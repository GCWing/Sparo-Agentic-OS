# Bridge 能力平台架构设计

本文定义 Sparo OS 中 Bridge App、Agent App、Live App 的最终协作模型。

核心结论：

- **Bridge App 的主要作用，是把传统应用、外部运行时和服务桥接成可被 Agent App 使用的能力。**
- **Bridge App 是可管理、可安装、可验证、可复用的应用桥接包，不是直接面向业务任务的产品应用。**
- **Agent App 是面向用户的对话式智能应用。**
- **Live App 是面向用户的可视化工作流应用。**
- **Bridge App 有明确的用户管理心智和 AI Builder 构建心智；完成业务任务时，用户主要面对由 Bridge 包装出来的 Agent App，必要时才面对 Live App。**

也就是说：

```text
任务使用心智:
  Agent App / Live App

能力管理与构建心智:
  Bridge App 负责把传统应用桥接成 Agent App 可消费的能力

运行时职责:
  Bridge Runtime 负责外部 SDK / CLI / GUI / daemon / service 的生命周期、权限、事件和恢复。
```

## 设计目标

Bridge 能力平台要同时满足几类需求：

1. 普通用户不需要理解 SDK action、GUI 点击、CLI 参数或 daemon 协议。
2. 普通用户需要能看见、安装、启停、检查、授权、配置和卸载自己的 Bridge 能力。
3. Agent App 能把 Bridge 能力包装成用户可直接对话的产品化智能体。
4. Live App 能在需要可视化工作流时消费同一个 Bridge 能力。
5. AI Builder 需要能创建、测试、调试、包装和复用 Bridge。

因此 Bridge App 不能消失，也不应仅仅降级成某个 Agent App 的内部实现文件。它应该是平台级应用桥接资产：负责把传统应用变成 Agent App 可以声明式引用、FlowChat 可以自然呈现、Live App 可以后端调用的能力。

## 当前代码基础

当前代码中已经存在可复用的骨架：

- `src/crates/core/src/agent_app/manifest.rs`
  - `AgentAppManifest` 已支持 `tools`、`skills`、`subagents`、`service_actions`。
- `src/crates/core/src/agent_app/manager.rs`
  - `AgentAppAgent` 已能注册进 `AgentRegistry`，被 FlowChat 作为 `agentType` 使用。
- `src/crates/core/src/bridge_app/manifest.rs`
  - `BridgeAppManifest` 已支持 `kind`、`runtime`、`actions`、`permissions`。
- `src/crates/core/src/bridge_app/manager.rs`
  - `BridgeAppManager::run_action` 已能启动 worker 并解析 Bridge 事件，但仍是一次性 `wait_with_output` 模型。
- `src/crates/core/src/live_app/types.rs`
  - `LiveAppBackendBinding` 已支持 `kind: AgentApp | BridgeApp`。
- `src/crates/core/src/live_app/bridge_builder.rs`
  - `window.app.backend.call()` 已作为 Live App 的统一后端调用入口。
- `src/apps/desktop/src/api/live_app_api.rs`
  - `live_app_backend_call` 已能根据绑定调用 Agent App service action 或 Bridge App action。
- `src/web-ui/src/flow_chat`
  - FlowChat 已有 session、turn、event listener、tool cards、cancel、history 和 external session 展示能力。
- `src/crates/core/src/agentic/tools/implementations/computer_use_tool.rs`
  - GUI 自动化能力已作为 Sparo 原生工具存在，可用于 GUI Bridge 或 GUI Agent。

现状的问题不是缺少起点，而是边界还没有收敛成统一规范。

## 最终心智模型

### Live App

Live App 是用户直接操作的可视化应用。

它负责：

- UI
- 表单
- 仪表盘
- 画布
- 工作流编排
- 结果可视化

它不应该直接管理任意外部 runtime，也不应该让用户理解 Bridge action。它只声明后端绑定，并通过统一接口调用。

```ts
await app.backend.call('cursor.start', input);
```

### Agent App

Agent App 是用户可对话的智能应用。

在 Bridge 体系中，Agent App 是传统应用桥接后的主要产品化形态。它把 Bridge 暴露的 SDK / CLI / GUI / service 能力包装成自然语言可操作的助手，让用户像使用 Cursor GUI 一样表达目标、观察进度、接管或继续，而不是直接选择底层 action。

