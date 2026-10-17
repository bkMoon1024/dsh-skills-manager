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
  const skills = join(process.env.DSH_HOME, 'skills');
  mkdirSync(skills, { recursive: true });
  const ctx = createCtx();
  apply(ctx);
  t.after(async () => {
    for (const cleanup of ctx.cleanups.reverse()) await cleanup();
  });
  return { root, skills, ctx };
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
