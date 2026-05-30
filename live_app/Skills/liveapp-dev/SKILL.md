---
name: liveapp-dev
description: Develops, maintains, and generates Sparo OS Live Apps. Use for Live App framework code, LiveAppStudio, InitLiveApp, window.app APIs, app.fs/app.shell/app.storage/app.net/app.ai/app.agentic, runtime debugging, or work under live_app/Demo/ and live_app/Skills/.
---

# Sparo OS Live App V2 开发指南

> **本 Skill 服务两类工作**：
>
> - **维护框架本身** → 阅读下方"代码架构 / Bridge / 权限模型 / window.app API"等章节。
> - **生成一个新的 Live App** → 先遵循 Studio prompt 的默认策略；本文件只提供 API、权限、视觉硬约束。需要深入视觉 polish 时再读 `[design-playbook.md](design-playbook.md)`。详细 API 见 `[api-reference.md](api-reference.md)`。

---

## 调用方与加载顺序

本 Skill 同时服务两类入口：

1. 任意 Agent 用 `Skill('liveapp-dev')` 加载（手动调用，框架维护或生成新 Live App）。
2. **LiveAppStudio Mode 自动调用**：每个 Studio 会话首轮强制加载本 `SKILL.md`。Studio 的工作循环（Intake / Anchor / Scaffold / Skeleton / Loop / Polish / Review）已写入它的 prompt，本文档不重复。本文档只提供 Anchor 阶段的视觉锚定上下文与 Polish 阶段的 QA Checklist。


| 场景                  | 必读                                | 按需 Read                                    |
| ------------------- | --------------------------------- | ------------------------------------------ |
| Studio 生成新 Live App | `SKILL.md` | `design-playbook.md`（深度视觉 polish 时）、`api-reference.md`（写 `worker.js` / 自定义权限时） |
| 维护框架本身              | `SKILL.md` + `architecture.md`    | `api-reference.md`                         |
| 改 builtin 应用        | `SKILL.md`（reseed 规则）             | `design-playbook.md`（视觉变更时）                |


**Studio prompt 已硬规定：同一会话内不重复加载本 Skill 任何文件。**

## 视觉锚白名单（Anchor 阶段）

按"工具型 → 展示型 → 设计系统型"递进选择最贴近的形态后 Read 其 `style.css` 顶部 Design System 注释。以下路径只保证在开发仓库中存在；二进制发布版应优先依赖内置 `liveapp-dev` Skill 的 compact baseline 和已安装 Live App，不要假设 Demo 目录存在。

- **内置（克制工具型）**：`bundles/live-apps/`
  - `gomoku/` — 交互 + 主题切换 + 持久化
  - `divination/` — 仪式感配色与卡片
- **Demo（更激进 / 复杂模块化）**：`live_app/Demo/`
  - `git-graph/` — 复杂 UI 拆模块（components / panels / services）
  - `icon-design-system/` — 设计系统型应用范例
  - `background-remover/` — 单页工具 + 文件交互范例

仅当用户明确要求"对外展示 / 灵感型 / 作品集"风格时才优先取 Demo；默认优先取内置 assets 的克制感。

---

## 生成新 Live App 必读（速查）

> 完整指南见 `[design-playbook.md](design-playbook.md)`。这里是**不可妥协**的硬约束，AI 在用 `InitLiveApp` 工具创建骨架后**必须**遵守。

### 流程

1. **少问，默认决策**：最多问 3 个用户能回答的问题：目的/受众、数据来源、隐私或外部访问、视觉参考。不要问 node mode、权限实现、i18n、Tweaks、框架或文件结构；由 Studio 用最小权限、no node、zh-CN + en-US、必要时 Tweaks 的默认策略决定。
2. **找设计上下文**：开发仓库中可先读 `live_app/Demo/` 与 `bundles/live-apps/` 中**最贴近形态**的应用，复刻它的视觉语言（间距 / 圆角 / 卡片密度 / motif）。如果这些路径不存在（例如二进制发布版），不要搜索用户工作区凑参考，直接使用 packaged `liveapp-dev` 的设计 baseline。
3. **声明设计系统**：`style.css` 顶部用注释钉住 palette / typography / radius / motif（参见 playbook §1.3 模板），后续全应用复用。
4. **占位先行 → 早预览**：第一版用占位文本 / 占位图框 / fixture 数据，先在 Toolbox 里跑给用户看，再迭代。
5. **验证**：light/dark × zh/en 共 4 套截图都过；过 playbook §8 的 QA Checklist，尤其检查 CSS 是否引用了无效或臆造的主题变量。

