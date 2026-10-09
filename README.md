# @local/skills-manager

DSH plugin that adds a **技能 / Skills** page to Settings for managing the local
skill directory (`~/.dsh/skills` by default; resolved via `$DSH_HOME` when set).

## 安装 / Install

```bash
dsh plugin --profile web add github:daha1216/dsh-skills-manager
```

> 重新执行同一命令即可更新到最新提交。

Host half (`index.js`) exposes a small JSON API on the plugin web server:

- `GET  /skills-manager/api` — list skills (validity, description, policy, mtime)
- `GET  /skills-manager/api/get?name=…` — full skill body for editing
- `POST /skills-manager/api/save` — create/rename/edit (keeps unknown frontmatter keys)
- `POST /skills-manager/api/policy` — toggle `disable-model-invocation` / `user-invocable`
- `POST /skills-manager/api/delete` — remove a skill (bundle dir or flat file)

Client half (`client.js`) registers a `settings.section` entry styled after the
built-in skill tool card: skill rows with hover chevron, expandable instructions
card, invocation-policy switches, and a create/edit form with client + server
validation (kebab-case names, required description).

Skill file format follows `dsh-skill-filesystem`: `<name>/SKILL.md` bundles or
flat `<name>.md`, YAML frontmatter with `name`, `description`, optional
`whenToUse`, `disable-model-invocation`, `user-invocable`. Unknown frontmatter
keys are preserved verbatim on save.
