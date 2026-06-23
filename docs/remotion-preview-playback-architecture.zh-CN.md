# Remotion 右侧预览播放架构方案

## 结论

当前右侧预览的问题不是 Remotion Player 本身选错了，而是 Live App iframe 内部仍把 Player 当作可被整页重渲染替换的普通 DOM。最佳方案是把右侧 Player 预览收口为一个稳定挂载的 runtime island：宿主 UI 只 patch transport、timeline、status、selection overlay，除非 workspace / composition / runtime version / player host URL 真正变化，否则不能销毁 `.rl-player-frame`。

同时，播放控制要从一个布尔 `state.playing` 升级为显式状态机：区分用户意图、Player 实际运行态、命令确认、当前 frame snapshot。所有 seek、play、pause、send context、render still 都通过同一个 Player snapshot / command 协议拿事实，而不是让面板本地状态和 Player 自己的事件互相纠偏。

## 当前链路

右侧 workbench 入口本身是合理的：

- `src/web-ui/src/app/session-profiles/profiles/liveAppWorkbenchProfile.ts` 根据 `liveAppWorkbench.tabs` 自动打开右侧 aux tab，并使用 `duplicateCheckKey` 去重。
- `src/web-ui/src/app/scenes/apps/live-app/components/LiveAppRunnerPanel.tsx` 只负责加载 Live App，并用 `runnerKey` 挂载 `LiveAppRunner`。
- `src/web-ui/src/app/scenes/apps/live-app/components/LiveAppRunner.tsx` 将 compiled Live App 放入 sandbox iframe，并通过 `workbenchRouteChange` 推送 route / workspace / session 上下文。
- `src/web-ui/src/app/scenes/apps/live-app/hooks/useLiveAppBridge.ts` 提供 `backend.call`、`backend.status`、`host.fillChatInput` 等受控 host API。

也就是说，右侧播放问题主要不在 React 宿主层，而在 `bundles/live-apps/remotion-live` 与 `bundles/bridge-apps/remotion-runtime` 的预览控制协议。

当前 Remotion Live 预览链路：

- `bundles/live-apps/remotion-live/src/state.js` 使用一个全局 `state` 同时保存 `frame`、`playing`、`playerRuntimeReady`、`playerRuntimePlaying`、`playerFrameModel`、`previewFrame`、`previewClip`、`playerHost`。
- `bundles/live-apps/remotion-live/src/actions.js` 中 `setFrame()`、`togglePlayback()` 直接更新 `state.frame/state.playing` 并向 Player iframe 发 `seek/play/pause`。
- `bundles/live-apps/remotion-live/src/render-core.js` 的 `render()` 仍会 `root.innerHTML = ...` 重建整棵 UI。
- `bundles/live-apps/remotion-live/ui.js` 监听 Player host 发回的 `ready/frame/frameContext/play/pause/ended/error` 消息。
- `bundles/bridge-apps/remotion-runtime/src/player-host.js` 动态生成一个使用 `@remotion/player` 的 Player host 页面，并通过 `postMessage` 回传 frame、play、pause、frameContext。

## 主要根因

### 1. Player iframe 不稳定

`render()` 每次都会替换 `root.innerHTML`。只要 Player 预览存在，这会销毁并重建 `.rl-player-frame`，导致播放、当前帧、内部 Player lifecycle、握手状态和 frameContext 都丢失。

会触发全量 render 的路径很多：

- `ensurePlayerPreviewHost()` 开始和结束都会 `render()`。
- `pollPlayerPreviewHostStatus()` 在 host 签名变化时 `render()`。
- `evaluateCurrentFrame()` 每次 backend `getFrameContext` 完成后 `render()`。
- still / clip fallback 的 loading、缓存命中、失败、完成都会 `render()`。
- locale / route / mode / export / error 也会全量 render。

之前已经避免了 `frameContext` 更新时直接 full render，但播放链路仍然有大量 full render 入口，因此 bug 会继续复现。

### 2. 播放意图和播放事实混在一起

当前 `state.playing` 既表示用户想播放，又被当成 UI 的播放事实。Player host 也会回 `play/pause` 事件；Live App 收到 `play` 时，如果本地 `state.playing` 是 false，会立刻给 Player 发 `pause`。这个保护思路可以防止 Player 自行播放，但在 iframe 重建、autoplay、握手重试、延迟消息、命令排队期间，很容易把一次合法播放纠偏成暂停。

