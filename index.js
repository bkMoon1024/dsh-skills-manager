import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const name = '@local/skills-manager';

export const inject = ['webServer', 'skills', 'loader'];

/**
 * Web-session agents resolve the skill catalog through their own scope chain,
 * which never reaches the preset composition layers holding the filesystem
 * provider — every session then sees only the 4 bundled skills. A provider on
 * the global layer merges into every view (live agent, standing preset lease)
 * and the registry dedupes by name, so this restores user skills everywhere.
 */
function registerGlobalSkillProvider(ctx) {
  // loader.import during fiber startup races host boot and can reject silently
  // (verified live: identical registration injected post-boot works). Defer the
  // first attempt past startup, retry, and surface the outcome via /list so a
  // dead provider is observable instead of swallowed by a lost stdout warn.
  const status = { state: 'pending', attempts: 0, error: undefined };
  let provider;
  let disposed = false;
  let unregister;
  let timer;
  const maxAttempts = 6;
  const attempt = () => {
    if (disposed) return;
    status.attempts += 1;
    ctx.loader.import('@deepseek-ai/dsh-skill-filesystem').then((mod) => {
      if (disposed) return;
      unregister = ctx.skills.registerProvider((control) => {
        provider = new mod.FileSystemSkillProvider(ctx, control, {});
        return provider;
      });
      status.state = 'ready';
      status.error = undefined;
    }).catch((error) => {
      if (disposed) return;
      status.error = String(error?.stack ?? error);
      if (status.attempts < maxAttempts) {
        timer = setTimeout(attempt, 5000);
      } else {
        status.state = 'error';
        ctx.logger?.warn?.(`skills-manager: global skill provider unavailable after ${maxAttempts} attempts: ${status.error}`);
      }
    });
  };
  timer = setTimeout(attempt, 1000);
  ctx.effect(function* () {
    yield async () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unregister?.();
      await provider?.dispose();
    };
  }, 'skills-manager: global skill provider');
  return status;
}

const MOUNT = '/skills-manager/api';
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANAGED_KEYS = new Set(['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable']);
const MANAGED_KEY_ORDER = ['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable'];
/** dsh-skill-filesystem rejects these legacy spellings and ignores the whole skill. */
const LEGACY_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]);
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SKILL_BYTES = 2 * 1024 * 1024;

function skillsRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'skills');
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

/** Strict boolean grammar of dsh-skill-filesystem: true/false/yes/no/on/off/1/0, case-insensitive. */
function parseStrictBool(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(value)) return true;
  if (['false', 'no', 'off', '0'].includes(value)) return false;
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Frontmatter parsing
 *
 * A skill file's frontmatter is YAML. The manager only needs a handful of
 * keys, but it rewrites whole files, so anything it does not understand must
 * survive byte-for-byte. Each top-level key is therefore kept as a segment of
 * raw lines (key line + indented/blank continuation), and only managed keys
 * are re-rendered. Block scalars and unknown keys keep their original shape.
 * ------------------------------------------------------------------ */

const KEY_LINE_RE = /^([A-Za-z0-9_-]+)[ \t]*:(.*)$/;
const INDENTED_RE = /^[ \t]/;

function parseFrontmatterLines(fmLines) {
  const segments = [];
  let current;
  for (const line of fmLines) {
    if (line !== '' && !INDENTED_RE.test(line)) {
      const match = KEY_LINE_RE.exec(line);
      if (match) {
        current = { kind: 'key', key: match[1], lines: [line] };
        segments.push(current);
        continue;
      }
      current = { kind: 'raw', lines: [line] };
      segments.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else segments.push({ kind: 'raw', lines: [line] });
  }
  return segments;
}

/** Split a skill markdown file into frontmatter segments and body. */
function splitFrontmatter(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    return { problems: ['缺少 YAML frontmatter（文件必须以 --- 开头）'], eol, segments: [], body: '' };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end === -1) {
    return { problems: ['frontmatter 未闭合（缺少结束 ---）'], eol, segments: [], body: '' };
  }
  const segments = parseFrontmatterLines(lines.slice(1, end));
  // Leading blank lines are layout, not content; dropping them keeps repeated
  // saves from pushing the body down one line at a time.
  const body = lines.slice(end + 1).join(eol).replace(/^(?:[ \t]*\r?\n)+/, '');
  return { problems: [], eol, segments, body };
}

