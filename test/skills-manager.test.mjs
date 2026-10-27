import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, __test } from '../index.js';

const { splitFrontmatter, serializeFrontmatter, buildFileContent, readKeyValue, describeEntry, scanRoot, explorerTarget } = __test;

const YAML_URL = 'file:///D:/dsh%20work/_dsh_src/dsh/node_modules/yaml/dist/index.js';
let YAML;
try { YAML = await import(YAML_URL); } catch { YAML = undefined; }

function keyValue(parsed, key) {
  const segment = parsed.segments.find((item) => item.kind === 'key' && item.key === key);
  return segment ? readKeyValue(segment) : undefined;
}

function yamlFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  return YAML.parse(lines.slice(1, end).join('\n'));
}

function roundTrip(text, next) {
  const parsed = splitFrontmatter(text);
  const { head, eol } = serializeFrontmatter(next, parsed);
  return buildFileContent(head, eol, parsed.body);
}

const NEXT = { name: 'demo', description: 'demo skill', whenToUse: '', modelInvocable: true, userInvocable: true };

function makeTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'skm-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createCtx() {
  const routes = [];
  const cleanups = [];
  return {
    routes,
    cleanups,
    loader: { import: async () => { throw new Error('provider unavailable in tests'); } },
    skills: { registerProvider: () => () => {} },
    logger: { warn() {} },
    webServer: { register(route) { routes.push(route); return () => {}; } },
    effect(fn) {
      const result = fn();
      if (result && typeof result.next === 'function') {
        const first = result.next();
        if (typeof first.value === 'function') cleanups.push(first.value);
        return () => {};
      }
      if (typeof result === 'function') cleanups.push(result);
      return () => {};
    },
  };
}

function makeReq({ method = 'GET', path = '/list', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = `/skills-manager/api${path}`;
  req.headers = headers;
  req.resume = () => {};
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  const res = { statusCode: 0, headers: {}, payload: '', writableEnded: false };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers ?? {}; };
  res.end = (chunk) => { res.payload = chunk ?? ''; res.writableEnded = true; };
  return res;
}

async function call(ctx, { method = 'GET', path = '/list', headers = {}, body } = {}) {
  const route = ctx.routes[0];
  const req = makeReq({ method, path, headers, body });
  const res = makeRes();
  await route.handler(req, res);
  return { status: res.statusCode, json: res.payload ? JSON.parse(res.payload) : null };
}

function hostHeaders(extra = {}) {
  return { host: '127.0.0.1:30816', ...extra };
}

function postHeaders(extra = {}) {
  return hostHeaders({ 'content-type': 'application/json', ...extra });
}

async function setupApi(t) {
  const root = makeTempRoot(t);
  process.env.DSH_HOME = join(root, 'home');
  process.env.DSH_AGENTS_HOME = join(root, 'agents-home');
  const skills = join(process.env.DSH_HOME, 'skills');
  const agentsSkills = join(process.env.DSH_AGENTS_HOME, 'skills');
  mkdirSync(skills, { recursive: true });
  mkdirSync(agentsSkills, { recursive: true });
  const ctx = createCtx();
  apply(ctx);
  t.after(async () => {
    for (const cleanup of ctx.cleanups.reverse()) await cleanup();
  });
  return { root, skills, agentsSkills, ctx };
}

function writeBundle(skills, name, content) {
  mkdirSync(join(skills, name), { recursive: true });
  writeFileSync(join(skills, name, 'SKILL.md'), content, 'utf8');
}

/* ---------------------------- parser ---------------------------- */

test('block scalar description is read semantically and survives a policy write', () => {
  const text = '---\nname: demo\ndescription: >\n  第一行\n  第二行\n---\n\n# Body\n';
  const parsed = splitFrontmatter(text);
  assert.deepEqual(parsed.problems, []);
  assert.equal(keyValue(parsed, 'description'), '第一行 第二行');

  const out = roundTrip(text, { ...NEXT, description: '第一行 第二行', modelInvocable: false });
  const reparsed = splitFrontmatter(out);
  assert.equal(keyValue(reparsed, 'description'), '第一行 第二行');
  assert.equal(keyValue(reparsed, 'disable-model-invocation'), 'true');
  assert.equal(reparsed.body, '# Body\n');
  if (YAML) {
    const data = yamlFrontmatter(out);
    assert.equal(data.description, '第一行 第二行');
    assert.equal(data['disable-model-invocation'], true);
  }
});

test('literal block scalar and folded multiline plain scalars are read', () => {
  const literal = splitFrontmatter('---\nname: demo\ndescription: |\n  line1\n  line2\n---\n');
  assert.equal(keyValue(literal, 'description'), 'line1\nline2');
  const plain = splitFrontmatter('---\nname: demo\ndescription: first\n  second\n---\n');
  assert.equal(keyValue(plain, 'description'), 'first second');
});

