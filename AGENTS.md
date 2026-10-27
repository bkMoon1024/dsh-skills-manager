# AGENTS.md

## 项目定位

DSH（DeepSeek Harness）Web 插件：在「设置 → 技能」中浏览、新建、编辑、删除本地技能，并切换模型/用户调用策略。插件同时管理 `~/.dsh/skills` 与 `~/.agents/skills`（可用 `DSH_HOME` / `DSH_AGENTS_HOME` 覆盖）。

## 开发与验证

- Node.js >= 22；零运行时依赖；**没有构建步骤**，`client.js` 是手写并预打包的 plain script，直接改，不要引入 bundler。
- 运行测试：`npm test`（Node 原生 Test Runner，当前 43 项）。
- 本地安装调试：`dsh plugin --profile desktop add link:<仓库绝对路径>`；改动宿主侧 `index.js` 后需重启 DSH，客户端改动刷新页面。
- 提交前至少跑一次 `npm test` 和 `node --check index.js client.js`。

## 目录结构

- `index.js` — 插件服务端：注册文件系统 skill provider、挂载 `/skills-manager/api/*`、自研 YAML frontmatter 解析/序列化；文件末尾 `__test` 导出仅供测试。
- `client.js` — 客户端 Bundle：`window.__ModuleLoader__.load` 工厂，注册 `settings.section` 插槽（`id: 'skills'`），样式全部使用 `.skm-` 前缀。
- `test/skills-manager.test.mjs` — 使用 fake `ctx` 与临时 `DSH_HOME`/`DSH_AGENTS_HOME`，不得读写真实用户目录。
- `cordis.patch.yml` — 插件注入配置，`id` 与 `package.json` 的 `name` 必须一致。

## 关键约束

- **路径安全**：绝不把请求里的 `name`/`file` 直接拼接为磁盘路径；先用 `scanRoot` 得到条目，再以 `root` + 相对 `file` 寻址。写/删/改策略前用 `realpath` 校验目标仍在技能根目录内。
- **无损 frontmatter**：策略写入只改受管字段；未改动字段保留原始字节、注释、CRLF 与 BOM；未知键不得丢弃。
- **双根隔离**：所有列表/读取/写入/删除都携带 `root`（`dsh` 或 `agents`）；测试必须两个环境变量都隔离。
- **前端状态**：以 `root:file` 作为 key，不要以技能 `name` 作唯一标识（允许同名）。
- **Windows 兼容**：拒绝 `con`/`nul`/`com1` 等保留名与超长名，注意大小写不敏感文件系统。
- 不新增运行时依赖；保持现有 HTTP API 对旧客户端（只传 `name`）的兼容。

## 文档

`README.md` 与 `README.en.md` 是用户文档，行为变更时同步更新两份；版本号、更新日志与测试数量保持一致。