它负责：

- prompt
- tools
- skills
- subagents
- memory
- examples
- service actions
- 引用外部 Bridge 能力

用户在 FlowChat 中选择 Agent App，然后用自然语言表达目标。

```text
用户 -> FlowChat -> Cursor Agent App -> Bridge capability / Sparo tools -> FlowChat events
```

### Bridge App

Bridge App 是用户可管理、AI 可构建的应用桥接包。

它的主要作用不是成为一个新的业务任务入口，而是把传统应用、外部 SDK、CLI、GUI、daemon、HTTP service 或 MCP server 变成 Agent App 可消费的标准能力。换句话说，Bridge App 是“传统应用 -> Agent App”的桥接层。

它负责：

- SDK 适配
- CLI 适配
- GUI 自动化封装
- HTTP / service 适配
- daemon 管理
- MCP 包装
- 依赖安装与检查
- 密钥声明与注入
- 权限声明与执行
- 标准事件协议
- run 生命周期
- 取消、恢复、状态查询
- artifact 产出

Bridge App 可以被 Agent App 或 Live App 消费，也可以在管理台中被普通用户查看、安装、启动、停止、检查、测试和授权。区别在于：Bridge 的管理入口面向能力治理和桥接配置；业务任务入口应优先由 Agent App 承载，只有当任务天然需要专门 UI 时才由 Live App 承载。

## 平台分层

```text
Sparo App Platform

User Surfaces
  - FlowChat
  - Live App iframe UI
  - App Catalog / Management

Product Apps
  - Agent App
  - Live App

Application Bridge Packages
  - Bridge App
  - Skills
  - Runtime Tools
  - MCP Tools

Runtimes
  - Agent Runtime
  - Live App Runtime
  - Bridge Runtime

External Systems
  - SDK
  - CLI
  - GUI desktop apps
  - HTTP services
  - local daemons
  - cloud agents
```

用户完成任务时主要接触 `Product Apps`。用户安装、检查、授权、修复传统应用桥接能力时接触 `Application Bridge Packages`，AI Builder 则在这里创建 Bridge 并生成 Agent App wrapper。

## Bridge App 规范

Bridge App 应从裸 action 包升级为应用桥接包。

推荐 manifest：

```json
{
  "schemaVersion": 1,
  "id": "cursor-sdk",
  "name": "Cursor SDK",
  "description": "Bridge Cursor SDK agents into Sparo OS.",
  "kind": "sdk",
  "runtime": {
    "language": "javascript",
    "entry": "worker.js",
    "packageManager": "npm"
  },
  "capabilities": [
    {
      "id": "cursor.agent",
      "title": "Cursor Agent",
      "description": "Start, observe, resume, and cancel Cursor agent runs.",
      "category": "externalAgent",
      "actions": [
        "health",
        "setup",
        "start",
        "status",
        "resume",
        "cancel",
        "artifacts"
      ],
      "streaming": true,
      "cancelable": true,
      "resumable": true,
      "usableBy": ["agentApp", "liveAppBackend"],
      "inputSchema": {},
      "outputSchema": {}
    }
  ],
  "permissions": {
    "fs": ["{workspace}", "{app}"],
    "net": ["https://api.cursor.com", "https://github.com"],
    "shell": ["git", "npm"],
    "gui": [],
    "secrets": ["CURSOR_API_KEY"]
  }
}
```

### `kind`

Bridge kind 表示主要外部运行时类型：

- `sdk`
- `cli`
- `gui`
- `service`
- `mcp`
- `daemon`

`kind` 不决定用户入口，只决定 Bridge Runtime 选择的适配策略。

### `capabilities`

`capabilities` 是 Bridge App 暴露给 Agent App 和 Live App 的稳定能力契约。

一个 Bridge App 可以有多个 capability。例如 Office Bridge 可以同时暴露：

- `office.word`
- `office.excel`
- `office.powerpoint`

Cursor Bridge 可以暴露：

- `cursor.sdkAgent`
- `cursor.guiAgent`

### `actions`

Bridge action 应标准化为生命周期动作，而不是任意散落的按钮式操作。

推荐标准动作：

- `health`
- `setup`
- `start`
- `status`
- `resume`
- `cancel`
- `artifacts`
- `dispose`

Bridge 可以额外暴露领域动作，但领域动作应被 capability schema 描述，并优先供 Agent App / Live App 消费。