### 反 AI 味（默认禁用，除非用户明确要求）

- ❌ 蓝紫渐变 / "Aurora" 风背景
- ❌ Emoji 当主图标（用描边 SVG 或字母圆形容器）
- ❌ 左侧色条 + 圆角卡片组合
- ❌ 标题下加 1-2px 装饰横线
- ❌ 硬画复杂插画 SVG（用占位框，标注 "Image TBD"）
- ❌ Inter / Roboto 兜底就完事（用 `var(--sparo-font-sans)` 优先）
- ❌ 12px 以下文字 / hit target < 32px
- ❌ 圆角混用 4/8/12/16（钉 1-2 档全应用统一）
- ❌ 用装饰性 stats / icon / sparkline 填空白（空白是排版问题，不是内容问题）

### 颜色与字体

- **首选** `var(--sparo-*)` 系列 + fallback，与宿主主题协同（见下文"主题集成"章节的完整变量清单）。只把该清单里的变量当作宿主主题变量；`--sparo-surface`、`--sparo-card`、`--theme-bg`、`--color-primary` 等未定义名字必须改成已定义变量，或在 `:root` 中作为应用自己的 alias 明确定义。
- **优先使用运行态 UI Kit**：常规 Button / Card / Input / Badge / Alert / Empty / Stack / Toolbar 优先使用 `app.ui`，它随 Live App 编译产物注入，不需要 import，也不依赖主应用开发态别名。
- 一个颜色占视觉权重 60-70%（dominant），1-2 个 supporting，1 个 accent —  — **禁止给所有色块同等权重**。
- 字号：标题 18-22px / Section 14-15px / 正文 13-14px / Caption 11-12px。

### Tweaks 变体（推荐做法）

对外观/密度/字号/布局的多种合理选择，做成运行时可切换、写入 `app.storage('tweaks')`、右下角浮动小面板"Tweaks" —  — 一份代码服务多种偏好是 Live App 的天然优势。详细约定见 playbook §4。

### 占位优于劣质实现

没图标 / 没数据 / 没素材时，用明确的占位（标注尺寸或 "TBD"），并在 `meta.json.description` 末尾登记待补清单；复杂交付才新增 README —  — **不要硬画一个糟糕的真实物**。

### 工具型 vs 展示型

绝大多数 Sparo OS Live App 是**工具型** —  — 信息密集、操作短、配色冷静，仿照 `gomoku` / `divination` / `git-graph` 的克制感。只有用户明确要"对外展示 / 灵感型 / 作品集"时才放飞视觉。

### 内容守则

- 不为填空白而加内容 —  — 空白说明结构应被简化。
- 每个元素都要能回答"为什么在这里"，回答不了就删掉。
- 加新 section / page / 功能前**先问用户** —  — 你不比用户更懂他的目标。

---

## 核心哲学：Zero-Dialect Runtime

Live App（灵动应用）使用 **标准 Web API + window.app**：UI 侧为 ESM 模块（`ui.js`），后端逻辑在独立 JS Worker 进程（Bun 优先 / Node 回退）中执行。Rust 负责进程管理、权限策略和 Tauri 独占 API；Bridge 统一使用 **window.app** Runtime Adapter。

## 代码架构

### Rust 后端

```
src/crates/core/src/live_app/
├── types.rs               # LiveAppSource (ui_js/worker_js/esm_dependencies/npm_dependencies), NodePermissions
├── manager.rs             # CRUD + recompile() + resolve_policy_for_app()
├── storage.rs             # ui.js, worker.js, package.json, esm_dependencies.json
├── compiler.rs            # Import Map + Runtime Adapter 注入 + ESM
├── bridge_builder.rs      # window.app 生成 + build_import_map()
├── permission_policy.rs   # resolve_policy() → JSON 策略供 Worker 启动 / host_dispatch 复用
├── host_dispatch.rs       # 宿主直连分发 fs/shell/os/net（无需 Bun/Node Worker）
├── runtime_detect.rs      # detect_runtime() Bun/Node
├── js_worker.rs           # 单进程 stdin/stderr JSON-RPC
├── js_worker_pool.rs      # 池管理 + install_deps
├── exporter.rs            # 导出骨架
└── mod.rs
```