test('unknown keys, comments and nested metadata are preserved verbatim', () => {
  const text = [
    '---',
    'name: demo',
    'description: "demo skill"',
    '# keep this comment',
    'metadata:',
    '  owner: me',
    '  nested:',
    '    a: 1',
    'custom: >',
    '  block',
    '  text',
    '---',
    'body',
  ].join('\n');
  const out = roundTrip(text, NEXT);
  assert.match(out, /# keep this comment/);
  assert.match(out, /metadata:\n {2}owner: me\n {2}nested:\n {4}a: 1/);
  assert.match(out, /custom: >\n {2}block\n {2}text/);
});

test('inline comments, quoted scalars and ambiguous plain values', () => {
  const commented = splitFrontmatter('---\nname: demo\ndescription: foo # bar\n---\n');
  assert.equal(keyValue(commented, 'description'), 'foo');

  const single = splitFrontmatter("---\nname: demo\ndescription: 'it''s fine'\n---\n");
  assert.equal(keyValue(single, 'description'), "it's fine");

  const double = splitFrontmatter('---\nname: demo\ndescription: "a\\nb"\n---\n');
  assert.equal(keyValue(double, 'description'), 'a\nb');

  const out = roundTrip('---\nname: demo\ndescription: on\n---\n', { ...NEXT, description: 'on' });
  if (YAML) assert.equal(yamlFrontmatter(out).description, 'on');
});

test('body blank lines do not accumulate across repeated saves', () => {
  const text = '---\nname: demo\ndescription: demo skill\n---\n\n# Body\n\n';
  const parsed = splitFrontmatter(text);
  assert.equal(parsed.body, '# Body\n\n');
  const first = buildFileContent(serializeFrontmatter(NEXT, parsed).head, parsed.eol, parsed.body);
  assert.equal(first, '---\nname: demo\ndescription: demo skill\n---\n\n# Body\n');
  const second = buildFileContent(
    serializeFrontmatter(NEXT, splitFrontmatter(first)).head,
    splitFrontmatter(first).eol,
    splitFrontmatter(first).body,
  );
  assert.equal(second, first);
});

test('CRLF files keep CRLF and one blank line', () => {
  const text = '---\r\nname: demo\r\ndescription: demo skill\r\n---\r\n\r\n# Body\r\n';
  const parsed = splitFrontmatter(text);
  assert.equal(parsed.eol, '\r\n');
  const out = buildFileContent(serializeFrontmatter(NEXT, parsed).head, parsed.eol, parsed.body);
  assert.ok(out.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(out));
  assert.equal(out, '---\r\nname: demo\r\ndescription: demo skill\r\n---\r\n\r\n# Body\r\n');
});

test('legacy invocation keys are reported as problems', (t) => {
  const root = makeTempRoot(t);
  const file = join(root, 'SKILL.md');
  writeFileSync(file, '---\nname: demo\ndescription: demo skill\nmodelInvocable: false\n---\n', 'utf8');
  const entry = describeEntry({ fallbackName: 'demo', kind: 'flat', relPath: 'demo.md', fileAbs: file });
  assert.equal(entry.valid, false);
  assert.ok(entry.problems.some((problem) => problem.includes('modelInvocable')));
});

test('unreadable / missing files become problems instead of throwing', (t) => {
  const root = makeTempRoot(t);
  const missing = describeEntry({ fallbackName: 'gone', kind: 'bundle', relPath: 'gone/SKILL.md', fileAbs: join(root, 'gone', 'SKILL.md') });
  assert.equal(missing.valid, false);
  assert.equal(missing.missingFile, true);
  assert.ok(missing.problems.some((problem) => problem.includes('SKILL.md')));
  assert.deepEqual(scanRoot(join(root, 'nope')), []);
});

test('symlinked skill directories are discovered like the official provider', (t) => {
  const root = makeTempRoot(t);
  const target = join(root, 'target-skill');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'SKILL.md'), '---\nname: linked\ndescription: linked skill\n---\n', 'utf8');
  const skills = join(root, 'skills');
  mkdirSync(skills, { recursive: true });
  try {
    symlinkSync(target, join(skills, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('symlink not supported in this environment');
    return;
  }
  const names = scanRoot(skills).map((entry) => entry.name);
  assert.deepEqual(names, ['linked']);
});

/* ------------------------------ API ------------------------------ */

test('API rejects requests without a trusted Host', async (t) => {
  const { ctx } = await setupApi(t);
  const response = await call(ctx, { headers: {} });
  assert.equal(response.status, 403);
});

test('API rejects cross-site and mismatched-origin requests', async (t) => {
  const { ctx } = await setupApi(t);
  const crossSite = await call(ctx, { headers: hostHeaders({ 'sec-fetch-site': 'cross-site' }) });
  assert.equal(crossSite.status, 403);
  const mismatch = await call(ctx, { headers: hostHeaders({ origin: 'https://evil.example' }) });
  assert.equal(mismatch.status, 403);
  const schemeMismatch = await call(ctx, { headers: hostHeaders({ origin: 'https://127.0.0.1:30816' }) });
  assert.equal(schemeMismatch.status, 403);
  const sameOrigin = await call(ctx, { headers: hostHeaders({ origin: 'http://127.0.0.1:30816' }) });
  assert.equal(sameOrigin.status, 200);
});

test('API requires JSON content type and a bounded body', async (t) => {
  const { ctx } = await setupApi(t);
  const plain = await call(ctx, {
    method: 'POST',
    path: '/policy',
    headers: hostHeaders({ 'content-type': 'text/plain' }),
    body: '{"name":"x"}',
  });
  assert.equal(plain.status, 415);

  const huge = 'x'.repeat(1024 * 1024 + 1);
  const oversized = await call(ctx, {
    method: 'POST',
    path: '/policy',
    headers: postHeaders({ 'content-length': String(huge.length) }),
    body: huge,
  });
  assert.equal(oversized.status, 413);
});

test('API policy write preserves a block-scalar description', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'dsh-plugin-collection', [
    '---',
    'name: dsh-plugin-collection',
    'description: >',
    '  维护第三方 DSH 插件目录。',
    '  收录并更新各插件 README 自带命令。',
    '---',
    '',
    '# Body',
    '',
  ].join('\n'));
  const list = await call(ctx, { headers: hostHeaders() });
  assert.equal(list.status, 200);
  const entry = list.json.skills.find((item) => item.name === 'dsh-plugin-collection');
  assert.equal(entry.valid, true);
  assert.equal(entry.description, '维护第三方 DSH 插件目录。 收录并更新各插件 README 自带命令。');

  const response = await call(ctx, {
    method: 'POST',
    path: '/policy',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'dsh-plugin-collection', modelInvocable: false }),
  });
  assert.equal(response.status, 200);
  const written = readFileSync(join(skills, 'dsh-plugin-collection', 'SKILL.md'), 'utf8');
  if (YAML) {
    const data = yamlFrontmatter(written);
    assert.equal(data.description, '维护第三方 DSH 插件目录。 收录并更新各插件 README 自带命令。');
    assert.equal(data['disable-model-invocation'], true);
  }
  const reparsed = splitFrontmatter(written);
  assert.ok(keyValue(reparsed, 'description').length > 10);
});

