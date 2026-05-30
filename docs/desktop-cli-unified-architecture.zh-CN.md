# Sparo Desktop / CLI 统一架构设计

本文定义 Sparo OS 后续的目标架构：**Desktop 与 CLI 都是一等产品形态，二者几乎全量共享 GUI 背后的业务能力、配置、日志、会话、存储和运行时**。除窗口、托盘、WebView、原生弹窗、桌面宠物、可视化编辑器内的直接交互等确实只属于 GUI 的能力外，CLI 必须能够覆盖 Desktop GUI 暴露的后端功能。

本文不是过渡方案，不保留 server 兼容路径，不为旧的 `api-layer`、WebSocket RPC 或 CLI 独立存储做兼容设计。目标是一次到位地把系统收敛到最干净、最可维护、最能支撑 Desktop 与 CLI 双形态长期演进的架构。

## 设计结论

Sparo OS 应采用：

```text
Desktop Host
  Tauri shell
  React Web UI
  Desktop capabilities
  Tauri command adapter
  Tauri event adapter

CLI Host
  clap command surface
  TUI / stdout / JSON renderers
  CLI capability adapter
  CLI command adapter
  CLI event adapter

Shared Core Runtime
  command services
  agentic runtime
  workspace runtime
  config / logs / storage / sessions
  tools / MCP / terminal / live apps / agent apps / bridge apps
  host capability traits
```

核心原则：

```text
共享业务能力，不共享界面形态。
共享 command service，不共享 Tauri IPC。
共享 runtime/storage/config/logging，不共享 CLI 临时实现。
Desktop 和 CLI 都调用 core；没有 server 中间层。
```

## 必须删除的旧方向

以下内容不进入目标架构：

- `src/apps/server`
- `src/crates/api-layer`
- 面向 browser-served Web App 的 WebSocket RPC 路径
- CLI 独立 session JSON 存储
- CLI 独立主配置文件
- 以 Tauri command 作为业务逻辑边界的设计
- 为 server 预留的通用 transport 抽象

这些路径会制造错误的架构压力：它们要求业务逻辑假装服务于三端或四端，但实际产品目标只有 Desktop 与 CLI 双形态。

Relay Server 例外。`src/apps/relay-server` 是 Remote Connect 的中继基础设施，不是 Sparo App Server，不参与本文讨论的 Desktop / CLI 应用运行时。

## 目标目录结构

```text
src/
  apps/
    desktop/
      src/
        api/                  # Tauri command adapter only
        host/                 # DesktopHost capabilities
        bootstrap/            # Desktop boot orchestration
        window/
        tray/
        computer_use/

    cli/
      src/
        commands/             # clap command adapters
        render/               # table/json/yaml/tui/stdout renderers
        tui/                  # interactive TUI surfaces
        host/                 # CliHost capabilities
        bootstrap.rs          # CLI boot orchestration
        main.rs

    relay-server/
      ...

  crates/
    core/
      src/
        command/              # shared command service layer
        runtime/              # shared runtime builder and handles
        host/                 # host capability traits
        agentic/
        service/
        infrastructure/
        live_app/
        agent_app/
        bridge_app/
        util/

    events/
    ai-adapters/
    webdriver/
    libs/
```

`src/apps/desktop/src/api` 和 `src/apps/cli/src/commands` 都是 adapter。业务实现必须进入 `src/crates/core/src/command` 或更底层的 core service。

## Shared Core Runtime

目标 runtime 应是 Desktop 和 CLI 唯一的后端入口。

```rust
pub struct SparoRuntime {
    pub paths: Arc<PathManager>,
    pub config: Arc<ConfigService>,
    pub workspace: Arc<WorkspaceService>,
    pub filesystem: Arc<FileSystemService>,
    pub agentic: AgenticRuntime,
    pub terminal: Arc<TerminalApi>,
    pub mcp: Option<Arc<MCPService>>,
    pub live_apps: Arc<LiveAppManager>,
    pub agent_apps: Arc<AgentAppService>,
    pub bridge_apps: Arc<BridgeAppService>,
    pub token_usage: Arc<TokenUsageService>,
    pub host: Arc<dyn HostCapabilities>,
    pub event_sink: Arc<dyn EventSink>,
}

pub struct AgenticRuntime {
    pub coordinator: Arc<ConversationCoordinator>,
    pub scheduler: Arc<DialogScheduler>,
    pub event_queue: Arc<EventQueue>,
    pub event_router: Arc<EventRouter>,
}

pub struct RuntimeOptions {
    pub host_kind: HostKind,
    pub workspace_path: Option<PathBuf>,
    pub host: Arc<dyn HostCapabilities>,
    pub event_sink: Arc<dyn EventSink>,
    pub background_services: BackgroundServiceMode,
}

pub enum HostKind {
    Desktop,
    Cli,
}

pub enum BackgroundServiceMode {
    Full,
    InteractiveCli,
    HeadlessCli,
}
```