### Tauri Commands

```
src/apps/desktop/src/api/live_app_api.rs
```

- 应用管理: `list_live_apps`, `get_live_app`, `create_live_app`, `update_live_app`, `delete_live_app`
- 存储/授权: `get/set_live_app_storage`, `grant_live_app_workspace`, `grant_live_app_path`
- 版本: `get_live_app_versions`, `rollback_live_app`
- Worker/Runtime: `live_app_runtime_status`, `live_app_worker_call`, `live_app_host_call`, `live_app_worker_stop`, `live_app_install_deps`, `live_app_recompile`
- 对话框由前端 Bridge 用 Tauri dialog 插件处理，部分封装为 `live_app_dialog_*` 等

### Agent 工具

```
src/crates/core/src/agentic/tools/implementations/
└── live_app_init_tool.rs   # InitLiveApp — 创建骨架目录供 AI 用通用文件工具编辑
```

注册在 `registry.rs` 的 `register_all_tools()` 中。AI 后续用 Read/Edit/Write 等通用文件工具编辑 Live App 源文件。

### 前端

```
src/web-ui/src/app/scenes/apps/live-app/
├── liveAppStore.ts
├── components/ LiveAppCard, LiveAppRunner (iframe 带 data-app-id)
├── hooks/
│   ├── useLiveAppBridge.ts        # worker.call → workerCall() + dialog.open/save/message
│   └── useLiveAppCatalogSync.ts   # 列表与运行态同步
└── liveAppIcons.tsx 等

src/web-ui/src/app/scenes/apps/LiveAppScene.tsx / LiveAppScene.scss
src/web-ui/src/infrastructure/api/service-api/LiveAppAPI.ts
src/web-ui/src/flow_chat/tool-cards/InitLiveAppToolDisplay.tsx   # InitLiveAppDisplay，工具名 InitLiveApp
```

### Worker 宿主

```
src/apps/desktop/resources/worker_host.js
```

Node/Bun 标准脚本：从 argv 读策略 JSON，stdin 收 RPC、stderr 回响应，内置 fs/shell/net/os/storage dispatch + 加载用户 `source/worker.js` 自定义方法。

## Live App 数据模型 (V2)

```rust
// types.rs
LiveAppSource {
  html, css,
  ui_js,           // 浏览器侧 ESM
  esm_dependencies,
  worker_js,       // Worker 侧逻辑
  npm_dependencies,
}
LiveAppPermissions { fs?, shell?, net?, node?, ai?, agentic? }  // node 替代 env/compute，AI/Agentic 走宿主桥接
```

## 权限模型

- **permission_policy.rs**：`resolve_policy(perms, app_id, app_data_dir, workspace_dir, granted_paths)` 生成 JSON 策略，传给 Worker 启动参数；Worker 内部按策略拦截越权。
- 路径变量同前：`{appdata}`, `{workspace}`, `{user-selected}`, `{home}` 等。

## Bridge 通信流程 (V2)

```
iframe 内 window.app.call(method, params) → useLiveAppBridge 监听
  ├─ 框架原语 (fs.* / shell.* / os.* / net.*)：
  │   ├─ node.enabled = false → liveAppAPI.hostCall → Tauri invoke('live_app_host_call')
  │   │ → core live_app::host_dispatch（纯 Rust，无需 Bun/Node）
  │   └─ node.enabled = true → liveAppAPI.workerCall → Tauri invoke('live_app_worker_call')
  │ → JsWorkerPool（保留旧路径，允许 worker.js 覆写 fs/shell 等）
  ├─ 自定义方法：始终走 worker.call → JsWorkerPool（要求 node.enabled = true 且 worker.js 导出）
  ├─ storage.* (node.enabled = false 时)：直接走 get/set_live_app_storage 命令
  ├─ ai.*：走 live_app_ai_* 命令，复用宿主 AIClient
  └─ agentic.*：走 live_app_agentic_* 命令，创建/驱动宿主管理的 Sparo OS Agentic 会话

dialog.open / dialog.save / dialog.message → postMessage → useLiveAppBridge 直接调 @tauri-apps/plugin-dialog
```

### 何时使用「无 Node 模式」（推荐）