现在有 `playerControlEpoch` 和 command fallback，但 message 协议没有 command id / instance id / ack，旧 iframe 或旧命令的消息仍可能更新当前状态。

### 3. 当前 frame 没有统一事实源

Player mode 下，真实当前帧应来自 Player host；Still mode 下，当前帧来自面板；Studio mode 下，当前帧只能来自 Studio/bridge 可读状态。现在 `state.frame` 是所有模式共享事实，Player 事件会不断覆盖它，但 `sendContext()`、`renderStill()`、`startExport()` 等 seek-sensitive action 没有先向 Player 请求一次强一致 snapshot。

结果是：用户看到的帧、timeline 显示的帧、传给 Agent 的上下文、渲染 still 的帧可能短暂漂移。

### 4. 三种预览模式的语义没有收口

当前有 `player`、`studio`、`still` 三种模式：

- Player 是默认且最适合右侧交互播放的模式。
- Studio 更适合开发态诊断，不适合作为稳定可控的右侧播放事实源。
- Still/clip fallback 是降级预览，不应和 Player 共用同一个播放语义。

UI 上现在已经把 Studio transport 独立出来，但状态模型仍然让 `state.frame/state.playing` 横跨三种模式。

### 5. 验证没有覆盖真实播放

`tests/e2e/specs/live-app-composite-workbench.spec.ts` 目前能验证 Remotion Player host 启动、返回 localhost URL、HTML 包含 Remotion、composition manifest 可读。但它没有验证：

- 点击右侧 Play 后 frame 是否持续前进。
- 点击 Pause 后 Player 是否停止。
- slider seek 后 Player 是否到达目标帧。
- 播放中 host poll / frameContext / status 更新是否不会重建 iframe。
- `sendContext()` / `renderStill()` 是否使用用户实际看到的帧。

因此现在的 E2E 只能证明“预览服务启动了”，不能证明“右侧播放工作了”。

## 最佳方案：Preview Runtime Island

目标模型：

```text
Live App shell
  Header / status / mode switch
  Stable Preview Runtime Island
    Player iframe, mounted once per preview instance
    Overlay and selection layer, patched locally
  Transport controller
    Timeline / play button / frame input
  Context and render actions
    Always read preview snapshot before acting

Bridge App runtime
  Project detection and manifest
  Player host build/start/reuse
  Still/export rendering

Player host
  @remotion/player as authoritative playback runtime
  postMessage protocol with instance id, command id, snapshot, ack, frameContext
```

### 1. Make Player iframe durable

Add a small DOM renderer boundary in Remotion Live:

- `renderShell()` may rebuild header/status/outer layout only when route/workspace/project detection state changes.
- `renderPreviewStage()` must preserve the existing `.rl-player-frame` when the stage key is unchanged.
- Stage key should include `previewMode`, `workspacePath`, `compositionId`, `manifest.buildId`, `playerHost.baseUrl`, and `PLAYER_HOST_RUNTIME_VERSION`.
- Updating status, transport, timeline, context tray, loading badge, selection overlay, and frame pill should be local DOM patch functions.
- `render()` should not call `root.innerHTML = ...` during normal Player playback.

Player iframe should only be recreated for structural events:

- workspace changed
- composition changed
- preview mode changed away from or back to Player
- player host base URL changed
- runtime version changed
- project build id changed
- explicit restart preview

### 2. Introduce an explicit playback state machine

Replace the loose booleans with one controller state:

```ts
previewRuntime = {
  mode: 'player' | 'studio' | 'still',
  instanceId,
  compositionId,
  frame,
  desiredPlaying: false,
  actualPlaying: false,
  lifecycle: 'empty' | 'starting' | 'ready' | 'error',
  commandEpoch,
  pendingCommand: null,
  lastSnapshot: null,
}
```

Rules:

- UI buttons reflect `desiredPlaying` optimistically plus `actualPlaying` confirmation state.
- Player `play/pause/frame` events update `actualPlaying` and `frame`; they do not immediately overwrite user intent unless the event belongs to the current `instanceId`.
- If Player reports `play` while `desiredPlaying === false`, do not instantly send pause unless the message is current and no command is pending. Prefer command ack / timeout reconciliation.
- All commands carry `{ instanceId, commandId, type, frame }`.
- Player echoes `{ commandId, accepted, frame, playing }`.
- The parent ignores stale messages from older iframe instances.

### 3. Add a snapshot protocol

