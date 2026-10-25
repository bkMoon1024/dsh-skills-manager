<div align="center">

# 🧩 dsh-skills-manager · 技能管理面板

**DeepSeek Harness 原生风格技能可视化管理：一站式查看、新建、在线编辑与调用策略调控**

[![Release](https://img.shields.io/github/v/release/daha1216/dsh-skills-manager?color=4d6bfe.svg?style=flat-square)](https://github.com/daha1216/dsh-skills-manager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](./LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4A90D9.svg?style=flat-square)](https://github.com/topics/dsh-plugin)
[![Tests Passing](https://img.shields.io/badge/tests-21%20passed-brightgreen.svg?style=flat-square)](https://github.com/daha1216/dsh-skills-manager)

**中文** · [English](./README.en.md)

</div>

---

在 DeepSeek Harness（DSH）中，**Skills（技能）** 是赋予智能体领域能力、标准执行规范与自定义工具流的核心资产。然而在日常使用中：
- 想查看本地装了哪些技能，必须在文件资源管理器或终端里层层翻找目录？
- 想暂时关闭某个技能的模型自动调用，却要手动编辑 YAML Frontmatter，生怕改错缩进或破坏原注释？
- 智能体偶尔自主乱用某些大模型消耗型技能，无法方便地设置“仅允许我手动调用”？
- 想看看某个技能的具体 Prompt 提示词，或者顺手复制出来微调，没有直观的预览和复制入口？

**dsh-skills-manager** 为 DSH 设置中心带来了**原生级「技能管理」面板**。通过优雅的可视化界面，助你一站式掌控技能全生命周期，让智能体的能力调用变得清晰、可控、安全。

---

## 📸 实机体验

<div align="center">

| 技能管理全貌（设置中心） | 技能卡片展开与策略控制 |
| :---: | :---: |
| <img src="./assets/skills-list.png" width="460" alt="DSH 设置中的技能管理列表面板" /> | <img src="./assets/skill-detail.png" width="460" alt="展开技能卡片：策略开关与正文预览" /> |
| *设置面板原生内嵌「技能」标签，一览全部技能、指令字数、类型与修改时间* | *可视化独立配置「模型自主调用」与「用户手动调用」策略，支持指令实时预览与一键复制* |

</div>

---

## ✨ 核心特性

### 1. 🔍 一站式技能概览与即时检索
- **自动全量扫描**：智能识别技能根目录（默认为 `~/.dsh/skills`，支持 `$DSH_HOME` 自定义与符号链接跟随）。
- **多形态支持**：完整支持 `<name>/SKILL.md`（Bundle 目录型）与 `<name>.md`（Flat 单文件型）两种主流布局。
- **信息一目了然**：直观展示技能描述、有效性状态、指令字数统计（Tokens 预估参考）与最近修改时间。
- **实时模糊过滤**：搜索框支持按**技能名称**、**描述内容**或**触发场景（whenToUse）**即时搜索过滤。

### 2. 🎛️ 精准的调用策略可视化调控
每张技能卡片均提供独立的调用策略开关，所见即所得：
- **模型自主调用**：开启后允许智能体在任务规划与推理时自主匹配并触发；关闭后模型将不会自动调用该技能（底层写入 `disable-model-invocation: true`）。
- **用户手动调用**：控制是否允许用户在对话框输入 `@` 或在工具面板中显式调用该技能（底层写入 `user-invocable`）。
- **无损写入机制**：修改策略仅更新目标字段，**原 YAML 中的未知元数据字段、自定义注释、CRLF 换行与块标量结构 100% 原样保留**。

### 3. 📝 在线指令预览、一键复制与快捷编辑
- **Markdown 正文预览**：展开卡片即可阅读格式化渲染后的 `SKILL.md` 正文，顶部提供「复制指令」按钮，方便随时提取参考。
- **内置轻量编辑器**：支持在线直接编辑技能 Frontmatter 与正文；快捷键支持 `Ctrl/Cmd + S` 快速保存、`Esc` 退出。
- **防丢保护机制**：包含修改冲突检测（乐观并发并发锁）与未保存直接离开时的防误触确认。

### 4. 📁 本地文件系统无缝联动
- **一键定位根目录**：工具栏提供「打开目录」按钮，一键调出系统的文件资源管理器（Windows Explorer / macOS Finder / Linux xdg-open）。
- **单技能直达**：卡片内配备「打开目录」，直接定位到该技能的 Bundle 文件夹，方便管理附加的脚本、模板与依赖资源。
- **快速打开全局配置**：页面右上角提供一键「打开配置文件」入口。

### 5. 🛡️ 生产级安全防护体系
- **安全软删除（防误删）**：删除技能时，系统会将其安全移至 `<root>/.trash/` 回收站目录，绝不直接物理销毁，随时可撤销找回。
- **写前快照备份**：每次保存新版本前，自动在 `<root>/.backups/` 中创建带时间戳的完整历史快照副本。
- **严格信任围栏**：API 仅允许本地 Loopback 或受信主机调用，强制同源检查与 JSON 请求体限制，杜绝跨源攻击（CSRF）与非法路径穿越。

### 6. 🎨 原生质感与深色模式完美适配
- 深度融合 DSH 官方 UI 体系，完全遵循官方 Design Tokens。
- **v0.3.1 深度重构主题配色**：深色模式下开关旋钮、按钮前景色与链接强调色均达到无障碍高对比度（开关旋钮达 18:1 对比度，按钮文字杜绝深色糊团）。
- **中英双语无缝切换**：跟随 DSH 系统语言（`zh` / `en`）自适应切换界面文案。

---

## 📦 安装与更新

> **前置条件**：已安装并配置带有 `dsh` CLI 的 DeepSeek Harness 环境。

### 方式一：推荐通过 Profile 安装（GitHub 远程源）

在终端中执行以下命令（以桌面版 Profile 为例）：

```bash
# 安装到 DSH 桌面端
dsh plugin --profile desktop add github:daha1216/dsh-skills-manager

# 若在 Web 独立服务中使用
dsh plugin --profile web add github:daha1216/dsh-skills-manager
```

> 💡 **重要说明**：
> 1. 安装或更新后，**请完全退出并重新启动 DSH 桌面端**（独立 Web 部署请重启 `dsh` 进程并刷新浏览器），以使宿主模块与客户端 Bundle 完整生效。
> 2. 后续若要更新到最新版本，重新执行上述相同的 `add` 命令即可。
>
> **兼容性**：`engines.dsh` 声明 `^0.2.0-rc.1`，即 **DSH 0.2.0-rc.1 及以上、0.3.0 之前**。装到不匹配的版本时，插件管理器会以 `incompatible-version` 明确拒绝；确实要在别的版本上试，可用 `dsh plugin allow-version` 加一次性豁免。DSH 升到 0.3.x 后需要本插件发新版放开范围。

### 方式二：本地开发安装（Checkout 模式）

如果你希望在本机克隆并进行调试修改：

```bash
git clone https://github.com/daha1216/dsh-skills-manager.git "D:/dsh work/skills-manager"
dsh plugin --profile desktop add link:"D:/dsh work/skills-manager"
```

---

## 🚀 使用指南

1. 打开 DeepSeek Harness 客户端，点击左下角齿轮进入 **设置**。
2. 在左侧导航栏中点击 **技能**，即可进入技能管理面板。
3. **浏览与搜索**：顶部搜索框可按技能名称或使用场景即时检索，列表中每个卡片清晰标明了类型（目录型/文件型）、描述与指令字数。
4. **调整调用策略**：展开任意技能卡片，直接拨动「模型自主调用」与「用户手动调用」的开关，配置即时落盘生效。
5. **新建技能**：点击右上角「+ 新建技能」，输入英文短横线名称（kebab-case）与描述，即可一键生成规范的初始技能骨架。

---

## 📁 技能目录与 Frontmatter 规范

技能文件存放在 `~/.dsh/skills`（若配置了环境变量 `$DSH_HOME`，则为 `$DSH_HOME/skills`）。

插件支持两种主流布局结构：
- **Bundle 目录型（推荐）**：`<name>/SKILL.md`，同级可存放脚本、参考资料与辅助图片。
- **Flat 单文件型**：`<name>.md`，适用于单一提示词技能。

标准 `SKILL.md` 采用 YAML Frontmatter 格式：

```yaml
---
name: my-skill
description: 简明扼要地说明这个技能提供什么专业能力
whenToUse: 什么时候触发（可选，例如：当用户询问数据分析或可视化图表时）
disable-model-invocation: false   # 设为 true 则禁止智能体自主推理调用
user-invocable: true             # 设为 true 则允许用户在会话框手动调用
---

# 技能正文

这里是注入给模型的详细系统指令、规范与示例...
```

---

## 🔌 HTTP API 概览

宿主服务端（`index.js`）向 DSH 前端暴露了以下经过信任围栏保护的 RESTful 接口：

| 方法 | 接口路径 | 功能说明 |
| :--- | :--- | :--- |
| `GET` | `/skills-manager/api` | 获取全部技能列表（元数据、有效性、策略状态、修改时间等） |
| `GET` | `/skills-manager/api/get?name=…` | 获取指定技能的完整源码正文（供编辑使用） |
| `POST` | `/skills-manager/api/save` | 新建 / 编辑 / 重命名技能，带乐观锁（`expectedMtimeMs`）与无损 YAML 保留 |
| `POST` | `/skills-manager/api/policy` | 切换 `disable-model-invocation` 与 `user-invocable` 调用策略 |
| `POST` | `/skills-manager/api/open` | 唤起系统文件管理器打开技能总目录或指定技能 Bundle 目录 |
| `POST` | `/skills-manager/api/delete` | 将技能安全移入 `<root>/.trash/` 回收站目录 |

---

## 🧪 自动化测试

项目内置了详尽的单元测试与回归测试集（基于 Node.js 原生 Test Runner）：

```bash
node --test "test/*.test.mjs"
```

覆盖 21 项核心测试，包括：
- YAML Frontmatter 往返保真度（保留块标量、未知键、注释、CRLF 换行等）。
- API 信任围栏防护（Host 校验、同源 Origin 检查、请求体超限拦截）。
- 乐观并发写入冲突保护与软删除移入 `.trash/` 机制。
- 操作系统原生文件管理器唤起路径防注入。

---

## 📝 更新日志

### v0.3.1（2026-10-18）
- **深色模式全量重构**：全面对齐 DSH 官方 Design Tokens（`--dsw-alias-button-primary-fill`、`--dsw-alias-label-primary-foreground` 等），彻底解决深色主题下主按钮白底白字、危险按钮视觉糊团、链接色不可读等问题。
- **高对比度开关与组件**：开关控件按宿主官方令牌重写，深色下旋钮对比度提升至 18:1；卡片与编辑面板阴影迁移至 `--dsw-shadow-lv2`。

### v0.3.0
- 新增一键打开技能根目录与单技能目录功能。
- 引入指令字数统计与优化 Markdown 渲染排版。
- 引入安全回收站（`.trash/`）与写前版本快照（`.backups/`）。

---

## 🙏 贡献者

感谢为项目提交代码与改进建议的贡献者：

- [@lanslot4n93r](https://github.com/lanslot4n93r) — 深色模式主按钮配色修复（改用 `label-primary-inverted`），以及打包时带上 `cordis.patch.yml`，GitHub 远程安装不再缺 overlay。

---

## 📄 开源协议

本项目采用 [MIT License](./LICENSE) 协议开源。
