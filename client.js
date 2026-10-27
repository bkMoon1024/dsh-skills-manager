window.__ModuleLoader__.load({
  id: "@local/skills-manager",
  factory(require) {
    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");
    const { useEffect, useMemo, useRef, useState } = React;

    const API = "/skills-manager/api";
    const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    // Two global roots can legitimately contain the same relative path, so a
    // skill is identified by root + file, never by file alone.
    const entryKey = (skill) => `${skill.rootKey ?? "dsh"}:${skill.file}`;

    const NS = "skills-manager";

    const DICTS = {
      zh: {
        "nav": "技能",
        "header.title": "技能管理",
        "header.subtitle": "管理本机全局技能目录中的 AI 技能，配置模型自主调用策略与指令提示词。",
        "toolbar.new": "新建技能",
        "toolbar.refresh": "刷新",
        "toolbar.search": "搜索技能名称、描述或时机…",
        "toolbar.count": "共 {n} 个技能",
        "toolbar.filterCount": "筛选出 {filtered} / {total} 个技能",
        "toolbar.rootTitle": "技能存储目录：{root}",
        "roots.label": "技能目录",
        "roots.missing": "未创建",
        "toolbar.copyPath": "复制目录路径",
        "toolbar.copiedPath": "路径已复制",
        "toolbar.openDir": "打开目录",
        "toolbar.openDirTitle": "在文件管理器中打开技能安装目录",
        "loading": "正在加载技能列表…",
        "search.label": "搜索技能",
        "notice.saved": "已保存",
        "notice.deleted": "已删除，可在技能目录 .trash 中找回",
        "provider.title": "技能提供器未就绪",
        "provider.desc": "状态：{state}（已尝试 {attempts} 次）。会话可能只能看到内置技能。",
        "empty.rootMissingTitle": "技能目录尚未创建",
        "empty.rootMissing": "本地技能目录尚未创建。点击“新建技能”创建第一个技能，系统会自动创建该目录。",
        "empty.noneTitle": "暂无自定义技能",
        "empty.none": "本机尚未添加任何 AI 技能。创建你的第一个技能，为模型赋予专有能力与工作流准则。",
        "empty.filteredTitle": "未找到匹配技能",
        "empty.filtered": "没有找到匹配当前搜索条件的技能，请尝试更换关键词。",
        "empty.clearFilter": "清空筛选",
        "error.prefix": "操作失败",
        "error.load": "读取技能列表失败",
        "error.save": "保存技能失败",
        "error.delete": "删除技能失败",
        "error.policy": "更新调用策略失败",
        "error.openDir": "打开目录失败",
        "error.timeout": "请求超时，请检查技能目录是否可访问后重试",
        "error.retry": "重试",
        "row.invalid": "配置异常",
        "row.bundle": "目录型",
        "row.flat": "单文件",
        "row.modelOnly": "仅模型调用",
        "row.userOnly": "仅用户调用",
        "row.disabled": "已停用",
        "row.ready": "已就绪",
        "card.instructions": "指令正文 (SKILL.md)",
        "card.path": "文件路径",
        "card.kind": "格式",
        "card.whenToUse": "触发时机",
        "card.size": "指令字数",
        "card.updated": "最近修改",
        "card.modelSwitch": "模型自主调用",
        "card.modelSwitchDesc": "允许智能体在任务推理与规划时自主决定调用此技能",
        "card.userSwitch": "用户手动调用",
        "card.userSwitchDesc": "允许用户在对话框或工具面板中显式指定调用此技能",
        "card.edit": "编辑技能",
        "card.openDir": "打开目录",
        "card.delete": "删除",
        "card.deleteConfirmTitle": "确定删除此技能？",
        "card.deleteConfirmMsg": "技能“{name}”及其所有本地文件将被移入技能目录的 .trash，可在文件管理器中手动找回。",
        "card.confirmDelete": "移入 .trash",
        "card.cancelDelete": "取消",
        "card.copyCode": "复制指令",
        "card.copiedCode": "已复制",
        "card.noFile": "该目录缺少 SKILL.md 文件，无法正常读取。你可以删除该目录，或重新保存此技能进行重建。",
        "card.problemsTitle": "检测到配置问题：",
        "card.policyInvalid": "该技能配置异常，先修复后才能切换调用策略。",
        "delete.busy": "正在删除…",
        "policy.busy": "正在保存…",
        "editor.newTitle": "新建技能",
        "editor.editTitle": "编辑技能 · {name}",
        "editor.subtitle": "配置技能标识、触发意图与详细的 Markdown 指令正文。",
        "editor.name": "技能唯一标识 (name)",
        "editor.nameHint": "小写 kebab-case，仅包含英文字母、数字和连字符，如 web-search",
        "editor.namePlaceholder": "例如：my-skill",
        "editor.description": "技能描述 (description)",
        "editor.descriptionHint": "简明概括此技能的核心功能，模型将据此理解其用途（必填）",
        "editor.descriptionPlaceholder": "例如：提供网络搜索与权威信息检索能力",
        "editor.whenToUse": "触发时机 (whenToUse，可选)",
        "editor.whenToUseHint": "指导模型在何种具体意图或边界场景下主动调用此技能",
        "editor.whenToUsePlaceholder": "例如：当用户需要查询实时信息、最新新闻或网络资料时调用",
        "editor.body": "指令正文 (Markdown)",
        "editor.bodyHint": "详细的工作流程、输入输出规范、边界约束与示例（支持完整 Markdown）",
        "editor.bodyPlaceholder": "# 技能指令与工作流程\n\n在此输入 Markdown 正文…",
        "editor.modelSwitch": "允许模型自主调用",
        "editor.userSwitch": "允许用户手动调用",
        "editor.save": "保存技能",
        "editor.saving": "正在保存…",
        "editor.cancel": "取消",
        "editor.shortcutHint": "Esc 取消 · Ctrl + S 快速保存",
        "editor.descRequired": "技能描述不能为空",
        "editor.nameInvalid": "技能标识必须是小写 kebab-case（例如 my-skill）",
        "editor.chars": "{n} 字",
        "editor.problemsBanner": "该技能当前存在配置问题，保存会重写 frontmatter：",
        "editor.discardTitle": "放弃未保存的修改？",
        "editor.discardMsg": "当前编辑内容尚未保存，离开后将丢失。",
        "editor.discardConfirm": "放弃修改",
        "editor.discardCancel": "继续编辑",
        "editor.unsaved": "有未保存的修改",
      },
      en: {
        "nav": "Skills",
        "header.title": "Skills",
        "header.subtitle": "Manage AI skills in your global skill directories: edit instructions and control when models may invoke them.",
        "toolbar.new": "New Skill",
        "toolbar.refresh": "Refresh",
        "toolbar.search": "Search skills by name, description, or trigger…",
        "toolbar.count": "{n} skills",
        "toolbar.filterCount": "{filtered} of {total} skills",
        "toolbar.rootTitle": "Skills directory: {root}",
        "roots.label": "Skill directories",
        "roots.missing": "not created",
        "toolbar.copyPath": "Copy path",
        "toolbar.copiedPath": "Path copied",
        "toolbar.openDir": "Open folder",
        "toolbar.openDirTitle": "Open the skills directory in the file manager",
        "loading": "Loading skills…",
        "search.label": "Search skills",
        "notice.saved": "Saved",
        "notice.deleted": "Deleted — recoverable from the .trash folder",
        "provider.title": "Skill provider not ready",
        "provider.desc": "State: {state} after {attempts} attempt(s). Sessions may only see bundled skills.",
        "empty.rootMissingTitle": "Skills directory not found",
        "empty.rootMissing": "The skills directory does not exist yet. Click “New Skill” to create it and your first skill.",
        "empty.noneTitle": "No skills yet",
        "empty.none": "No custom skills have been added yet. Create your first skill to empower agent models with specialized behaviors.",
        "empty.filteredTitle": "No matching skills",
        "empty.filtered": "No skills match the current search query. Try another term.",
        "empty.clearFilter": "Clear search",
        "error.prefix": "Action failed",
        "error.load": "Failed to load skills",
        "error.save": "Failed to save skill",
        "error.delete": "Failed to delete skill",
        "error.policy": "Failed to update invocation policy",
        "error.openDir": "Could not open the folder",
        "error.timeout": "The request timed out. Check that the skills folder is reachable and try again.",
        "error.retry": "Retry",
        "row.invalid": "Invalid config",
        "row.bundle": "Bundle",
        "row.flat": "Flat",
        "row.modelOnly": "Model only",
        "row.userOnly": "User only",
        "row.disabled": "Disabled",
        "row.ready": "Ready",
        "card.instructions": "Instructions (SKILL.md)",
        "card.path": "Path",
        "card.kind": "Format",
        "card.whenToUse": "When to use",
        "card.size": "Length",
        "card.updated": "Updated",
        "card.modelSwitch": "Model Invocation",
        "card.modelSwitchDesc": "Allow agent models to invoke this skill autonomously during reasoning",
        "card.userSwitch": "User Invocation",
        "card.userSwitchDesc": "Allow users to invoke this skill explicitly via chat or command palette",
        "card.edit": "Edit",
        "card.openDir": "Open folder",
        "card.delete": "Delete",
        "card.deleteConfirmTitle": "Delete this skill?",
        "card.deleteConfirmMsg": "Skill “{name}” and all its local files will be moved to the .trash folder in the skills directory; you can restore them manually from the file manager.",
        "card.confirmDelete": "Move to .trash",
        "card.cancelDelete": "Cancel",
        "card.copyCode": "Copy",
        "card.copiedCode": "Copied",
        "card.noFile": "This directory is missing SKILL.md. You can delete it or recreate it by saving a new skill.",
        "card.problemsTitle": "Configuration issues detected:",
        "card.policyInvalid": "Fix the configuration issues before changing invocation policy.",
        "delete.busy": "Deleting…",
        "policy.busy": "Saving…",
        "editor.newTitle": "New Skill",
        "editor.editTitle": "Edit · {name}",
        "editor.subtitle": "Define skill metadata, invocation settings, and instruction prompts.",
        "editor.name": "Skill Identifier (name)",
        "editor.nameHint": "Unique identifier, lowercase kebab-case only (e.g. web-search)",
        "editor.namePlaceholder": "e.g. my-skill",
        "editor.description": "Description",
        "editor.descriptionHint": "Summarize what this skill does so models understand when to use it (required)",
        "editor.descriptionPlaceholder": "e.g. Search the web and retrieve authoritative sources",
        "editor.whenToUse": "When to Use (optional)",
        "editor.whenToUseHint": "Provide explicit conditions or scenarios triggering this skill",
        "editor.whenToUsePlaceholder": "e.g. When the user asks for real-time news or web research",
        "editor.body": "Instruction Prompt (Markdown)",
        "editor.bodyHint": "Workflows, output guidelines, boundary constraints, and examples (full Markdown supported)",
        "editor.bodyPlaceholder": "# Skill instructions\n\nWrite the Markdown body here…",
        "editor.modelSwitch": "Allow Model Invocation",
        "editor.userSwitch": "Allow User Invocation",
        "editor.save": "Save Skill",
        "editor.saving": "Saving…",
        "editor.cancel": "Cancel",
        "editor.shortcutHint": "Esc to cancel · Ctrl + S to save",
        "editor.descRequired": "Description is required",
        "editor.nameInvalid": "Name must be lowercase kebab-case (e.g. my-skill)",
        "editor.chars": "{n} chars",
        "editor.problemsBanner": "This skill has configuration issues; saving will rewrite its frontmatter:",
        "editor.discardTitle": "Discard unsaved changes?",
        "editor.discardMsg": "Your edits have not been saved and will be lost.",
        "editor.discardConfirm": "Discard",
        "editor.discardCancel": "Keep editing",
        "editor.unsaved": "Unsaved changes",
      },
    };

    const FALLBACK_LANG = (typeof navigator !== "undefined" && (navigator.language ?? "zh")).toLowerCase().startsWith("zh") ? "zh" : "en";
    const formatTemplate = (template, params) => {
      const text = String(template ?? "");
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    };
    let t = (key, params) => formatTemplate((DICTS[FALLBACK_LANG] ?? DICTS.zh)[key] ?? DICTS.zh[key] ?? key, params);

    const API_TIMEOUT_MS = 20000;

    async function api(path, init) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      try {
        const response = await fetch(API + path, {
          ...init,
          headers: init?.body ? { "content-type": "application/json" } : undefined,
          signal: controller.signal,
        });
        let payload = null;
        try { payload = await response.json(); } catch { /* non-JSON body */ }
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
        }
        return payload;
      } catch (error) {
        if (error && error.name === "AbortError") throw new Error(t("error.timeout"));
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    function legacyCopy(text) {
      if (typeof document === "undefined") return;
      let area = null;
      try {
        area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
      } catch { /* clipboard unavailable */ } finally {
        if (area && area.parentNode) area.parentNode.removeChild(area);
      }
    }

    function copyToClipboard(text) {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      }
      return Promise.resolve(legacyCopy(text));
    }

    function formatTime(ms) {
      if (!ms) return "—";
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /* Official Primitives Icon Artwork (1px clean stroke) */
    const IconSkill = ({ size = 16, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 17 17", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1,
      children: [
        jsx("path", { d: "M4.57788 5.77124H10.7029", stroke: "currentColor" }),
        jsx("path", { d: "M4.57788 8.89819H7.91879", stroke: "currentColor" }),
        jsx("path", {
          d: "M12.1404 1.19446C12.9442 1.19446 13.6404 1.81999 13.6404 2.64465V8.89856H12.6404V2.64465C12.6404 2.42015 12.4411 2.19446 12.1404 2.19446H3.14038C2.83968 2.19446 2.64038 2.42015 2.64038 2.64465V13.0929C2.64082 13.3172 2.84001 13.5421 3.14038 13.5421H8.88159V14.5421H3.14038C2.33675 14.5421 1.6408 13.9172 1.64038 13.0929V2.64465C1.64038 1.81999 2.33651 1.19446 3.14038 1.19446H12.1404Z",
          fill: "currentColor",
        }),
        jsx("path", {
          d: "M12.0051 15.1056C12.0051 13.6395 10.8166 12.451 9.35059 12.451C10.8166 12.451 12.0051 11.2626 12.0051 9.79651C12.0051 11.2626 13.1936 12.451 14.6597 12.451C13.1936 12.451 12.0051 13.6395 12.0051 15.1056Z",
          stroke: "currentColor",
        }),
      ],
    });

    const IconChevron = ({ size = 14, className }) => jsx("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.2,
      children: jsx("path", {
        d: "M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6",
        stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round",
      }),
    });

    const IconChevronLeft = ({ size = 14, className }) => jsx("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.2,
      children: jsx("path", {
        d: "M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12",
        stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round",
      }),
    });

    const IconPlus = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.3,
      children: [
        jsx("path", { d: "M8 3V13", stroke: "currentColor", strokeLinecap: "round" }),
        jsx("path", { d: "M3 8H13", stroke: "currentColor", strokeLinecap: "round" }),
      ],
    });

    const IconTrash = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.1,
      children: [
        jsx("path", { d: "M1.5 3.88831H14.5", stroke: "currentColor", strokeLinecap: "round" }),
        jsx("path", {
          d: "M5.41602 3.88833V2.47962C5.41602 2.29282 5.52492 2.11366 5.71876 1.98157C5.9126 1.84948 6.17551 1.77527 6.44964 1.77527H9.55053C9.82466 1.77527 10.0876 1.84948 10.2814 1.98157C10.4753 2.11366 10.5842 2.29282 10.5842 2.47962V3.88833",
          stroke: "currentColor",
        }),
        jsx("path", {
          d: "M2.57349 3.88831L3.19366 13.2943C3.21937 13.5502 3.33952 13.7872 3.53065 13.9593C3.72178 14.1313 3.97016 14.2259 4.22729 14.2246H11.7728C12.0299 14.2259 12.2783 14.1313 12.4694 13.9593C12.6605 13.7872 12.7807 13.5502 12.8064 13.2943L13.4266 3.88831",
          stroke: "currentColor",
        }),
        jsx("path", { d: "M6.44946 7V11.2", stroke: "currentColor", strokeLinecap: "round" }),
        jsx("path", { d: "M9.55054 7V11.2", stroke: "currentColor", strokeLinecap: "round" }),
      ],
    });

    const IconEdit = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.1,
      children: [
        jsx("path", {
          d: "M8.85596 2.69971H4.19971C3.37141 2.69971 2.69992 3.37146 2.69971 4.19971V11.8003C2.69992 12.6285 3.37141 13.3003 4.19971 13.3003H11.8003C12.6283 13.2999 13.3001 12.6283 13.3003 11.8003V7.89893H14.3003V11.8003C14.3001 13.1806 13.1806 14.2999 11.8003 14.3003H4.19971C2.81913 14.3003 1.69992 13.1808 1.69971 11.8003V4.19971C1.69992 2.81918 2.81913 1.69971 4.19971 1.69971H8.85596V2.69971Z",
          fill: "currentColor",
        }),
        jsx("path", { d: "M7.7849 8.23878L13.888 2.13574", stroke: "currentColor", strokeLinecap: "round" }),
      ],
    });

    const IconRefresh = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.2,
      children: [
        jsx("path", {
          d: "M14.5001 8C14.5 9.28552 14.1188 10.5422 13.4045 11.611C12.6903 12.6799 11.6752 13.5129 10.4875 14.0049C9.29982 14.4968 7.99295 14.6255 6.73212 14.3747C5.4713 14.124 4.31314 13.505 3.4041 12.596C2.49514 11.687 1.87614 10.5288 1.62537 9.26798C1.37459 8.00716 1.50331 6.70028 1.99525 5.51261C2.48719 4.32494 3.32025 3.30981 4.3891 2.59557C5.45795 1.88134 6.71458 1.50008 8.0001 1.5C9.9001 1.5 11.7001 2.3 13.0001 3.6L14.5001 5.1",
          stroke: "currentColor", strokeLinecap: "round",
        }),
        jsx("path", { d: "M14.4999 1.5V5.1H10.8999", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" }),
      ],
    });

    const IconSearch = ({ size = 15, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.2,
      children: [
        jsx("path", {
          d: "M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z",
          stroke: "currentColor",
        }),
        jsx("path", { d: "M10.2991 10.3933L14.7783 14.8725", stroke: "currentColor", strokeLinecap: "round" }),
      ],
    });

    const IconClose = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.3,
      children: [
        jsx("path", { d: "M3.5 3.5L12.5 12.5", stroke: "currentColor", strokeLinecap: "round" }),
        jsx("path", { d: "M12.5 3.5L3.5 12.5", stroke: "currentColor", strokeLinecap: "round" }),
      ],
    });

    const IconCheck = ({ size = 14, className }) => jsx("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.4,
      children: jsx("path", {
        d: "M2.5 8.5L5.5 11.5L13.5 4",
        stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round",
      }),
    });

    const IconWarning = ({ size = 16, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.2,
      strokeLinecap: "round", strokeLinejoin: "round",
      children: [
        jsx("path", {
          d: "M6.87 2.6a1.33 1.33 0 0 1 2.26 0l5.34 9.33A1.33 1.33 0 0 1 13.33 14H2.67a1.33 1.33 0 0 1-1.14-2.07Z",
          stroke: "currentColor",
        }),
        jsx("path", { d: "M8 6v3m0 2.33h.01", stroke: "currentColor" }),
      ],
    });

    const IconFolder = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.1,
      children: [
        jsx("path", {
          d: "M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991",
          stroke: "currentColor",
        }),
        jsx("path", {
          d: "M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z",
          stroke: "currentColor",
        }),
      ],
    });

    const IconSparkle = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.1,
      children: [
        jsx("path", {
          d: "M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z",
          stroke: "currentColor",
        }),
        jsx("path", {
          d: "M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z",
          stroke: "currentColor",
        }),
      ],
    });

    const IconCopy = ({ size = 14, className }) => jsxs("svg", {
      width: size, height: size, className, viewBox: "0 0 16 16", fill: "none",
      xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", strokeWidth: 1.1,
      children: [
        jsx("rect", { x: "1.5", y: "4.1", width: "10.4", height: "10.4", rx: "2", stroke: "currentColor" }),
        jsx("path", {
          d: "M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z",
          fill: "currentColor",
        }),
      ],
    });

    /* Design System Styles */
    const CSS = `
/* Layout & Page Container */
.skm-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 0 0 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--dsw-alias-label-primary, #1e1e1e);
  font-family: inherit;
}
.skm-page * {
  box-sizing: border-box;
}

/* Page Header */
.skm-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-top: 4px;
}
.skm-header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.skm-header-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  letter-spacing: -0.02em;
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-header-desc {
  margin: 0;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 20px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.skm-path-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.04));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: 11px;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  cursor: pointer;
  flex: none;
  max-width: 320px;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 100ms ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skm-path-chip:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.5));
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-path-chip:active {
  transform: scale(0.97);
}

/* Directory switcher: the host exposes two global skill roots. */
.skm-root-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 3px;
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  align-self: flex-start;
}
.skm-root-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: 12px;
  cursor: pointer;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  transition: background 120ms ease, color 120ms ease;
}
.skm-root-tab:hover {
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-root-tab[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.16));
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-root-missing {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(128,128,128,0.16);
}
.skm-root-tab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: 1px;
}

/* Toolbar Controls */
.skm-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.skm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 340px;
}
.skm-search-icon {
  position: absolute;
  left: 9px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.6));
  pointer-events: none;
  display: inline-flex;
}
.skm-search-input {
  width: 100%;
  height: 32px;
  padding: 0 28px 0 30px;
  border-radius: 7px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}
.skm-search-input:focus {
  background: var(--dsw-alias-bg-base, transparent);
  border-color: var(--dsw-alias-link, #4176e6);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-link, #4176e6) 20%, transparent);
}
.skm-search-clear {
  position: absolute;
  right: 6px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 120ms ease, background 120ms ease;
}
.skm-search-clear:hover {
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.15));
}
.skm-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

/* Generic Button Primitives */
.skm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  border: .5px solid transparent;
  transition: transform 120ms ease-out, background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
  user-select: none;
}
.skm-btn:active {
  transform: scale(0.97);
}
.skm-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
  transform: none;
}
.skm-btn-primary {
  background: var(--dsw-alias-button-primary-fill, #4c6ef5);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  border-color: transparent;
  box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,0.08));
}
.skm-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #4176e6);
}
.skm-btn-secondary {
  border-color: var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.05));
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-btn-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.15));
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.5));
}
.skm-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.skm-btn-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-btn-danger {
  background: var(--dsw-alias-state-error-primary, #e03131);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  border-color: transparent;
}
.skm-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 85%, var(--dsw-alias-label-primary-foreground, #000));
}
.skm-btn-sm {
  height: 26px;
  padding: 0 8px;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  border-radius: 5px;
}

/* Spinner */
.skm-icon-spin {
  animation: skm-spin 800ms linear infinite;
}
@keyframes skm-spin {
  to { transform: rotate(360deg); }
}

/* Meta Stats Line */
.skm-meta-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.8));
  padding: 0 2px;
  flex: none;
}

/* Pill Badges */
.skm-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: .01em;
  white-space: nowrap;
  flex: none;
}
.skm-badge[data-tone="brand"] {
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  color: var(--dsw-alias-link, #4176e6);
}
.skm-badge[data-tone="neutral"] {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.14));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}
.skm-badge[data-tone="warn"] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e8590c) 14%, transparent);
  color: var(--dsw-alias-state-warn-label, #e8590c);
}
.skm-badge[data-tone="error"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}

/* Card List */
.skm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Skill Card */
.skm-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.04));
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
  overflow: hidden;
}
.skm-card:hover {
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.5));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.07));
}
.skm-card[data-open="true"] {
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,0.6));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  box-shadow: var(--dsw-shadow-lv2, 0 4px 18px rgba(0,0,0,0.04));
}

/* Card Trigger Row */
.skm-row-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: background 140ms ease;
}
.skm-row-btn:active {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
}
.skm-icon-box {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  color: var(--dsw-alias-link, #4176e6);
  transition: transform 140ms ease;
}
.skm-card[data-valid="false"] .skm-icon-box {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.skm-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.skm-row-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skm-row-title {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  color: var(--dsw-alias-label-primary, inherit);
  letter-spacing: -.01em;
}
.skm-row-desc {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 18px;
}
.skm-row-desc[data-tone="error"] {
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.skm-row-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.skm-row-mtime {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
}
.skm-row-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  transform: rotate(0deg);
  transition: transform 240ms cubic-bezier(.2, .8, .2, 1), color 140ms ease;
}
.skm-card[data-open="true"] .skm-row-chevron {
  transform: rotate(180deg);
  color: var(--dsw-alias-label-primary, inherit);
}

/* Fluid Expand/Collapse */
.skm-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 280ms cubic-bezier(.2, .8, .2, 1);
}
.skm-collapse[data-open="true"] {
  grid-template-rows: 1fr;
}
.skm-collapse-inner {
  min-height: 0;
  overflow: hidden;
}
.skm-details-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 16px 16px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
  transform: translateY(-4px);
  opacity: 0;
  transition: transform 240ms cubic-bezier(.2, .8, .2, 1), opacity 180ms ease;
}
.skm-collapse[data-open="true"] .skm-details-wrap {
  transform: translateY(0);
  opacity: 1;
}

/* Details Meta Facts Bar */
.skm-facts-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  flex-wrap: wrap;
}
.skm-facts-list {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.85));
  flex-wrap: wrap;
}
.skm-fact-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.skm-fact-item span {
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}
.skm-facts-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

/* WhenToUse Callout Box */
.skm-callout {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 6%, transparent);
  border: .5px solid color-mix(in srgb, var(--dsw-alias-link, #4176e6) 20%, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}
.skm-callout-icon {
  color: var(--dsw-alias-link, #4176e6);
  flex: none;
  margin-top: 2px;
}
.skm-callout-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skm-callout-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .03em;
  color: var(--dsw-alias-link, #4176e6);
}

/* Policy Switches Grid */
.skm-policy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}
.skm-policy-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06));
}
.skm-policy-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skm-policy-title {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-weight: 500;
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-policy-desc {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.75));
}

/* Apple Fluid Switch Component */
.skm-switch-btn {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  outline: none;
  flex: none;
}
.skm-switch-track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4));
  background: var(--dsw-alias-border-l3, rgba(128,128,128,0.25));
  transition: background 180ms ease, border-color 180ms ease;
  user-select: none;
}
.skm-switch-track[data-checked="true"] {
  background: var(--dsw-alias-button-primary-fill, #4c6ef5);
  border-color: var(--dsw-alias-button-primary-fill, #4c6ef5);
}
.skm-switch-knob {
  position: absolute;
  top: 1.5px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  box-shadow: var(--dsw-shadow-lv1, 0 1px 3px rgba(0, 0, 0, 0.25));
  transition: transform 220ms cubic-bezier(.25, 1.25, .35, 1), width 150ms ease;
}
.skm-switch-track[data-checked="true"] .skm-switch-knob {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
.skm-switch-btn:active .skm-switch-knob {
  width: 18px;
}
.skm-switch-btn:active .skm-switch-track[data-checked="true"] .skm-switch-knob {
  transform: translateX(13px);
}

/* Instructions Preview Box */
.skm-preview-box {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-markdown-code-block, rgba(128,128,128,0.06));
  overflow: hidden;
}
.skm-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.04));
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
}
.skm-preview-title {
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.skm-preview-pre {
  margin: 0;
  padding: 12px 14px;
  max-height: 340px;
  overflow: auto;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
  white-space: pre-wrap;
  word-break: break-word;
}
.skm-preview-empty {
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  font-size: 13px;
}

/* Delete Confirmation Panel */
.skm-confirm-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  border: .5px solid var(--dsw-alias-state-error-primary, #e03131);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 8%, transparent);
  animation: skm-fade-in 200ms cubic-bezier(.2, .8, .2, 1);
}
.skm-confirm-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.skm-confirm-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.skm-confirm-msg {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.9));
}
.skm-confirm-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

/* Editor View */
.skm-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  animation: skm-fade-in 220ms cubic-bezier(.2, .8, .2, 1);
  box-shadow: var(--dsw-shadow-lv2, 0 4px 20px rgba(0,0,0,0.04));
}
.skm-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
}
.skm-editor-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.skm-editor-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skm-field-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.skm-field-label {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  font-weight: 500;
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-field-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
}
.skm-input, .skm-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 7px;
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size-secondary, 13px);
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.skm-input:focus, .skm-textarea:focus {
  border-color: var(--dsw-alias-link, #4176e6);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-link, #4176e6) 20%, transparent);
}
.skm-textarea {
  min-height: 280px;
  resize: vertical;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  line-height: 1.6;
}
.skm-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2));
  flex-wrap: wrap;
  gap: 12px;
}
.skm-shortcut-hint {
  font-size: 12px;
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
}

/* Empty & Error Banners */
.skm-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.3));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.06));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: var(--dsh-content-font-size-secondary, 13px);
  animation: skm-fade-in 180ms ease;
}
.skm-banner[data-tone="error"] {
  border-color: var(--dsw-alias-state-error-primary, #e03131);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e03131) 8%, transparent);
  color: var(--dsw-alias-state-error-primary, #e03131);
}
.skm-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px dashed var(--dsw-alias-border-l1, rgba(128,128,128,0.35));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.03));
  animation: skm-fade-in 220ms ease;
}
.skm-empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.12));
  color: var(--dsw-alias-label-caption, rgba(128,128,128,0.7));
  margin-bottom: 14px;
}
.skm-empty-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, inherit);
}
.skm-empty-desc {
  margin: 0 0 20px;
  font-size: var(--dsh-content-font-size-secondary, 13px);
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  max-width: 440px;
  line-height: 1.5;
}

/* Busy / disabled states */
.skm-btn[disabled] {
  opacity: .55;
  cursor: not-allowed;
}
.skm-switch-btn[disabled] {
  opacity: .6;
  cursor: not-allowed;
}
.skm-policy-card[data-disabled="true"] {
  opacity: .7;
}
.skm-policy-text {
  cursor: pointer;
}
.skm-policy-card[data-disabled="true"] .skm-policy-text {
  cursor: not-allowed;
}
.skm-inline-hint {
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08));
  color: var(--dsw-alias-label-secondary, rgba(128,128,128,0.85));
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: 1.5;
}
.skm-banner[data-tone="warn"] {
  border-color: var(--dsw-alias-state-warn-primary, #f08c00);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f08c00) 8%, transparent);
  color: var(--dsw-alias-state-warn-primary, #f08c00);
}
.skm-banner[data-tone="success"] {
  border-color: var(--dsw-alias-state-success-primary, #2f9e44);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 8%, transparent);
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}

/* Narrow screens: let the toolbar and card rows wrap instead of overflowing */
@media (max-width: 640px) {
  .skm-page {
    padding-left: 0;
    padding-right: 0;
  }
  .skm-toolbar {
    flex-wrap: wrap;
  }
  .skm-search-wrap {
    flex: 1 1 100%;
  }
  .skm-toolbar-actions {
    flex-wrap: wrap;
  }
  .skm-facts-bar {
    flex-wrap: wrap;
  }
  .skm-facts-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .skm-row-right .skm-row-mtime {
    display: none;
  }
  .skm-editor-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
}

/* Keyframes & Reduced Motion */
@keyframes skm-fade-in {
  from { opacity: 0; transform: scale(0.985) translateY(4px); }
  to { opacity: 1; transform: none; }
}

.skm-btn:focus-visible,
.skm-row-btn:focus-visible,
.skm-switch-btn:focus-visible,
.skm-search-input:focus-visible,
.skm-input:focus-visible,
.skm-textarea:focus-visible,
.skm-path-chip:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`;

    function Switch({ on, onToggle, label, description, id, disabled }) {
      const toggle = () => { if (!disabled) onToggle(); };
      return jsxs("div", {
        className: "skm-policy-card",
        "data-disabled": disabled ? "true" : "false",
        children: [
          jsxs("div", {
            className: "skm-policy-text",
            onClick: toggle,
            children: [
              jsx("label", { id: id ? `${id}-label` : undefined, className: "skm-policy-title", children: label }),
              description ? jsx("span", { className: "skm-policy-desc", children: description }) : null,
            ],
          }),
          jsx("button", {
            type: "button",
            role: "switch",
            "aria-checked": on ? "true" : "false",
            "aria-labelledby": id ? `${id}-label` : undefined,
            "aria-disabled": disabled ? "true" : "false",
            disabled,
            className: "skm-switch-btn",
            onClick: toggle,
            onKeyDown: (e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle();
              }
            },
            children: jsx("span", {
              className: "skm-switch-track",
              "data-checked": on ? "true" : "false",
              children: jsx("span", { className: "skm-switch-knob" }),
            }),
          }),
        ],
      });
    }

    function SkillCard({ skill, open, onToggle, onEdit, onOpenDir, onPolicy, onDelete, pending, panelId }) {
      const [copied, setCopied] = useState(false);
      const copiedTimer = useRef(null);
      const problems = Array.isArray(skill.problems) ? skill.problems : [];
      const missingFile = Boolean(skill.missingFile);
      const canTogglePolicy = !missingFile && skill.valid;

      useEffect(() => () => {
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
      }, []);

      const handleCopyCode = async (e) => {
        e.stopPropagation();
        if (!skill.preview) return;
        await copyToClipboard(skill.preview);
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1800);
      };

      const badges = [];
      if (!skill.valid) {
        badges.push(jsx("span", { className: "skm-badge", "data-tone": "error", children: t("row.invalid") }, "invalid"));
      } else {
        if (!skill.modelInvocable && !skill.userInvocable) {
          badges.push(jsx("span", { className: "skm-badge", "data-tone": "warn", children: t("row.disabled") }, "disabled"));
        } else if (!skill.modelInvocable && skill.userInvocable) {
          badges.push(jsx("span", { className: "skm-badge", "data-tone": "neutral", children: t("row.userOnly") }, "userOnly"));
        } else if (skill.modelInvocable && !skill.userInvocable) {
          badges.push(jsx("span", { className: "skm-badge", "data-tone": "brand", children: t("row.modelOnly") }, "modelOnly"));
        }
      }
      badges.push(
        jsx("span", { className: "skm-badge", "data-tone": "neutral", children: skill.kind === "bundle" ? t("row.bundle") : t("row.flat") }, "kind")
      );

      return jsxs("div", {
        className: "skm-card",
        "data-open": open ? "true" : "false",
        "data-valid": skill.valid ? "true" : "false",
        children: [
          jsxs("button", {
            type: "button",
            className: "skm-row-btn",
            onClick: onToggle,
            "aria-expanded": open ? "true" : "false",
            "aria-controls": panelId,
            children: [
              jsx("div", { className: "skm-icon-box", children: jsx(IconSkill, { size: 16 }) }),
              jsxs("div", {
                className: "skm-row-info",
                children: [
                  jsxs("div", {
                    className: "skm-row-title-row",
                    children: [
                      jsx("span", { className: "skm-row-title", children: skill.name }),
                      badges,
                    ],
                  }),
                  jsx("span", {
                    className: "skm-row-desc",
                    "data-tone": skill.valid ? "default" : "error",
                    children: skill.valid ? skill.description : problems.join("；"),
                  }),
                ],
              }),
              jsxs("div", {
                className: "skm-row-right",
                children: [
                  skill.mtimeMs ? jsx("span", { className: "skm-row-mtime", children: formatTime(skill.mtimeMs) }) : null,
                  jsx("span", { className: "skm-row-chevron", children: jsx(IconChevron, { size: 14 }) }),
                ],
              }),
            ],
          }),
          jsx("div", {
            className: "skm-collapse",
            id: panelId,
            "data-open": open ? "true" : "false",
            "aria-hidden": open ? "false" : "true",
            // CSS-only collapse leaves descendants in the tab order and the
            // accessibility tree; inert removes them while the panel is closed.
            inert: open ? undefined : "",
            children: jsx("div", {
              className: "skm-collapse-inner",
              children: jsxs("div", {
                className: "skm-details-wrap",
                children: [
                  jsxs("div", {
                    className: "skm-facts-bar",
                    children: [
                      jsxs("div", {
                        className: "skm-facts-list",
                        children: [
                          jsxs("div", { className: "skm-fact-item", title: skill.file, children: [jsx(IconFolder, { size: 13 }), jsx("span", { children: skill.file })] }),
                          jsxs("div", { className: "skm-fact-item", children: [t("card.size"), ": ", jsx("span", { children: t("editor.chars", { n: skill.bodyChars }) })] }),
                          jsxs("div", { className: "skm-fact-item", children: [t("card.updated"), ": ", jsx("span", { children: formatTime(skill.mtimeMs) })] }),
                        ],
                      }),
                      jsxs("div", {
                        className: "skm-facts-actions",
                        children: [
                          jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-ghost skm-btn-sm",
                            onClick: onOpenDir,
                            disabled: pending,
                            title: t("card.openDir"),
                            children: [jsx(IconFolder, { size: 12 }), t("card.openDir")],
                          }),
                          !missingFile ? jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-secondary skm-btn-sm",
                            onClick: onEdit,
                            disabled: pending,
                            children: [jsx(IconEdit, { size: 12 }), t("card.edit")],
                          }) : null,
                          jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-ghost skm-btn-sm",
                            style: { color: "var(--dsw-alias-state-error-primary, #e03131)" },
                            onClick: onDelete.onAsk,
                            disabled: pending,
                            children: [jsx(IconTrash, { size: 12 }), t("card.delete")],
                          }),
                        ],
                      }),
                    ],
                  }),
                  onDelete.confirm ? jsxs("div", {
                    className: "skm-confirm-panel",
                    children: [
                      jsxs("div", {
                        className: "skm-confirm-text",
                        children: [
                          jsx("span", { className: "skm-confirm-title", children: t("card.deleteConfirmTitle") }),
                          jsx("span", { className: "skm-confirm-msg", children: t("card.deleteConfirmMsg", { name: skill.name }) }),
                        ],
                      }),
                      jsxs("div", {
                        className: "skm-confirm-actions",
                        children: [
                          jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-danger skm-btn-sm",
                            onClick: onDelete.onConfirm,
                            disabled: pending,
                            children: [jsx(IconTrash, { size: 12 }), pending ? t("delete.busy") : t("card.confirmDelete")],
                          }),
                          jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-secondary skm-btn-sm",
                            onClick: onDelete.onCancel,
                            disabled: pending,
                            children: t("card.cancelDelete"),
                          }),
                        ],
                      }),
                    ],
                  }) : null,
                  !skill.valid && problems.length > 0 ? jsxs("div", {
                    className: "skm-banner",
                    "data-tone": "error",
                    role: "alert",
                    children: [
                      jsx(IconWarning, { size: 16 }),
                      jsx("span", { children: `${t("card.problemsTitle")} ${problems.join("；")}` }),
                    ],
                  }) : null,
                  skill.whenToUse ? jsxs("div", {
                    className: "skm-callout",
                    children: [
                      jsx("span", { className: "skm-callout-icon", children: jsx(IconSparkle, { size: 15 }) }),
                      jsxs("div", {
                        className: "skm-callout-body",
                        children: [
                          jsx("span", { className: "skm-callout-label", children: t("card.whenToUse") }),
                          jsx("span", { children: skill.whenToUse }),
                        ],
                      }),
                    ],
                  }) : null,
                  canTogglePolicy ? jsxs("div", {
                    className: "skm-policy-grid",
                    children: [
                      jsx(Switch, {
                        id: `policy-model-${skill.file}`,
                        on: skill.modelInvocable,
                        label: t("card.modelSwitch"),
                        description: t("card.modelSwitchDesc"),
                        disabled: pending,
                        onToggle: () => onPolicy(skill, { modelInvocable: !skill.modelInvocable }),
                      }),
                      jsx(Switch, {
                        id: `policy-user-${skill.file}`,
                        on: skill.userInvocable,
                        label: t("card.userSwitch"),
                        description: t("card.userSwitchDesc"),
                        disabled: pending,
                        onToggle: () => onPolicy(skill, { userInvocable: !skill.userInvocable }),
                      }),
                    ],
                  }) : (!missingFile ? jsx("div", {
                    className: "skm-inline-hint",
                    children: t("card.policyInvalid"),
                  }) : null),
                  jsxs("div", {
                    className: "skm-preview-box",
                    children: [
                      jsxs("div", {
                        className: "skm-preview-head",
                        children: [
                          jsxs("span", { className: "skm-preview-title", children: [jsx(IconSkill, { size: 13 }), t("card.instructions")] }),
                          !missingFile && skill.preview ? jsx("button", {
                            type: "button",
                            className: "skm-btn skm-btn-ghost skm-btn-sm",
                            onClick: handleCopyCode,
                            children: [
                              copied ? jsx(IconCheck, { size: 12 }) : jsx(IconCopy, { size: 12 }),
                              copied ? t("card.copiedCode") : t("card.copyCode"),
                            ],
                          }) : null,
                        ],
                      }),
                      missingFile ? jsx("div", { className: "skm-preview-empty", children: t("card.noFile") })
                        : jsx("pre", { className: "skm-preview-pre", children: skill.preview ?? "…" }),
                    ],
                  }),
                ],
              }),
            }),
          }),
        ],
      });
    }

    function Editor({ initial, onCancel, onSaved, onDirtyChange }) {
      const [name, setName] = useState(initial.name ?? "");
      const [description, setDescription] = useState(initial.description ?? "");
      const [whenToUse, setWhenToUse] = useState(initial.whenToUse ?? "");
      const [body, setBody] = useState(initial.body ?? "");
      const [modelInvocable, setModelInvocable] = useState(initial.modelInvocable !== false);
      const [userInvocable, setUserInvocable] = useState(initial.userInvocable !== false);
      const [busy, setBusy] = useState(false);
      const busyRef = useRef(false);
      const [error, setError] = useState(null);
      const [confirmDiscard, setConfirmDiscard] = useState(false);
      const isCreate = !initial.originalName;
      const bodyChars = useMemo(() => Array.from(body).length, [body]);

      const dirty = useMemo(() => (
        name !== (initial.name ?? "")
        || description !== (initial.description ?? "")
        || whenToUse !== (initial.whenToUse ?? "")
        || body !== (initial.body ?? "")
        || modelInvocable !== (initial.modelInvocable !== false)
        || userInvocable !== (initial.userInvocable !== false)
      ), [name, description, whenToUse, body, modelInvocable, userInvocable, initial]);

      useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

      const requestCancel = () => {
        if (busy) return;
        if (dirty) setConfirmDiscard(true);
        else onCancel();
      };

      const submit = async (e) => {
        if (e) e.preventDefault();
        // A second Ctrl+S/submit can fire before the disabled prop re-renders.
        if (busyRef.current) return;
        const trimmedName = name.trim();
        const trimmedDesc = description.trim();
        if (!NAME_RE.test(trimmedName)) {
          setError(t("editor.nameInvalid"));
          return;
        }
        if (trimmedDesc === "") {
          setError(t("editor.descRequired"));
          return;
        }
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
          const payload = await api("/save", {
            method: "POST",
            body: JSON.stringify({
              root: initial.root,
              name: trimmedName,
              description,
              whenToUse,
              body,
              modelInvocable,
              userInvocable,
              originalName: initial.originalName,
              originalFile: initial.originalFile,
              expectedMtimeMs: isCreate ? undefined : initial.mtimeMs,
            }),
          });
          onSaved({ root: payload.root ?? initial.root, name: trimmedName, file: payload.file });
        } catch (err) {
          setError(`${t("error.save")}：${err.message}`);
          busyRef.current = false;
          setBusy(false);
        }
      };

      const handleKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (confirmDiscard) setConfirmDiscard(false);
          else requestCancel();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          submit();
        }
      };

      return jsxs("form", {
        className: "skm-editor",
        onKeyDown: handleKeyDown,
        onSubmit: submit,
        children: [
          jsxs("div", {
            className: "skm-editor-head",
            children: [
              jsxs("div", {
                className: "skm-editor-head-left",
                children: [
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-ghost skm-btn-sm",
                    onClick: requestCancel,
                    title: t("editor.cancel"),
                    children: [jsx(IconChevronLeft, { size: 14 }), t("editor.cancel")],
                  }),
                  jsx("h2", {
                    className: "skm-editor-title",
                    children: isCreate ? t("editor.newTitle") : t("editor.editTitle", { name: initial.originalName }),
                  }),
                ],
              }),
              jsxs("div", {
                className: "skm-toolbar-actions",
                children: [
                  jsx("button", {
                    type: "submit",
                    className: "skm-btn skm-btn-primary",
                    disabled: busy,
                    children: [
                      busy ? jsx(IconRefresh, { size: 13, className: "skm-icon-spin" }) : jsx(IconCheck, { size: 13 }),
                      busy ? t("editor.saving") : t("editor.save"),
                    ],
                  }),
                ],
              }),
            ],
          }),
          jsxs("div", {
            className: "skm-field-group",
            children: [
              jsxs("div", {
                className: "skm-field-head",
                children: [
                  jsx("label", { className: "skm-field-label", htmlFor: "skm-field-name", children: t("editor.name") }),
                  jsx("span", { className: "skm-field-hint", children: t("editor.nameHint") }),
                ],
              }),
              jsx("input", {
                id: "skm-field-name",
                className: "skm-input",
                value: name,
                onChange: (e) => { setName(e.target.value); setError(null); },
                spellCheck: false,
                autoFocus: isCreate,
                placeholder: t("editor.namePlaceholder"),
              }),
            ],
          }),
          jsxs("div", {
            className: "skm-field-group",
            children: [
              jsxs("div", {
                className: "skm-field-head",
                children: [
                  jsx("label", { className: "skm-field-label", htmlFor: "skm-field-description", children: t("editor.description") }),
                  jsx("span", { className: "skm-field-hint", children: t("editor.descriptionHint") }),
                ],
              }),
              jsx("input", {
                id: "skm-field-description",
                className: "skm-input",
                value: description,
                onChange: (e) => { setDescription(e.target.value); setError(null); },
                autoFocus: !isCreate,
                placeholder: t("editor.descriptionPlaceholder"),
              }),
            ],
          }),
          jsxs("div", {
            className: "skm-field-group",
            children: [
              jsxs("div", {
                className: "skm-field-head",
                children: [
                  jsx("label", { className: "skm-field-label", htmlFor: "skm-field-when", children: t("editor.whenToUse") }),
                  jsx("span", { className: "skm-field-hint", children: t("editor.whenToUseHint") }),
                ],
              }),
              jsx("input", {
                id: "skm-field-when",
                className: "skm-input",
                value: whenToUse,
                onChange: (e) => setWhenToUse(e.target.value),
                placeholder: t("editor.whenToUsePlaceholder"),
              }),
            ],
          }),
          jsxs("div", {
            className: "skm-policy-grid",
            children: [
              jsx(Switch, {
                id: "editor-policy-model",
                on: modelInvocable,
                label: t("editor.modelSwitch"),
                description: t("card.modelSwitchDesc"),
                disabled: busy,
                onToggle: () => setModelInvocable((v) => !v),
              }),
              jsx(Switch, {
                id: "editor-policy-user",
                on: userInvocable,
                label: t("editor.userSwitch"),
                description: t("card.userSwitchDesc"),
                disabled: busy,
                onToggle: () => setUserInvocable((v) => !v),
              }),
            ],
          }),
          jsxs("div", {
            className: "skm-field-group",
            children: [
              jsxs("div", {
                className: "skm-field-head",
                children: [
                  jsx("label", { className: "skm-field-label", htmlFor: "skm-field-body", children: t("editor.body") }),
                  jsx("span", { className: "skm-field-hint", children: t("editor.chars", { n: bodyChars }) }),
                ],
              }),
              jsx("textarea", {
                id: "skm-field-body",
                className: "skm-textarea",
                value: body,
                onChange: (e) => setBody(e.target.value),
                spellCheck: false,
                placeholder: t("editor.bodyPlaceholder"),
              }),
            ],
          }),
          (initial.problems?.length ?? 0) > 0 ? jsxs("div", {
            className: "skm-banner",
            "data-tone": "warn",
            role: "status",
            children: [
              jsx(IconWarning, { size: 16 }),
              jsx("span", { children: `${t("editor.problemsBanner")} ${initial.problems.join("；")}` }),
            ],
          }) : null,
          error ? jsxs("div", {
            className: "skm-banner",
            "data-tone": "error",
            role: "alert",
            children: [jsx(IconWarning, { size: 16 }), jsx("span", { children: error })],
          }) : null,
          confirmDiscard ? jsxs("div", {
            className: "skm-confirm-panel",
            children: [
              jsxs("div", {
                className: "skm-confirm-text",
                children: [
                  jsx("span", { className: "skm-confirm-title", children: t("editor.discardTitle") }),
                  jsx("span", { className: "skm-confirm-msg", children: t("editor.discardMsg") }),
                ],
              }),
              jsxs("div", {
                className: "skm-confirm-actions",
                children: [
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-danger skm-btn-sm",
                    onClick: onCancel,
                    children: t("editor.discardConfirm"),
                  }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-secondary skm-btn-sm",
                    onClick: () => setConfirmDiscard(false),
                    children: t("editor.discardCancel"),
                  }),
                ],
              }),
            ],
          }) : jsxs("div", {
            className: "skm-editor-footer",
            children: [
              jsx("span", { className: "skm-shortcut-hint", children: dirty ? `${t("editor.unsaved")} · ${t("editor.shortcutHint")}` : t("editor.shortcutHint") }),
              jsxs("div", {
                className: "skm-toolbar-actions",
                children: [
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-secondary",
                    onClick: requestCancel,
                    disabled: busy,
                    children: t("editor.cancel"),
                  }),
                  jsx("button", {
                    type: "submit",
                    className: "skm-btn skm-btn-primary",
                    disabled: busy,
                    children: [
                      busy ? jsx(IconRefresh, { size: 13, className: "skm-icon-spin" }) : jsx(IconCheck, { size: 13 }),
                      busy ? t("editor.saving") : t("editor.save"),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    }

    function SkillsSection() {
      const [state, setState] = useState({ loading: true });
      const [activeRootKey, setActiveRootKey] = useState(null);
      const [query, setQuery] = useState("");
      const [openFile, setOpenFile] = useState(null);
      const [confirmFile, setConfirmFile] = useState(null);
      const [editor, setEditor] = useState(null);
      const [editorDirty, setEditorDirty] = useState(false);
      const [copiedPath, setCopiedPath] = useState(false);
      const [pendingFile, setPendingFile] = useState(null);
      const [notice, setNotice] = useState(null);
      const reqSeq = useRef(0);
      const editorSeq = useRef(0);
      const noticeTimer = useRef(null);
      const pathTimer = useRef(null);

      useEffect(() => () => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        if (pathTimer.current) clearTimeout(pathTimer.current);
      }, []);

      // A reload or tab close discards the editor without a word otherwise.
      useEffect(() => {
        if (!editorDirty) return undefined;
        const warn = (event) => {
          event.preventDefault();
          event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
      }, [editorDirty]);

      const showNotice = (text) => {
        setNotice(text);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 2800);
      };

      const load = async () => {
        const seq = ++reqSeq.current;
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
          const payload = await api("/list");
          if (seq !== reqSeq.current) return;
          const roots = payload.roots ?? [];
          setActiveRootKey((prev) => (prev && roots.some((root) => root.key === prev) ? prev : (roots[0]?.key ?? "dsh")));
          setState((prev) => {
            // Keep expanded previews across refreshes; a policy toggle must not
            // erase the instructions a user is reading. Drop stale previews.
            const previous = new Map((prev.skills ?? []).map((skill) => [`${skill.rootKey}:${skill.file}`, skill]));
            const skills = payload.skills.map((skill) => {
              const old = previous.get(`${skill.rootKey}:${skill.file}`);
              return old && old.preview !== undefined && old.mtimeMs === skill.mtimeMs
                ? { ...skill, preview: old.preview }
                : skill;
            });
            return {
              loading: false,
              root: payload.root,
              roots,
              skills,
              provider: payload.provider,
            };
          });
        } catch (e) {
          if (seq !== reqSeq.current) return;
          setState((prev) => ({ ...prev, loading: false, error: `${t("error.load")}：${e.message}` }));
        }
      };

      useEffect(() => { load(); }, []);

      const skills = state.skills ?? [];
      const roots = state.roots ?? [];
      const activeRoot = roots.find((root) => root.key === activeRootKey) ?? roots[0] ?? null;
      const rootKey = activeRoot?.key ?? "dsh";
      const rootPath = activeRoot?.path ?? state.root ?? "";
      const rootExists = activeRoot ? activeRoot.exists !== false : state.rootExists !== false;
      const rootSkills = skills.filter((skill) => (skill.rootKey ?? "dsh") === rootKey);
      const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return rootSkills;
        return rootSkills.filter((s) => (
          s.name.toLowerCase().includes(q)
          || (s.description && s.description.toLowerCase().includes(q))
          || (s.whenToUse && s.whenToUse.toLowerCase().includes(q))
        ));
      }, [rootSkills, query]);

      const switchRoot = (key) => {
        setActiveRootKey(key);
        setOpenFile(null);
        setConfirmFile(null);
        setQuery("");
      };

      const handleCopyRootPath = async () => {
        if (!rootPath) return;
        await copyToClipboard(rootPath);
        setCopiedPath(true);
        if (pathTimer.current) clearTimeout(pathTimer.current);
        pathTimer.current = setTimeout(() => setCopiedPath(false), 2000);
      };

      const openDir = async (skill) => {
        try {
          await api("/open", {
            method: "POST",
            body: JSON.stringify(skill
              ? { root: skill.rootKey ?? rootKey, name: skill.name, file: skill.file }
              : { root: rootKey }),
          });
        } catch (e) {
          setState((prev) => ({ ...prev, error: `${t("error.openDir")}：${e.message}` }));
        }
      };

      const expand = async (skill) => {
        const key = entryKey(skill);
        if (openFile === key) {
          setOpenFile(null);
          setConfirmFile(null);
          return;
        }
        setOpenFile(key);
        setConfirmFile(null);
        if (skill.missingFile) return;
        try {
          const payload = await api(`/get?root=${encodeURIComponent(skill.rootKey ?? rootKey)}&file=${encodeURIComponent(skill.file)}`);
          setState((prev) => ({
            ...prev,
            skills: (prev.skills ?? []).map((s) => (entryKey(s) === key ? { ...s, preview: payload.skill.body } : s)),
          }));
        } catch {
          /* preview stays blank on failure; summary remains visible */
        }
      };

      const startEdit = async (skill) => {
        if (editorDirty && !window.confirm(t("editor.discardMsg"))) return;
        const seq = ++editorSeq.current;
        setPendingFile(entryKey(skill));
        try {
          const payload = await api(`/get?root=${encodeURIComponent(skill.rootKey ?? rootKey)}&file=${encodeURIComponent(skill.file)}`);
          if (seq !== editorSeq.current) return;
          setEditor({
            originalName: skill.name,
            originalFile: skill.file,
            root: skill.rootKey ?? rootKey,
            token: seq,
            name: payload.skill.name,
            description: payload.skill.description,
            whenToUse: payload.skill.whenToUse,
            body: payload.skill.body,
            modelInvocable: payload.skill.modelInvocable,
            userInvocable: payload.skill.userInvocable,
            problems: payload.skill.problems,
            mtimeMs: payload.skill.mtimeMs,
          });
          setEditorDirty(false);
        } catch (e) {
          if (seq !== editorSeq.current) return;
          setState((prev) => ({ ...prev, error: `${t("error.load")}：${e.message}` }));
        } finally {
          if (seq === editorSeq.current) setPendingFile(null);
        }
      };

      const startCreate = () => {
        if (editorDirty && !window.confirm(t("editor.discardMsg"))) return;
        // A fresh token remounts the editor even if an empty "new" draft is
        // already open, so stale text can never leak into the next skill.
        // It also cancels an in-flight startEdit, whose finally no longer runs.
        setEditor({ originalName: null, root: rootKey, token: ++editorSeq.current });
        setPendingFile(null);
        setEditorDirty(false);
      };

      const applyPolicy = async (skill, patch) => {
        if (!skill.valid || pendingFile) return;
        const key = entryKey(skill);
        setPendingFile(key);
        // Optimistic UI update to eliminate toggle lag
        setState((prev) => ({
          ...prev,
          skills: (prev.skills ?? []).map((s) => (entryKey(s) === key ? { ...s, ...patch } : s)),
        }));
        try {
          await api("/policy", {
            method: "POST",
            body: JSON.stringify({
              root: skill.rootKey ?? rootKey,
              name: skill.name,
              file: skill.file,
              expectedMtimeMs: skill.mtimeMs,
              ...patch,
            }),
          });
          await load();
        } catch (e) {
          await load();
          setState((prev) => ({ ...prev, error: `${t("error.policy")}：${e.message}` }));
        } finally {
          setPendingFile(null);
        }
      };

      const doDelete = async (skill) => {
        if (pendingFile) return;
        const key = entryKey(skill);
        setPendingFile(key);
        try {
          await api("/delete", {
            method: "POST",
            body: JSON.stringify({ root: skill.rootKey ?? rootKey, name: skill.name, file: skill.file }),
          });
          setConfirmFile(null);
          if (openFile === key) setOpenFile(null);
          await load();
          showNotice(t("notice.deleted"));
        } catch (e) {
          setState((prev) => ({ ...prev, error: `${t("error.delete")}：${e.message}` }));
        } finally {
          setPendingFile(null);
        }
      };

      const afterSave = async (saved) => {
        setEditor(null);
        setEditorDirty(false);
        const root = saved?.root ?? rootKey;
        const file = saved?.file ?? null;
        const key = file ? `${root}:${file}` : null;
        setActiveRootKey(root);
        setOpenFile(key);
        showNotice(t("notice.saved"));
        await load();
        if (!key) return;
        try {
          const payload = await api(`/get?root=${encodeURIComponent(root)}&file=${encodeURIComponent(file)}`);
          setState((prev) => ({
            ...prev,
            skills: (prev.skills ?? []).map((s) => (entryKey(s) === key ? { ...s, preview: payload.skill.body } : s)),
          }));
        } catch {
          /* preview can stay empty */
        }
      };

      const handleEditorCancel = () => {
        editorSeq.current += 1;
        setPendingFile(null);
        setEditor(null);
        setEditorDirty(false);
      };

      const providerWarning = state.provider && state.provider.state !== "ready" ? state.provider : null;

      return jsxs("div", {
        className: "skm-page",
        children: [
          jsx("style", { "data-plugin": "@local/skills-manager", children: CSS }),
          jsxs("div", {
            className: "skm-header",
            children: [
              jsxs("div", {
                className: "skm-header-info",
                children: [
                  jsx("h1", { className: "skm-header-title", children: t("header.title") }),
                  jsx("p", { className: "skm-header-desc", children: t("header.subtitle") }),
                ],
              }),
              rootPath ? jsxs("button", {
                type: "button",
                className: "skm-path-chip",
                title: t("toolbar.rootTitle", { root: rootPath }),
                onClick: handleCopyRootPath,
                children: [
                  copiedPath ? jsx(IconCheck, { size: 12 }) : jsx(IconFolder, { size: 13 }),
                  jsx("span", { children: copiedPath ? t("toolbar.copiedPath") : rootPath }),
                ],
              }) : null,
            ],
          }),
          !editor && roots.length > 1 ? jsx("div", {
            className: "skm-root-tabs",
            role: "group",
            "aria-label": t("roots.label"),
            children: roots.map((root) => jsx("button", {
              type: "button",
              "aria-pressed": root.key === rootKey ? "true" : "false",
              className: "skm-root-tab",
              title: root.path,
              onClick: () => switchRoot(root.key),
              children: [
                root.label ?? root.path,
                root.exists === false ? jsx("span", { className: "skm-root-missing", children: t("roots.missing") }) : null,
              ],
            }, root.key)),
          }) : null,
          jsxs("div", {
            className: "skm-toolbar",
            children: [
              jsxs("div", {
                className: "skm-search-wrap",
                children: [
                  jsx("span", { className: "skm-search-icon", children: jsx(IconSearch, { size: 14 }) }),
                  jsx("input", {
                    className: "skm-search-input",
                    value: query,
                    onChange: (e) => setQuery(e.target.value),
                    placeholder: t("toolbar.search"),
                    "aria-label": t("search.label"),
                  }),
                  query ? jsx("button", {
                    type: "button",
                    className: "skm-search-clear",
                    onClick: () => setQuery(""),
                    title: t("empty.clearFilter"),
                    children: jsx(IconClose, { size: 12 }),
                  }) : null,
                ],
              }),
              jsxs("div", {
                className: "skm-toolbar-actions",
                children: [
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-secondary",
                    onClick: () => openDir(null),
                    title: t("toolbar.openDirTitle"),
                    children: [jsx(IconFolder, { size: 13 }), t("toolbar.openDir")],
                  }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-secondary",
                    onClick: load,
                    disabled: state.loading,
                    "aria-busy": state.loading ? "true" : "false",
                    title: t("toolbar.refresh"),
                    children: [
                      jsx(IconRefresh, { size: 13, className: state.loading ? "skm-icon-spin" : undefined }),
                      t("toolbar.refresh"),
                    ],
                  }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-primary",
                    onClick: startCreate,
                    children: [jsx(IconPlus, { size: 14 }), t("toolbar.new")],
                  }),
                ],
              }),
            ],
          }),
          !editor && rootSkills.length > 0 ? jsx("div", {
            className: "skm-meta-line",
            children: jsx("span", {
              children: query
                ? t("toolbar.filterCount", { filtered: filtered.length, total: rootSkills.length })
                : t("toolbar.count", { n: rootSkills.length }),
            }),
          }) : null,
          providerWarning ? jsxs("div", {
            className: "skm-banner",
            "data-tone": "warn",
            role: "status",
            children: [
              jsx(IconWarning, { size: 16 }),
              jsxs("span", {
                children: [
                  jsx("strong", { children: t("provider.title") }),
                  " ",
                  t("provider.desc", { state: providerWarning.state, attempts: providerWarning.attempts }),
                ],
              }),
            ],
          }) : null,
          state.error ? jsxs("div", {
            className: "skm-banner",
            "data-tone": "error",
            role: "alert",
            "aria-live": "assertive",
            children: [
              jsx(IconWarning, { size: 16 }),
              jsx("span", { children: state.error }),
              jsx("button", {
                type: "button",
                className: "skm-btn skm-btn-secondary skm-btn-sm",
                onClick: load,
                children: t("error.retry"),
              }),
            ],
          }) : null,
          notice ? jsxs("div", {
            className: "skm-banner",
            "data-tone": "success",
            role: "status",
            "aria-live": "polite",
            children: [jsx(IconCheck, { size: 16 }), jsx("span", { children: notice })],
          }) : null,
          editor ? jsx(Editor, {
            key: `${editor.root ?? "dsh"}:${editor.originalFile ?? "new"}:${editor.token ?? 0}`,
            initial: editor,
            onCancel: handleEditorCancel,
            onSaved: afterSave,
            onDirtyChange: setEditorDirty,
          }) : jsxs("div", {
            className: "skm-list",
            children: [
              state.loading && rootSkills.length === 0 ? jsxs("div", {
                className: "skm-banner",
                children: [
                  jsx(IconRefresh, { size: 14, className: "skm-icon-spin" }),
                  jsx("span", { children: t("loading") }),
                ],
              }) : null,
              !state.loading && !state.error && rootExists === false ? jsxs("div", {
                className: "skm-empty-card",
                children: [
                  jsx("div", { className: "skm-empty-icon", children: jsx(IconFolder, { size: 24 }) }),
                  jsx("h3", { className: "skm-empty-title", children: t("empty.rootMissingTitle") }),
                  jsx("p", { className: "skm-empty-desc", children: t("empty.rootMissing") }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-primary",
                    onClick: startCreate,
                    children: [jsx(IconPlus, { size: 14 }), t("toolbar.new")],
                  }),
                ],
              }) : null,
              !state.loading && !state.error && rootExists !== false && rootSkills.length === 0 ? jsxs("div", {
                className: "skm-empty-card",
                children: [
                  jsx("div", { className: "skm-empty-icon", children: jsx(IconSparkle, { size: 24 }) }),
                  jsx("h3", { className: "skm-empty-title", children: t("empty.noneTitle") }),
                  jsx("p", { className: "skm-empty-desc", children: t("empty.none") }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-primary",
                    onClick: startCreate,
                    children: [jsx(IconPlus, { size: 14 }), t("toolbar.new")],
                  }),
                ],
              }) : null,
              !state.loading && rootSkills.length > 0 && filtered.length === 0 ? jsxs("div", {
                className: "skm-empty-card",
                children: [
                  jsx("div", { className: "skm-empty-icon", children: jsx(IconSearch, { size: 24 }) }),
                  jsx("h3", { className: "skm-empty-title", children: t("empty.filteredTitle") }),
                  jsx("p", { className: "skm-empty-desc", children: t("empty.filtered") }),
                  jsx("button", {
                    type: "button",
                    className: "skm-btn skm-btn-secondary",
                    onClick: () => setQuery(""),
                    children: t("empty.clearFilter"),
                  }),
                ],
              }) : null,
              filtered.map((skill) => jsx(SkillCard, {
                skill,
                open: openFile === entryKey(skill),
                pending: pendingFile === entryKey(skill),
                panelId: `skm-panel-${entryKey(skill).replace(/[^a-zA-Z0-9_-]/g, "-")}`,
                onToggle: () => expand(skill),
                onEdit: () => startEdit(skill),
                onOpenDir: () => openDir(skill),
                onPolicy: applyPolicy,
                onDelete: {
                  confirm: confirmFile === entryKey(skill),
                  onAsk: () => setConfirmFile(entryKey(skill)),
                  onConfirm: () => doDelete(skill),
                  onCancel: () => setConfirmFile(null),
                },
              }, entryKey(skill))),
            ],
          }),
        ],
      });
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        if (ctx.locale && typeof ctx.locale.register === "function" && typeof ctx.locale.bind === "function") {
          ctx.effect(() => ctx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), "skills-manager: locale dictionaries");
          t = ctx.locale.bind(NS);
        }
        ctx.slots.inject("settings.section", () => ctx.slots.register(
          { name: "settings.section", id: "skills", order: 16, locale: NS, label: () => t("nav") },
          SkillsSection,
        ));
      },
    };
  },
});
