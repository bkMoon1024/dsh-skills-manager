import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MANAGED_KEYS = new Set(['name', 'description', 'whenToUse', 'disable-model-invocation', 'user-invocable']);

function skillsRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'skills');
}

/** Strict boolean grammar of dsh-skill-filesystem: true/false/yes/no/on/off/1/0, case-insensitive. */
function parseStrictBool(raw) {
  const value = raw.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(value)) return true;
  if (['false', 'no', 'off', '0'].includes(value)) return false;
  return undefined;
}

/** Split one skill markdown file into frontmatter lines and body, preserving unknown lines. */
function parseSkillText(text) {
  if (!text.startsWith('---')) return { problems: ['缺少 YAML frontmatter（文件必须以 --- 开头）'] };
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { problems: ['frontmatter 起始行无效'] };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { problems: ['frontmatter 未闭合（缺少结束 ---）'] };
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join(eol);
  const entries = [];
  for (const line of fmLines) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s?(.*)$/);
    if (match) entries.push({ key: match[1], raw: match[2].trim() });
  }
  return { problems: [], eol, fmLines, body, entries };
}

/** YAML-plain-safe scalar: double-quote anything with specials; JSON strings are valid YAML. */
function yamlScalar(value) {
  if (value === '' || /[:#\n"'\\]/.test(value) || value !== value.trim()) return JSON.stringify(value);
  return value;
}

/**
 * Rebuild frontmatter: managed keys from `next`, every original unmanaged line kept verbatim.
 */
function serializeSkill(next, original) {
  const eol = original?.eol ?? '\n';
  const preserved = original
    ? original.fmLines.filter((line) => {
        const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
        return !match || !MANAGED_KEYS.has(match[1]);
      })
    : [];
  const lines = [
    '---',
    `name: ${yamlScalar(next.name)}`,
    `description: ${yamlScalar(next.description)}`,
  ];
  if (next.whenToUse) lines.push(`whenToUse: ${yamlScalar(next.whenToUse)}`);
  if (next.modelInvocable === false) lines.push('disable-model-invocation: true');
  if (next.userInvocable === false) lines.push('user-invocable: false');
  lines.push(...preserved, '---');
  return { head: lines.join(eol), eol };
}

function stripQuotes(value) {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    if (value[0] === '"') {
      try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    return value.slice(1, -1);
  }
  return value;
}

/** Describe one discovered skill entry; invalid entries keep their problems for the manager to surface. */
function describeEntry({ fallbackName, kind, relPath, fileAbs, dirAbs }) {
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
  };
  if (kind === 'bundle' && !existsSync(fileAbs)) {
    entry.problems.push('目录缺少 SKILL.md');
    return entry;
  }
  let stat;
  try { stat = statSync(fileAbs); } catch { entry.problems.push('无法读取文件'); return entry; }
  entry.mtimeMs = Math.round(stat.mtimeMs);
  const text = readFileSync(fileAbs, 'utf8');
  const parsed = parseSkillText(text);
  entry.bodyChars = parsed.body?.length ?? 0;
  for (const problem of parsed.problems ?? []) entry.problems.push(problem);
  if (parsed.entries) {
    const by = new Map(parsed.entries.map((item) => [item.key, item]));
    const fmName = by.get('name');
    const fmDesc = by.get('description');
    const when = by.get('whenToUse');
    const dmi = by.get('disable-model-invocation');
    const ui = by.get('user-invocable');
    if (fmName && fmName.raw !== '') entry.name = stripQuotes(fmName.raw);
    if (!fmName || fmName.raw === '') entry.problems.push('缺少 name');
    if (fmName && fmName.raw !== '' && !NAME_RE.test(entry.name)) entry.problems.push(`name 不是 kebab-case：${entry.name}`);
    if (when && when.raw !== '') entry.whenToUse = stripQuotes(when.raw);
    if (!fmDesc || fmDesc.raw === '') entry.problems.push('缺少 description');
    else entry.description = stripQuotes(fmDesc.raw);
    if (dmi && dmi.raw !== '') {
      const value = parseStrictBool(dmi.raw);
      if (value === undefined) entry.problems.push(`disable-model-invocation 值无效：${dmi.raw}`);
      else entry.modelInvocable = !value;
    }
    if (ui && ui.raw !== '') {
      const value = parseStrictBool(ui.raw);
      if (value === undefined) entry.problems.push(`user-invocable 值无效：${ui.raw}`);
      else entry.userInvocable = value;
    }
  }
  entry.valid = entry.problems.length === 0;
  return entry;
}

function scanRoot(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (dirent.name.startsWith('.')) continue;
    if (dirent.isDirectory()) {
      out.push(describeEntry({
        fallbackName: dirent.name,
        kind: 'bundle',
        relPath: `${dirent.name}/SKILL.md`,
        fileAbs: join(root, dirent.name, 'SKILL.md'),
        dirAbs: join(root, dirent.name),
      }));
    } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
      out.push(describeEntry({
        fallbackName: dirent.name.replace(/\.md$/, ''),
        kind: 'flat',
        relPath: dirent.name,
        fileAbs: join(root, dirent.name),
        dirAbs: undefined,
      }));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function assertSafeName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw Object.assign(new Error(`技能名称必须是小写 kebab-case（字母数字与连字符），收到：${JSON.stringify(name)}`), { statusCode: 400 });
  }
}

