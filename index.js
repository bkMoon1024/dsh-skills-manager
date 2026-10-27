import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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
        // A distinct name avoids dsh-scope's "a skill provider named
        // \"filesystem\" is already registered" when the host's own
        // skill-filesystem row is enabled outside the web bundle.
        provider = new mod.FileSystemSkillProvider(ctx, control, { providerName: 'skills-manager' });
        return provider;
      });
      status.state = 'ready';
      status.error = undefined;
    }).catch((error) => {
      if (disposed) return;
      // /list shows this string in the browser; keep the stack (which contains
      // absolute paths) in the host log only.
      status.error = String(error?.message ?? error);
      if (status.attempts < maxAttempts) {
        timer = setTimeout(attempt, 5000);
      } else {
        status.state = 'error';
        ctx.logger?.warn?.(`skills-manager: global skill provider unavailable after ${maxAttempts} attempts: ${error?.stack ?? error}`);
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
/** NAME_RE would accept strings the filesystem cannot hold (Windows devices, >255 bytes). */
const MAX_NAME_LENGTH = 64;
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** History directories grow on every write; keep a bounded, newest-first window. */
const MAX_BACKUPS = 200;
const MAX_TRASH = 100;

/** Host providers read both global catalogs; the manager must show the same set. */
function skillsRoots() {
  const env = (key, fallback) => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  };
  const home = env('DSH_HOME', join(homedir(), '.dsh'));
  const agentsHome = env('DSH_AGENTS_HOME', join(homedir(), '.agents'));
  const candidates = [
    { key: 'dsh', path: join(home, 'skills') },
    { key: 'agents', path: join(agentsHome, 'skills') },
  ];
  const seen = new Set();
  return candidates.filter((root) => {
    const absolute = resolve(root.path);
    if (seen.has(absolute)) return false;
    seen.add(absolute);
    root.path = absolute;
    return true;
  });
}

/** Human-friendly label for a root path; keeps the directory switcher short. */
function displayRootPath(path) {
  const home = homedir();
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  if (path.startsWith(prefix)) return `~${sep}${path.slice(prefix.length)}`;
  return path;
}

const DEFAULT_ROOT_KEY = 'dsh';

/** Resolve a browser-supplied root key against the known roots (never a raw path). */
function rootInfo(key) {
  const roots = skillsRoots();
  const wanted = typeof key === 'string' && key !== '' ? key : DEFAULT_ROOT_KEY;
  const found = roots.find((root) => root.key === wanted);
  if (!found) throw httpError(400, `未知的技能根目录：${wanted}`);
  return found;
}

/** Scan every existing root and tag entries with the root they came from. */
function scanAll(roots) {
  const skills = [];
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    for (const entry of scanRoot(root.path)) {
      skills.push({ ...entry, rootKey: root.key, rootPath: root.path });
    }
  }
  return skills;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Filesystem errors carry absolute paths and platform-specific wording; the
 * browser gets a stable, path-free message instead (the UI already shows the
 * skills root, and the detail ended up in screenshots/support tickets).
 */
const FS_ERROR_MESSAGES = new Map([
  ['ENAMETOOLONG', '名称或路径过长'],
  ['EACCES', '没有访问权限'],
  ['EPERM', '操作不被允许，文件可能被占用或权限不足'],
  ['ENOENT', '文件或目录不存在'],
  ['ENOTDIR', '路径中存在同名文件'],
  ['EISDIR', '路径是目录'],
  ['ENOSPC', '磁盘空间不足'],
  ['EROFS', '文件系统只读'],
  ['EBUSY', '文件正被占用'],
  ['ELOOP', '符号链接层级过深'],
  ['ENOTEMPTY', '目录非空'],
  ['EMFILE', '打开的文件过多'],
  ['EIO', '磁盘读写错误'],
]);

function describeError(error) {
  if (error?.statusCode) return error.message;
  const hint = FS_ERROR_MESSAGES.get(error?.code);
  if (hint) return `${hint}（${error.code}）`;
  // Unknown filesystem errors carry the absolute path in `message`; the API is
  // browser-facing, so don't echo it. The code alone is enough to diagnose.
  if (typeof error?.code === 'string' && /^E[A-Z0-9]+$/.test(error.code)) {
    return `文件操作失败（${error.code}）`;
  }
  return error?.message ?? String(error);
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

// YAML keys may be quoted ("name": value) and a colon only starts a mapping
// entry when it is followed by a space or the end of the line. Treating
// `name:demo` as a key used to make the manager "repair" a file by appending a
// second `name:` line, which makes the YAML unparsable for DSH.
const KEY_LINE_RE = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))[ \t]*:(?:[ \t]+(.*))?$/;
const INDENTED_RE = /^[ \t]/;

function keyLineMatch(line) {
  const match = KEY_LINE_RE.exec(line);
  if (!match) return undefined;
  return { key: match[1] ?? match[2] ?? match[3], value: match[4] ?? '' };
}

function parseFrontmatterLines(fmLines) {
  const segments = [];
  let current;
  for (const line of fmLines) {
    if (line !== '' && !INDENTED_RE.test(line)) {
      const match = keyLineMatch(line);
      if (match) {
        current = { kind: 'key', key: match.key, lines: [line] };
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

/**
 * Split a skill markdown file into frontmatter segments and body.
 *
 * A UTF-8 BOM is detected because DSH cannot parse a BOM-prefixed frontmatter;
 * the manager flags it and strips it on the next write. A file whose
 * frontmatter cannot be parsed still exposes its text as `body`: the editor
 * must never present such a file as empty, or saving would silently replace
 * its content with a blank body. When an unclosed block still contains a
 * blank line plus recognizable keys, the keys are recovered so a repair does
 * not duplicate the old frontmatter inside the body.
 */
function splitFrontmatter(text) {
  const source = String(text ?? '');
  const bom = source.startsWith('\uFEFF');
  const raw = bom ? source.slice(1) : source;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== '---') {
    return { problems: ['缺少 YAML frontmatter（文件必须以 --- 开头）'], eol, segments: [], body: raw, bom, unparsed: true };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') { end = i; break; }
  }
  if (end === -1) {
    const blank = lines.findIndex((line, index) => index > 0 && line.trim() === '');
    if (blank > 0) {
      const candidate = parseFrontmatterLines(lines.slice(1, blank));
      const hasKey = candidate.some((segment) => segment.kind === 'key' && (segment.key === 'name' || segment.key === 'description'));
      if (hasKey) {
        const body = lines.slice(blank + 1).join(eol).replace(/^(?:[ \t]*\r?\n)+/, '');
        return {
          problems: ['frontmatter 未闭合（缺少结束 ---），保存时会补齐'],
          eol,
          segments: candidate,
          body,
          bom,
          unparsed: true,
          recovered: true,
        };
      }
    }
    return { problems: ['frontmatter 未闭合（缺少结束 ---）'], eol, segments: [], body: raw, bom, unparsed: true };
  }
  const segments = parseFrontmatterLines(lines.slice(1, end));
  // Leading blank lines are layout, not content; dropping them keeps repeated
  // saves from pushing the body down one line at a time.
  const body = lines.slice(end + 1).join(eol).replace(/^(?:[ \t]*\r?\n)+/, '');
  return { problems: [], eol, segments, body, bom, unparsed: false };
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
    // An unterminated quote (YAML allows the closing quote on a later line)
    // keeps everything after the opening quote; chopping the last character
    // here used to corrupt the value by one byte.
    if (end === -1) return value.slice(1);
    const token = value.slice(0, end + 1);
    try { return JSON.parse(token); } catch { return token.slice(1, -1); }
  }
  if (value[0] === "'") {
    const end = findClosingQuote(value, "'");
    if (end === -1) return value.slice(1).replace(/''/g, "'");
    const token = value.slice(0, end + 1);
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
  // A comment line between the key and its continuation is YAML layout, not
  // part of the value; folding it in used to turn `# note` into description
  // text that the next save persisted.
  const kept = lines.filter((line) => !/^[ \t]*#/.test(line));
  const trimmed = kept.map((line) => line.trim());
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
  const match = keyLineMatch(segment.lines[0]);
  const inline = match ? match.value.trim() : '';
  const rest = segment.lines.slice(1);
  if (/^[>|]/.test(inline)) return parseBlockScalar(inline, rest);
  const restPlain = rest.filter((line) => !/^[ \t]*#/.test(line));
  if (inline === '') return foldPlainLines(restPlain);
  // YAML permits a quoted scalar to span lines: `description: "first\n  second"`.
  // Fold the continuation lines first, otherwise the closing quote is missed and
  // the value gets mangled on the next write.
  if ((inline[0] === '"' || inline[0] === "'") && findClosingQuote(inline, inline[0]) === -1) {
    const joined = [inline, ...restPlain.map((line) => line.trim()).filter((line) => line !== '')].join(' ');
    if (findClosingQuote(joined, inline[0]) !== -1) return parseInlineScalar(joined);
  }
  const single = parseInlineScalar(inline);
  if (restPlain.every((line) => line.trim() === '')) return single;
  return foldPlainLines([single, ...restPlain.map((line) => line.trim())]);
}

/**
 * YAML-plain-safe scalar: quote anything a YAML parser could misread; JSON
 * strings are valid YAML. Besides the YAML 1.1 booleans, numbers written in
 * hex/octal/binary form, `.inf`/`.nan` and anything that merely *starts* like a
 * number (`0x10` parses as 16, `2024-01-01` may become a timestamp) are quoted.
 */
const YAML_AMBIGUOUS_RE = /^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|\.(?:inf|nan))$/i;
// A plain scalar may not start with an indicator character; `- foo`, `? foo`
// and `[x]` are otherwise parsed as sequences, mappings or flow collections.
const YAML_LEADING_INDICATOR_RE = /^[-?:,[\]{}#&*!|>'"%@`]/;
function yamlScalar(value) {
  const text = String(value ?? '');
  if (
    text === ''
    || YAML_AMBIGUOUS_RE.test(text)
    || YAML_LEADING_INDICATOR_RE.test(text)
    || /[:#\n\r\t"'\\[\]{}&*!|>%@`]/.test(text)
    || /^[-+]?[.\d]/.test(text)
    || text !== text.trim()
  ) {
    // JSON strings are valid YAML double-quoted scalars; U+2028/U+2029 are the
    // exception (JSON leaves them raw, YAML treats them as line breaks).
    return JSON.stringify(text).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
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

/** True when a managed key already carries the requested semantic value. */
function managedValueMatches(key, segment, next) {
  const current = readKeyValue(segment);
  switch (key) {
    case 'name': return current === next.name;
    case 'description': return current === next.description;
    case 'whenToUse': return current === String(next.whenToUse ?? '');
    case 'disable-model-invocation': return (parseStrictBool(current) === true) === (next.modelInvocable === false);
    case 'user-invocable': {
      const value = parseStrictBool(current);
      return (value === undefined ? true : value) === (next.userInvocable !== false);
    }
    default: return false;
  }
}

/**
 * Rebuild the frontmatter: managed keys are re-rendered at their original
 * position (or appended when absent), every other segment is kept verbatim.
 * A managed key whose semantic value did not change keeps its original bytes,
 * so a block scalar or a quoted description is not flattened by an unrelated
 * policy toggle. Legacy invocation keys are dropped here: their values were
 * already carried over into the canonical keys, and leaving them in place makes
 * dsh-skill-filesystem ignore the whole skill.
 */
function serializeFrontmatter(next, original) {
  const eol = original?.eol ?? '\n';
  const segments = original?.segments ?? [];
  const seen = new Set();
  const out = [];
  for (const segment of segments) {
    if (segment.kind === 'key' && LEGACY_KEYS.has(segment.key)) continue;
    if (segment.kind === 'key' && MANAGED_KEYS.has(segment.key)) {
      if (seen.has(segment.key)) continue; // duplicate key: collapse to the first occurrence
      seen.add(segment.key);
      if (managedValueMatches(segment.key, segment, next)) {
        out.push(...segment.lines);
        continue;
      }
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
  return { head: ['---', ...out, '---'].join(eol), eol, bom: original?.bom === true };
}

/**
 * frontmatter + exactly one blank line + trimmed body + trailing newline.
 *
 * A UTF-8 BOM is never re-emitted: dsh-skill-filesystem reads the first line
 * verbatim (`---`) and silently ignores BOM-prefixed skills, so preserving the
 * BOM would keep a skill permanently unloadable.
 */
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

/** YAML scalars that dsh-skill-filesystem rejects because they are not strings. */
const NON_STRING_SCALAR_RE = /^(?:~|null|true|false|0x[0-9a-f]+|0o[0-7]+|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|\.(?:inf|nan))$/i;

/** Flag a managed value that YAML will not read back as a plain string. */
function plainScalarProblem(segment) {
  const match = keyLineMatch(segment.lines[0]);
  if (!match) return undefined;
  const inline = match.value.trim();
  if (inline === '') {
    // `description:` followed by `  nested: value` is a YAML mapping, not a
    // string; dsh-skill-filesystem rejects the skill. A colon without a
    // following space (e.g. a URL) is still a plain scalar.
    const nested = segment.lines.slice(1).some((line) => /^[ \t]+[^\s#:][^\n:]*:(?:[ \t]+|$)/.test(line));
    return nested ? 'YAML 会解析为映射，不是字符串' : undefined;
  }
  if (/^[>|]/.test(inline)) return undefined;
  if (inline[0] === '"' || inline[0] === "'") {
    const joined = [inline, ...segment.lines.slice(1).map((line) => line.trim()).filter(Boolean)].join(' ');
    return findClosingQuote(joined, inline[0]) === -1 ? 'YAML 引号未闭合' : undefined;
  }
  if (inline[0] === '[' || inline[0] === '{') return 'YAML 会解析为列表或对象，不是字符串';
  if (NON_STRING_SCALAR_RE.test(inline)) return 'YAML 会解析为 null/布尔/数字，不是字符串';
  if (inline[0] === '&' || inline[0] === '*' || inline[0] === '!') return 'YAML 标签/锚点/别名不能作为字符串值';
  return undefined;
}

/** Cheap structural checks for YAML shapes the manager must not call "valid". */
function yamlStructuralProblems(segments) {
  const problems = [];
  let tabbed = false;
  for (const segment of segments) {
    if (!tabbed && segment.lines.some((line) => line.startsWith('\t'))) {
      problems.push('frontmatter 使用制表符缩进，YAML 不允许');
      tabbed = true;
    }
    if (segment.kind !== 'key') continue;
    const match = keyLineMatch(segment.lines[0]);
    if (!match) continue;
    const inline = match.value.trim();
    if (inline[0] === '[' || inline[0] === '{') {
      const close = inline[0] === '[' ? ']' : '}';
      const joined = [inline, ...segment.lines.slice(1)].join('\n').trimEnd();
      if (!joined.endsWith(close)) problems.push(`YAML 语法错误：${segment.key} 的 ${inline[0]} 没有闭合`);
    }
  }
  return problems;
}

/** Describe one discovered skill entry; invalid entries keep their problems for the manager to surface. */
function describeEntry({ fallbackName, kind, relPath, fileAbs }) {
  const entry = {
    name: fallbackName,
    kind,
    file: relPath.split(sep).join('/'),
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
    entry.problems.push(`无法读取文件：${error.code ?? error.message}`);
    return entry;
  }
  entry.mtimeMs = Math.round(stat.mtimeMs);
  if (stat.size > MAX_SKILL_BYTES) {
    entry.problems.push(`文件过大（${stat.size} 字节），超过 ${MAX_SKILL_BYTES} 字节上限`);
    return entry;
  }
  let text;
  try { text = readFileSync(fileAbs, 'utf8'); } catch (error) {
    entry.problems.push(`无法读取文件：${error.code ?? error.message}`);
    return entry;
  }
  const parsed = splitFrontmatter(text);
  entry.bodyChars = parsed.body.length;
  for (const problem of parsed.problems) entry.problems.push(problem);
  if (parsed.bom) entry.problems.push('文件以 UTF-8 BOM 开头，DSH 会忽略该技能；保存会移除 BOM');
  // An unparsable file with no recoverable keys has nothing more to inspect;
  // a recovered one still exposes its real name/description/body.
  if (parsed.problems.length > 0 && parsed.segments.length === 0) return entry;

  // Duplicate top-level keys make the YAML parser reject the whole document, so
  // the skill is loaded by nobody; surfacing it here lets a save repair the file.
  const seenKeys = new Set();
  for (const segment of parsed.segments) {
    if (segment.kind !== 'key') continue;
    if (seenKeys.has(segment.key)) entry.problems.push(`frontmatter 中存在重复键 ${segment.key}，YAML 解析会失败`);
    seenKeys.add(segment.key);
  }
  for (const problem of yamlStructuralProblems(parsed.segments)) entry.problems.push(problem);

  const nameSegment = findKeySegment(parsed.segments, 'name');
  const nameValue = nameSegment ? readKeyValue(nameSegment) : '';
  if (nameSegment) {
    const scalarProblem = plainScalarProblem(nameSegment);
    if (scalarProblem) entry.problems.push(`name 无效：${scalarProblem}`);
  }
  if (nameValue === '') entry.problems.push('缺少 name');
  else {
    entry.name = nameValue;
    if (!NAME_RE.test(nameValue)) entry.problems.push(`name 不是 kebab-case：${nameValue}`);
  }
  const descriptionSegment = findKeySegment(parsed.segments, 'description');
  const descriptionValue = descriptionSegment ? readKeyValue(descriptionSegment) : '';
  if (descriptionSegment) {
    const scalarProblem = plainScalarProblem(descriptionSegment);
    if (scalarProblem) entry.problems.push(`description 无效：${scalarProblem}`);
  }
  if (descriptionValue === '') entry.problems.push('缺少 description');
  else entry.description = descriptionValue;
  const whenSegment = findKeySegment(parsed.segments, 'whenToUse');
  if (whenSegment) {
    entry.whenToUse = readKeyValue(whenSegment);
    const scalarProblem = plainScalarProblem(whenSegment);
    if (scalarProblem) entry.problems.push(`whenToUse 无效：${scalarProblem}`);
  }
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
    if (!canonical) continue;
    entry.problems.push(`使用了不支持的旧键 ${segment.key}，DSH 会忽略该技能；请改为 ${canonical}`);
    // The skill is invalid, but its invocation intent is still readable. Carry
    // the legacy value over so a repair-save does not silently reset the policy;
    // the canonical key, when present, wins.
    if (findKeySegment(parsed.segments, canonical)) continue;
    const raw = readKeyValue(segment);
    if (raw === '') continue;
    const value = parseStrictBool(raw);
    if (value === undefined) continue;
    if (segment.key === 'disableModelInvocation') entry.modelInvocable = !value;
    else if (segment.key === 'modelInvocable') entry.modelInvocable = value;
    else if (segment.key === 'userInvocable') entry.userInvocable = value;
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
  if (typeof value !== 'string' || value.length > MAX_NAME_LENGTH || !NAME_RE.test(value)) {
    throw httpError(400, `技能名称必须是最多 ${MAX_NAME_LENGTH} 个字符的小写 kebab-case（字母数字与连字符），收到：${JSON.stringify(value)}`);
  }
  // `con`, `nul`, `com1`… cannot be opened by Explorer even when Node manages to
  // create them, which would leave an unusable skill behind.
  if (WINDOWS_RESERVED_RE.test(value)) {
    throw httpError(400, `技能名称 ${value} 是 Windows 保留设备名，无法创建可访问的目录，请换一个名称`);
  }
}

/** Lookups (get/policy/delete/originalName) address existing scan entries, whose dir name may be non-kebab. */
function assertEntryKey(value) {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..' || /[\\/:*?"<>|\r\n]/.test(value)) {
    throw httpError(400, `无效的技能条目名：${JSON.stringify(value)}`);
  }
}

/**
 * Resolve one scan entry. The browser sends the exact `file` it rendered, which
 * is unique even when two skills share a frontmatter `name`; `name` remains the
 * fallback for older clients and for scripts. `file` is only ever compared with
 * scanned entries — it is never joined onto the root.
 */
function findEntry(entries, { file, name }) {
  const relFile = typeof file === 'string' && file !== '' ? file.split('\\').join('/') : '';
  if (relFile !== '') {
    const match = entries.find((item) => item.file === relFile);
    if (!match) throw httpError(404, `找不到技能文件 ${relFile}`);
    return match;
  }
  assertEntryKey(name);
  const match = entries.find((item) => item.name === name);
  if (!match) throw httpError(404, `找不到技能 ${name}`);
  return match;
}

function relativeToRoot(root, absolute) {
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Resolve symlinks before reading/writing: a junction under the skills root
 * must never let a save or policy write escape into an unrelated directory.
 * Missing targets are allowed for writes (the parent is checked instead) and
 * a symlinked SKILL.md is written through, so the link itself survives.
 */
function assertRealInside(root, target, { allowMissing = false } = {}) {
  let realRoot;
  try { realRoot = realpathSync(root); } catch { realRoot = resolve(root); }
  let real;
  try {
    real = realpathSync(target);
  } catch (error) {
    if (!allowMissing) throw error;
    try { real = join(realpathSync(dirname(target)), basename(target)); } catch { return target; }
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw httpError(400, '拒绝访问技能目录之外的路径（符号链接目标不在技能目录内）');
  }
  return real;
}

function readForEdit(root, entry) {
  const fileAbs = join(root, entry.file);
  let stat;
  try { stat = statSync(fileAbs); } catch { throw httpError(404, `找不到 ${entry.file}`); }
  // Listing caps the file size as well; without the same guard here a locally
  // planted huge file is still read whole by /get, /save and /policy.
  if (stat.size > MAX_SKILL_BYTES) throw httpError(413, `文件过大（${stat.size} 字节），上限 ${MAX_SKILL_BYTES} 字节`);
  assertRealInside(root, fileAbs);
  let text;
  try { text = readFileSync(fileAbs, 'utf8'); } catch (error) {
    throw httpError(500, `无法读取 ${entry.file}：${error.code ?? error.message}`);
  }
  return splitFrontmatter(text);
}

/** Atomic write; the previous content is copied into <root>/.backups first. */
function writeSkillFile(root, fileAbs, content) {
  const target = assertRealInside(root, fileAbs, { allowMissing: true });
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    try {
      const backups = join(root, '.backups');
      mkdirSync(backups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rel = relativeToRoot(root, target).split('/').join('__');
      // Same-millisecond writes used to overwrite the previous snapshot; the
      // random suffix keeps every version recoverable.
      const suffix = Math.random().toString(16).slice(2, 8);
      copyFileSync(target, join(backups, `${stamp}-${suffix}-${rel}`));
    } catch { /* backup is best-effort */ }
  }
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, target);
  } catch (error) {
    // A failed write must not leave a half-written .tmp sibling behind: those
    // files are invisible to the manager but accumulate forever.
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw error;
  }
  pruneOldEntries(join(root, '.backups'), MAX_BACKUPS);
}

/** Keep the newest `keep` entries of a history directory; failures are ignored. */
function pruneOldEntries(dir, keep) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  if (names.length <= keep) return;
  const entries = names.map((name) => {
    try { return { name, mtimeMs: statSync(join(dir, name)).mtimeMs }; } catch { return undefined; }
  }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(keep)) {
    try { rmSync(join(dir, entry.name), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/** Deletes move into <root>/.trash instead of vanishing, so a misclick is recoverable. */
function trashPath(root, leaf) {
  const dir = join(root, '.trash');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Millisecond timestamps collide when a user deletes two skills quickly.
  return join(dir, `${stamp}-${Math.random().toString(16).slice(2, 8)}-${leaf}`);
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function send(res, code, payload) {
  if (res.writableEnded || res.headersSent) return;
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
  // dsh web --host <lan-ip> is supported by the host; accept the listener's own
  // address so the panel keeps working there without opening the trusted-host
  // allow-list (which would disable the loopback fence everywhere).
  const stripV4Mapped = (value) => value.replace(/^::ffff:/, '');
  const localAddress = stripV4Mapped(normalizeHostname(String(req.socket?.localAddress ?? '')));
  const boundAddress = localAddress !== '' && stripV4Mapped(hostname) === localAddress;
  if (!loopback && !boundAddress && !trustedHostnames().has(hostname)) {
    throw httpError(403, '只允许从本机访问技能管理接口');
  }
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
    throw httpError(403, '拒绝跨站请求');
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originUrl;
    try { originUrl = new URL(origin); } catch { throw httpError(403, 'Origin 请求头无效'); }
    if ((originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') || originUrl.origin !== hostUrl.origin) {
      throw httpError(403, 'Origin 与 Host 不一致');
    }
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
    req.on('error', (error) => fail(httpError(400, `读取请求体失败：${error.code ?? error.message}`)));
    // The browser can navigate away or abort mid-upload; without this the route
    // handler would await a promise that never settles.
    req.on('aborted', () => fail(httpError(400, '请求被中断')));
    req.on('close', () => { if (!settled) fail(httpError(400, '请求被中断')); });
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

function resolveOpenTarget(root, args = {}) {
  const file = typeof args.file === 'string' ? args.file : '';
  const name = typeof args.name === 'string' ? args.name : '';
  if (file === '' && name === '') return { target: root, skill: undefined };
  const entry = findEntry(scanRoot(root), { file, name });
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
  const { target, skill } = resolveOpenTarget(root, args);
  await openDirectory(target);
  return { ok: true, path: target, kind: skill ? skill.kind : 'root' };
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

function listHandler(roots, providerStatus) {
  const primary = roots[0];
  return {
    ok: true,
    // Kept for older clients; `roots` is the authoritative list.
    root: primary.path,
    rootExists: existsSync(primary.path),
    roots: roots.map((root) => ({
      key: root.key,
      label: displayRootPath(root.path),
      path: root.path,
      exists: existsSync(root.path),
    })),
    skills: scanAll(roots),
    provider: {
      state: providerStatus.state,
      attempts: providerStatus.attempts,
      // A stack trace (with absolute paths) is debugging material for the host
      // log, not something the UI needs.
      error: providerStatus.error === undefined ? undefined : String(providerStatus.error).split(/\r?\n/)[0].slice(0, 300),
    },
  };
}

function getHandler(root, rootKey, { name, file }) {
  const entry = findEntry(scanRoot(root), { name, file });
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
      rootKey,
      rootPath: root,
      body: parsed.body,
      // The frontmatter is unreadable, so `body` is the file's whole text and a
      // save rebuilds the frontmatter around it instead of discarding content.
      rawFallback: parsed.unparsed === true,
      extraFrontmatterLines,
    },
  };
}

function resolveOriginal(root, args) {
  const file = typeof args.originalFile === 'string' && args.originalFile !== '' ? args.originalFile : undefined;
  const name = typeof args.originalName === 'string' && args.originalName !== '' ? args.originalName : undefined;
  if (!file && !name) return undefined;
  if (file) return findEntry(scanRoot(root), { file });
  return findEntry(scanRoot(root), { name });
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

function samePath(a, b) {
  const left = resolve(a);
  const right = resolve(b);
  if (left === right) return true;
  // Windows and macOS resolve paths case-insensitively; a case-only rename is
  // the legitimate way to repair a non-kebab directory name.
  return process.platform === 'win32' || process.platform === 'darwin'
    ? left.toLowerCase() === right.toLowerCase()
    : false;
}

function saveHandler(root, args) {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  assertSafeName(name);
  // Trim only: rewriting internal runs of whitespace changed a description the
  // user never edited (block scalars and double spaces were flattened).
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (description.replace(/\s+/g, ' ').trim() === '') throw httpError(400, 'description 不能为空');
  const whenToUse = typeof args.whenToUse === 'string' ? args.whenToUse.trim() : '';
  const original = resolveOriginal(root, args);
  // A partial client that omits a policy field must not silently reset it; only
  // an explicit boolean overrides what the file already says.
  const modelInvocable = typeof args.modelInvocable === 'boolean' ? args.modelInvocable : (original?.modelInvocable ?? true);
  const userInvocable = typeof args.userInvocable === 'boolean' ? args.userInvocable : (original?.userInvocable ?? true);
  const parsedOriginal = original ? readForEdit(root, original) : undefined;
  // An omitted body means "leave it alone": deleting the body because a caller
  // only sent the metadata fields would silently destroy the skill.
  const body = typeof args.body === 'string'
    ? args.body.replace(/\r\n/g, '\n')
    : (parsedOriginal?.body ?? '');
  assertFresh(root, original, args.expectedMtimeMs);
  const renaming = Boolean(original) && name !== original.name;
  if (renaming || !original) {
    // Compare case-insensitively: `CaseSkill/` already occupies `caseskill/` on
    // Windows and macOS, so a new "caseskill" would otherwise overwrite it.
    const lower = name.toLowerCase();
    const clash = scanRoot(root).find((item) => item.file !== original?.file && item.name.toLowerCase() === lower);
    if (clash) throw httpError(409, `名称 ${name} 已被占用（${clash.file}）`);
  }
  const kind = original?.kind ?? 'bundle';
  const { head, eol } = serializeFrontmatter(
    { name, description, whenToUse, modelInvocable, userInvocable },
    parsedOriginal,
  );
  const content = buildFileContent(head, eol, body);
  if (kind === 'bundle') {
    const currentDir = original ? dirname(join(root, original.file)) : undefined;
    let targetDir = currentDir ?? join(root, name);
    if (renaming || !original) {
      const wanted = join(root, name);
      if (existsSync(wanted) && !(currentDir && samePath(wanted, currentDir))) {
        throw httpError(409, `目录 ${name} 已存在（可能属于另一个技能），请换一个名称`);
      }
      targetDir = wanted;
    }
    let renamedFrom;
    try {
      if (renaming && !samePath(targetDir, currentDir)) {
        renamedFrom = currentDir;
        renameSync(renamedFrom, targetDir);
      } else if (renaming) {
        // Case-only rename: the filesystem already points at the same directory;
        // keep the original path so the write stays atomic.
        targetDir = currentDir;
      }
      writeSkillFile(root, join(targetDir, 'SKILL.md'), content);
    } catch (error) {
      if (renamedFrom && renamedFrom !== targetDir) {
        try { renameSync(targetDir, renamedFrom); } catch { /* rollback is best-effort */ }
      }
      throw error;
    }
    return { ok: true, file: relativeToRoot(root, join(targetDir, 'SKILL.md')) };
  }
  // Flat skills: keep the existing filename unless the user renamed the skill,
  // otherwise a file whose name differs from its frontmatter name would gain a
  // duplicate sibling on every save.
  const targetFile = original && original.name === name
    ? join(root, original.file)
    : join(root, `${name}.md`);
  if (original && original.name !== name) {
    const oldFile = join(root, original.file);
    if (!samePath(oldFile, targetFile)) {
      if (existsSync(targetFile)) throw httpError(409, `${name}.md 已存在，请换一个名称`);
      renameSync(oldFile, targetFile);
    }
  }
  writeSkillFile(root, targetFile, content);
  return { ok: true, file: relativeToRoot(root, targetFile) };
}

function policyHandler(root, args) {
  const entry = findEntry(scanRoot(root), { file: args.file, name: typeof args.name === 'string' ? args.name : '' });
  assertFresh(root, entry, args.expectedMtimeMs);
  if (!existsSync(join(root, entry.file))) throw httpError(400, `${entry.file} 不存在，无法修改调用策略`);
  const parsed = readForEdit(root, entry);
  if (parsed.problems.length > 0) throw httpError(400, `无法解析 ${entry.file}：${parsed.problems.join('；')}`);
  const modelInvocable = typeof args.modelInvocable === 'boolean' ? args.modelInvocable : entry.modelInvocable;
  const userInvocable = typeof args.userInvocable === 'boolean' ? args.userInvocable : entry.userInvocable;
  const { head, eol, bom } = serializeFrontmatter({
    name: entry.name,
    description: entry.description,
    whenToUse: entry.whenToUse,
    modelInvocable,
    userInvocable,
  }, parsed);
  writeSkillFile(root, join(root, entry.file), buildFileContent(head, eol, parsed.body, bom));
  return { ok: true };
}

function deleteHandler(root, args) {
  const entry = findEntry(scanRoot(root), { file: args.file, name: typeof args.name === 'string' ? args.name : '' });
  const fileAbs = join(root, entry.file);
  const resolved = fileAbs.split('\\').join('/');
  const rootPrefix = root.split('\\').join('/').replace(/\/$/, '') + '/';
  if (!resolved.startsWith(rootPrefix)) throw httpError(400, '拒绝删除技能目录之外的路径');
  const leaf = entry.kind === 'bundle' ? dirname(join(root, entry.file)) : fileAbs;
  const target = trashPath(root, leaf.split(/[\\/]/).pop());
  renameSync(leaf, target);
  pruneOldEntries(join(root, '.trash'), MAX_TRASH);
  return { ok: true, trashed: target.split(root).pop()?.replace(/^[\\/]/, ''), file: entry.file };
}

/** Read an optional Cordis service without requiring it to exist. */
function safeService(ctx, name) {
  try {
    if (typeof ctx.get !== 'function') return undefined;
    return ctx.get(name, false) ?? undefined;
  } catch {
    return undefined;
  }
}

export function apply(ctx) {
  const providerStatus = registerGlobalSkillProvider(ctx);
  // The host's own /api requires an authenticated browser session. Reuse that
  // admission when the connection service exists: loopback is transport, not
  // identity, so without it any local process could rewrite the skills (and
  // therefore the instructions) the agent loads next.
  const connection = safeService(ctx, 'connection');
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: MOUNT,
    handler: async (req, res) => {
      try {
        if (connection !== undefined && typeof connection.requestRejection === 'function') {
          const rejection = connection.requestRejection(req);
          if (typeof rejection === 'number') {
            send(res, rejection, { ok: false, error: rejection === 401 ? '需要已登录的 DSH 会话' : '拒绝访问' });
            return;
          }
        } else {
          assertTrustedRequest(req);
        }
        const url = new URL(req.url, 'http://127.0.0.1');
        const stripped = url.pathname.startsWith(MOUNT) ? url.pathname.slice(MOUNT.length) : url.pathname;
        const route = stripped.replace(/\/+$/, '') || '/';
        const roots = skillsRoots();
        if (req.method === 'GET' && (route === '/' || route === '/list')) {
          send(res, 200, listHandler(roots, providerStatus));
          return;
        }
        if (req.method === 'GET' && route === '/get') {
          const root = rootInfo(url.searchParams.get('root') ?? undefined);
          send(res, 200, getHandler(root.path, root.key, {
            name: url.searchParams.get('name') ?? '',
            file: url.searchParams.get('file') ?? '',
          }));
          return;
        }
        const postRoutes = new Set(['/save', '/policy', '/open', '/delete']);
        if (req.method === 'POST' && !postRoutes.has(route)) {
          send(res, 404, { ok: false, error: `未知接口 ${req.method} ${route}` });
          return;
        }
        if (req.method === 'POST') assertJsonRequest(req);
        if (req.method === 'POST' && route === '/save') {
          const body = await readJsonBody(req);
          const root = rootInfo(body.root);
          const originalKey = body.originalRoot === undefined ? root.key : rootInfo(body.originalRoot).key;
          if (originalKey !== root.key) throw httpError(400, '不支持把技能移动到另一个技能目录');
          send(res, 200, { ...saveHandler(root.path, body), root: root.key });
          return;
        }
        if (req.method === 'POST' && route === '/policy') {
          const body = await readJsonBody(req);
          const root = rootInfo(body.root);
          send(res, 200, { ...policyHandler(root.path, body), root: root.key });
          return;
        }
        if (req.method === 'POST' && route === '/open') {
          const body = await readJsonBody(req);
          const root = rootInfo(body.root);
          send(res, 200, { ...(await openHandler(root.path, body)), root: root.key });
          return;
        }
        if (req.method === 'POST' && route === '/delete') {
          const body = await readJsonBody(req);
          const root = rootInfo(body.root);
          send(res, 200, { ...deleteHandler(root.path, body), root: root.key });
          return;
        }
        send(res, 404, { ok: false, error: `未知接口 ${req.method} ${route}` });
      } catch (error) {
        send(res, error.statusCode ?? 500, { ok: false, error: describeError(error) });
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
  pruneOldEntries,
  explorerTarget,
  resolveOpenTarget,
  setOpener(fn) {
    openDirectoryImpl = typeof fn === 'function' ? fn : openDirectoryDefault;
  },
};