### `permissions`

Bridge 权限由 Bridge Runtime 强制执行，不应只停留在 manifest 展示。

权限维度：

- `fs`
  - `{workspace}`
  - `{app}`
  - `{home}`
  - `{user-selected}`
  - 绝对路径
- `net`
  - host 或 URL 前缀 allowlist
- `shell`
  - 命令 allowlist
- `gui`
  - 允许自动化的应用、bundle id、窗口标题、进程或系统范围
- `secrets`
  - 命名密钥句柄，不允许写入 manifest、日志或导出包

## Bridge Runtime

当前 `BridgeAppManager::run_action` 是一次性进程执行模型。最终应升级为标准 Bridge Runtime。

### 运行时职责

```text
Bridge Runtime
  - package discovery
  - manifest validation
  - dependency health/setup
  - permission enforcement
  - secret injection
  - worker/daemon lifecycle
  - run registry
  - streaming event forwarding
  - cancel/status/resume
  - artifact store
  - error normalization
```

### Run Registry

Bridge Runtime 应维护 Bridge run，而不是只返回一个同步结果。

```text
BridgeRun
  - run_id
  - bridge_id
  - capability_id
  - action
  - consumer_kind
  - consumer_id
  - workspace_path
  - status
  - started_at
  - updated_at
  - external_run_ref
  - artifacts
```

`consumer_kind` 可取：

- `agentApp`
- `liveApp`
- `management`
- `system`

### Worker Protocol

worker 输入应包含 capability 和 consumer 信息。

```json
{
  "bridgeId": "cursor-sdk",
  "capabilityId": "cursor.agent",
  "action": "start",
  "runId": "run_123",
  "input": {},
  "workspacePath": "D:/workspace/project",
  "consumer": {
    "kind": "agentApp",
    "id": "internal-agent-runtime",
    "sessionId": "session_123",
    "turnId": "dialog_123"
  }
}
```

worker 输出应是 NDJSON 事件：

```json
{ "type": "run.started", "runId": "run_123" }
{ "type": "text.delta", "text": "Inspecting repository..." }
{ "type": "tool.started", "name": "cursor.edit", "input": {} }
{ "type": "artifact.created", "artifact": { "kind": "pullRequest", "url": "https://..." } }
{ "type": "approval.required", "request": {} }
{ "type": "run.completed", "output": {} }
```

Bridge Runtime 负责把这些事件转成：

- FlowChat `AgenticEvent`
- Live App `backend:event`
- 管理台 run log

## Bridge App 提供工具扩展，Agent App 作为内部消费者

Bridge App 不只是 capability/action 的集合，也应该携带面向 Agentic runtime 的工具扩展声明。这样 `cursor-sdk` 作为一个目录包发给别人时，运行适配器、capability、工具定义和 FlowChat 卡片定义都在同一个 Bridge App bundle 里。

推荐扩展 `BridgeAppManifest`：

```json
{
  "id": "cursor-sdk",
  "name": "Cursor SDK",
  "capabilities": [
    {
      "id": "cursor.agent",
      "actions": ["health", "setup", "start", "status", "resume", "cancel", "artifacts"]
    }
  ],
  "tools": [
    {
      "name": "CursorAgent",
      "capabilityId": "cursor.agent",
      "action": "start",
      "inputSchema": {},
      "ui": {
        "card": {
          "kind": "appDefined",
          "title": "Cursor Agent",
          "family": "bridge-app"
        }
      }
    }
  ]
}
```

运行时注册出的工具名使用 Bridge App 命名空间，例如 `bridgeapp__cursor-sdk__CursorAgent`。Agent App 可以在内部把它作为工具策略来消费，但不需要再为 Cursor 额外生成一个用户可见的 Agent App 实体。Agent App 中不应该直接嵌入大型 SDK wrapper、长期外部进程管理器，或继续暴露 `Read` / `Grep` / `Bash` / `GetFileDiff` 这类底层工具来模拟 Cursor。

### CursorAgent 与 BridgeCall 工具

Cursor Agent 使用 Bridge App 声明出的高封装工具：

```text
bridgeapp__cursor-sdk__CursorAgent
  input:
    prompt
    mode: local | cloud
    runId
  output:
    run_id
    status
    output
    artifacts
```

通用 Bridge App / Agent App Builder 仍可使用底层工具：