/** Lookups (get/policy/delete/originalName) address existing scan entries, whose dir name may be non-kebab. */
function assertEntryKey(name) {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || /[\\/:*?"<>|\r\n]/.test(name)) {
    throw Object.assign(new Error(`无效的技能条目名：${JSON.stringify(name)}`), { statusCode: 400 });
  }
}

function readForEdit(root, entry) {
  const fileAbs = join(root, entry.file);
  const text = readFileSync(fileAbs, 'utf8');
  const parsed = parseSkillText(text);
  return parsed.entries ? parsed : { ...parsed, entries: [], body: '' };
}

function send(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? {} : JSON.parse(text));
      } catch (error) { reject(new Error(`请求体不是合法 JSON：${error.message}`)); }
    });
    req.on('error', reject);
  });
}

export function apply(ctx) {
  const providerStatus = registerGlobalSkillProvider(ctx);
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/skills-manager/api',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const mount = '/skills-manager/api';
      const stripped = url.pathname.startsWith(mount) ? url.pathname.slice(mount.length) : url.pathname;
      const route = stripped.replace(/\/+$/, '') || '/';
      try {
        if (req.method === 'GET' && (route === '/' || route === '/list')) {
          const root = skillsRoot();
          send(res, 200, {
            ok: true,
            root,
            rootExists: existsSync(root),
            skills: scanRoot(root),
            provider: { state: providerStatus.state, attempts: providerStatus.attempts, error: providerStatus.error },
          });
          return;
        }
        if (req.method === 'GET' && route === '/get') {
          const name = url.searchParams.get('name') ?? '';
          assertEntryKey(name);
          const root = skillsRoot();
          const entry = scanRoot(root).find((item) => item.name === name);
          if (!entry) throw Object.assign(new Error(`找不到技能 ${name}`), { statusCode: 404 });
          const fileAbs = join(root, entry.file);
          if (!existsSync(fileAbs)) throw Object.assign(new Error(`${entry.file} 不存在`), { statusCode: 404 });
          const parsed = readForEdit(root, entry);
          send(res, 200, {
            ok: true,
            skill: {
              ...entry,
              body: parsed.body ?? '',
              extraFrontmatterLines: parsed.fmLines
                ? parsed.fmLines.filter((line) => {
                    const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
                    return !match || !MANAGED_KEYS.has(match[1]);
                  })
                : [],
            },
          });
          return;
        }
        if (req.method === 'POST' && route === '/save') {
          const args = await readJsonBody(req);
          const root = skillsRoot();
          const name = typeof args.name === 'string' ? args.name.trim() : '';
          assertSafeName(name);
          const description = typeof args.description === 'string' ? args.description.replace(/\s+/g, ' ').trim() : '';
          if (description === '') throw Object.assign(new Error('description 不能为空'), { statusCode: 400 });
          const whenToUse = typeof args.whenToUse === 'string' ? args.whenToUse.replace(/\s+/g, ' ').trim() : '';
          const modelInvocable = args.modelInvocable !== false;
          const userInvocable = args.userInvocable !== false;
          const body = typeof args.body === 'string' ? args.body.replace(/\r\n/g, '\n') : '';
          const originalName = typeof args.originalName === 'string' && args.originalName !== '' ? args.originalName : undefined;
          let original;
          if (originalName) {
            assertEntryKey(originalName);
            original = scanRoot(root).find((item) => item.name === originalName);
            if (!original) throw Object.assign(new Error(`找不到原技能 ${originalName}`), { statusCode: 404 });
          }
          if (name !== originalName) {
            const clash = scanRoot(root).find((item) => item.name === name);
            if (clash) throw Object.assign(new Error(`名称 ${name} 已被占用（${clash.file}）`), { statusCode: 409 });
          }
          const kind = original?.kind ?? 'bundle';
          const parsedOriginal = original ? readForEdit(root, original) : undefined;
          const { head, eol } = serializeSkill({ name, description, whenToUse, modelInvocable, userInvocable }, parsedOriginal?.entries ? parsedOriginal : undefined);
          const normalizedBody = body.endsWith('\n') || body === '' ? body : `${body}\n`;
          const content = `${head}${eol}${eol}${normalizedBody}`;
          let targetRel;
          if (kind === 'bundle') {
            const oldDir = original ? join(root, original.file, '..') : undefined;
            const dir = join(root, name);
            if (original && original.name !== name && oldDir !== dir) renameSync(oldDir, dir);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
            targetRel = `${name}/SKILL.md`;
          } else {
            const file = join(root, `${name}.md`);
            if (original && original.name !== name) renameSync(join(root, original.file), file);
            writeFileSync(file, content, 'utf8');
            targetRel = `${name}.md`;
          }
          send(res, 200, { ok: true, file: targetRel });
          return;
        }
        if (req.method === 'POST' && route === '/policy') {
          const args = await readJsonBody(req);
          const root = skillsRoot();
          const name = typeof args.name === 'string' ? args.name : '';
          assertEntryKey(name);
          const entry = scanRoot(root).find((item) => item.name === name);
          if (!entry) throw Object.assign(new Error(`找不到技能 ${name}`), { statusCode: 404 });
          if (!existsSync(join(root, entry.file))) throw Object.assign(new Error(`${entry.file} 不存在，无法修改调用策略`), { statusCode: 400 });
          const parsed = readForEdit(root, entry);
          const modelInvocable = typeof args.modelInvocable === 'boolean' ? args.modelInvocable : entry.modelInvocable;
          const userInvocable = typeof args.userInvocable === 'boolean' ? args.userInvocable : entry.userInvocable;
          const { head, eol } = serializeSkill({
            name: entry.name,
            description: entry.description,
            whenToUse: entry.whenToUse,
            modelInvocable,
            userInvocable,
          }, parsed.entries ? parsed : undefined);
          const body = (parsed.body ?? '').replace(/\r\n/g, '\n');
          const normalizedBody = body.endsWith('\n') || body === '' ? body : `${body}\n`;
          writeFileSync(join(root, entry.file), `${head}${eol}${eol}${normalizedBody}`, 'utf8');
          send(res, 200, { ok: true });
          return;
        }
        if (req.method === 'POST' && route === '/delete') {
          const args = await readJsonBody(req);
          const root = skillsRoot();
          const name = typeof args.name === 'string' ? args.name : '';
          assertEntryKey(name);
          const entry = scanRoot(root).find((item) => item.name === name);
          if (!entry) throw Object.assign(new Error(`找不到技能 ${name}`), { statusCode: 404 });
          const fileAbs = join(root, entry.file);
          const resolved = fileAbs.split('\\').join('/');
          const rootPrefix = root.split('\\').join('/').replace(/\/$/, '') + '/';
          if (!resolved.startsWith(rootPrefix)) throw Object.assign(new Error('拒绝删除技能目录之外的路径'), { statusCode: 400 });
          if (entry.kind === 'bundle') rmSync(join(root, entry.file, '..'), { recursive: true, force: true });
          else rmSync(fileAbs, { force: true });
          send(res, 200, { ok: true });
          return;
        }
        send(res, 404, { ok: false, error: `未知接口 ${req.method} ${route}` });
      } catch (error) {
        send(res, error.statusCode ?? 500, { ok: false, error: error.message ?? String(error) });
      }
    },
  }), 'skills-manager: api');
}
