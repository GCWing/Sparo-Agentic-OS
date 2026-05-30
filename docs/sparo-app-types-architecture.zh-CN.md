# Sparo 应用形态架构设计

> Bridge App、Agent App、Live App 的最终协作模型与 Bridge 能力包规范，详见
> [Bridge 能力平台架构设计](./bridge-capability-platform-architecture.zh-CN.md)。

Sparo OS 中有三种应用形态：

- **Live App**：面向用户的交互应用。
- **Agent App**：基于 Sparo 原生 Agent 体系定制的智能体应用。
- **Bridge App**：把传统应用、外部运行时或服务桥接成 Agent App 可使用能力的桥接应用。

三者可以共享应用目录、权限、安装、导入导出和后端调用机制，但运行时模型不同。

## 核心定位

### Live App

Live App 是用户体验层。

它负责应用 UI、交互流程、状态展示、表单、仪表盘、画布和具体工作流。Live App 不应该直接管理任意 Agent 会话。当它需要智能后端能力时，应调用声明好的后端动作。

```ts
await app.backend.call('backendId.actionName', input)
```

典型场景：

- 交互式工作台
- 可视化编辑器
- 报告或仪表盘
- 工作流应用
- 面向特定领域的用户工具

运行时模型：

```text
用户 -> Live App UI -> 声明式后端动作 -> 后端结果/事件
```

### Agent App

Agent App 是 Sparo 原生 Agent 的产品化封装。

它运行在 Sparo 自己的 Agent 系统中，使用 Sparo 的 prompt、tools、skills、subagents、memory、session 和 event 机制。它的目标是把一个专用助手包装成一等 Sparo Agent。

典型资产：

- manifest
- agent prompt
- tool allowlist
- skills
- subagents
- service actions
- examples

典型场景：

- 文件整理助手
- 代码审查助手
- 调研助手
- 文档生成助手
- 领域专属 Sparo 助手

运行时模型：

```text
Sparo Agent Engine -> model -> Sparo tools/skills/subagents -> Sparo events
```

### Bridge App

Bridge App 是传统应用到 Agent App 的桥接层。

它把已有软件、服务、SDK、CLI、GUI、daemon 或协议包装成 Sparo 可使用的标准能力，再由 Agent App 把这些能力产品化为可对话、可观察、可接管的用户体验。Bridge App 通常需要较多程序化处理，因为它要处理协议适配、状态管理、运行时集成、事件转换和异常恢复。

典型桥接类型：

- CLI bridge
- SDK bridge
- GUI bridge
- HTTP/service bridge
- MCP bridge
- local daemon bridge

典型场景：

- Cursor SDK Bridge
- Claude Code CLI Bridge
- Office 桌面自动化 Bridge
- 企业 ERP GUI Bridge
- Jira/Notion/Slack SDK Bridge
- 内部命令行工具 Bridge

运行时模型：

```text
Sparo Bridge Runtime -> external adapter -> external app/service/runtime -> bridge events -> Sparo events
```

## 三者关系

```text
Sparo Apps
- Live App
  - 面向用户的应用 UI 和工作流
- Agent App
  - Sparo 原生 Agent 应用
- Bridge App
  - 外部应用/运行时适配器
```

Live App 可以调用 Agent App 或 Bridge App 作为后端。Agent App 可以调用 Bridge App 暴露出的能力。Bridge App 本身应作为安装、授权、诊断、测试和绑定对象被用户管理；完成业务任务时，默认入口应是包装后的 Agent App，而不是裸 Bridge action。

```text
Live App
  -> app.backend.call()
  -> Agent App 或 Bridge App
  -> Sparo Session / Event / UI

Agent App
  -> Sparo tools / skills / subagents

Bridge App
  -> CLI / SDK / GUI / HTTP / MCP
  -> Agent App wrapper
```

## 统一 App Surface

应用可以暴露一个或多个 surface。

```json
{
  "surfaces": {
    "launchableApp": true,
    "agent": true,
    "tool": true,
    "liveAppBackend": true
  }
}
```

含义：

- `launchableApp`：可以在应用目录中展示和打开。
- `agent`：可以作为会话 Agent 被选择。
- `tool`：可以被其他 Agent 调用。
- `liveAppBackend`：可以被 Live App 通过 `app.backend.call()` 调用。

Agent App 和 Bridge App 都可以暴露 agent、tool、backend surface，但运行时应保持独立。

## 运行时边界

### Agent App Runtime

Agent App 走 Sparo 原生 Agent 执行路径。