只要小应用的后端能力可以用 `fs.*` / `shell.*` / `os.*` / `net.*` / `storage.*` / `ai.*` / `agentic.*` 完成（例如调用 `git` 拉数据、读写工作区文件、抓取 HTTP API、直连宿主模型、或驱动 Sparo OS Agentic 会话），就把 `permissions.node.enabled` 设为 `false`：

- 不依赖 Bun/Node 安装环境，bundle 后即点即用，避免 "JS Worker pool not initialized" 类问题；
- 安全与性能与 Worker 路径完全等价（同一份 `permission_policy`，Rust 直接执行）；
- 仍然可以使用 `app.shell.exec / fs.* / net.fetch / os.info / storage.get|set / ai.* / agentic.*` 等宿主桥接能力。

什么时候需要 `node.enabled = true`：

- 需要写 `worker.js` 自定义方法（CPU 密集 / 长流程 / 复杂解析等）；
- 需要 `npm_dependencies` 安装第三方 npm 包；
- 需要在 worker 内长期持有连接、缓存、状态。

> 走「无 Node 模式」时，**禁止** 调用 `app.call('myCustomMethod', …)`，宿主会显式报错；只能调用框架原语和 `app.storage.*`。

## 能力边界（重要）

Live App 运行时**只暴露下列能力**，没有任何任意调用内部服务的"通用 Sparo OS 后端通道"。设计 / 生成新小应用前请先比对，能力不在表内的需求请走相应替代方案。Agentic 会话只能通过表内的 `app.agentic.*` 管理，**不要假设有 `app.sparo.*` / `app.workspace.*` / `app.git.*` / `app.session.*` 之类的接口存在。**


| 能力        | 入口                                                                                     | 说明                                                          |
| --------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 文件系统      | `app.fs.*`                                                                             | 受 `permissions.fs.read/write` 路径白名单限制                       |
| 子进程 / 命令行 | `app.shell.exec`                                                                       | 受 `permissions.shell.allow` 命令名白名单限制                        |
| HTTP      | `app.net.fetch`                                                                        | 受 `permissions.net.allow` 域名白名单限制                           |
| 系统信息      | `app.os.info`                                                                          | 仅 platform / cpus / homedir / tmpdir 等只读字段                  |
| KV 存储     | `app.storage.get/set`                                                                  | 每个小应用独立的 `storage.json`，跨会话保留                               |
| AI        | `app.ai.complete / chat / cancel / getModels`                                          | 复用宿主 AIClient，受 `permissions.ai`（含 `allowed_models` / 速率限制） |
| Agentic   | `app.agentic.createSession / sendMessage / cancelTurn / listSessions / restoreSession / deleteSession / confirmTool / rejectTool / openSession / onEvent` | 创建并驱动真实 Sparo OS Agentic 会话，受 `permissions.agentic` 限制；需要 Sparo OS 工具链、会话持久化、原生 Flow Chat 查看时使用 |
| 对话框       | `app.dialog.open/save/message`                                                         | Tauri dialog 插件                                             |
| 剪贴板       | `app.clipboard.readText/writeText`                                                     | 宿主 navigator.clipboard                                      |
| 自定义后端     | `app.call('xxx', …)` + `worker.js`                                                     | 仅 `node.enabled = true` 时可用，自己实现业务逻辑                        |
| 主题 / i18n | `app.theme` / `app.locale` / `app.onThemeChange` / `app.onLocaleChange` / `app.t(...)` | 见对应章节                                                       |


## Runtime UI Kit（运行态组件子集）

每个编译后的 Live App 都会注入一个小型运行态 UI Kit：`window.app.ui`。它不是主应用 React 组件库的开发态直连，而是为 sandbox iframe 准备的白名单子集：用原生 DOM helper + 与组件库对齐的 class contract，避免 Live App 依赖 Vite alias、React context 或开发服务器。

当前白名单：

- `app.ui.Button({ text, variant, size, onClick })`
- `app.ui.Card({ children, variant, padding })`
- `app.ui.CardHeader({ title, subtitle, extra })`
- `app.ui.CardBody({ children })`
- `app.ui.CardFooter({ children, align })`
- `app.ui.Input({ label, placeholder, value, onInput })`
- `app.ui.Badge({ text, variant })`
- `app.ui.Alert({ type, title, message, description })`
- `app.ui.Empty({ title, description })`
- `app.ui.Stack({ children, direction, gap })`
- `app.ui.Toolbar({ children })`
- `app.ui.mount(target, child)` / `app.ui.createElement(tag, attrs, ...children)`