```text
BridgeCall
  input:
    bridge_id
    capability_id
    action
    input
    mode
  output:
    run_id
    status
    output
    artifacts
```

`BridgeCall` 只暴露给有权限的 Agent App 或 Builder，不直接作为 Cursor Agent 的用户任务工具面。

### FlowChat 展示

Bridge 事件应映射成 FlowChat tool cards。

推荐卡片：

- `BridgeRunCard`
- `ExternalAgentRunCard`
- `GuiObservationCard`
- `BridgeArtifactCard`
- `PullRequestCard`
- `DiffReviewCard`

用户看到的是任务进展、变更和结果，不是 Bridge action。

## Live App 消费 Bridge

Live App 是 Bridge 的另一等消费者。

当前已有：

```ts
await app.backend.call('backendId.actionName', input)
```

推荐把绑定从 action 直接绑定升级为 capability 绑定。

```json
{
  "backends": [
    {
      "id": "cursor",
      "kind": "bridgeApp",
      "appId": "cursor-sdk",
      "capabilityId": "cursor.agent",
      "actions": [
        {
          "name": "start",
          "inputSchema": {},
          "outputSchema": {}
        },
        {
          "name": "cancel",
          "inputSchema": {},
          "outputSchema": {}
        }
      ]
    }
  ]
}
```

Live App 仍然只使用统一调用：

```ts
const run = await app.backend.call('cursor.start', input, {
  entityId: cardId,
  idempotencyKey: `cursor:${cardId}`
});

app.backend.onEvent((event) => {
  if (event.backendId === 'cursor') {
    renderCursorProgress(event);
  }
});
```

Live App 不需要知道 worker、SDK、GUI 坐标、CLI 参数等内部细节。

## GUI Bridge

GUI Bridge 是 Bridge App 的重要类型，不应被简化成 ComputerUse 的普通用例。

GUI Bridge 应封装传统桌面应用的操作知识：

- 应用启动
- 窗口定位
- 可访问性树读取
- OCR/截图观察
- 菜单和快捷键
- 点击/输入/拖拽
- 状态验证
- 错误恢复
- 用户接管

底层可以复用：

- `ComputerUse`
- `ControlHub`
- WebDriver
- OS-specific accessibility API
- shell / AppleScript / PowerShell

但对上暴露的是稳定 capability：

```json
{
  "id": "cursor-gui",
  "kind": "gui",
  "capabilities": [
    {
      "id": "cursor.guiAgent",
      "category": "guiAgent",
      "actions": ["health", "start", "status", "cancel", "artifacts"],
      "usableBy": ["agentApp", "liveAppBackend"]
    }
  ],
  "permissions": {
    "gui": [
      {
        "appName": "Cursor",
        "bundleId": "com.todesktop.230313mzl4w4u92",
        "automation": ["observe", "keyboard", "mouse", "accessibility"]
      }
    ]
  }
}
```

用户不应直接看到 `click`、`type_text`、`screenshot` 这些动作。它们是 GUI Bridge 内部的执行细节。

## Cursor 示例

推荐最终产品结构：

```text
Cursor Bridge Packages
  - cursor-sdk
  - cursor-gui

Cursor Agent App
  - 用户 FlowChat 入口
  - 自动选择 sdk / gui / hybrid
  - 展示任务、PR、diff、测试结果

Cursor Live App
  - 可视化任务工作台
  - 多 run 列表
  - PR / diff / log 面板
  - backend 绑定 cursor bridge capability
```

运行策略：

```text
短任务、本地仓库:
  Cursor Agent -> cursor-sdk local

长任务、需要 PR:
  Cursor Agent -> cursor-sdk cloud

用户明确要求操作 Cursor 桌面:
  Cursor Agent -> cursor-gui

SDK run 需要人工接管:
  Cursor Agent -> Cursor GUI handoff
```

## Bridge 管理台

Bridge App 需要独立管理心智。这里的管理者不是另一个角色，而是普通用户在管理自己的传统应用桥接包时的心智；AI Builder 则在同一个体系下负责创建 Bridge 并包装成 Agent App。

Apps 中的 Bridge 区域应定位为：

```text
Bridge App Management
```

而不是：

```text
Run this app as a user workflow
```

管理台应支持：