Desktop 和 CLI 不允许各自复制 agentic 初始化逻辑。所有 coordinator、scheduler、event queue、event router、session manager、tool pipeline、cron、memory consolidation、host scan、workspace overview 等初始化，必须通过同一个 runtime builder 完成。

## Command Service Layer

`core::command` 是 Desktop 和 CLI 的共享能力边界。它不依赖 Tauri，不解析 clap，不渲染 UI，只接收 typed request，返回 typed response。

建议结构：

```text
src/crates/core/src/command/
  mod.rs
  context.rs
  error.rs
  dto/
    mod.rs
    session.rs
    config.rs
    workspace.rs
    filesystem.rs
    terminal.rs
    mcp.rs
    live_app.rs
    agent_app.rs
    bridge_app.rs
    skill.rs
    memory.rs
    logs.rs
    storage.rs

  session.rs
  config.rs
  workspace.rs
  filesystem.rs
  terminal.rs
  mcp.rs
  live_app.rs
  agent_app.rs
  bridge_app.rs
  skill.rs
  memory.rs
  logs.rs
  storage.rs
```

标准调用链：

```text
Desktop Web UI
  -> Tauri invoke
  -> desktop api adapter
  -> core command service
  -> core service/runtime
  -> typed response
  -> Web UI render

CLI
  -> clap args / TUI action
  -> cli command adapter
  -> core command service
  -> core service/runtime
  -> typed response
  -> table/json/yaml/TUI/stdout render
```

示例：

```rust
pub async fn get_config(
    ctx: &CommandContext,
    request: GetConfigRequest,
) -> CommandResult<serde_json::Value>;

pub async fn set_config(
    ctx: &CommandContext,
    request: SetConfigRequest,
) -> CommandResult<SetConfigResponse>;
```

Desktop adapter：

```rust
#[tauri::command]
pub async fn set_config(
    state: State<'_, DesktopState>,
    request: SetConfigRequest,
) -> Result<SetConfigResponse, String> {
    core::command::config::set_config(state.command_context(), request)
        .await
        .map_err(|error| error.to_string())
}
```

CLI adapter：

```rust
pub async fn run_set_config(
    runtime: &SparoRuntime,
    args: SetConfigArgs,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let response = core::command::config::set_config(runtime.command_context(), args.into()).await?;
    render(response, output)
}
```

## Host Capability Model

Desktop 与 CLI 的差异必须显式表达为 host capability，而不是散落在 command handler 内部。

```rust
pub trait HostCapabilities: Send + Sync {
    fn kind(&self) -> HostKind;
    fn computer_use(&self) -> Option<Arc<dyn ComputerUseHost>>;
    fn clipboard(&self) -> Option<Arc<dyn ClipboardHost>>;
    fn native_dialogs(&self) -> Option<Arc<dyn NativeDialogHost>>;
    fn notifications(&self) -> Option<Arc<dyn NotificationHost>>;
    fn browser_control(&self) -> Option<Arc<dyn BrowserControlHost>>;
    fn webview_control(&self) -> Option<Arc<dyn WebviewControlHost>>;
    fn terminal_io(&self) -> Arc<dyn TerminalIoHost>;
}
```

DesktopHost：

- 提供 Tauri window、tray、dialog、clipboard、notification、WebView、desktop computer-use、screen capture、accessibility。
- 可以启动 GUI-only flow。
- 可以向 Web UI emit rich event。

CliHost：

- 提供 stdin/stdout/stderr、TTY detection、pager、editor open command、file path prompt、terminal confirmation、JSON output。
- 不提供窗口、托盘、WebView DOM self-control、桌面宠物。
- 对确实不可实现的能力返回 `UnsupportedOnCli`。

