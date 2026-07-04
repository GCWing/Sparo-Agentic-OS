---
name: product-app-api
description: Sparo OS Product App runtime API guidance. Use when writing or reviewing Product App ui.js, worker.js, source_manifest.json, permissions, window.app APIs, app.ai, app.backend service actions, storage, fs/shell/net/os/dialog/clipboard calls, runtime events, or Product App runtime debugging.
---

# Product App API Skill

Use this skill for Product App runtime code and platform capability work. Prefer current tool output, scaffold files, and package validation results over memory.

## Runtime Model

- `ui.js` runs in the iframe/browser environment. It uses the DOM, standard browser APIs, ESM imports, and `window.app`.
- `worker.js` is optional backend logic running in a separate JavaScript Worker host. Custom `app.call(method, params)` calls only methods exported by `worker.js`.
- `source_manifest.json` describes entrypoints: `uiEntry`, optional `workerEntry`, `styleEntries`, and `buildMode`. Current built-in apps use `nativeEsm`.
- `esm_dependencies.json` is the browser import-map dependency array, not an object. Write `[]` when there are no dependencies.
- Extra source files are read from `source/`. Do not handwrite `private_surface_sources`; edit package source files.
- A Product App surface `implementationRef` must be `app://<app-id>@<version>/surfaces/<surface-id>`. Do not fall back to old `bundle://surface-components/...` refs.

## `window.app` Capabilities

The runtime adapter exposes `window.app`. A common alias is:

```javascript
const runtime = () => window.app || {};
```

Basic properties:

- `app.appId`
- `app.appDataDir`
- `app.workspaceDir`
- `app.theme`
- `app.locale`
- `app.platform`
- `app.mode`

Host capabilities:

- `app.fs.readFile/writeFile/readdir/stat/mkdir/rm/copyFile/rename/appendFile`
- `app.shell.exec(command, opts)`
- `app.net.fetch(url, opts)`
- `app.os.info()`
- `app.storage.get(key)` / `app.storage.set(key, value)`
- `app.dialog.open/save/message`
- `app.clipboard.writeText/readText`
- `app.ai.complete/chat/cancel/getModels`
- `app.backend.call/cancel/status/cancelRun/cancelStaleRuns/turnText/onEvent/offEvent`
- `app.host.fillChatInput(text)`
- `app.deck.renderPage(opts)`
- `app.log.debug/info/warn/error`
- `app.onActivate/onDeactivate/onThemeChange/onLocaleChange`
- `app.i18n.t(key, params, fallback)`, `app.i18n.setMessages(messages)`, `app.i18n.onChange(fn)`
- `app.t(localeTable, fallback)`: selects text from `{ "zh-CN": "...", "en-US": "..." }` using the current locale.
- `app.on(event, fn)` / `app.off(event, fn)`: subscribes to runtime events, `worker:*`, `backend:event`, and similar events.
- `app.ui`: runtime UI Kit. UI details belong in `product-app-ui-polish`.

The current code does not expose an `app.agentic.*` namespace. Use `app.backend.*` for app-private Agent Component or Bridge Component bindings. Use `app.ai.*` only for direct model capability.

## UI And Worker Boundary

- Put DOM, theme, locale, event binding, and user interaction in `ui.js`.
- Enter host capabilities through `window.app` for files, shell, network, system info, storage, AI, and backend calls. Do not import Sparo internal services directly.
- Write `worker.js` only for custom business backend logic, and declare `permissions.node.enabled = true`.
- When `node.enabled = false`, host primitives can still be used, but custom `app.call(...)` methods cannot.
- Worker code must not assume DOM, `window.app`, or browser globals exist.

## Permissions

Current surface runtime permissions shape:

```json
{
  "fs": { "read": ["{appdata}"], "write": ["{appdata}"] },
  "shell": { "allow": ["git"] },
  "net": { "allow": ["api.example.com"] },
  "node": { "enabled": false, "max_memory_mb": 256, "timeout_ms": 30000 },
  "ai": {
    "enabled": true,
    "allowed_models": ["primary", "fast"],
    "max_tokens_per_request": 4096,
    "rate_limit_per_minute": 20
  }
}
```

Rules:

- Default to minimum permissions. If the app does not need user files, use only `{appdata}` or omit `fs`.
- Path scopes include `{appdata}`, `{workspace}`, `{home}`, `{user-selected}`, and absolute paths. `{workspace}` resolves only when a workspace is bound.
- `shell.allow` is a command-name allowlist. For git capability, declare `"git"`; do not create a general shell channel.
- `net.allow` is a domain allowlist. `"*"` means all network access and should not be the default.
- `permissions.ai.enabled` controls `app.ai.*`. If `allowed_models` is absent, rely only on `primary`.
- Do not expand permissions to work around missing platform capability. Internal services such as WorkspaceService, GitService, TerminalService, LSP, Browser, Computer Use, and Config are not Product App APIs.

## AI And Intelligent Backend

`app.ai.*` reuses the host AI client and requires no app API key:

```javascript
const result = await app.ai.complete('Summarize the current input', {
  systemPrompt: 'Output only a concise conclusion.',
  model: 'fast',
  maxTokens: 800,
  temperature: 0.2,
});

const handle = await app.ai.chat(
  [{ role: 'user', content: 'Generate three options' }],
  {
    model: 'primary',
    onChunk: (chunk) => appendText(chunk.text || ''),
    onDone: () => setBusy(false),
    onError: (error) => showError(String(error?.message || error)),
  },
);
```

`app.backend.*` calls declared backend bindings and is the right path for app-private Agent Components or Bridge Components:

```javascript
const run = await app.backend.call('ppt.generate', input, {
  entityId: state.deckId,
  idempotencyKey: `generate:${state.deckId}:${Date.now()}`,
});

app.backend.onEvent((event) => {
  if (event.actionRunId === run.actionRunId) updateProgress(event);
});
```

Key backend binding fields:

- `id`
- `kind`: `agentComponent` or `bridgeComponent`
- `componentId`
- Optional `capabilityId`
- `role`
- `sessionPolicy`: `ephemeral`, `persistent`, `perEntity`, `shared`
- `memoryScope`: `none`, `appInstance`, `entity`, `agentComponent`
- `actions`: `{ name, inputSchema, outputSchema, allowStatePatch }[]`

If the Product App needs durable intelligent behavior, prefer an app-private Agent Component exposed through backend binding actions. Do not use a raw Agentic session as internal application state.

## Built-In App References

- `builtin-spark-board`: uses `runtime().storage` for canvas state persistence and `onLocaleChange` for i18n refresh; use it as a lightweight workbench reference.
- `builtin-ppt-live`: shows complex modular source, `app.backend.call('ppt.generate', ...)`, history/storage fallback, and theme/locale synchronization; use it for intelligent backend and large UI patterns.
- `builtin-harmony-dev` / `builtin-remotion-live`: listen for `productAppRuntimeRouteChange` and refresh facts by workspace route; use them for workspace-aware apps.

## Verification

After changes, collect evidence appropriate to the change:

- The package can be read and the lock can be refreshed.
- `ValidateProductAppPackage` has no fatal error.
- Preview/runtime observation shows the UI is non-empty and key interactions work.
- Permissions, data, AI/backend behavior have matching runtime evidence; mark unrun capabilities as unverified.