- 安装 Bridge
- 创建 Bridge
- 验证 manifest
- 查看权限
- 配置 secrets
- 安装依赖
- 运行 health/setup
- 测试 capability action
- 查看 run logs
- 查看 consumers
- 生成 Agent App wrapper
- 生成 Live App backend binding
- 导入导出包

Bridge Runner 可以保留，但应明确是“测试台 / 调试台 / 手动运维入口”，不是普通用户完成业务任务的默认入口。

## Bridge Studio

Bridge Studio 是给用户和 AI Builder 创建 Bridge 的工具。它的默认产物不应止步于 Bridge 包，而应继续生成可用的 Agent App wrapper；这样传统应用被桥接后，用户默认进入 FlowChat 中的 Agent App，而不是 Bridge Runner。

模板：

- SDK Bridge
- CLI Bridge
- GUI Bridge
- HTTP Service Bridge
- Daemon Bridge
- MCP Bridge

Studio 产物：

```text
bridge-app/
  manifest.json
  README.md
  package.json
  worker.js 或 src/main.ts
  schemas/
  assets/
  tests/

agent-app-wrapper/
  manifest.json
  agent.md
  examples.json

live-app-binding-example/
  backend snippet
  UI usage snippet
```

AI Builder 可以基于传统应用描述生成 Bridge 包，再生成 Agent App 或 Live App 使用它。

推荐默认链路：

```text
传统应用描述
  -> Bridge Studio
  -> Bridge App
  -> Agent App wrapper
  -> FlowChat 用户入口
```

Live App binding 是可选增强，用于需要专门可视化界面、仪表盘、表单或画布的场景。

## App Catalog 信息架构

推荐最终信息架构：

```text
Apps
  - Live Apps
  - Agent Apps
  - Bridge Apps

Agent Picker / FlowChat
  - 只显示 Agent App 和内置 Agent
  - 不显示普通 Bridge App

Live App Gallery
  - 显示 Live App
  - Live App 详情显示所依赖的 Agent/Bridge 后端

Bridge Management
  - 显示 Bridge 包、capabilities、health、权限、consumers、generated Agent Apps
```

Bridge 仍然是 App Catalog 的一类，但它的 CTA 应是：

- Manage
- Test
- Generate Agent App
- Bind to Agent App
- Bind to Live App

而不是：

- Start Chat
- Run Task

## 权限与安全

### 权限合成

当 Agent App 或 Live App 使用 Bridge 时，有效权限应为：

```text
effective_permissions =
  consumer_declared_permissions
  ∩ bridge_declared_permissions
  ∩ user_grants
  ∩ runtime_policy
```

如果 Agent App 想调用 Cursor Bridge，但 Cursor Bridge 没有声明 GitHub 网络权限，则调用应失败。

如果 Live App 想调用 GUI Bridge，但用户没有授予 GUI 自动化权限，则调用应进入 approval 或 failed 状态。

### Secrets

Secret 只能通过命名句柄使用。

```json
{
  "secrets": ["CURSOR_API_KEY"]
}
```

规则：

- 不写入 manifest
- 不写入 logs
- 不进入 exported package
- 不回传给 iframe
- 不进入 FlowChat 文本
- 只在 Bridge Runtime 启动 worker 时注入

### GUI 权限

GUI 权限必须细化：

- app identity
- allowed actions
- foreground requirement
- confirmation policy
- screenshot retention policy
- user takeover policy

高风险动作应进入 `approval.required`。

## 事件映射

Bridge 事件应统一映射到不同 consumer。

```text
Bridge Event
  -> Agent App consumer
      -> AgenticEvent
      -> FlowChat tool card

  -> Live App consumer
      -> liveapp-backend-event
      -> app.backend.onEvent()

  -> Management consumer
      -> run log
      -> diagnostics panel
```

标准事件类型：

- `run.started`
- `run.status`
- `text.delta`
- `thinking.delta`
- `tool.started`
- `tool.delta`
- `tool.completed`
- `artifact.created`
- `approval.required`
- `approval.resolved`
- `run.completed`
- `run.failed`
- `run.cancelled`

Artifact 类型：

- `file`
- `diff`
- `screenshot`
- `log`
- `url`
- `pullRequest`
- `branch`
- `externalRun`

## 代码演进路线

### P0: 信息架构与命名收敛