生成常规工具型 Live App 时，优先用 `app.ui` 搭骨架，再写业务样式。若必须手写 HTML，也优先复用这些运行态 class：`btn`、`v-card`、`sparo-input-wrapper`、`badge`、`alert`、`bfui-stack`。

示例：

```js
const ui = app.ui;

const panel = ui.Card({
  children: [
    ui.CardHeader({ title: app.t({ 'zh-CN': '待办清单', 'en-US': 'Tasks' }) }),
    ui.CardBody({
      children: ui.Stack({
        children: [
          ui.Input({ label: app.t({ 'zh-CN': '新任务', 'en-US': 'New task' }) }),
          ui.Button({ text: app.t({ 'zh-CN': '添加', 'en-US': 'Add' }) }),
        ],
      }),
    }),
  ],
});

ui.mount('#app', panel);
```


### 框架**不**直接暴露的 Sparo OS 后端能力（截至本文档）

下面这些 Sparo OS 内部服务，目前**没有**给小应用开放直接调用通道（表内已有的 `app.agentic.*` 是唯一受控 Agentic 会话入口）：

- WorkspaceService（结构化工作区索引、统一搜索）
- GitService（结构化 status / diff / blame，区别于裸 `git` 命令）
- TerminalService（创建/读写交互式终端）
- Session / AgenticSystem 的任意内部 API（只能用 `app.agentic.*` 创建/恢复 Live App 自己拥有的会话、发送 prompt、接收事件、确认/拒绝工具、跳转查看）
- LSP / Snapshot / Mermaid / Skills / Browser API / Computer Use / Config 等

需要这类能力时的合规姿势：

1. **能用裸命令行解决的**（如 git） → 在 `permissions.shell.allow` 里加命令名，用 `app.shell.exec` 包一层；
2. **只是要读 Sparo OS 工作区内的文件**（如某些项目元数据） → 把 `{workspace}` 加到 `permissions.fs.read`，自己用 `app.fs.*` 读 + 在前端解析；
3. **必须启动/驱动 Agentic 会话** → 用 `app.agentic.*`，不要用 `app.ai.chat` 模拟；
4. **必须真调用其他内部服务** → 暂不支持，先记录到需求池。**不要**自己起一个 worker 去模拟服务行为，会和真正的 service 行为漂移。

> 维护者：以后若新增 `app.sparo.*` / `app.workspace.*` 这类宿主直通通道，请同步更新本节，避免"文档说没有、代码偷偷加了"的不一致。

## window.app 运行时 API

Live App UI 内通过 **window.app** 访问：


| API                            | 说明                                                       |
| ------------------------------ | -------------------------------------------------------- |
| `app.call(method, params)`     | 调用自定义 Worker 方法；仅 `node.enabled = true` 且 `worker.js` 导出时可用 |
| `app.fs.*`                     | 文件系统原语；node 关闭时由 Rust host_dispatch 处理，node 开启时可走 Worker |
| `app.shell.*`                  | Shell 原语；受命令白名单限制                                      |
| `app.net.*`                    | HTTP 原语；受域名白名单限制                                       |
| `app.os.*`                     | 只读系统信息                                                  |
| `app.storage.*`                | 每应用 KV 存储；无 Node 模式下由 manager 命令直接处理                    |
| `app.ai.*`                     | 宿主模型调用；受 `permissions.ai` 限制                              |
| `app.agentic.*`                | 宿主管理的 Sparo OS Agentic 会话；受 `permissions.agentic` 限制        |
| `app.dialog.open/save/message` | 由 Bridge 转 Tauri dialog 插件                                  |
| `app.clipboard.*`              | 由 Bridge 转宿主剪贴板                                          |
| 生命周期 / 事件 / i18n              | `onActivate` / `onDeactivate` / `onThemeChange` / `onLocaleChange` / `app.on/off` / `app.t` |


## 主题集成

Live App 在 iframe 中运行时自动与主应用主题同步，避免界面风格与主应用差距过大。

### 只读属性与事件


| 成员                      | 说明                                        |
| ----------------------- | ----------------------------------------- |
| `app.theme`             | 当前主题类型字符串：`'dark'` 或 `'light'`（随主应用切换更新）  |
| `app.onThemeChange(fn)` | 注册主题变更回调，参数为 payload：`{ type, id, vars }` |