CLI 不应隐藏能力缺失。错误必须是 typed error：

```rust
CommandError::UnsupportedCapability {
    host: HostKind::Cli,
    capability: "native_dialog",
    alternative: Some("Pass --path explicitly"),
}
```

## Event Model

事件也要共享 core event，不共享传输协议。

```rust
pub trait EventSink: Send + Sync {
    async fn emit(&self, event: AgenticEvent) -> anyhow::Result<()>;
    async fn emit_generic(&self, name: &str, payload: serde_json::Value) -> anyhow::Result<()>;
}
```

DesktopEventSink：

```text
AgenticEvent
  -> DesktopEventSink
  -> Tauri emit
  -> Web UI listener
```

CliEventSink：

```text
AgenticEvent
  -> CliEventSink
  -> render model
  -> TUI/stdout/json lines
```

CLI 支持三种输出模式：

```text
human
  面向人阅读，适合交互终端。

json
  单次命令返回一个完整 JSON response。

jsonl
  流式事件一行一个 JSON，适合脚本和自动化。
```

CLI 的 `exec`、`chat`、`terminal`、`mcp`、`live-app run` 等命令必须共用这套 event sink。

## 配置统一

目标状态：

- 全局配置唯一来源是 `ConfigService`。
- 路径唯一来源是 `PathManager`。
- CLI 不再维护独立主配置。
- CLI-only 选项写入 global config 的 `cli.*` namespace。
- Desktop GUI 设置页和 CLI `sparo config` 命令读写同一份配置。

建议配置结构：

```json
{
  "app": {
    "language": "zh-CN",
    "logging": {
      "level": "debug"
    }
  },
  "ai": {},
  "cli": {
    "theme": "dark",
    "outputFormat": "human",
    "pager": "auto",
    "confirmDangerous": true,
    "defaultWorkspace": null,
    "keybindings": {}
  }
}
```

`sparo config` 应覆盖 GUI 设置页背后的配置能力：

```text
sparo config get [path]
sparo config set <path> <json-value>
sparo config reset [path]
sparo config import <file>
sparo config export [file]
sparo config models list
sparo config models enable <id>
sparo config models disable <id>
sparo config logging get
sparo config logging set-level <level>
```

## 日志统一

日志路径必须统一由 `PathManager::logs_dir()` 决定。

每次 Desktop 或 CLI 启动都创建 session log directory：

```text
<app-root>/logs/YYYYMMDDTHHMMSS/
  app.log
  ai.log
  cli.log        # CLI only
  webview.log    # Desktop only
```

规则：

- `BITFUN_LOG_DIR` / `BITFUN_E2E_LOG_DIR` 这类 override 可以保留，但必须在 shared logging initializer 中实现。
- runtime log level 由 global config 控制。
- Desktop 和 CLI 都能通过 command service 查询日志状态。

CLI 命令：

```text
sparo logs info
sparo logs tail app
sparo logs tail ai
sparo logs tail cli
sparo logs export --since today
sparo logs cleanup --keep 10
```

## 会话与存储统一

CLI 独立 session JSON 必须删除。所有 session 都进入 core `PersistenceManager`。

目标路径：

```text
<app-root>/workspaces/<workspace-id>/sessions/<session-id>/
  metadata.json
  state.json
  turns/
  snapshots/
  artifacts/
```

Agentic OS 全局会话使用独立 scope：

```text
<app-root>/agentic_os/sessions/<session-id>/
  metadata.json
  state.json
  turns/
  snapshots/
  artifacts/
```

Desktop GUI 的会话列表、CLI `sparo sessions list`、CLI `sparo chat --resume` 必须看到同一批 workspace session。Agentic OS 全局会话需要由调用方显式选择全局 storage scope。

CLI 命令当前已落地：

```text
sparo sessions list [--workspace <path>]
sparo sessions show <session-id>
sparo sessions delete <session-id>
```

目标命令，尚待落地：

```text
sparo sessions restore <session-id>
sparo sessions compact <session-id>
sparo sessions transcript <session-id> [--tools] [--thinking]
sparo sessions fork <session-id> --from-turn <n>
```

CLI interactive chat 可以保留 TUI 临时转录模型，但不能把它作为持久化来源。它应显示 core persisted turns，并通过 coordinator/scheduler 继续同一个 session。

## CLI 功能覆盖矩阵