- 将 Apps 中 Bridge 区域定位为管理台。
- Bridge Runner 标记为测试/调试工具。
- Agent Picker 不直接展示 Bridge。
- Live App 后端文档明确 Bridge 是可声明后端。

### P1: Bridge schema

- 在 `src/crates/core/src/bridge_app/manifest.rs` 增加 `capabilities`。
- 保留 `actions` 作为 legacy 或 capability 的展开形式。
- 增加 consumer、artifact、lifecycle 字段。
- 更新前端 `BridgeAppAPI.ts` 类型。

### P2: Bridge Runtime 标准化

- 将 `BridgeAppManager::run_action` 拆成：
  - `start_run`
  - `stream_run_events`
  - `cancel_run`
  - `get_run`
  - `list_runs`
  - `get_artifacts`
- 增加 in-memory run registry。
- 后续再加持久化 run history。

### P3: Agent App 引用 Bridge

- 扩展 `AgentAppManifest`：
  - `bridgeCapabilities`
- 新增 `BridgeCall` tool。
- Agent App service action 可调用 Bridge capability。
- FlowChat 增加 Bridge tool cards。

### P4: Live App 后端 capability binding

- 扩展 `LiveAppBackendBinding`：
  - `capabilityId`
- `live_app_backend_call` 调用 Bridge 时使用 capability/action。
- `useLiveAppBridge` 继续转发 `backend:event`。
- 增加 `backend.status` / `backend.cancelRun` 的统一 API。

### P5: GUI Bridge

- 新增 GUI Bridge adapter。
- 复用 `ComputerUse`、`ControlHub`、WebDriver 和 OS accessibility。
- 支持 GUI permission enforcement。
- 增加 GUI observation/artifact event。

### P6: Bridge Studio

- 创建 Bridge 包模板。
- 生成 health/setup/start/status/cancel 示例。
- 自动生成 Agent App wrapper。
- 自动生成 Live App backend binding 示例。
- 提供测试台与权限检查器。

## 不推荐方案

### 不推荐让 Bridge 成为业务任务主入口

原因：

- 用户会被迫理解 action、schema、SDK 参数、GUI 动作。
- 产品心智会分裂。
- FlowChat 和 Live App 的既有交互优势无法复用。
- 传统应用桥接后的产品化形态应该是 Agent App，而不是裸 Bridge action 面板。

### 不推荐把 Bridge 完全吞进 Agent App

原因：

- Bridge 本身有安装、权限、依赖、密钥、诊断、复用价值。
- 同一个传统应用 Bridge 需要被多个 Agent App 复用，必要时也被 Live App 复用。
- AI Builder 需要独立创建和测试传统应用桥接包，再生成 Agent App wrapper。

### 不推荐在 Agent App runtime tool 中嵌入大型 SDK/GUI wrapper

原因：

- 生命周期管理不清晰。
- 权限难以统一执行。
- 依赖和密钥难以管理。
- Live App 无法复用。

## 最终原则

1. **Bridge 的主要作用是把传统应用桥接成 Agent App 可使用的标准能力。**
2. **Bridge 是应用桥接资产和用户可管理对象，不是业务任务的默认执行入口。**
3. **Agent App 是 Bridge 的默认产品化消费表面，Live App 是需要可视化工作流时的增强表面。**
4. **Bridge 必须有独立管理、安装、验证、权限、密钥、运行诊断体系。**
5. **Agent App 通过 FlowChat 消费 Bridge，Live App 通过 `app.backend.call()` 消费 Bridge。**
6. **GUI Bridge 暴露的是领域能力，不是点击、坐标、截图等低层动作。**
7. **同一个 Bridge capability 应能被多个 Agent App 和 Live App 复用。**
8. **所有外部运行时都必须通过 Bridge Runtime 标准生命周期和事件协议进入 Sparo。**

最终模型：

```text
Bridge App
  = Traditional app bridge package
  = Management and runtime contract

Agent App
  = Default conversational product wrapper for bridged traditional apps
  = FlowChat user surface

Live App
  = Visual workflow product wrapper
  = iframe UI + backend bindings
```

这套模型保留 Bridge App 的平台价值，同时把主路径收敛为：传统应用先被 Bridge App 标准化桥接，再由 Agent App 包装成用户可直接对话的产品应用；用户管理桥接能力时面对 Bridge App，完成任务时通常面对 Agent App，只有需要专门可视化体验时才面对 Live App。