### data-theme-type 属性

编译后的 HTML 根元素 `<html>` 带有 `data-theme-type="dark"` 或 `"light"`，便于用 CSS 按主题写样式，例如：

```css
[data-theme-type="light"] .panel { background: #f5f5f5; }
[data-theme-type="dark"] .panel { background: #1a1a1a; }
```

### --sparo-* CSS 变量

宿主会将主应用主题映射为以下 CSS 变量并注入 iframe 的 `:root`。在 Live App 的 CSS 中建议用 `var(--sparo-*, <fallback>)` 引用，以便在 Sparo OS 内与主应用一致，导出为独立应用时 fallback 生效。

审阅时必须把下列清单当作唯一有效的宿主主题变量白名单。任何不在清单内的 `--sparo-*` 引用都是无效变量；任何 `--theme-*` / `--color-*` / `--surface-*` 之类主题名只有在 Live App 自己的 `:root` 明确定义后才能使用。

**背景**

- `--sparo-bg` — 主背景
- `--sparo-bg-secondary` — 次级背景（如工具栏、面板）
- `--sparo-bg-tertiary` — 第三级背景
- `--sparo-bg-elevated` — 浮层/卡片背景

**文字**

- `--sparo-text` — 主文字
- `--sparo-text-secondary` — 次要文字
- `--sparo-text-muted` — 弱化文字

**强调与语义**

- `--sparo-accent`、`--sparo-accent-hover` — 强调色及悬停
- `--sparo-success`、`--sparo-warning`、`--sparo-error`、`--sparo-info` — 语义色

**边框与元素**

- `--sparo-border`、`--sparo-border-subtle` — 边框
- `--sparo-element-bg`、`--sparo-element-hover` — 控件背景与悬停

**圆角与字体**

- `--sparo-radius`、`--sparo-radius-lg` — 圆角
- `--sparo-font-sans`、`--sparo-font-mono` — 无衬线与等宽字体

**滚动条**

- `--sparo-scrollbar-thumb`、`--sparo-scrollbar-thumb-hover` — 滚动条滑块

示例（在 `style.css` 中）：

```css
:root {
  --bg: var(--sparo-bg, #121214);
  --text: var(--sparo-text, #e8e8e8);
  --accent: var(--sparo-accent, #60a5fa);
}
body {
  font-family: var(--sparo-font-sans, system-ui, sans-serif);
  color: var(--text);
  background: var(--bg);
}
```

### 同步时机

- iframe 加载后 bridge 会向宿主发送 `sparo/request-theme`，宿主回推当前主题变量，iframe 内 `_applyThemeVars` 写入 `:root`。
- 主应用切换主题时，宿主会向 iframe 发送 `themeChange` 事件，bridge 更新变量并触发 `onThemeChange` 回调。

## 国际化（i18n）

Live App 运行在 V2 之后内置 i18n 支持，开发者**必须**为多语言用户考虑两类文案：

1. **Gallery 元数据**（`name` / `description` / `tags`） —  — 在 `meta.json` 顶层加 `i18n.locales` 块，宿主 Gallery / Card / Scene 标题自动按当前语言挑选。
2. **应用内文案**（HTML / JS 中的所有可见字符串） —  — 通过 `window.app.locale`、`window.app.onLocaleChange(fn)` 与 `window.app.t(table, fallback)` 实现。

### `meta.json` 多语言示例

```json
{
  "id": "your-app",
  "name": "默认名（兜底）",
  "description": "默认描述",
  "tags": ["默认标签"],
  "i18n": {
    "locales": {
      "zh-CN": { "name": "中文名", "description": "中文描述", "tags": ["中文"] },
      "en-US": { "name": "English Name", "description": "English desc", "tags": ["en"] }
    }
  }
}
```

回退顺序：`current` → `en-US` → `zh-CN` → 顶层默认值。

### `window.app` i18n 运行时 API


| 成员                       | 说明                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `app.locale`             | 当前语言 ID（如 `'zh-CN'` / `'en-US'`），随宿主切换更新                                                      |
| `app.onLocaleChange(fn)` | 注册语言切换回调，参数为新 locale 字符串                                                                      |
| `app.t(table, fallback)` | 从 `{ 'zh-CN': '...', 'en-US': '...' }` 表挑选字符串；解析顺序：current → en-US → zh-CN → 表的第一项 → fallback |