```text
Agent App manifest
-> Agent registry
-> Sparo execution engine
-> model round
-> tool execution
-> AgenticEvent
```

### Bridge App Runtime

Bridge App 走专用外部运行时路径。

```text
Bridge App manifest
-> Bridge registry
-> Bridge runtime
-> adapter worker/process
-> external software
-> bridge event stream
-> AgenticEvent
```

Bridge Runtime 负责：

- 依赖安装和检查
- worker 或进程启动
- run 生命周期管理
- 事件流转发
- 取消
- 恢复
- 权限控制
- 密钥注入
- 外部错误归一化

## Live App 后端绑定

Live App 的后端绑定应同时支持 Agent App 和 Bridge App。

```json
{
  "backends": [
    {
      "id": "research",
      "kind": "agentApp",
      "appId": "research-agent",
      "actions": [
        {
          "name": "summarize",
          "inputSchema": {},
          "outputSchema": {}
        }
      ]
    },
    {
      "id": "cursor",
      "kind": "bridgeApp",
      "appId": "cursor-sdk-bridge",
      "actions": [
        {
          "name": "run",
          "inputSchema": {},
          "outputSchema": {}
        }
      ]
    }
  ]
}
```

Live App 代码不需要关心后端类型，统一使用同一种调用方式。

```ts
await app.backend.call('cursor.run', input)
```

## Agent App 包结构

Agent App 包是一个 Sparo 原生 Agent 定义。它应该轻量、声明式，并专注于塑造 Sparo Agent 的行为。

```text
agent-app/
- manifest.json
- agent.md
- examples.json
- tools/
  - fetch-data.tool.json
  - fetch-data.js
```

核心文件：

- `manifest.json`：身份信息、元数据、tools、skills、subagents、service actions 和 examples。
- `agent.md`：该应用 Agent 的系统 prompt 模板。
- `examples.json`：在 UI 中展示的开场示例。
- `tools/`：可选的应用内 runtime tools。

Agent App 应优先复用 Sparo 已有 tools、skills 和 subagents。应用内 runtime tool 适合处理很窄的辅助逻辑，不适合包装大型外部运行时。大型 SDK、CLI、GUI 或 daemon 集成应建模为 Bridge App。

Manifest 示例：

```json
{
  "schemaVersion": 1,
  "id": "research-agent",
  "name": "Research Agent",
  "description": "A Sparo-native agent for structured research tasks.",
  "icon": "search",
  "category": "research",
  "model": "primary",
  "readonly": false,
  "enabled": true,
  "tools": ["Read", "Grep", "Glob", "WebSearch"],
  "skills": ["research-notes"],
  "subagents": ["FileFinder"],
  "serviceActions": [
    {
      "name": "summarize",
      "description": "Summarize provided source material into structured notes.",
      "inputSchema": {},
      "outputSchema": {},
      "promptTemplate": "Summarize the following material and return concise structured notes.\n\nInput:\n{{input}}",
      "toolPolicy": ["Read", "Grep", "Glob"]
    }
  ],
  "examples": [
    {
      "title": "Summarize a folder",
      "prompt": "Read the selected folder and summarize the important findings."
    }
  ]
}
```

## Agent App Service Actions

Service action 是 Agent App 暴露出的结构化入口。

它让 Live App 和其他平台 surface 可以调用 Agent App，而不是依赖自由聊天文本。一个 service action 会把结构化输入转换成受控 prompt，并期望得到结构化或符合契约的输出。

Service action 字段：

- `name`：稳定动作名。
- `description`：动作说明。
- `inputSchema`：输入契约。
- `outputSchema`：输出契约。
- `promptTemplate`：动作专属指令模板。
- `toolPolicy`：可选的动作级工具限制。
- `memory`：可选的动作级记忆行为。

调用模型：

```text
Live App backend call
-> Agent App service action
-> action prompt template
-> Sparo Agent Engine
-> result/events
```

Agent App service action 适合需要继续使用 Sparo model、tools、memory 和 session 基础设施的智能任务。如果实现主体是外部 SDK、CLI 或 GUI，应改用 Bridge App action。

## Agent App 运行规则

Agent App 的行为应保持在 Sparo 原生 Agent 模型内。

设计规则：

- 以 prompt、tools、skills、subagents 作为主要定制点。
- 应用内 JavaScript tool 应保持小而专用。
- 不要在 Agent App tool 中嵌入大型 SDK wrapper 或长期运行的外部进程管理器。
- Live App 需要结构化后端能力时，优先暴露 service action。
- 当核心价值来自外部软件行为时，使用 Bridge App。
- UI 可见文本需要进入本地化流程。
- 工具权限应显式且最小化。

