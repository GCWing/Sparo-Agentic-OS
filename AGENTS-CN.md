# Agents.md

中文 | [English](./AGENTS.md)

## 项目概览

Sparo OS 是一个用于构建和运行智能应用的 Agentic OS。桌面端和 CLI 都是一等产品形态，二者由共享 Rust core 服务支撑；React/TypeScript Web UI 是桌面端的界面层。

日常开发优先关注：

- `src/apps/desktop` - Tauri 2 桌面壳、命令、权限能力和桌面端集成。
- `src/apps/cli` - CLI 命令入口、终端/TUI 渲染和 CLI 专属集成。
- `src/web-ui` - 桌面端使用的 React 18 + TypeScript UI。
- `src/crates/core` - 平台无关的业务逻辑、Agent 运行时、服务、存储、路径和工具。
- `src/crates/events` - 平台无关的事件契约。
- `src/crates/transport` - core/events 与各应用表面的适配层。

除非用户明确要求，否则不要围绕通用 app server 目标设计或描述功能。当前支持的产品路径是桌面端 + Web UI 和 CLI；Remote Connect relay 是独立基础设施 crate，不是 Sparo app server。

## 当前架构

- `src/crates/core/src/agentic` - agents、prompts、sessions、dialog turns、model rounds 和工具执行。
- `src/crates/core/src/command` - 桌面端与 CLI adapter 共享的宿主无关 command service。
- `src/crates/core/src/runtime` - 桌面端与 CLI 共用的 process runtime 和 agentic runtime builder。
- `src/crates/core/src/service` - workspace、config、filesystem、terminal、git 等服务。
- `src/crates/core/src/infrastructure` - AI 适配器、应用路径、日志、存储、debug ingest 和事件。
- `src/web-ui/src/app` - 应用外壳和桌面面板。
- `src/web-ui/src/flow_chat` - 聊天 UI、工具卡片、流式/工具事件展示。
- `src/web-ui/src/tools` - editor、terminal、git、mermaid、design canvas 等功能工具。
- `src/web-ui/src/infrastructure` - theme、i18n、config、API adapters 和状态接线。
- `src/web-ui/src/design-system` - 可复用 UI API、视觉契约、预览覆盖和 AI UI 规则。
- `src/web-ui/src/shared` - 前端共享服务、Markdown 渲染、工具函数和类型。
- `src/web-ui/src/locales` - 翻译资源。

## 开发命令

在仓库根目录使用 `pnpm`。

```bash
pnpm install                 # 安装依赖
pnpm run desktop:dev         # 以开发模式运行桌面端
pnpm run dev:web             # 仅运行 Web UI / Vite
pnpm run type-check:web      # TypeScript 检查
pnpm run lint:web            # 前端 lint
pnpm run build:web           # type-check + Web UI build + Monaco 资源校验
pnpm run check:i18n          # locale 文件/键一致性检查
pnpm run check:design-system # design-system 架构与样式 gate
pnpm run preview:design-system # 运行 design-system preview app
pnpm run build:design-system   # 构建 design-system preview 输出
pnpm run desktop:build       # 桌面端生产构建
pnpm run cli:dev -- --help   # 以开发模式运行 CLI
pnpm run cli:build           # 构建 CLI release 二进制
pnpm run cli:check           # 对 CLI crate 运行 Rust check
pnpm run e2e:test            # debug app mode 下运行 Playwright E2E
```

只修改 Rust 代码时，针对受影响 crate 运行最窄范围的 `cargo check` 或 `cargo test`。

## 关键规则

### 平台边界

Core 代码必须保持平台无关。

- 在 `src/crates/core` 中不要依赖 `tauri::AppHandle` 等 Tauri 类型。
- 优先使用 `bitfun_events::EventEmitter`、服务 trait 和构造函数注入依赖。
- 桌面端特有逻辑放在 `src/apps/desktop` 或适配层。
- Tauri command DTO 与共享 command request/response 结构必须保持结构化、可序列化。

### Tauri 命令

Rust 命令名使用 `snake_case`，暴露给 UI 后通过 TypeScript helper 以 `camelCase` 调用。

始终优先使用结构化请求对象：

```rust
#[tauri::command]
pub async fn your_command(
    state: State<'_, AppState>,
    request: YourRequest,
) -> Result<YourResponse, String>
```

```ts
await api.invoke('your_command', { request: { /* fields */ } });
```

### 日志

日志规则适用于所有位置：

- 日志消息只使用英文。
- 日志消息禁止 emoji。
- 优先使用结构化数据/上下文，不要拼接长字符串。
- 正常路径日志保持简洁。
- 永远不要记录 token、API key、密码或个人数据。

前端日志：

- 规范：`src/web-ui/LOGGING.md`
- 使用 `@/shared/utils/logger` 中的 `createLogger('ModuleName')`。
- 记录结构化上下文：`log.info('Loaded items', { count })`。
- 错误作为数据传入：`log.error('Failed to load config', { configPath, error })`。

后端日志：

- 规范：`src/crates/LOGGING.md`
- 使用 `log::{trace, debug, info, warn, error}` 宏。
- 可用时带上 `session_id`、`request_id`、`workspace_path`、operation name 等上下文。

### 路径与持久化

- 应用配置目录名：`sparo_os`。
- 项目隐藏目录名：`.sparo_os`。
- 项目本地配置位于 `<workspace>/.sparo_os/config/`。
- 默认 debug log 位于 `<workspace>/.sparo_os/debug.log`。
- 运行时工作区数据通常位于 `<app-root>/workspaces/<workspace-id>/`。
- 项目 sessions 位于 `<app-root>/workspaces/<workspace-id>/sessions/`。
- Agentic OS 全局 sessions 位于 `<app-root>/agentic_os/sessions/`。

