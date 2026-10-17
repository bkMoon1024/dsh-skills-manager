# @local/skills-manager

DSH plugin that adds a **技能 / Skills** page to Settings for managing the local
skill directory (`~/.dsh/skills` by default; resolved via `$DSH_HOME` when set).

## 安装 / Install

```bash
dsh plugin --profile web add github:daha1216/dsh-skills-manager
```

开发态（本机 checkout）可直接链接：

```bash
dsh plugin --profile desktop add link:D:/dsh work/skills-manager
```

> 重新执行同一命令即可更新到最新提交。

## 开发 / Development

```bash
node --test "test/*.test.mjs"
```

Tests cover the YAML frontmatter round-trip (block scalars, comments, unknown
keys, CRLF, blank lines), the API trust fence, body limits, rename collisions,
optimistic-concurrency conflicts, and deletion into `.trash`.

## API

Host half (`index.js`) exposes a small JSON API on the plugin web server:

- `GET  /skills-manager/api` — list skills (validity, description, policy, mtime)
- `GET  /skills-manager/api/get?name=…` — full skill body for editing
- `POST /skills-manager/api/save` — create/rename/edit (keeps unknown frontmatter
  keys; accepts `expectedMtimeMs` for optimistic concurrency)
- `POST /skills-manager/api/policy` — toggle `disable-model-invocation` /
  `user-invocable`
- `POST /skills-manager/api/open` — open the skills root, or one skill's folder
  via `{"name":"…"}`, in the OS file manager
- `POST /skills-manager/api/delete` — move a skill (bundle dir or flat file) to
  `<root>/.trash/`; nothing is hard-deleted

Client half (`client.js`) registers a `settings.section` entry styled after the
built-in skill tool card: skill rows with hover chevron, expandable instructions
card, invocation-policy switches, and a create/edit form with client + server
validation (kebab-case names, required description), unsaved-changes guards,
busy states, and `zh`/`en` dictionaries registered through `ctx.locale`. A
toolbar button opens the skills directory, and each expanded skill row has an
**Open folder** action that reveals its bundle directory (flat skills open the
root they live in).

## Safety notes

- Requests must pass the same trust fence as DSH's own `/api`: loopback or
  trusted host, same-origin `Origin`, no `sec-fetch-site: cross-site`, and
  `content-type: application/json` on writes. Override extra hostnames with
  `DSH_SKILLS_MANAGER_TRUSTED_HOSTS=a,b`.
- Writes are atomic (temp file + rename). Before every write the previous file
  is copied to `<root>/.backups/<timestamp>-<path>`.
- Skill files follow `dsh-skill-filesystem`: `<name>/SKILL.md` bundles or flat
  `<name>.md`, YAML frontmatter with `name`, `description`, optional
  `whenToUse`, `disable-model-invocation`, `user-invocable`. Unknown frontmatter
  keys, comments, and block-scalar values are preserved verbatim on save; the
  legacy keys (`disableModelInvocation`, `modelInvocable`, `userInvocable`) are
  reported as problems instead of being silently rewritten.
- Symbolic links / junctions inside the skills directory are followed, matching
  the official provider; dot-prefixed entries (`.backups`, `.trash`, `.system`)
  are ignored by the manager.
- Opening a folder is a POST-only action behind the same trust fence. The target
  is resolved from the scanned catalog and confined to the skills root; the host
  spawns the platform file manager (`explorer.exe`, `open`, `xdg-open`) with an
  argv array, so no path is ever interpolated into a shell command.
