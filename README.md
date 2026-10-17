# 🧩 dsh-skills-manager

中文 · [English](./README.en.md)

> DeepSeek Harness（DSH）技能管理插件：在设置页集中列出、查看、新建、编辑、删除本地技能，切换模型调用与用户调用策略，并支持一键在文件管理器中打开技能目录。

[![Release](https://img.shields.io/github/v/release/daha1216/dsh-skills-manager?color=4d6bfe)](https://github.com/daha1216/dsh-skills-manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## ✨ 功能

- **技能列表** — 扫描技能目录，显示有效性、描述、`whenToUse`、调用策略、文件大小与更新时间；搜索框可按名称 / 描述 / 触发场景过滤。
- **查看与编辑** — 展开卡片查看正文；编辑器支持 `Esc` 取消、`Ctrl/Cmd + S` 保存，并对未保存修改给出确认。
- **新建 / 重命名 / 删除** — 名称强制 kebab-case；重命名冲突会拒绝；删除是移入 `<root>/.trash/`，不硬删。
- **调用策略开关** — 直接切换 `disable-model-invocation` 与 `user-invocable`，写回时保留未知 frontmatter 键、注释与块标量原文。
- **一键打开目录** — 工具栏按钮打开技能根目录；每张技能卡片的「打开目录」打开该技能的 bundle 目录。
- **中英双语** — 跟随 DSH 界面语言（`zh` / `en`），通过 `ctx.locale` 注册。

## 📦 安装与更新

```bash
dsh plugin --profile web add github:daha1216/dsh-skills-manager
```

开发态（本机 checkout）可直接链接：

```bash
dsh plugin --profile desktop add link:D:/dsh work/skills-manager
```

> 重新执行同一命令即可更新到最新提交。升级后需重启 DSH 让宿主生效，并刷新页面加载新版客户端。

## 🚀 使用

打开 **设置 → 技能**。页面会列出技能根目录下的全部技能；点击卡片展开正文，右侧开关切换调用策略，工具栏可刷新、搜索、新建，或直接打开技能目录。

## 📁 技能目录与格式

技能根目录默认为 `~/.dsh/skills`；设置 `$DSH_HOME` 时使用 `$DSH_HOME/skills`。

支持两种布局：

- `<name>/SKILL.md`（bundle，可带资源文件）
- `<name>.md`（flat）

`SKILL.md` 以 YAML frontmatter 开头：

```yaml
---
name: my-skill
description: 这个技能做什么
whenToUse: 什么时候触发（可选）
disable-model-invocation: false
user-invocable: true
---

# 正文
```

符号链接 / junction 会被跟随（与官方 provider 一致）；`.` 开头的条目（`.backups`、`.trash`、`.system`）会被忽略。

## 🧪 开发与测试

```bash
node --test "test/*.test.mjs"
```

共 21 项测试，覆盖 frontmatter 往返（块标量、注释、未知键、CRLF、空行）、API 信任围栏、请求体上限、重命名冲突、乐观并发冲突、删除进 `.trash`、符号链接发现，以及打开目录的平台路径编码。

## 🔌 HTTP API

宿主半（`index.js`）在插件 Web 服务器上暴露一组 JSON API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/skills-manager/api` | 列出技能（有效性、描述、策略、mtime） |
| `GET` | `/skills-manager/api/get?name=…` | 读取单个技能正文，供编辑 |
| `POST` | `/skills-manager/api/save` | 新建 / 重命名 / 编辑；保留未知 frontmatter 键；支持 `expectedMtimeMs` 乐观并发 |
| `POST` | `/skills-manager/api/policy` | 切换 `disable-model-invocation` / `user-invocable` |
| `POST` | `/skills-manager/api/open` | 打开技能根目录；传 `{"name":"…"}` 打开单个技能目录 |
| `POST` | `/skills-manager/api/delete` | 把技能（bundle 目录或 flat 文件）移入 `<root>/.trash/` |

客户端半（`client.js`）注册一个 `settings.section` 条目，交互对齐内置技能工具卡：技能行、可展开的说明卡、调用策略开关，以及带客户端 + 服务端校验（kebab-case、必填描述）的新建 / 编辑表单，包含未保存守卫、忙碌态和 `zh` / `en` 字典。

## 🔒 安全说明

- 请求必须通过与 DSH 自带 `/api` 相同的信任围栏：loopback 或受信主机、同源 `Origin`、非 `sec-fetch-site: cross-site`，写请求要求 `content-type: application/json`。额外主机名可通过 `DSH_SKILLS_MANAGER_TRUSTED_HOSTS=a,b` 放行。
- 写入是原子的（临时文件 + rename）；每次写前把旧文件复制到 `<root>/.backups/<timestamp>-<path>`。
- 未知 frontmatter 键、注释与块标量值在保存时原样保留；旧版键（`disableModelInvocation`、`modelInvocable`、`userInvocable`）会作为问题报告，而不是被静默改写。
- 打开目录是 POST-only 动作，同样在信任围栏之后；目标从扫描结果解析并限制在技能根目录内，宿主以 argv 数组直接 spawn 平台文件管理器（`explorer.exe` / `open` / `xdg-open`），不经过 shell 拼接。

## 📄 License

[MIT](./LICENSE)