test('API save keeps flat filenames when the frontmatter name differs', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeFileSync(join(skills, 'flat-file.md'), '---\nname: real-name\ndescription: demo skill\n---\nbody\n', 'utf8');
  const list = await call(ctx, { headers: hostHeaders() });
  assert.equal(list.json.skills.length, 1);
  const response = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'real-name', description: 'demo skill', body: '# Body\n', originalName: 'real-name' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(readdirSync(skills).filter((item) => !item.startsWith('.')).sort(), ['flat-file.md']);
  const written = readFileSync(join(skills, 'flat-file.md'), 'utf8');
  assert.equal(splitFrontmatter(written).body, '# Body\n');
});

test('API save renames a flat skill without leaving a duplicate', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeFileSync(join(skills, 'flat-file.md'), '---\nname: real-name\ndescription: demo skill\n---\nbody\n', 'utf8');
  const response = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'renamed', description: 'demo skill', body: 'body\n', originalName: 'real-name' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(readdirSync(skills).filter((item) => !item.startsWith('.')).sort(), ['renamed.md']);
});

test('API save reports a stale editor instead of overwriting', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'demo', '---\nname: demo\ndescription: demo skill\n---\nbody\n');
  const list = await call(ctx, { headers: hostHeaders() });
  const entry = list.json.skills[0];
  await new Promise((resolve) => setTimeout(resolve, 15));
  writeFileSync(join(skills, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: edited elsewhere\n---\nbody\n', 'utf8');
  const response = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({
      name: 'demo',
      description: 'demo skill',
      body: 'body\n',
      originalName: 'demo',
      expectedMtimeMs: entry.mtimeMs,
    }),
  });
  assert.equal(response.status, 409);
});

test('API delete moves the skill into .trash', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'demo', '---\nname: demo\ndescription: demo skill\n---\nbody\n');
  const response = await call(ctx, {
    method: 'POST',
    path: '/delete',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'demo' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(readdirSync(skills).filter((item) => !item.startsWith('.')), []);
  assert.equal(readdirSync(join(skills, '.trash')).length, 1);
});