CLI 要覆盖 GUI 后端能力，而不是 GUI 像素级体验。

### Agentic / Chat

```text
sparo chat
sparo exec <message>
sparo session create
sparo session start-turn
sparo session cancel-turn
sparo session confirm-tool
sparo session reject-tool
sparo session compact
sparo session update-model
sparo session update-title
```

### Workspace / Files

```text
sparo workspace open <path>
sparo workspace list
sparo workspace recent
sparo workspace remove-recent <id>
sparo workspace scan <path>
sparo fs tree <path>
sparo fs read <path>
sparo fs write <path> --content/--file
sparo fs search <pattern>
sparo fs rename <old> <new>
sparo fs delete <path>
sparo fs pinned list/add/remove/reorder
```

### Terminal

```text
sparo terminal create
sparo terminal list
sparo terminal write <session-id>
sparo terminal send-command <session-id> <command>
sparo terminal history <session-id>
sparo terminal signal <session-id> <signal>
sparo terminal close <session-id>
```

### MCP

```text
sparo mcp servers
sparo mcp start <server-id>
sparo mcp stop <server-id>
sparo mcp restart <server-id>
sparo mcp status <server-id>
sparo mcp resources <server-id>
sparo mcp read-resource <server-id> <uri>
sparo mcp prompts <server-id>
sparo mcp get-prompt <server-id> <name>
sparo mcp auth clear <server-id>
sparo mcp delete <server-id>
```

### Apps

```text
sparo apps list
sparo live-app list/create/update/delete
sparo live-app run <app-id> <action>
sparo live-app logs <app-id>
sparo live-app issues <app-id>
sparo live-app install-deps <app-id>
sparo agent-app list/create/update/delete/import/export
sparo bridge-app list/run/validate/delete
```

### Skills / Subagents / Tools

```text
sparo skills list
sparo skills add <path>
sparo skills delete <key>
sparo skills market list/search/download
sparo subagents list/enable/disable/delete
sparo tools list
sparo tools info <name>
sparo tools run <name> --input <json>
```

### Memory / Automation / Reports

```text
sparo memory host-scan run
sparo memory workspace-overview run
sparo memory global-milestone run
sparo memory consolidate run
sparo cron list/create/update/delete/run
```

## GUI-only 能力清单

以下能力不要求 CLI 等价实现：

- 主窗口控制
- 托盘菜单
- macOS menubar
- WebView DOM self-control
- desktop companion pet
- 原生文件选择弹窗
- GUI 内部 tab、panel、scene navigation
- Markdown/Tiptap 可视化编辑器的鼠标选区交互
- 图形化 diff review 组件

但 GUI-only 不等于业务不可用。例如 Markdown coauthor 的后端能力应有 CLI 形式：

```text
sparo markdown rewrite --file README.md --range 10:30 --instruction "..."
sparo markdown continue --file README.md --at 120 --instruction "..."
```

CLI 输出 patch 或 structured proposal，由用户在终端确认。

## Desktop Adapter 规则

`src/apps/desktop/src/api` 中的函数必须收敛为 adapter。

允许：

- Tauri `State` 提取。
- Tauri `AppHandle` 使用。
- DTO camelCase/serde 适配。
- 将 `CommandError` 转成 `String`。
- 调用 DesktopHost capability。
- emit Desktop-only event。

禁止：

- 在 Tauri command 中实现业务规则。
- 在 Tauri command 中直接维护 session/config/storage 的持久化规则。
- 在 Tauri command 中复制 core service 可表达的逻辑。
- 为 CLI 复制一个同名 handler。

## CLI Adapter 规则

`src/apps/cli/src/commands` 中的函数也必须只是 adapter。

允许：

- clap 参数解析。
- 终端交互确认。
- 输出格式化。
- pager / editor / TTY 检测。
- 将 `CommandError` 转成 exit code。

禁止：

- 自己写 session 文件。
- 自己写主配置。
- 自己初始化一套 agentic runtime。
- 自己实现 GUI 已经依赖的业务规则。

CLI exit code 标准：

```text
0  success
1  general failure
2  invalid arguments
3  unsupported capability
4  user cancelled
5  config error
6  workspace error
7  agent/runtime error
8  tool failure
```

## Error Model

Core command service 必须使用 typed error：