function findKeySegment(segments, key) {
  for (const segment of segments) {
    if (segment.kind === 'key' && segment.key === key) return segment;
  }
  return undefined;
}

function findClosingQuote(text, quote) {
  for (let i = 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === '\\') { i += 1; continue; }
    if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") { i += 1; continue; }
      return i;
    }
  }
  return -1;
}

function parseInlineScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value[0] === '"') {
    const end = findClosingQuote(value, '"');
    const token = end === -1 ? value : value.slice(0, end + 1);
    try { return JSON.parse(token); } catch { return token.slice(1, -1); }
  }
  if (value[0] === "'") {
    const end = findClosingQuote(value, "'");
    const token = end === -1 ? value : value.slice(0, end + 1);
    return token.slice(1, -1).replace(/''/g, "'");
  }
  // Plain scalar: an unquoted " #" starts a comment.
  const hash = value.search(/\s#/);
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

/** YAML folded/literal block scalar (`>` / `|`), with basic chomping support. */
function parseBlockScalar(indicator, lines) {
  const style = indicator[0];
  const chomp = indicator.includes('-') ? 'strip' : indicator.includes('+') ? 'keep' : 'clip';
  const content = [...lines];
  while (content.length > 0 && content[content.length - 1].trim() === '') content.pop();
  let indent = 0;
  for (const line of content) {
    if (line.trim() === '') continue;
    indent = line.match(/^[ \t]*/)[0].length;
    break;
  }
  const dedented = content.map((line) => {
    if (line.trim() === '') return '';
    return line.slice(Math.min(indent, line.match(/^[ \t]*/)[0].length));
  });
  let value;
  if (style === '|') {
    value = dedented.join('\n');
  } else {
    value = '';
    for (const line of dedented) {
      if (line === '') { value += '\n'; continue; }
      if (value !== '' && !value.endsWith('\n')) value += ' ';
      value += line;
    }
  }
  return chomp === 'strip' ? value.replace(/\n+$/, '') : value;
}

function foldPlainLines(lines) {
  const trimmed = lines.map((line) => line.trim());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  let value = '';
  for (const line of trimmed) {
    if (line === '') { value += '\n'; continue; }
    if (value !== '' && !value.endsWith('\n')) value += ' ';
    value += line;
  }
  return value;
}

/** Semantic value of one key segment (block scalar, quoted scalar, or plain). */
function readKeyValue(segment) {
  const match = KEY_LINE_RE.exec(segment.lines[0]);
  const inline = match ? match[2].trim() : '';
  const rest = segment.lines.slice(1);
  if (/^[>|]/.test(inline)) return parseBlockScalar(inline, rest);
  if (inline === '') return foldPlainLines(rest);
  const single = parseInlineScalar(inline);
  if (rest.every((line) => line.trim() === '')) return single;
  return foldPlainLines([single, ...rest.map((line) => line.trim())]);
}

/** YAML-plain-safe scalar: quote anything a YAML parser could misread; JSON strings are valid YAML. */
const YAML_AMBIGUOUS_RE = /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/i;
function yamlScalar(value) {
  const text = String(value ?? '');
  if (
    text === ''
    || YAML_AMBIGUOUS_RE.test(text)
    || /[:#\n\r\t"'\\[\]{}&*!|>%@`]/.test(text)
    || text !== text.trim()
    || /^[-?]/.test(text)
  ) {
    return JSON.stringify(text);
  }
  return text;
}

function renderManagedKey(key, next) {
  switch (key) {
    case 'name': return `name: ${yamlScalar(next.name)}`;
    case 'description': return `description: ${yamlScalar(next.description)}`;
    case 'whenToUse': return next.whenToUse ? `whenToUse: ${yamlScalar(next.whenToUse)}` : null;
    case 'disable-model-invocation': return next.modelInvocable === false ? 'disable-model-invocation: true' : null;
    case 'user-invocable': return next.userInvocable === false ? 'user-invocable: false' : null;
    default: return null;
  }
}

/**
 * Rebuild the frontmatter: managed keys are re-rendered at their original
 * position (or appended when absent), every other segment is kept verbatim.
 */
function serializeFrontmatter(next, original) {
  const eol = original?.eol ?? '\n';
  const segments = original?.segments ?? [];
  const seen = new Set();
  const out = [];
  for (const segment of segments) {
    if (segment.kind === 'key' && MANAGED_KEYS.has(segment.key)) {
      seen.add(segment.key);
      const line = renderManagedKey(segment.key, next);
      if (line !== null) out.push(line);
      continue;
    }
    out.push(...segment.lines);
  }
  for (const key of MANAGED_KEY_ORDER) {
    if (seen.has(key)) continue;
    const line = renderManagedKey(key, next);
    if (line !== null) out.push(line);
  }
  return { head: ['---', ...out, '---'].join(eol), eol };
}

/** frontmatter + exactly one blank line + trimmed body + trailing newline. */
function buildFileContent(head, eol, body) {
  const normalized = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  if (normalized === '') return `${head}${eol}`;
  return `${head}${eol}${eol}${normalized.split('\n').join(eol)}${eol}`;
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/** Describe one discovered skill entry; invalid entries keep their problems for the manager to surface. */
function describeEntry({ fallbackName, kind, relPath, fileAbs }) {
  const entry = {
    name: fallbackName,
    kind,
    file: relPath.split('\\').join('/'),
    valid: false,
    problems: [],
    description: '',
    whenToUse: '',
    modelInvocable: true,
    userInvocable: true,
    bodyChars: 0,
    mtimeMs: 0,
    missingFile: false,
  };
  if (kind === 'bundle' && !existsSync(fileAbs)) {
    entry.problems.push('目录缺少 SKILL.md');
    entry.missingFile = true;
    return entry;
  }
  let stat;
  try { stat = statSync(fileAbs); } catch (error) {
    entry.problems.push(`无法读取文件：${error.message}`);
    return entry;
  }
  entry.mtimeMs = Math.round(stat.mtimeMs);
  if (stat.size > MAX_SKILL_BYTES) {
    entry.problems.push(`文件过大（${stat.size} 字节），超过 ${MAX_SKILL_BYTES} 字节上限`);
    return entry;
  }
  let text;
  try { text = readFileSync(fileAbs, 'utf8'); } catch (error) {
    entry.problems.push(`无法读取文件：${error.message}`);
    return entry;
  }
  const parsed = splitFrontmatter(text);
  entry.bodyChars = parsed.body.length;
  for (const problem of parsed.problems) entry.problems.push(problem);
  if (parsed.problems.length > 0) return entry;

  const nameSegment = findKeySegment(parsed.segments, 'name');
  const nameValue = nameSegment ? readKeyValue(nameSegment) : '';
  if (nameValue === '') entry.problems.push('缺少 name');
  else {
    entry.name = nameValue;
    if (!NAME_RE.test(nameValue)) entry.problems.push(`name 不是 kebab-case：${nameValue}`);
  }
  const descriptionSegment = findKeySegment(parsed.segments, 'description');
  const descriptionValue = descriptionSegment ? readKeyValue(descriptionSegment) : '';
  if (descriptionValue === '') entry.problems.push('缺少 description');
  else entry.description = descriptionValue;
  const whenSegment = findKeySegment(parsed.segments, 'whenToUse');
  if (whenSegment) entry.whenToUse = readKeyValue(whenSegment);
  const dmiSegment = findKeySegment(parsed.segments, 'disable-model-invocation');
  if (dmiSegment) {
    const raw = readKeyValue(dmiSegment);
    if (raw !== '') {
      const value = parseStrictBool(raw);
      if (value === undefined) entry.problems.push(`disable-model-invocation 值无效：${raw}`);
      else entry.modelInvocable = !value;
    }
  }
  const uiSegment = findKeySegment(parsed.segments, 'user-invocable');
  if (uiSegment) {
    const raw = readKeyValue(uiSegment);
    if (raw !== '') {
      const value = parseStrictBool(raw);
      if (value === undefined) entry.problems.push(`user-invocable 值无效：${raw}`);
      else entry.userInvocable = value;
    }
  }
  for (const segment of parsed.segments) {
    if (segment.kind !== 'key') continue;
    const canonical = LEGACY_KEYS.get(segment.key);
    if (canonical) entry.problems.push(`使用了不支持的旧键 ${segment.key}，DSH 会忽略该技能；请改为 ${canonical}`);
  }
  entry.valid = entry.problems.length === 0;
  return entry;
}

function scanRoot(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue;
    const full = join(root, dirent.name);
    let isDirectory = dirent.isDirectory();
    let isFile = dirent.isFile();
    // dsh-skill-filesystem follows symlinks/junctions; the manager must see
    // exactly the skills a session can load.
    if (!isDirectory && !isFile && dirent.isSymbolicLink()) {
      try {
        const stat = statSync(full);
        isDirectory = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue;
      }
    }
    if (isDirectory) {
      out.push(describeEntry({
        fallbackName: dirent.name,
        kind: 'bundle',
        relPath: `${dirent.name}/SKILL.md`,
        fileAbs: join(root, dirent.name, 'SKILL.md'),
      }));
    } else if (isFile && dirent.name.endsWith('.md')) {
      out.push(describeEntry({
        fallbackName: dirent.name.replace(/\.md$/, ''),
        kind: 'flat',
        relPath: dirent.name,
        fileAbs: join(root, dirent.name),
      }));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function assertSafeName(value) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw httpError(400, `技能名称必须是小写 kebab-case（字母数字与连字符），收到：${JSON.stringify(value)}`);
  }
}

/** Lookups (get/policy/delete/originalName) address existing scan entries, whose dir name may be non-kebab. */
function assertEntryKey(value) {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..' || /[\\/:*?"<>|\r\n]/.test(value)) {
    throw httpError(400, `无效的技能条目名：${JSON.stringify(value)}`);
  }
}

function readForEdit(root, entry) {
  const fileAbs = join(root, entry.file);
  let text;
  try { text = readFileSync(fileAbs, 'utf8'); } catch (error) {
    throw httpError(500, `无法读取 ${entry.file}：${error.message}`);
  }
  return splitFrontmatter(text);
}

/** Atomic write; the previous content is copied into <root>/.backups first. */
function writeSkillFile(root, fileAbs, content) {
  mkdirSync(dirname(fileAbs), { recursive: true });
  if (existsSync(fileAbs)) {
    try {
      const backups = join(root, '.backups');
      mkdirSync(backups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const relative = fileAbs.slice(root.length + 1).split(/[\\/]/).join('__');
      copyFileSync(fileAbs, join(backups, `${stamp}-${relative}`));
    } catch { /* backup is best-effort */ }
  }
  const tmp = `${fileAbs}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, fileAbs);
}

/** Deletes move into <root>/.trash instead of vanishing, so a misclick is recoverable. */
function trashPath(root, leaf) {
  const dir = join(root, '.trash');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${stamp}-${leaf}`);
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function send(res, code, payload) {
  if (res.writableEnded) return;
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function trustedHostnames() {
  return new Set(
    String(process.env.DSH_SKILLS_MANAGER_TRUSTED_HOSTS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * Mirrors the fence dsh-client-connection puts in front of /api: the Host must
 * be loopback (or explicitly trusted), cross-site browser requests are refused,
 * and a present Origin must match the Host. Without this the plugin's routes
 * are reachable from any web page the user visits.
 */
function assertTrustedRequest(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') throw httpError(403, '缺少 Host 请求头');
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { throw httpError(403, 'Host 请求头无效'); }
  if (hostUrl.username !== '' || hostUrl.password !== '' || hostUrl.pathname !== '/' || hostUrl.search !== '' || hostUrl.hash !== '') {
    throw httpError(403, 'Host 请求头无效');
  }
  const hostname = normalizeHostname(hostUrl.hostname);
  const loopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
  if (!loopback && !trustedHostnames().has(hostname)) {
    throw httpError(403, '只允许从本机访问技能管理接口');
  }
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
    throw httpError(403, '拒绝跨站请求');
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originUrl;
    try { originUrl = new URL(origin); } catch { throw httpError(403, 'Origin 请求头无效'); }
    if (originUrl.host !== hostUrl.host) throw httpError(403, 'Origin 与 Host 不一致');
  }
}

function assertJsonRequest(req) {
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw httpError(415, '请求必须使用 application/json');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      reject(httpError(413, `请求体超过 ${MAX_BODY_BYTES} 字节上限`));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(httpError(413, `请求体超过 ${MAX_BODY_BYTES} 字节上限`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const parsed = text === '' ? {} : JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(httpError(400, '请求体必须是 JSON 对象'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(httpError(400, `请求体不是合法 JSON：${error.message}`));
      }
    });
    req.on('error', (error) => fail(httpError(400, `读取请求体失败：${error.message}`)));
  });
}

/* ------------------------------------------------------------------ *
 * Opening the skills directory in the OS file manager
 * ------------------------------------------------------------------ */

/**
 * Explorer splits its command line on commas and equals signs, and it wants a
 * file URL rather than a native path. Keep ASCII escapes intact and decode the
 * UTF-8 runs so non-ASCII home directories open correctly.
 */
function explorerTarget(path) {
  return pathToFileURL(path, { windows: true }).href
    .replace(/(?:%[89A-F][0-9A-F])+/gi, (run) => decodeURIComponent(run))
    .replaceAll(',', '%2C')
    .replaceAll('=', '%3D');
}

function spawnDetached(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    child.once('error', rejectPromise);
    child.once('spawn', () => {
      child.removeListener('error', rejectPromise);
      child.unref();
      resolvePromise();
    });
  });
}

function openDirectoryDefault(target) {
  if (process.platform === 'win32') return spawnDetached('explorer.exe', [explorerTarget(target)]);
  if (process.platform === 'darwin') return spawnDetached('open', [target]);
  if (process.platform === 'linux') return spawnDetached('xdg-open', [target]);
  throw httpError(501, `当前平台不支持打开目录：${process.platform}`);
}

/** Replaced by the test suite so tests never launch a real file manager. */
let openDirectoryImpl = openDirectoryDefault;

async function openDirectory(target) {
  try {
    await openDirectoryImpl(target);
  } catch (error) {
    if (error?.statusCode) throw error;
    throw httpError(500, `无法打开目录：${error?.message ?? String(error)}`);
  }
}

function resolveOpenTarget(root, name) {
  if (typeof name !== 'string' || name === '') return { target: root, skill: undefined };
  assertEntryKey(name);
  const entry = scanRoot(root).find((item) => item.name === name);
  if (!entry) throw httpError(404, `找不到技能 ${name}`);
  const target = entry.kind === 'bundle' ? dirname(join(root, entry.file)) : root;
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw httpError(400, '拒绝打开技能目录之外的路径');
  }
  return { target: resolvedTarget, skill: entry };
}

async function openHandler(root, args) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const { target, skill } = resolveOpenTarget(root, args.name);
  await openDirectory(target);
  return { ok: true, path: target, kind: skill ? skill.kind : 'root' };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function listHandler(root, providerStatus) {
  return {
    ok: true,
    root,
    rootExists: existsSync(root),
    skills: scanRoot(root),
    provider: { state: providerStatus.state, attempts: providerStatus.attempts, error: providerStatus.error },
  };
}

function getHandler(root, name) {
  assertEntryKey(name);
  const entry = scanRoot(root).find((item) => item.name === name);
  if (!entry) throw httpError(404, `找不到技能 ${name}`);
  const fileAbs = join(root, entry.file);
  if (!existsSync(fileAbs)) throw httpError(404, `${entry.file} 不存在`);
  const parsed = readForEdit(root, entry);
  const extraFrontmatterLines = [];
  for (const segment of parsed.segments) {
    if (segment.kind === 'key' && MANAGED_KEYS.has(segment.key)) continue;
    extraFrontmatterLines.push(...segment.lines);
  }
  return {
    ok: true,
    skill: {
      ...entry,
      body: parsed.body,
      extraFrontmatterLines,
    },
  };
}

function resolveOriginal(root, originalName) {
  if (typeof originalName !== 'string' || originalName === '') return undefined;
  assertEntryKey(originalName);
  const original = scanRoot(root).find((item) => item.name === originalName);
  if (!original) throw httpError(404, `找不到原技能 ${originalName}`);
  return original;
}

/** Refuse a write when the file changed since the editor loaded it. */
function assertFresh(root, original, expectedMtimeMs) {
  if (!original || typeof expectedMtimeMs !== 'number') return;
  try {
    const stat = statSync(join(root, original.file));
    if (Math.round(stat.mtimeMs) !== Math.round(expectedMtimeMs)) {
      throw httpError(409, '文件已被其他窗口修改，请刷新后重试');
    }
  } catch (error) {
    if (error.statusCode) throw error;
  }
}

function saveHandler(root, args) {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  assertSafeName(name);
  const description = typeof args.description === 'string' ? args.description.replace(/\s+/g, ' ').trim() : '';
  if (description === '') throw httpError(400, 'description 不能为空');
  const whenToUse = typeof args.whenToUse === 'string' ? args.whenToUse.replace(/\s+/g, ' ').trim() : '';
  const modelInvocable = args.modelInvocable !== false;
  const userInvocable = args.userInvocable !== false;
  const body = typeof args.body === 'string' ? args.body.replace(/\r\n/g, '\n') : '';
  const original = resolveOriginal(root, args.originalName);
  assertFresh(root, original, args.expectedMtimeMs);
  if (name !== original?.name) {
    const clash = scanRoot(root).find((item) => item.name === name);
    if (clash) throw httpError(409, `名称 ${name} 已被占用（${clash.file}）`);
  }
  const kind = original?.kind ?? 'bundle';
  const parsedOriginal = original ? readForEdit(root, original) : undefined;
  const { head, eol } = serializeFrontmatter(
    { name, description, whenToUse, modelInvocable, userInvocable },
    parsedOriginal,
  );
  const content = buildFileContent(head, eol, body);
  if (kind === 'bundle') {
    let targetDir = original ? dirname(join(root, original.file)) : join(root, name);
    let renamedFrom;
    try {
      if (original && original.name !== name) {
        renamedFrom = targetDir;
        targetDir = join(root, name);
        renameSync(renamedFrom, targetDir);
      }
      writeSkillFile(root, join(targetDir, 'SKILL.md'), content);
    } catch (error) {
      if (renamedFrom && renamedFrom !== targetDir) {
        try { renameSync(targetDir, renamedFrom); } catch { /* rollback is best-effort */ }
      }
      throw error;
    }
    return { ok: true, file: `${name}/SKILL.md` };
  }
  // Flat skills: keep the existing filename unless the user renamed the skill,
  // otherwise a file whose name differs from its frontmatter name would gain a
  // duplicate sibling on every save.
  const targetFile = original && original.name === name
    ? join(root, original.file)
    : join(root, `${name}.md`);
  if (original && original.name !== name) {
    const oldFile = join(root, original.file);
    if (oldFile !== targetFile) renameSync(oldFile, targetFile);
  }
  writeSkillFile(root, targetFile, content);
  return { ok: true, file: `${name}.md` };
}

function policyHandler(root, args) {
  const name = typeof args.name === 'string' ? args.name : '';
  assertEntryKey(name);
  const entry = scanRoot(root).find((item) => item.name === name);
  if (!entry) throw httpError(404, `找不到技能 ${name}`);
  assertFresh(root, entry, args.expectedMtimeMs);
  if (!existsSync(join(root, entry.file))) throw httpError(400, `${entry.file} 不存在，无法修改调用策略`);
  const parsed = readForEdit(root, entry);
  if (parsed.problems.length > 0) throw httpError(400, `无法解析 ${entry.file}：${parsed.problems.join('；')}`);
  const modelInvocable = typeof args.modelInvocable === 'boolean' ? args.modelInvocable : entry.modelInvocable;
  const userInvocable = typeof args.userInvocable === 'boolean' ? args.userInvocable : entry.userInvocable;
  const { head, eol } = serializeFrontmatter({
    name: entry.name,
    description: entry.description,
    whenToUse: entry.whenToUse,
    modelInvocable,
    userInvocable,
  }, parsed);
  writeSkillFile(root, join(root, entry.file), buildFileContent(head, eol, parsed.body));
  return { ok: true };
}

function deleteHandler(root, args) {
  const name = typeof args.name === 'string' ? args.name : '';
  assertEntryKey(name);
  const entry = scanRoot(root).find((item) => item.name === name);
  if (!entry) throw httpError(404, `找不到技能 ${name}`);
  const fileAbs = join(root, entry.file);
  const resolved = fileAbs.split('\\').join('/');
  const rootPrefix = root.split('\\').join('/').replace(/\/$/, '') + '/';
  if (!resolved.startsWith(rootPrefix)) throw httpError(400, '拒绝删除技能目录之外的路径');
  const leaf = entry.kind === 'bundle' ? dirname(join(root, entry.file)) : fileAbs;
  const target = trashPath(root, leaf.split(/[\\/]/).pop());
  renameSync(leaf, target);
  return { ok: true, trashed: target.split(root).pop()?.replace(/^[\\/]/, '') };
}

export function apply(ctx) {
  const providerStatus = registerGlobalSkillProvider(ctx);
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: MOUNT,
    handler: async (req, res) => {
      try {
        assertTrustedRequest(req);
        const url = new URL(req.url, 'http://127.0.0.1');
        const stripped = url.pathname.startsWith(MOUNT) ? url.pathname.slice(MOUNT.length) : url.pathname;
        const route = stripped.replace(/\/+$/, '') || '/';
        const root = skillsRoot();
        if (req.method === 'GET' && (route === '/' || route === '/list')) {
          send(res, 200, listHandler(root, providerStatus));
          return;
        }
        if (req.method === 'GET' && route === '/get') {
          send(res, 200, getHandler(root, url.searchParams.get('name') ?? ''));
          return;
        }
        if (req.method === 'POST') assertJsonRequest(req);
        if (req.method === 'POST' && route === '/save') {
          send(res, 200, saveHandler(root, await readJsonBody(req)));
          return;
        }
        if (req.method === 'POST' && route === '/policy') {
          send(res, 200, policyHandler(root, await readJsonBody(req)));
          return;
        }
        if (req.method === 'POST' && route === '/open') {
          send(res, 200, await openHandler(root, await readJsonBody(req)));
          return;
        }
        if (req.method === 'POST' && route === '/delete') {
          send(res, 200, deleteHandler(root, await readJsonBody(req)));
          return;
        }
        send(res, 404, { ok: false, error: `未知接口 ${req.method} ${route}` });
      } catch (error) {
        send(res, error.statusCode ?? 500, { ok: false, error: error.message ?? String(error) });
      }
    },
  }), 'skills-manager: api');
}

/** Internal hooks for the test suite; not part of the plugin's public API. */
export const __test = {
  splitFrontmatter,
  serializeFrontmatter,
  buildFileContent,
  readKeyValue,
  parseStrictBool,
  describeEntry,
  scanRoot,
  explorerTarget,
  resolveOpenTarget,
  setOpener(fn) {
    openDirectoryImpl = typeof fn === 'function' ? fn : openDirectoryDefault;
  },
};