Agent App 可以暴露这些 surface：

- `agent`：用户以该应用作为当前 Agent 开始会话。
- `tool`：其他 Agent 调用该应用的部分能力。
- `liveAppBackend`：Live App 调用声明好的 service actions。

## Bridge App 包结构

Bridge App 包应包含代码、manifest、schema、依赖和可选资源。

```text
bridge-app/
- manifest.json
- README.md
- package.json
- pnpm-lock.yaml
- src/
  - main.ts
  - adapters/
  - schemas/
- assets/
```

Manifest 示例：

```json
{
  "schemaVersion": 1,
  "id": "cursor-sdk-bridge",
  "name": "Cursor SDK Bridge",
  "description": "Run Cursor agents through the Cursor TypeScript SDK.",
  "kind": "sdk",
  "runtime": {
    "language": "typescript",
    "entry": "src/main.ts",
    "packageManager": "pnpm"
  },
  "surfaces": {
    "agent": true,
    "tool": true,
    "liveAppBackend": true
  },
  "actions": [
    {
      "name": "run",
      "description": "Start an external agent run.",
      "inputSchema": {},
      "outputSchema": {},
      "streaming": true,
      "cancelable": true,
      "resumable": true
    }
  ],
  "permissions": {
    "fs": ["workspace"],
    "net": ["https://api.cursor.com"],
    "shell": [],
    "gui": [],
    "secrets": ["CURSOR_API_KEY"]
  }
}
```

## Bridge 事件协议

Bridge worker 应输出结构化事件，而不是非结构化文本。

```json
{ "type": "run.started", "runId": "run_123" }
{ "type": "text.delta", "text": "Working on the task..." }
{ "type": "thinking.delta", "text": "Inspecting repository state." }
{ "type": "tool.started", "name": "shell", "input": {} }
{ "type": "tool.completed", "name": "shell", "output": {} }
{ "type": "artifact.created", "artifact": {} }
{ "type": "approval.required", "request": {} }
{ "type": "run.completed", "output": {} }
{ "type": "run.failed", "error": {} }
```

Sparo 负责把 Bridge 事件映射到现有 session、FlowChat、tool card 和 AgenticEvent。

## 建议核心模块

```text
src/crates/core/src/app_platform/
- catalog/
- manifest/
- permissions/
- surfaces/
  - agent_surface.rs
  - tool_surface.rs
  - backend_surface.rs
```

```text
src/crates/core/src/agent_app/
- manifest.rs
- manager.rs
- registry.rs
- runtime_tools.rs
- service_actions.rs
```

```text
src/crates/core/src/bridge_app/
- manifest.rs
- manager.rs
- registry.rs
- events.rs
- runtime/
  - mod.rs
  - cli_adapter.rs
  - sdk_adapter.rs
  - gui_adapter.rs
  - service_adapter.rs
  - worker_protocol.rs
```

```text
src/crates/core/src/live_app/
- Live App runtime and backend bindings
```

## 权限模型

Bridge App 权限应在包级声明，并由 Bridge Runtime 执行。

权限类型：

- `fs`：workspace、app storage、指定文件
- `net`：允许的 host 或 URL 前缀
- `shell`：允许的命令
- `gui`：允许自动化的应用、窗口或范围
- `secrets`：命名密钥句柄
- `workspace`：workspace 访问模式

Agent App 权限主要来自它声明的 Sparo tools、skills、subagents 和 runtime tools。Bridge App 权限主要来自外部运行时声明，并由 Bridge Runtime 统一约束。

密钥应由 runtime 注入，不应写入日志、manifest、导出包或工具输出。

## 演进路径

1. 保留 Agent App 作为 Sparo 原生 Agent 定制路径。
2. 新增 Bridge App，作为与 Agent App 并列的应用类型。
3. 将 Live App 后端绑定从仅支持 Agent App 泛化为 `kind + appId`。
4. 完善 Agent App 的 service action、runtime tool 和能力配置。
5. 先实现 SDK 和 CLI 类型的 Bridge Runtime。
6. 以 Cursor SDK Bridge 作为第一个 SDK Bridge 参考包。
7. 基于 ComputerUse 和 WebDriver 能力补充 GUI Bridge。
8. 增加 Bridge App Studio，用于生成、测试和调试 Bridge App 包。

## 最终模型

```text
Live App
  = 面向用户的应用界面和工作流

Agent App
  = Sparo 原生 Agent 应用

Bridge App
  = 外部软件能力适配器
```

三者共同构成 Sparo App 平台，但各自保持清晰的运行时职责。
