# Sparo App Types Architecture

Sparo OS has three application forms:

- **Live App**: an interactive user-facing application.
- **Agent App**: a Sparo-native agent package.
- **Bridge App**: a programmatic adapter that wraps external software as agent capability.

They share catalog, permissions, installation, and backend invocation concepts, but they have different runtime models.

## Core Positioning

### Live App

Live App is the user experience layer.

It provides application UI, interaction flow, state display, forms, dashboards, canvases, and workflow surfaces. It should not directly manage arbitrary agent sessions. When intelligent backend work is needed, it calls a declared backend action.

```ts
await app.backend.call('backendId.actionName', input)
```

Typical use cases:

- interactive workbench
- visual editor
- report/dashboard UI
- workflow application
- domain-specific user tool

Runtime model:

```text
User -> Live App UI -> declared backend action -> backend result/events
```

### Agent App

Agent App is a Sparo-native agent customization package.

It runs through the Sparo agent system and uses Sparo prompts, tools, skills, subagents, memory, sessions, and events. Its purpose is to package a specialized assistant that behaves like a first-class Sparo agent.

Typical assets:

- manifest
- agent prompt
- tool allowlist
- skills
- subagents
- service actions
- examples

Typical use cases:

- file organizer
- code review agent
- research assistant
- document generator
- domain-specific Sparo assistant

Runtime model:

```text
Sparo Agent Engine -> model -> Sparo tools/skills/subagents -> Sparo events
```

### Bridge App

Bridge App is an external capability adapter.

It wraps existing software, services, SDKs, CLIs, GUIs, daemons, or protocols and exposes them as Sparo-compatible agent capability. Bridge Apps are usually code-heavy because they need protocol adaptation, state management, runtime integration, and event translation.

Typical bridge kinds:

- CLI bridge
- SDK bridge
- GUI bridge
- HTTP/service bridge
- MCP bridge
- local daemon bridge

Typical use cases:

- Cursor SDK bridge
- Claude Code CLI bridge
- Office desktop automation bridge
- enterprise ERP GUI bridge
- Jira/Notion/Slack SDK bridge
- internal command-line tool bridge

Runtime model:

```text
Sparo Bridge Runtime -> external adapter -> external app/service/runtime -> bridge events -> Sparo events
```

## Relationship

```text
Sparo Apps
├─ Live App
│  └─ User-facing application UI and workflow
├─ Agent App
│  └─ Sparo-native agent package
└─ Bridge App
   └─ External app/runtime adapter
```

Live App can call Agent App or Bridge App backends. Agent App can call tools exposed by Bridge App. Bridge App can also be launched directly as an agent-like surface.

```text
                 ┌────────────────────┐
                 │      Live App       │
                 │ UI / workflow / UX  │
                 └─────────┬──────────┘
                           │ app.backend.call()
          ┌────────────────┴────────────────┐
          │                                 │
┌─────────▼──────────┐            ┌─────────▼──────────┐
│     Agent App      │            │     Bridge App     │
│ Sparo-native Agent │            │ External Adapter   │
└─────────┬──────────┘            └─────────┬──────────┘
          │                                 │
          │ Sparo tools / skills            │ CLI / SDK / GUI / HTTP / MCP
          │                                 │
          └──────────────┬──────────────────┘
                         ▼
              Sparo Session / Event / UI
```

## Shared App Surface Model

Apps can expose one or more surfaces.

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

Surface meanings:

- `launchableApp`: visible and openable from the Apps catalog.
- `agent`: can be selected as a conversational agent.
- `tool`: can be called by other agents.
- `liveAppBackend`: can be called by Live Apps through `app.backend.call()`.

Agent App and Bridge App may both expose agent/tool/backend surfaces, but their runtimes remain separate.

## Runtime Boundaries

### Agent App Runtime

Agent App uses the Sparo-native agent execution path.

```text
Agent App manifest
-> Agent registry
-> Sparo execution engine
-> model round
-> tool execution
-> AgenticEvent
```

### Bridge App Runtime

Bridge App uses a dedicated external runtime path.

```text
Bridge App manifest
-> Bridge registry
-> Bridge runtime
-> adapter worker/process
-> external software
-> bridge event stream
-> AgenticEvent
```

The Bridge runtime is responsible for:

- dependency setup
- process or worker startup
- run lifecycle
- event streaming
- cancellation
- resume/recovery
- permissions
- secrets injection
- external error normalization

## Live App Backend Binding

Live App backend bindings should support both Agent App and Bridge App backends.

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

Live App code uses one invocation style regardless of backend kind.

```ts
await app.backend.call('cursor.run', input)
```

## Agent App Package

An Agent App package is a Sparo-native agent definition. It should be lightweight, declarative, and focused on shaping how the Sparo agent behaves.