/* ------------------------ open in file manager ------------------------ */

test('API open launches the file manager for the root and one skill folder', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'demo', '---\nname: demo\ndescription: demo skill\n---\nbody\n');
  const opened = [];
  __test.setOpener((target) => { opened.push(target); });
  t.after(() => __test.setOpener(null));

  const rootOpen = await call(ctx, { method: 'POST', path: '/open', headers: postHeaders(), body: '{}' });
  assert.equal(rootOpen.status, 200);
  assert.equal(rootOpen.json.path, skills);
  assert.deepEqual(opened, [skills]);

  const skillOpen = await call(ctx, {
    method: 'POST',
    path: '/open',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'demo' }),
  });
  assert.equal(skillOpen.status, 200);
  assert.equal(skillOpen.json.path, join(skills, 'demo'));
  assert.deepEqual(opened, [skills, join(skills, 'demo')]);
});

test('API open creates a missing skills directory and refuses unsafe requests', async (t) => {
  const { skills, ctx } = await setupApi(t);
  rmSync(skills, { recursive: true, force: true });
  const opened = [];
  __test.setOpener((target) => { opened.push(target); });
  t.after(() => __test.setOpener(null));

  const created = await call(ctx, { method: 'POST', path: '/open', headers: postHeaders(), body: '{}' });
  assert.equal(created.status, 200);
  assert.equal(existsSync(skills), true);
  assert.deepEqual(opened, [skills]);

  const missing = await call(ctx, {
    method: 'POST',
    path: '/open',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'nope' }),
  });
  assert.equal(missing.status, 404);

  const traversal = await call(ctx, {
    method: 'POST',
    path: '/open',
    headers: postHeaders(),
    body: JSON.stringify({ name: '../evil' }),
  });
  assert.equal(traversal.status, 400);

  const plain = await call(ctx, {
    method: 'POST',
    path: '/open',
    headers: hostHeaders({ 'content-type': 'text/plain' }),
    body: '{}',
  });
  assert.equal(plain.status, 415);

  const crossSite = await call(ctx, {
    method: 'POST',
    path: '/open',
    headers: postHeaders({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    body: '{}',
  });
  assert.equal(crossSite.status, 403);
});

test('explorerTarget keeps unicode paths and escapes commas and equals signs', () => {
  assert.equal(explorerTarget('C:\\Users\\me\\a,b=c'), 'file:///C:/Users/me/a%2Cb%3Dc');
  assert.equal(explorerTarget('C:\\Users\\张三'), 'file:///C:/Users/张三');
});

test('API save refuses path traversal and invalid names', async (t) => {
  const { ctx } = await setupApi(t);
  const traversal = await call(ctx, { headers: hostHeaders(), path: '/get?name=..%2Fevil' });
  assert.equal(traversal.status, 400);
  const badName = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ name: '../evil', description: 'x', body: '' }),
  });
  assert.equal(badName.status, 400);
});

/* ------------------- hardening / round-trip regressions ------------------- */

test('a UTF-8 BOM is flagged and stripped on the next write', () => {
  const parsed = splitFrontmatter('\uFEFF---\nname: demo\ndescription: demo skill\n---\n\n# Body\n\nkeep me\n');
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.bom, true);
  assert.equal(parsed.body, '# Body\n\nkeep me\n');
  const { head, eol } = serializeFrontmatter(NEXT, parsed);
  // DSH compares the first line to "---" literally and ignores BOM-prefixed
  // skills, so the manager must not re-emit the BOM.
  assert.equal(buildFileContent(head, eol, parsed.body), '---\nname: demo\ndescription: demo skill\n---\n\n# Body\n\nkeep me\n');
});

test('a file without frontmatter exposes its text as body instead of nothing', () => {
  const text = '# Just markdown\n\nimportant text\n';
  const parsed = splitFrontmatter(text);
  assert.equal(parsed.problems.length, 1);
  assert.equal(parsed.body, text);
  const { head, eol } = serializeFrontmatter(NEXT, parsed);
  const repaired = buildFileContent(head, eol, parsed.body);
  assert.equal(splitFrontmatter(repaired).body, text);
});

test('a quoted scalar spanning lines keeps its semantic value and its bytes', () => {
  const text = '---\nname: demo\ndescription: "first line\n  second line"\n---\nbody\n';
  const parsed = splitFrontmatter(text);
  assert.equal(keyValue(parsed, 'description'), 'first line second line');
  const next = { ...NEXT, description: 'first line second line', modelInvocable: false };
  const out = roundTrip(text, next);
  assert.match(out, /description: "first line\n {2}second line"/);
  if (YAML) {
    assert.equal(yamlFrontmatter(out).description, 'first line second line');
    assert.equal(yamlFrontmatter(out)['disable-model-invocation'], true);
  }
});

