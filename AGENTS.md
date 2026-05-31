# Agents.md

[中文](./AGENTS-CN.md) | English

## Project Overview

Sparo OS is an Agentic OS for building and running intelligent apps. The first-class product surfaces are the Tauri desktop app and the CLI, both backed by shared Rust core services. The React/TypeScript Web UI is the desktop app surface.

Focus routine development on:

- `src/apps/desktop` - Tauri 2 desktop shell, commands, capabilities, and desktop-only integration.
- `src/apps/cli` - CLI command surface, terminal/TUI rendering, and CLI-only integration.
- `src/web-ui` - React 18 + TypeScript UI used by the desktop app.
- `src/crates/core` - platform-agnostic business logic, agent runtime, services, storage, paths, and tools.
- `src/crates/events` - platform-agnostic event contracts.
- `src/crates/transport` - adapters between core/events and app surfaces.

Do not describe or design features around a general-purpose app server target unless the user explicitly asks for it. The supported product paths are desktop + Web UI and CLI; Remote Connect relay is a separate infrastructure crate, not a Sparo app server.

## Current Architecture

- `src/crates/core/src/agentic` - agents, prompts, sessions, dialog turns, model rounds, and tool execution.
- `src/crates/core/src/command` - host-agnostic command services shared by desktop and CLI adapters.
- `src/crates/core/src/runtime` - shared process and agentic runtime builders used by desktop and CLI.
- `src/crates/core/src/service` - workspace, config, filesystem, terminal, git, and related services.
- `src/crates/core/src/infrastructure` - AI adapters, app paths, logging, storage, debug ingest, and events.
- `src/web-ui/src/app` - application shell and desktop panels.
- `src/web-ui/src/flow_chat` - chat UI, tool cards, streaming/tool event presentation.
- `src/web-ui/src/tools` - feature tools such as editor, terminal, git, mermaid, and design canvas.
- `src/web-ui/src/infrastructure` - theme, i18n, config, API adapters, and state wiring.
- `src/web-ui/src/design-system` - reusable UI APIs, visual contracts, preview coverage, and AI-facing UI rules.
- `src/web-ui/src/shared` - shared frontend services, markdown rendering, utilities, and types.
- `src/web-ui/src/locales` - translations.

## Development Commands

Use `pnpm` from the repository root.

```bash
pnpm install               # install dependencies
pnpm run desktop:dev       # run the desktop app in development
pnpm run dev:web           # run only the Web UI with Vite
pnpm run type-check:web    # TypeScript check
pnpm run lint:web          # frontend lint
pnpm run build:web         # type-check + Web UI build + Monaco asset verification
pnpm run check:i18n        # locale file/key consistency
pnpm run check:design-system # design-system architecture and styling gate
pnpm run preview:design-system # run the design-system preview app
pnpm run build:design-system   # build the design-system preview output
pnpm run desktop:build     # desktop production build
pnpm run cli:dev -- --help # run the CLI in development
pnpm run cli:build         # build the CLI release binary
pnpm run cli:check         # Rust check for the CLI crate
pnpm run e2e:test          # WebDriverIO E2E suite in debug app mode
```

For Rust-only changes, run the narrowest useful `cargo check` or `cargo test` command for the crate touched.

## Fast Verification Loop

Use E2E as a focused end-to-end feedback loop for large or complex work: new product flows, multi-surface UI features, desktop/Web UI integration, or bugs that have already resisted one or two simpler fixes. In those cases, write or update one small spec that exercises the exact workflow being implemented or repaired, then iterate against that spec until the behavior is correct:

```bash
pnpm run e2e:test:spec -- tests/e2e/specs/<feature>.spec.ts
pnpm run e2e:test:spec:dev -- tests/e2e/specs/<feature>.spec.ts # when Tauri dev/watch should rebuild Rust
```

Keep the E2E proportional: small copy/style/type-only edits usually need only the cheapest relevant check, such as `pnpm run check:web:fast`, `pnpm run type-check:web`, or the narrowest `cargo check`/`cargo test`. For E2E-critical UI controls, add stable `data-testid` hooks. If the focused spec exposes stale helper infrastructure, repair the helper/spec so the e2e validation remains trustworthy.

Use broader suites such as `pnpm run e2e:test:l0`, `pnpm run e2e:test:l0:all`, `pnpm run e2e:test:l1`, or `pnpm run e2e:test` when the change spans their surface area or before a release-style handoff.

## Critical Rules

### Platform Boundaries

Core code must stay platform agnostic.

- In `src/crates/core`, do not depend on Tauri types such as `tauri::AppHandle`.
- Prefer `bitfun_events::EventEmitter`, service traits, and constructor-injected dependencies.
- Desktop-specific code belongs under `src/apps/desktop` or an adapter layer.
- Keep Tauri command DTOs and shared command request/response structs structured and serializable.

### Tauri Commands

Command names are `snake_case` in Rust and invoked as `camelCase` through TypeScript helpers when exposed to the UI.

Always prefer a structured request object:

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

### Logging

Logging rules apply everywhere:

- English only.
- No emojis in log messages.
- Prefer structured data/context over string concatenation.
- Keep normal-path logging concise.
- Never log tokens, API keys, passwords, or personal data.

Frontend logging:

- Spec: `src/web-ui/LOGGING.md`
- Use `createLogger('ModuleName')` from `@/shared/utils/logger`.
- Log structured context: `log.info('Loaded items', { count })`.
- Include errors as data: `log.error('Failed to load config', { configPath, error })`.

Backend logging:

- Spec: `src/crates/LOGGING.md`
- Use `log::{trace, debug, info, warn, error}` macros.
- Include useful context such as `session_id`, `request_id`, `workspace_path`, and operation names when available.

### Paths And Persistence

- App config directory name: `sparo_os`.
- Project hidden directory name: `.sparo_os`.
- Project-local config lives under `<workspace>/.sparo_os/config/`.
- Default debug log lives at `<workspace>/.sparo_os/debug.log`.
- Runtime workspace data typically lives under `<app-root>/workspaces/<workspace-id>/`.
- Project sessions live under `<app-root>/workspaces/<workspace-id>/sessions/`.
- Agentic OS global sessions live under `<app-root>/agentic_os/sessions/`.

Desktop runtime logs:

- Default root is the Sparo OS config log directory:
  - Windows: `%APPDATA%\sparo_os\logs`
  - macOS: `~/Library/Application Support/sparo_os/logs`
  - Linux: `~/.config/sparo_os/logs`
- Each app launch creates a timestamped session directory under the log root.
- Session files are `app.log`, `ai.log`, and `webview.log`.
- `SPARO_LOG_DIR` overrides the log root. `SPARO_E2E_LOG_DIR` is used for E2E runs.

Debug instrumentation logs:

- The built-in debug ingest server defaults to `http://127.0.0.1:7242`.
- The default workspace debug log path is `.sparo_os/debug.log`.
- `scripts/debug-log-server.mjs` is only an ad hoc standalone helper. Its defaults are port `7469` and repository-root `debug-agent.log`; do not confuse it with the built-in ingest server.

### Frontend Reuse

When developing frontend features, reuse existing infrastructure:

- Reusable UI: `src/web-ui/src/design-system`
- Theme: `src/web-ui/src/infrastructure/theme` and `src/web-ui/src/design-system/foundation`
- I18n: `src/web-ui/src/infrastructure/i18n` and `src/web-ui/src/locales`
- Shared services/utilities: `src/web-ui/src/shared`
- Feature-local state: use existing Zustand/module store patterns where present.

`src/web-ui/src/design-system` is the final reusable UI contract. When building frontend UI, first look for an existing design-system primitive, pattern, token, or recipe that fits the need. If a new UI need appears, decide whether it is a reusable contract that belongs in the design system or a narrow product-specific variation that should stay in the feature layer. New UI code should import primitives and patterns from `@/design-system`. Product and feature TS/TSX files outside the design system must not import internal paths such as `@/design-system/primitives/Button` or relative paths into `design-system`; use the public barrel. Do not recreate a component package, compatibility shim, or alternate reusable UI root.

Feature SCSS should use runtime design-system CSS variables and token entrypoints. Avoid new raw `#hex`, `rgb()`, `rgba()`, or hardcoded `z-index` values in feature styling. Use design-system primitives for buttons, inputs, selects, dialogs, tabs, badges, tooltips, and loaders rather than feature-local control classes; keep feature-layer overrides limited to product-specific layout, composition, or state that is not broadly reusable.

When adding or changing reusable UI:

- Follow `src/web-ui/src/design-system/AGENTS.md`.
- Start from the closest recipe in `src/web-ui/src/design-system/recipes/`.
- Register deterministic preview coverage in `src/web-ui/src/design-system/preview/registries`.
- Run `pnpm run check:design-system`; use `pnpm run preview:design-system` or `pnpm run build:design-system` when visual coverage changes.

Keep UI text translated when the surrounding feature is localized. Add or update both `en-US` and `zh-CN` locale entries when introducing user-visible strings.
For locale file organization and maintenance rules, follow `src/web-ui/src/locales/AGENTS.md`.
Run `pnpm run check:i18n` after locale changes. `pnpm run type-check:web` and `pnpm run build:web` now include this check through the root script chain.

Locale files are organized by product surface. Use `scenes/*` for scene-level UI, `panels/*` for docked or embedded panels, `settings/*` for durable settings subpages, `shell/*` for global chrome and navigation, and `flow-chat/*` for larger chat subdomains. Keep `common.json` for text reused across multiple product areas.

### Tool And Agent Development

Tools:

1. Implement the tool under `src/crates/core/src/agentic/tools/implementations/`.
2. Define typed input/output structs.
3. Register the tool in `src/crates/core/src/agentic/tools/registry.rs`.
4. Add frontend tool-card rendering in `src/web-ui/src/flow_chat/tool-cards/` when the tool has user-visible output.
5. Preserve streaming behavior and concurrency assumptions in the tool pipeline.

Agents:

1. Add or update agent code under `src/crates/core/src/agentic/agents/`.
2. Put long prompts in `src/crates/core/src/agentic/agents/prompts/`.
3. Register new agents in the agent registry.
4. Keep prompts and logs in English unless the content is intentionally user-facing/localized.

### Git And Workspace Safety

- The worktree may already contain user edits. Do not revert unrelated changes.
- Keep edits scoped to the requested task.
- Prefer existing project patterns over new abstractions.
- Avoid generated files unless the task requires regeneration.
- For frontend or UI work, run at least `pnpm run type-check:web` or explain why it was not run.
- For backend work, run the narrowest useful Rust check/test or explain why it was not run.

## Quick Debugging Reference

Ad hoc browser instrumentation helper:

```bash
node scripts/debug-log-server.mjs
```

This standalone helper listens on `http://127.0.0.1:7469` and writes NDJSON to `debug-agent.log` in the repository root.

Built-in Agentic debug ingest uses the app-managed server instead:

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

Read the resulting workspace log from:

```text
<workspace>/.sparo_os/debug.log
```