```text
agent-app/
├─ manifest.json
├─ agent.md
├─ examples.json
└─ tools/
   ├─ fetch-data.tool.json
   └─ fetch-data.js
```

Core package files:

- `manifest.json`: identity, metadata, tools, skills, subagents, service actions, and examples.
- `agent.md`: system prompt template for the app agent.
- `examples.json`: starter examples shown in the UI.
- `tools/`: optional app-local runtime tools.

Agent App should prefer existing Sparo tools, skills, and subagents. App-local runtime tools are for narrow helper logic, not for wrapping large external runtimes. Large external integrations should be modeled as Bridge Apps.

Example manifest:

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

Service actions are structured entry points exposed by an Agent App.

They let Live Apps and other platform surfaces call an Agent App without depending on free-form chat. A service action turns structured input into a controlled prompt and expects structured or contract-bound output.

Service action fields:

- `name`: stable action name.
- `description`: human-readable purpose.
- `inputSchema`: input contract.
- `outputSchema`: expected output contract.
- `promptTemplate`: action-specific instruction template.
- `toolPolicy`: optional tool restriction for this action.
- `memory`: optional memory behavior for this action.

Invocation model:

```text
Live App backend call
-> Agent App service action
-> action prompt template
-> Sparo Agent Engine
-> result/events
```

Agent App service actions are best for intelligent work that should still use Sparo's model, tools, memory, and session infrastructure. If the implementation mostly delegates to an external SDK, CLI, or GUI, it should be a Bridge App action instead.

## Agent App Runtime Rules

Agent App behavior should stay within the Sparo-native agent model.

Design rules:

- Use prompt, tools, skills, and subagents as the primary customization points.
- Keep app-local JavaScript tools small and task-specific.
- Do not embed large SDK wrappers or long-running external process managers in Agent App tools.
- Use service actions for structured backend calls from Live Apps.
- Use Bridge App when the core value comes from external software behavior.
- Keep user-visible text localizable when surfaced in UI.
- Keep tool permissions explicit and minimal.

Agent App can expose these surfaces:

- `agent`: user starts a conversation with this app as the active agent.
- `tool`: other agents call selected Agent App capabilities.
- `liveAppBackend`: Live App calls declared service actions.

## Bridge App Package

A Bridge App package should include code, manifest, schemas, dependencies, and optional assets.

```text
bridge-app/
├─ manifest.json
├─ README.md
├─ package.json
├─ pnpm-lock.yaml
├─ src/
│  ├─ main.ts
│  ├─ adapters/
│  └─ schemas/
└─ assets/
```

Example manifest:

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

## Bridge Event Protocol

Bridge workers should emit structured events instead of unstructured text.

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

Sparo maps bridge events into the existing session, FlowChat, tool card, and AgenticEvent surfaces.

## Suggested Core Modules

```text
src/crates/core/src/app_platform/
├─ catalog/
├─ manifest/
├─ permissions/
└─ surfaces/
   ├─ agent_surface.rs
   ├─ tool_surface.rs
   └─ backend_surface.rs
```

```text
src/crates/core/src/agent_app/
├─ manifest.rs
├─ manager.rs
├─ registry.rs
├─ runtime_tools.rs
└─ service_actions.rs
```

```text
src/crates/core/src/bridge_app/
├─ manifest.rs
├─ manager.rs
├─ registry.rs
├─ events.rs
└─ runtime/
   ├─ mod.rs
   ├─ cli_adapter.rs
   ├─ sdk_adapter.rs
   ├─ gui_adapter.rs
   ├─ service_adapter.rs
   └─ worker_protocol.rs
```

```text
src/crates/core/src/live_app/
└─ Live App runtime and backend bindings
```

## Permission Model

Bridge App permissions should be declared at package level and enforced by the Bridge runtime.

Permission categories:

- `fs`: workspace, app storage, selected files
- `net`: allowed hosts or URL prefixes
- `shell`: allowed commands
- `gui`: allowed applications, windows, or automation scopes
- `secrets`: named secret handles
- `workspace`: workspace access mode

Secrets should be injected by the runtime and excluded from logs, manifests, exported packages, and tool outputs.

## Evolution Path

1. Keep Agent App as the Sparo-native agent customization path.
2. Add Bridge App as a sibling app type with its own manifest and manager.
3. Generalize Live App backend bindings from Agent App only to `kind + appId`.
4. Implement Bridge Runtime for SDK and CLI adapters first.
5. Use Cursor SDK Bridge as the first SDK Bridge reference package.
6. Add GUI Bridge support on top of ComputerUse and WebDriver capabilities.
7. Add Bridge App Studio for generating and testing Bridge App packages.

## Final Model

```text
Live App
  = user-facing application and workflow

Agent App
  = Sparo-native agent package

Bridge App
  = external software adapter exposed as agent capability
```

The three app types form one platform while preserving distinct runtime responsibilities.