Player host should support:

- `snapshot` request: returns `{ frame, playing, durationInFrames, fps, frameContext }`.
- `command` ack: confirms play / pause / seek reached the Player runtime.
- `frameContext` stream: optional continuous update, throttled and used for overlay.

Live App should use `await getPreviewSnapshot()` before:

- `sendContext()`
- `renderStill()`
- `startExport()` when frame range depends on current frame
- any future "revise this frame/selection" action

If Player is not ready, fall back to backend `getFrameContext` plus `state.frame`, but mark `contextSource: 'bridge-fallback'`.

### 4. Make seek a two-phase operation

Slider input should be responsive but not destructive:

- On drag/input: update local timeline DOM immediately, throttle `seek` commands to Player.
- On commit/change/pointerup: send a final `seek` with command id and request snapshot.
- Do not call full `render()` for every scrub frame.
- Do not render a still fallback while Player is ready.

### 5. Treat Studio and Still as separate modes

Player should remain the default right-side preview. Studio is useful but should be framed as "open/inspect Studio", not as the primary controlled player.

Recommended mode semantics:

- `player`: interactive playback, frame authority, selection overlay, AI context.
- `studio`: dev/diagnostic iframe, no host-owned play button or selection precision guarantee.
- `still`: deterministic fallback; play button becomes "render short preview clip" or is hidden/disabled as playback.

### 6. Keep built-in refresh and runtime versions aligned

When implementing:

- Bump `bundles/live-apps/remotion-live/bundle.json`.
- Bump `bundles/bridge-apps/remotion-runtime/bundle.json`.
- Bump both `PLAYER_HOST_RUNTIME_VERSION` constants in Live App and Bridge runtime when the message protocol changes.
- Rely on built-in `source_digest` refresh behavior, but keep versions increasing so installed copies reseed predictably.
- Fix mojibake in `bundles/live-apps/remotion-live/meta.json` and any user-facing zh-CN strings touched by the work.

## Implementation Plan

1. Add `bundles/live-apps/remotion-live/src/preview-controller.js`.
   - Own preview runtime state, stage key, command id generation, desired/actual playback transitions, and snapshot reads.

2. Add `bundles/live-apps/remotion-live/src/player-protocol.js`.
   - Wrap `postMessage`, filter `instanceId`, queue commands until ready, expose `play()`, `pause()`, `seek()`, `snapshot()`.

3. Refactor `render-core.js`.
   - Split full shell render from patch render.
   - Preserve `.rl-player-frame` whenever stage key is unchanged.
   - Replace status/timeline/context/overlay through small DOM patch functions.

4. Update `ui.js` event dispatch.
   - Move Player message handling into `player-protocol.js` or `preview-controller.js`.
   - Ensure top-level event dispatch only calls controller actions.

5. Update `actions.js`.
   - `togglePlayback()`, `setFrame()`, `sendContext()`, and `renderStill()` should call the controller rather than mutating `state.playing/state.frame` directly.
   - Selection pause should set `desiredPlaying = false` and send a current pause command instead of only stopping local timers.

6. Update `bundles/bridge-apps/remotion-runtime/src/player-host.js`.
   - Include `instanceId` from URL or parent command.
   - Add `snapshot` request support.
   - Echo `commandId` on command ack.
   - Send `state` messages containing `frame` and `playing`.
   - Keep `frameContext` throttled with `requestAnimationFrame`.

7. Update tests.
   - Extend real Remotion E2E to start Player host and verify play advances frames through the message protocol.
   - Add seek verification: send seek to a target frame and assert snapshot frame matches.
   - Add right-side UI verification: open Remotion Live, click play, observe frame pill/timeline advances without `.rl-player-frame` node identity changing during host status polls.
   - Keep the existing host-start test as a boot smoke test.

## Acceptance Criteria

- Clicking Play in the right panel advances the frame continuously.
- Clicking Pause stops frame advancement and keeps the current frame stable.
- Scrubbing seeks the Player without reloading the iframe.
- Host status polling and frameContext messages do not replace `.rl-player-frame`.
- `sendContext()` and `renderStill()` use a fresh Player snapshot when Player mode is ready.
- Changing composition intentionally remounts Player exactly once and then resumes stable patch updates.
- Studio and Still modes do not claim Player-level frame authority.
- `pnpm run type-check:web`, `node --check` on Live App and runtime worker files, backend contract checks, and the focused real Remotion E2E pass.