test('ambiguous numeric and date-like descriptions are quoted for YAML', () => {
  for (const value of ['0x10', '0o17', '.inf', '.nan', '0123', '1e3', '2024-01-01', '- foo', '? foo', '[x]', '*anchor', '# comment']) {
    const { head } = serializeFrontmatter({ ...NEXT, description: value }, undefined);
    assert.match(head, new RegExp(`description: ${JSON.stringify(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (YAML) assert.equal(yamlFrontmatter(`${head}\n`).description, value);
  }
  const plain = serializeFrontmatter({ ...NEXT, description: 'demo skill' }, undefined).head;
  assert.match(plain, /description: demo skill/);
});

test('policy writes keep block scalars and CRLF byte-for-byte', () => {
  const text = '---\r\nname: demo\r\ndescription: |\r\n  line one\r\n  line two\r\ncustom: keep\r\n---\r\n\r\n# Body\r\n';
  const parsed = splitFrontmatter(text);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.eol, '\r\n');
  const description = keyValue(parsed, 'description');
  assert.equal(description, 'line one\nline two');
  const { head, eol } = serializeFrontmatter({ ...NEXT, description }, parsed);
  assert.equal(head, '---\r\nname: demo\r\ndescription: |\r\n  line one\r\n  line two\r\ncustom: keep\r\n---');
  assert.equal(buildFileContent(head, eol, parsed.body), '---\r\nname: demo\r\ndescription: |\r\n  line one\r\n  line two\r\ncustom: keep\r\n---\r\n\r\n# Body\r\n');
});

test('an unclosed frontmatter is recovered without duplicating it into the body', () => {
  const text = '---\nname: demo\ndescription: demo skill\n\n# Body\n';
  const parsed = splitFrontmatter(text);
  assert.equal(parsed.unparsed, true);
  assert.equal(parsed.recovered, true);
  assert.equal(parsed.body, '# Body\n');
  const { head, eol } = serializeFrontmatter(NEXT, parsed);
  const rebuilt = buildFileContent(head, eol, parsed.body);
  assert.equal(rebuilt, '---\nname: demo\ndescription: demo skill\n---\n\n# Body\n');
  assert.equal((rebuilt.match(/^name:/gm) ?? []).length, 1);
});

test('legacy invocation keys keep their value and are repaired on write', (t) => {
  const root = makeTempRoot(t);
  const file = join(root, 'SKILL.md');
  writeFileSync(file, '---\nname: demo\ndescription: demo skill\nmodelInvocable: false\n---\nbody\n', 'utf8');
  const entry = describeEntry({ fallbackName: 'demo', kind: 'flat', relPath: 'demo.md', fileAbs: file });
  assert.equal(entry.valid, false);
  assert.equal(entry.modelInvocable, false);
  const parsed = splitFrontmatter(readFileSync(file, 'utf8'));
  const out = roundTrip(readFileSync(file, 'utf8'), {
    name: entry.name,
    description: entry.description,
    whenToUse: entry.whenToUse,
    modelInvocable: entry.modelInvocable,
    userInvocable: entry.userInvocable,
  });
  assert.doesNotMatch(out, /modelInvocable/);
  assert.match(out, /disable-model-invocation: true/);
  assert.equal(splitFrontmatter(out).problems.length, 0);
  assert.ok(parsed.segments.some((segment) => segment.kind === 'key' && segment.key === 'modelInvocable'));
});

test('duplicate frontmatter keys are reported and collapsed on write', (t) => {
  const root = makeTempRoot(t);
  const file = join(root, 'SKILL.md');
  writeFileSync(file, '---\nname: demo\nname: demo\ndescription: demo skill\n---\nbody\n', 'utf8');
  const entry = describeEntry({ fallbackName: 'demo', kind: 'flat', relPath: 'demo.md', fileAbs: file });
  assert.equal(entry.valid, false);
  assert.ok(entry.problems.some((problem) => problem.includes('重复键')));
  const out = roundTrip(readFileSync(file, 'utf8'), NEXT);
  assert.equal((out.match(/^name:/gm) ?? []).length, 1);
  if (YAML) assert.equal(yamlFrontmatter(out).name, 'demo');
});

test('history directories keep only the newest entries', (t) => {
  const root = makeTempRoot(t);
  for (let i = 0; i < 5; i += 1) writeFileSync(join(root, `${i}.txt`), String(i), 'utf8');
  __test.pruneOldEntries(root, 2);
  assert.equal(readdirSync(root).length, 2);
  __test.pruneOldEntries(root, 5);
  assert.equal(readdirSync(root).length, 2);
});

test('API flags a BOM file and removes the BOM on save', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'bom-skill', '\uFEFF---\nname: bom-skill\ndescription: BOM skill\n---\n\n# Keep\n\nme\n');
  const list = await call(ctx, { headers: hostHeaders() });
  const entry = list.json.skills.find((item) => item.file === 'bom-skill/SKILL.md');
  assert.equal(entry.valid, false);
  assert.ok(entry.problems.some((problem) => problem.includes('BOM')));
  const got = await call(ctx, { headers: hostHeaders(), path: `/get?file=${encodeURIComponent(entry.file)}` });
  assert.equal(got.json.skill.body, '# Keep\n\nme\n');
  const saved = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({
      name: 'bom-skill',
      description: 'BOM skill',
      body: got.json.skill.body,
      originalFile: entry.file,
    }),
  });
  assert.equal(saved.status, 200);
  const written = readFileSync(join(skills, 'bom-skill', 'SKILL.md'), 'utf8');
  assert.equal(written.startsWith('\uFEFF'), false);
  assert.equal(written, '---\nname: bom-skill\ndescription: BOM skill\n---\n\n# Keep\n\nme\n');
  const after = await call(ctx, { headers: hostHeaders() });
  assert.equal(after.json.skills.find((item) => item.file === 'bom-skill/SKILL.md').valid, true);
});

test('API save on a file without frontmatter keeps every byte of its text', async (t) => {
  const { skills, ctx } = await setupApi(t);
  mkdirSync(join(skills, 'plain-skill'), { recursive: true });
  const original = '# Just markdown\n\nimportant text\n';
  writeFileSync(join(skills, 'plain-skill', 'SKILL.md'), original, 'utf8');
  const list = await call(ctx, { headers: hostHeaders() });
  const entry = list.json.skills.find((item) => item.file === 'plain-skill/SKILL.md');
  assert.equal(entry.valid, false);
  const got = await call(ctx, { headers: hostHeaders(), path: `/get?file=${encodeURIComponent(entry.file)}` });
  assert.equal(got.json.skill.body, original);
  assert.equal(got.json.skill.rawFallback, true);
  await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({
      name: 'plain-skill',
      description: 'repaired',
      body: got.json.skill.body,
      originalFile: entry.file,
    }),
  });
  assert.ok(readFileSync(join(skills, 'plain-skill', 'SKILL.md'), 'utf8').includes(original));
});

test('API addresses entries by file when two skills share a name', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'alpha', '---\nname: dup\ndescription: ALPHA\n---\nalpha\n');
  writeBundle(skills, 'beta', '---\nname: dup\ndescription: BETA\n---\nbeta\n');
  const got = await call(ctx, { headers: hostHeaders(), path: `/get?file=${encodeURIComponent('beta/SKILL.md')}` });
  assert.equal(got.status, 200);
  assert.equal(got.json.skill.description, 'BETA');
  const removed = await call(ctx, {
    method: 'POST',
    path: '/delete',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'dup', file: 'beta/SKILL.md' }),
  });
  assert.equal(removed.status, 200);
  assert.deepEqual(readdirSync(skills).filter((item) => !item.startsWith('.')), ['alpha']);
});

test('API save cannot take over a directory that differs only by case', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'CaseSkill', '---\nname: case-other\ndescription: original\n---\noriginal body\n');
  if (!existsSync(join(skills, 'caseskill'))) {
    t.skip('case-sensitive filesystem');
    return;
  }
  const response = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'caseskill', description: 'Hijacked', body: 'HIJACKED' }),
  });
  assert.equal(response.status, 409);
  assert.match(readFileSync(join(skills, 'CaseSkill', 'SKILL.md'), 'utf8'), /original body/);
});

test('API save rejects reserved device names and over-long names', async (t) => {
  const { ctx } = await setupApi(t);
  for (const name of ['con', 'nul', 'aux', 'com1', 'a'.repeat(65)]) {
    const response = await call(ctx, {
      method: 'POST',
      path: '/save',
      headers: postHeaders(),
      body: JSON.stringify({ name, description: 'x', body: '' }),
    });
    assert.equal(response.status, 400, name);
  }
});

test('API save without a policy field keeps the existing policy', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'demo', '---\nname: demo\ndescription: demo skill\ndisable-model-invocation: true\nuser-invocable: false\n---\nbody\n');
  const response = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ name: 'demo', description: 'demo skill', body: 'body\n', originalFile: 'demo/SKILL.md' }),
  });
  assert.equal(response.status, 200);
  const written = readFileSync(join(skills, 'demo', 'SKILL.md'), 'utf8');
  assert.match(written, /disable-model-invocation: true/);
  assert.match(written, /user-invocable: false/);
});
/* ------------------- second adversarial pass regressions ------------------- */

test('a quoted frontmatter key is addressed as name and never duplicated', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'quoted', '---\n"name": quoted\ndescription: original text\n---\n\n# Body\n');
  const list = await call(ctx, { headers: hostHeaders() });
  const entry = list.json.skills.find((item) => item.file === 'quoted/SKILL.md');
  assert.equal(entry.valid, true);
  assert.equal(entry.name, 'quoted');
  const saved = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'dsh', name: 'quoted', description: 'new text', body: '# Body\n', originalFile: entry.file }),
  });
  assert.equal(saved.status, 200);
  const written = readFileSync(join(skills, 'quoted', 'SKILL.md'), 'utf8');
  const parsed = splitFrontmatter(written);
  assert.equal(parsed.segments.filter((segment) => segment.kind === 'key' && segment.key === 'name').length, 1);
  assert.equal(keyValue(parsed, 'description'), 'new text');
  assert.equal(parsed.body, '# Body\n');
  if (YAML) assert.equal(yamlFrontmatter(written).name, 'quoted');
});

test('save without a body keeps the existing body instead of deleting it', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'keep-body', '---\nname: keep-body\ndescription: x\n---\n\n# Body line 1\n\nBody line 2\n');
  const saved = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'dsh', name: 'keep-body', description: 'edited', originalFile: 'keep-body/SKILL.md' }),
  });
  assert.equal(saved.status, 200);
  const written = readFileSync(join(skills, 'keep-body', 'SKILL.md'), 'utf8');
  assert.equal(splitFrontmatter(written).body, '# Body line 1\n\nBody line 2\n');
});

test('a no-op save keeps description bytes (double spaces, block scalars, comments)', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'spaced', '---\nname: spaced\ndescription: "a  b\\tc"\n---\n\n# Body\n');
  writeBundle(skills, 'blocky', '---\nname: blocky\ndescription: |\n  line one\n  line two\n---\n\n# Body\n');
  writeBundle(skills, 'commented', '---\nname: commented\ndescription: x\n  # note about desc\n---\n\n# Body\n');
  const list = await call(ctx, { headers: hostHeaders() });
  const spaced = list.json.skills.find((item) => item.file === 'spaced/SKILL.md');
  assert.equal(spaced.description, 'a  b\tc');
  const commented = list.json.skills.find((item) => item.file === 'commented/SKILL.md');
  assert.equal(commented.description, 'x');
  for (const file of ['spaced/SKILL.md', 'blocky/SKILL.md', 'commented/SKILL.md']) {
    const got = await call(ctx, { headers: hostHeaders(), path: `/get?file=${encodeURIComponent(file)}` });
    const saved = await call(ctx, {
      method: 'POST',
      path: '/save',
      headers: postHeaders(),
      body: JSON.stringify({
        root: 'dsh',
        name: got.json.skill.name,
        description: got.json.skill.description,
        body: got.json.skill.body,
        originalFile: file,
      }),
    });
    assert.equal(saved.status, 200, file);
  }
  assert.match(readFileSync(join(skills, 'spaced', 'SKILL.md'), 'utf8'), /description: "a {2}b\\tc"/);
  assert.match(readFileSync(join(skills, 'blocky', 'SKILL.md'), 'utf8'), /description: \|\n {2}line one\n {2}line two/);
  assert.match(readFileSync(join(skills, 'commented', 'SKILL.md'), 'utf8'), /description: x\n/);
});

test('non-string and malformed frontmatter values are flagged instead of green', async (t) => {
  const { skills, ctx } = await setupApi(t);
  writeBundle(skills, 'bool-desc', '---\nname: bool-desc\ndescription: true\n---\n');
  writeBundle(skills, 'flow-desc', '---\nname: flow-desc\ndescription: [a, b]\n---\n');
  writeBundle(skills, 'open-quote', '---\nname: open-quote\ndescription: "unterminated\n---\n');
  writeBundle(skills, 'tabbed', '---\nname: tabbed\ndescription: tab\n\tcustom: x\n---\n');
  writeBundle(skills, 'nested-desc', '---\nname: nested-desc\ndescription:\n  nested: map\n---\n');
  const list = await call(ctx, { headers: hostHeaders() });
  const byFile = (file) => list.json.skills.find((item) => item.file === file);
  assert.equal(byFile('bool-desc/SKILL.md').valid, false);
  assert.ok(byFile('bool-desc/SKILL.md').problems.some((problem) => problem.includes('不是字符串')));
  assert.equal(byFile('flow-desc/SKILL.md').valid, false);
  assert.equal(byFile('open-quote/SKILL.md').valid, false);
  assert.equal(byFile('tabbed/SKILL.md').valid, false);
  assert.ok(byFile('tabbed/SKILL.md').problems.some((problem) => problem.includes('制表符')));
  assert.equal(byFile('nested-desc/SKILL.md').valid, false);
  assert.ok(byFile('nested-desc/SKILL.md').problems.some((problem) => problem.includes('映射')));
});

test('both global skill roots are listed and addressed by root key', async (t) => {
  const { skills, agentsSkills, ctx } = await setupApi(t);
  writeBundle(skills, 'dsh-only', '---\nname: dsh-only\ndescription: dsh root\n---\n');
  writeBundle(agentsSkills, 'agents-only', '---\nname: agents-only\ndescription: agents root\n---\n');
  const list = await call(ctx, { headers: hostHeaders() });
  assert.deepEqual(list.json.roots.map((root) => root.key).sort(), ['agents', 'dsh']);
  assert.ok(list.json.roots.every((root) => typeof root.label === 'string' && root.label.length > 0));
  const files = list.json.skills.map((item) => `${item.rootKey}:${item.file}`).sort();
  assert.deepEqual(files, ['agents:agents-only/SKILL.md', 'dsh:dsh-only/SKILL.md']);
  const got = await call(ctx, { headers: hostHeaders(), path: '/get?root=agents&file=agents-only%2FSKILL.md' });
  assert.equal(got.status, 200);
  assert.equal(got.json.skill.rootKey, 'agents');
  assert.equal(got.json.skill.description, 'agents root');
  const policy = await call(ctx, {
    method: 'POST',
    path: '/policy',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'agents', file: 'agents-only/SKILL.md', modelInvocable: false }),
  });
  assert.equal(policy.status, 200);
  assert.equal(policy.json.root, 'agents');
  assert.match(readFileSync(join(agentsSkills, 'agents-only', 'SKILL.md'), 'utf8'), /disable-model-invocation: true/);
  const created = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'agents', name: 'new-agents', description: 'created in agents', body: 'hi\n' }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.root, 'agents');
  assert.equal(existsSync(join(agentsSkills, 'new-agents', 'SKILL.md')), true);
  assert.equal(existsSync(join(skills, 'new-agents', 'SKILL.md')), false);
  const removed = await call(ctx, {
    method: 'POST',
    path: '/delete',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'agents', file: 'agents-only/SKILL.md' }),
  });
  assert.equal(removed.status, 200);
  assert.equal(existsSync(join(agentsSkills, 'agents-only')), false);
  assert.equal(existsSync(join(skills, 'dsh-only', 'SKILL.md')), true);
});

test('when the host connection service exists, unauthenticated requests get 401', async (t) => {
  const root = makeTempRoot(t);
  process.env.DSH_HOME = join(root, 'home');
  process.env.DSH_AGENTS_HOME = join(root, 'agents-home');
  mkdirSync(join(process.env.DSH_HOME, 'skills'), { recursive: true });
  mkdirSync(join(process.env.DSH_AGENTS_HOME, 'skills'), { recursive: true });
  const ctx = createCtx();
  ctx.get = (name) => (name === 'connection'
    ? { requestRejection: () => 401 }
    : undefined);
  apply(ctx);
  const response = await call(ctx, { headers: hostHeaders() });
  assert.equal(response.status, 401);
  assert.match(response.json.error, /会话/);
});

test('a junction inside the root cannot read or write outside it', { skip: process.platform !== 'win32' }, async (t) => {
  const { root, skills, ctx } = await setupApi(t);
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'SKILL.md'), '---\nname: linked\ndescription: outside\n---\n\noutside body\n', 'utf8');
  symlinkSync(outside, join(skills, 'linked'), 'junction');
  const list = await call(ctx, { headers: hostHeaders() });
  assert.ok(list.json.skills.some((item) => item.file === 'linked/SKILL.md'));
  const got = await call(ctx, { headers: hostHeaders(), path: '/get?file=linked%2FSKILL.md' });
  assert.equal(got.status, 400);
  const saved = await call(ctx, {
    method: 'POST',
    path: '/save',
    headers: postHeaders(),
    body: JSON.stringify({ root: 'dsh', name: 'linked', description: 'pwn', body: 'OVERWRITTEN\n', originalFile: 'linked/SKILL.md' }),
  });
  assert.equal(saved.status, 400);
  assert.equal(readFileSync(join(outside, 'SKILL.md'), 'utf8'), '---\nname: linked\ndescription: outside\n---\n\noutside body\n');
});