### HTML 静态文案：`data-i18n` 约定

宿主不强制要求该写法，但推荐 Live App 内部统一约定：

- `<span data-i18n="key">默认</span>` —  — 切换语言时 `applyStaticI18n()` 读取 `data-i18n` 并替换 `textContent`
- `<div data-i18n="ariaKey" data-i18n-attr="aria-label">...</div>` —  — 设置某个属性而非文本

参考 `bundles/live-apps/spark-board/ui.js` 等内置应用的 `I18N` 表 + `applyStaticI18n()` + `app.onLocaleChange` 三件套即可复用。

### 编写自检清单

- `meta.json` 已加 `i18n.locales`（至少 `zh-CN` / `en-US`）
- HTML 中静态文案均带 `data-i18n` 属性
- JS 内动态拼接的字符串使用 `app.t()` 或自有 `I18N` 表
- 注册了 `app.onLocaleChange`，切换语言时重新渲染（包括动态列表、aria-label、title）
- 持久化数据（`app.storage`）保存语言无关的索引/键，而非已翻译的字符串

## 内置小应用（bundles/live-apps/*）维护规范
内置小应用放在 `bundles/live-apps/<app>/`，每个包用 `bundle.json` 声明稳定 `id` 和 reseed `version`。`src/crates/core/src/live_app/builtin/mod.rs` 会以 `include_dir!` 打包整个 `bundles/live-apps` 目录；首次启动 / 升级时由 `seed_builtin_live_apps()` 把资源写入用户的 `liveapps/<app_id>/`，并在该目录下写入 `.builtin-version` 标记文件。

**只有当 bundled `version` > on-disk 标记时才会重新 seed**，否则启动时会跳过，用户看到的还是旧版本。

### 修改流程（强制）

凡是修改了 `bundles/live-apps/<app>/` 下任何文件（`index.html` / `style.css` / `ui.js` / `worker.js` / `meta.json`），**都必须**同步把该包 `bundle.json` 的 `version: N` 改为 `N + 1`。

```json
{
  "schemaVersion": 1,
  "id": "builtin-daily-divination",
  "version": 14
}
```

未 bump 的后果：

- 已经体验过该小应用的用户（本地有 `.builtin-version` 标记）不会收到新版本，无法验证设计 / 修复
- QA / Release 看到的还是旧文件，会误判“代码已合但效果没出来”

### 自检清单

- 改完 `bundles/live-apps/<app>/` 任何文件
- `bundle.json` 中对应 `version` 已 +1
- 本地清掉用户数据目录中 `liveapps/<app_id>/.builtin-version` 或直接删整目录，再启动验证 reseed 生效
- `meta.json` 中的 `version` 字段（用户可见的元数据版本）按需同步（与 reseed 无关，但用于展示）

### 提示

- `meta.json` 里的 `version` 是给用户看的版本号，不驱动 reseed
- 真正驱动 reseed 的是 `bundle.json` 中的 `version` 字段（u32）
- 二者最好语义一致：资源有重大更新时同步 bump，便于排查
## 开发约定

### 新增 Agent 工具

当前仅 **InitLiveApp**。若扩展：

1. `implementations/live_app_xxx_tool.rs`（或他名）实现 `Tool`
2. `mod.rs` + `registry.rs` 注册
3. `flow_chat/tool-cards/index.ts` 增加对应卡片组件

### 修改编译器

`compiler.rs`：注入 Import Map（`build_import_map`）、Runtime Adapter（`build_bridge_script`）、CSP；用户脚本以 `<script type="module">` 注入 `ui_js`。

### 前端事件

后端 `liveapp-created` / `liveapp-updated` / `liveapp-deleted` / `liveapp-worker-`*，前端 `useLiveAppCatalogSync` 统一监听并刷新 store。

## 场景注册检查清单

同前：`SceneBar/types.ts`、`scenes/registry.ts`、`SceneViewport.tsx`、`NavPanel/config.ts`、`app/types/index.ts`、locales。

## 参考

- 历史重构计划（文件名可能仍含 miniapp）: `.cursor/plans/miniapp_v2_full_refactor_*.plan.md`
- 架构摘要: 同目录 `architecture.md`

