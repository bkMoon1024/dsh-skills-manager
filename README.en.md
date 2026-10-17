# 🧩 dsh-skills-manager

English · [中文](./README.md)

> A DeepSeek Harness (DSH) plugin that adds a **Skills** page to Settings for listing, inspecting, creating, editing, and deleting local skills, toggling model / user invocation policy, and opening the skill directory in the OS file manager.

[![Release](https://img.shields.io/github/v/release/daha1216/dsh-skills-manager?color=4d6bfe)](https://github.com/daha1216/dsh-skills-manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## ✨ Features

- **Skill list** — scans the skill directory and shows validity, description, `whenToUse`, invocation policy, file size, and mtime; the search box filters by name / description / trigger scenario.
- **View and edit** — expand a card to read the body; the editor supports `Esc` to cancel and `Ctrl/Cmd + S` to save, with an unsaved-changes guard.
- **Create / rename / delete** — names are forced to kebab-case; rename collisions are rejected; deletion moves the skill to `<root>/.trash/` instead of hard-deleting it.
- **Invocation policy switches** — toggle `disable-model-invocation` and `user-invocable`; unknown frontmatter keys, comments, and block scalars are preserved verbatim on write-back.
- **Open folder** — a toolbar button opens the skills root; each skill card has an **Open folder** action for its bundle directory.
- **Bilingual UI** — follows the DSH interface language (`zh` / `en`) through `ctx.locale`.

## 📦 Install and update

```bash
dsh plugin --profile web add github:daha1216/dsh-skills-manager
```

For local development, link the checkout:

```bash
dsh plugin --profile desktop add link:D:/dsh work/skills-manager
```

> Re-running the same command updates to the latest commit. After upgrading, restart DSH so the host half reloads, and refresh the page to load the new client half.

## 🚀 Usage

Open **Settings → Skills**. The page lists every skill under the skills root; click a card to expand its body, use the switches to change invocation policy, and use the toolbar to refresh, search, create, or open the skills directory.

## 📁 Skill directory and format

The skills root defaults to `~/.dsh/skills`, or `$DSH_HOME/skills` when `$DSH_HOME` is set.

Two layouts are supported:

- `<name>/SKILL.md` (bundle, may include resource files)
- `<name>.md` (flat)

`SKILL.md` starts with YAML frontmatter:

```yaml
---
name: my-skill
description: What this skill does
whenToUse: When it should trigger (optional)
disable-model-invocation: false
user-invocable: true
---

# Body
```

Symbolic links / junctions are followed (matching the official provider); dot-prefixed entries (`.backups`, `.trash`, `.system`) are ignored.

## 🧪 Development and tests

```bash
node --test "test/*.test.mjs"
```

21 tests cover the YAML frontmatter round-trip (block scalars, comments, unknown keys, CRLF, blank lines), the API trust fence, body limits, rename collisions, optimistic-concurrency conflicts, deletion into `.trash`, symlink discovery, and platform path encoding for opening folders.

## 🔌 HTTP API

The host half (`index.js`) exposes a small JSON API on the plugin web server:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/skills-manager/api` | List skills (validity, description, policy, mtime) |
| `GET` | `/skills-manager/api/get?name=…` | Full skill body for editing |
| `POST` | `/skills-manager/api/save` | Create / rename / edit; keeps unknown frontmatter keys; accepts `expectedMtimeMs` for optimistic concurrency |
| `POST` | `/skills-manager/api/policy` | Toggle `disable-model-invocation` / `user-invocable` |
| `POST` | `/skills-manager/api/open` | Open the skills root, or one skill's folder via `{"name":"…"}` |
| `POST` | `/skills-manager/api/delete` | Move a skill (bundle dir or flat file) to `<root>/.trash/` |

The client half (`client.js`) registers a `settings.section` entry styled after the built-in skill tool card: skill rows, an expandable instructions card, invocation-policy switches, and a create/edit form with client + server validation (kebab-case names, required description), unsaved-changes guards, busy states, and `zh` / `en` dictionaries.

## 🔒 Safety notes

- Requests must pass the same trust fence as DSH's own `/api`: loopback or trusted host, same-origin `Origin`, no `sec-fetch-site: cross-site`, and `content-type: application/json` on writes. Override extra hostnames with `DSH_SKILLS_MANAGER_TRUSTED_HOSTS=a,b`.
- Writes are atomic (temp file + rename). Before every write the previous file is copied to `<root>/.backups/<timestamp>-<path>`.
- Unknown frontmatter keys, comments, and block-scalar values are preserved verbatim on save; the legacy keys (`disableModelInvocation`, `modelInvocable`, `userInvocable`) are reported as problems instead of being silently rewritten.
- Opening a folder is a POST-only action behind the same trust fence. The target is resolved from the scanned catalog and confined to the skills root; the host spawns the platform file manager (`explorer.exe`, `open`, `xdg-open`) with an argv array, so no path is ever interpolated into a shell command.

## 📄 License

[MIT](./LICENSE)