桌面运行时日志：

- 默认根目录是 Sparo OS 配置日志目录：
  - Windows: `%APPDATA%\sparo_os\logs`
  - macOS: `~/Library/Application Support/sparo_os/logs`
  - Linux: `~/.config/sparo_os/logs`
- 每次应用启动会在日志根目录下创建时间戳 session 目录。
- Session 文件包括 `app.log`、`ai.log` 和 `webview.log`。
- `BITFUN_LOG_DIR` 会覆盖日志根目录。`BITFUN_E2E_LOG_DIR` 用于 E2E 运行。

Debug instrumentation 日志：

- 内置 debug ingest server 默认地址是 `http://127.0.0.1:7242`。
- 默认工作区 debug log 路径是 `.sparo_os/debug.log`。
- `scripts/debug-log-server.mjs` 只是临时 standalone helper，默认端口是 `7469`，日志写到仓库根目录 `debug-agent.log`；不要和内置 ingest server 混淆。

### 前端复用

开发前端功能时复用现有基础设施：

- 可复用 UI：`src/web-ui/src/design-system`
- 主题：`src/web-ui/src/infrastructure/theme` 和 `src/web-ui/src/design-system/foundation`
- I18n：`src/web-ui/src/infrastructure/i18n` 和 `src/web-ui/src/locales`
- 共享服务/工具函数：`src/web-ui/src/shared`
- 功能局部状态：沿用已有 Zustand/module store 模式。

`src/web-ui/src/design-system` 是最终可复用 UI 契约。开发前端 UI 时，先查找是否已有可满足诉求的 design-system primitive、pattern、token 或 recipe。出现新的 UI 诉求时，先判断它是否应沉淀为 design system 的可复用契约，还是只属于当前产品场景、应留在业务层做窄范围覆盖。新的 UI 代码应从 `@/design-system` 导入 primitives 和 patterns。design system 外部的产品/功能 TS/TSX 文件不得导入内部路径，例如 `@/design-system/primitives/Button`，也不要用相对路径进入 `design-system`；必须使用公共 barrel。不要重建 component package、兼容层或另一套可复用 UI root。

Feature SCSS 应使用运行时 design-system CSS 变量和 token entrypoints。避免在 feature 样式里新增裸 `#hex`、`rgb()`、`rgba()` 或硬编码 `z-index`。按钮、输入框、选择器、对话框、标签页、徽标、提示和加载器应使用 design-system primitives，不要创建 feature-local control classes；业务层覆盖应限制在产品特定的布局、组合或状态表达上，避免把可复用能力散落在 feature 内。

新增或修改可复用 UI 时：

- 遵循 `src/web-ui/src/design-system/AGENTS.md`。
- 从 `src/web-ui/src/design-system/recipes/` 中最接近的 recipe 开始。
- 在 `src/web-ui/src/design-system/preview/registries` 注册确定性的 preview 覆盖。
- 运行 `pnpm run check:design-system`；视觉覆盖变化时使用 `pnpm run preview:design-system` 或 `pnpm run build:design-system`。

如果周边功能已经本地化，新增用户可见文案时同步维护 `en-US` 和 `zh-CN` locale。
Locale 文件组织和维护规则见 `src/web-ui/src/locales/AGENTS.md`。
修改 locale 后运行 `pnpm run check:i18n`。`pnpm run type-check:web` 和 `pnpm run build:web` 已通过根脚本链包含该检查。

Locale 文件按产品表面组织。`scenes/*` 用于场景级 UI，`panels/*` 用于 docked/embedded panels，`settings/*` 用于稳定设置子页，`shell/*` 用于全局 chrome 和导航，`flow-chat/*` 用于较大的聊天子域。`common.json` 只放跨多个产品区域复用的文本。

### 工具与 Agent 开发

工具：

1. 在 `src/crates/core/src/agentic/tools/implementations/` 下实现工具。
2. 定义类型化 input/output struct。
3. 在 `src/crates/core/src/agentic/tools/registry.rs` 注册工具。
4. 工具有用户可见输出时，在 `src/web-ui/src/flow_chat/tool-cards/` 增加前端工具卡片渲染。
5. 保持工具流水线的流式行为和并发假设。

Agents：

1. 在 `src/crates/core/src/agentic/agents/` 下新增或更新 Agent 代码。
2. 长提示词放在 `src/crates/core/src/agentic/agents/prompts/`。
3. 在 Agent registry 中注册新 Agent。
4. 除非内容明确面向用户或需要本地化，prompts 和 logs 保持英文。

### Git 与工作区安全

- 工作区可能已有用户修改，不要回退无关变更。
- 变更范围保持贴近用户请求。
- 优先沿用项目现有模式，不要轻易引入新抽象。
- 除非任务需要，不要生成或改动生成文件。
- 前端或 UI 变更至少运行 `pnpm run type-check:web`，否则说明未运行原因。
- 后端变更运行最窄范围的 Rust check/test，或说明未运行原因。

## 快速调试参考

临时浏览器 instrumentation helper：

```bash
node scripts/debug-log-server.mjs
```

这个 standalone helper 监听 `http://127.0.0.1:7469`，并把 NDJSON 写入仓库根目录的 `debug-agent.log`。

内置 Agentic debug ingest 使用应用托管 server：

```ts
fetch('http://127.0.0.1:7242/ingest/session-id', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    location: 'file.ts:LINE',
    message: 'Description',
    data: {},
    timestamp: Date.now(),
    sessionId: 'session-id',
  }),
}).catch(() => {});
```

结果日志读取位置：

```text
<workspace>/.sparo_os/debug.log
```