```rust
pub enum CommandError {
    InvalidRequest { message: String },
    NotFound { resource: String, id: String },
    PermissionDenied { message: String },
    UnsupportedCapability {
        host: HostKind,
        capability: String,
        alternative: Option<String>,
    },
    Config { message: String },
    Workspace { message: String },
    Runtime { message: String },
    Tool { message: String },
    Io { message: String },
}
```

Desktop adapter 可以转成 GUI 错误。CLI adapter 可以转成 stderr + exit code。业务层不应返回 `String` 错误作为主接口。

## Output Contract

所有 CLI 命令必须支持至少一种机器可读输出：

```text
--output human
--output json
--output yaml
```

流式命令额外支持：

```text
--stream jsonl
```

同一 core response 被不同 renderer 展示，不允许命令 handler 为 human/json 分叉业务逻辑。

## 安全与权限

危险操作统一经过 core command policy：

```rust
pub struct CommandPolicy {
    pub confirmation: ConfirmationPolicy,
    pub filesystem_scope: FilesystemScope,
    pub tool_policy: ToolExecutionPolicy,
    pub host_kind: HostKind,
}
```

Desktop 的确认可以来自 GUI dialog。CLI 的确认来自 TTY prompt，或显式参数：

```text
--yes
--confirm
--dry-run
```

无 TTY 的 CLI 默认不能阻塞等待确认，必须失败并提示传入 `--yes` 或配置 policy。

## 删除项

目标架构完成后，应不存在：

```text
src/apps/server
src/crates/api-layer
CLI 独立 session JSON 存储与本地历史主路径
CLI 自建 agentic runtime 组装逻辑
CLI 主配置 config.toml 作为业务配置来源
Web UI 默认 WebSocket backend adapter
server RPC dispatcher
WebSocketTransportAdapter 作为产品路径
```

`src/apps/cli/src/session.rs` 可以保留为 TUI 临时转录和视图状态模型，但不能承担持久化 session 来源。`src/apps/cli/src/agent/agentic_system.rs` 可以保留为 CLI adapter，但不能再复制 core agentic runtime 初始化图。

`bitfun-transport` 如果保留，应收窄为 Desktop / CLI host event adapter；如果 CLI event sink 需要共享 trait，应把 trait 移入 core runtime，不保留 server 语义。

## 最终架构图

```text
                         ┌──────────────────────────┐
                         │        React Web UI       │
                         │     Desktop experience    │
                         └─────────────┬────────────┘
                                       │
                                       │ Tauri invoke/events
                                       ▼
┌────────────────────────────────────────────────────────────────┐
│                         Desktop Host                            │
│  Tauri adapter / DesktopHost capabilities / DesktopEventSink     │
└───────────────────────────────┬────────────────────────────────┘
                                │
                                │ CommandContext + SparoRuntime
                                ▼
┌────────────────────────────────────────────────────────────────┐
│                      Shared Core Command Layer                   │
│ session config workspace fs terminal mcp apps skills memory logs │
└───────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────┐
│                         Shared Core Runtime                      │
│ agentic services tools persistence storage config paths events   │
└───────────────────────────────▲────────────────────────────────┘
                                │
                                │ CommandContext + SparoRuntime
┌───────────────────────────────┴────────────────────────────────┐
│                           CLI Host                              │
│ clap commands / TUI / stdout-json-yaml / CliHost / CliEventSink  │
└────────────────────────────────────────────────────────────────┘
```

## 成功标准

架构完成的判定不是“CLI 能聊天”，而是：

- Desktop GUI 和 CLI 读写同一份 global config。
- Desktop GUI 和 CLI 读写同一份 workspace/session persistence。
- Desktop GUI 和 CLI 使用同一个 runtime builder。
- Desktop GUI 和 CLI 使用同一批 command service。
- Desktop Tauri command 中不再承载业务逻辑。
- CLI 不再有独立 session/config/logging 主路径。
- GUI 后端能力都有 CLI command 覆盖，明确列入 GUI-only 的除外。
- 不存在 server / api-layer / WebSocket RPC 兼容包袱。
- CLI 的 human/json/yaml/jsonl 输出由 renderer 层负责，不污染业务 handler。

这就是最终架构目标：**Desktop 和 CLI 是两个一等 Host；core command runtime 是唯一业务后端；server-era 抽象彻底删除；配置、日志、会话、存储全部统一。**
