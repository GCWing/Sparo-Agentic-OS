# E2E 用户真实性改进分析

## 结论

当前 E2E 的问题不是“用了 WebDriverIO”或“用了 data-testid”，而是测试体系没有把不同验证目的分开，导致很多本应验证真实用户路径的 spec 混入了直接改前端 store、直接调用 Tauri command、直接调用 feature API、直接派发 DOM event、直接改 scrollTop 等内部操作。

这会带来一个很危险的结果：测试通过只能证明内部链路在理想状态下可被调用，不能证明用户真的能在桌面 UI 中发现入口、完成操作、看到反馈、处理等待和错误状态。

改进要同时做两件事：

1. 机制上给测试分层、给绕路加闸门、补足用户动作 DSL 和 fixture 通道。
2. 提示上让每个写 E2E 的 agent 先声明“这是哪类测试、用户如何真实操作、哪些绕路仅用于 setup/assert/cleanup”。

## 当前症状

现有文档已经写了“测试真实用户工作流”，但实际代码里有多种反向激励：

- `BasePage` 暴露 `executeScript`，让直接执行页面脚本成为一等能力。
- `workspace-helper` 用 `workspaceManager.openWorkspace` 打开工作区，跳过了用户选择/切换工作区入口。
- 若干 spec 直接 `import('/src/...')` 调用前端服务、改 Zustand store 或调用导航函数。
- 若干 spec 直接访问 `window.__TAURI_INTERNALS__.invoke` 调 Tauri command。
- hover、ctrl 多选、滚动等用户动作有时通过 `dispatchEvent`、`scrollTop = ...` 模拟，而不是通过 WebDriver action。
- 一些测试为了造 UI 状态直接注入完整 session/tool-card fixture，但文件名和层级仍像 L1 用户流，容易误导后续维护者。

这不是说这些技术都不该存在。比如 `l0-webdriver-protocol.spec.ts` 直接造 DOM 是合理的，因为它测试的是内置 WebDriver 协议本身。问题在于同样的技术被放进 L1 用户路径里，没有显式例外边界。

## 建议的测试分层

把 E2E spec 分成四类，并让文件名、describe 注释、lint 规则都识别这个分类。

| 类型 | 目的 | 允许的内部操作 | 不应声称 |
| --- | --- | --- | --- |
| `protocol` | 验证内置 WebDriver、Tauri bridge、底层驱动能力 | 可以 `browser.execute`、造 DOM、直接打 driver endpoint | 不声称用户路径可用 |
| `fixture-regression` | 用合成数据验证复杂 UI 状态，例如虚拟列表、tool card、布局退化 | 可以在 setup 阶段 seed store 或后端 fixture | 不声称真实用户能产生该状态 |
| `integration` | 验证后端 command/service/API 与 UI 适配边界 | 可以直接调用 structured Tauri command 或 test-only API | 不替代用户入口测试 |
| `user-path` | 验证用户能从真实界面完成任务 | Act 阶段只能用可见 UI、键盘、鼠标、菜单、文件选择等用户动作 | 不能直接调 store/API/command 完成行为 |

L1/L2 默认应是 `user-path`。如果某个测试不是用户路径，就要在文件头写清楚，避免它被当成产品验收证据。

## 机制改进

### 1. 增加 E2E faithfulness gate

新增一个轻量静态检查脚本，例如 `scripts/check-e2e-faithfulness.mjs`，扫描 `tests/e2e/specs/**/*.ts`：

- 在 `user-path` spec 中禁止裸用：
  - `browser.execute` / `browser.executeAsync`
  - `window.__TAURI_INTERNALS__`
  - `invoke(`
  - `flowChatStore.setState`
  - `useModernFlowChatStore.getState`
  - `workspaceManager.openWorkspace`
  - `openWorkspaceScene`
  - `dispatchEvent(`
  - `scrollTop =`
  - feature API 直调，如 `fileWorkbenchAPI.*`
- 允许例外必须满足两个条件：
  - 只能在 setup/assert/cleanup helper 中。
  - 必须带注释：`// e2e-fixture-allowed: <reason>`，并说明为什么不能通过用户动作完成。

第一阶段只报告，不阻断；第二阶段对新增 `user-path` 绕路 fail；第三阶段清理历史高风险 spec。

### 2. 建立用户动作 DSL，而不是让每个 spec 手写选择器

在 `tests/e2e/helpers/` 下新增类似 `user-actions.ts`：

- `user.openWorkspaceViaStartScreen(path)`
- `user.openSettingsViaMenu()`
- `user.openFilesFromShell()`
- `user.selectSettingsTab(label)`
- `user.typeChatMessage(text)`
- `user.sendChatMessage()`
- `user.hover(element)`
- `user.ctrlClick(element)`
- `user.wheel(element, deltaY)`
- `user.pressShortcut(keys)`
- `user.chooseFromMenu(trigger, optionLabel)`

这些 helper 内部可以用 WebDriver element/action 能力，但不要用 store/API 直接完成业务结果。这样 agent 写测试时天然表达“用户动作”，而不是表达“内部实现怎么调”。

### 3. 把 fixture 通道从 UI spec 中隔离出来

现在很多复杂 UI 测试需要造 session、tool card、streaming state。这个需求是合理的，但应该有受控机制：

- `seedSessionWithToolCardFixture(...)`
- `seedStreamingFlowChatFixture(...)`
- `seedModelConfigFixture(...)`
- `seedWorkspaceFixture(...)`

这些 helper 统一放在 `tests/e2e/fixtures/runtime/` 或 `tests/e2e/helpers/fixtures/`，命名上明确是 fixture。使用它们的 spec 标记为 `fixture-regression`，只验证 UI 对某种状态的渲染/交互退化，不冒充完整用户路径。

更进一步，可以增加 debug/e2e-only 的 Tauri command 或后端 fixture API，结构化地创建测试状态。这样比直接改 frontend store 更接近真实 runtime，也更不容易被 UI store 重构打碎。

### 4. 用户路径缺入口时，让测试暴露产品问题

如果某个功能只有内部 API，没有真实 UI 入口，不要用 `openWorkspaceScene(...)` 把页面强行打开后说 E2E 通过。应当二选一：

- 补真实入口、按钮、菜单、空状态 CTA、快捷键，再写 `user-path` spec。
- 把测试降级为 `integration` 或 `fixture-regression`，并记录“缺少用户入口”。

这点对 Files Workbench、Settings 子页、Work/Goal 这类多入口功能尤其重要。

### 5. 用 WebDriver actions 替代手派 DOM event

当前内置 WebDriver 已有 key、pointer、wheel actions 的服务端结构。测试侧应该补包装：

- ctrl/cmd 多选用 `keyDown(Control)` + pointer click + `keyUp(Control)`。
- hover 用 `moveTo` 或 pointer move，不手动 `dispatchEvent(new MouseEvent(...))`。
- 滚动用 wheel action，不直接写 `scrollTop`。
- contenteditable 清空优先用真实 focus + select-all + Backspace；如果驱动不稳定，就补驱动能力，而不是在每个测试里改 `textContent`。

这样 E2E 会逼出驱动层的问题，而不是把驱动缺口埋在 spec 里。

### 6. 引入“用户路径覆盖”报告

每个 spec 运行时记录 action trace：

- 打开了哪个入口。
- 点击/输入/滚动了哪些用户可见元素。
- 关键断言来自哪个用户可见反馈。
- 是否使用 fixture/内部 API。

报告不需要很重，先输出 JSON/NDJSON 即可。价值是 PR review 时能一眼看出某个 spec 是“真实操作”还是“状态注入后看 DOM”。

## 提示改进

### 根 AGENTS.md 可增加的 E2E 规则

建议在 Fast Verification Loop 后面加入这类规则：

```md
When adding or updating E2E tests, classify the spec before writing it:

- `user-path`: validates a real user workflow. The Act steps must use visible UI, keyboard, pointer, wheel, menus, dialogs, or file picker interactions. Do not call frontend stores, feature APIs, Tauri commands, `browser.execute`, `dispatchEvent`, or direct scroll mutation to perform the behavior under test.
- `fixture-regression`: validates rendering or interaction against seeded runtime state. Fixture setup must be isolated in named fixture helpers and the spec must not be presented as a full user journey.
- `integration`: validates command/service/runtime wiring. Direct command/API calls are allowed, but include at least one separate user-path spec for user-facing entry points when the feature has UI.
- `protocol`: validates the embedded WebDriver or bridge itself.

If a user-path spec needs an internal shortcut, first improve the app UI hook, page object, user-action helper, or embedded WebDriver capability. Use internal shortcuts only for setup/assert/cleanup with `e2e-fixture-allowed: <reason>`.
```

### E2E guide 可增加的写作模板

让每个新 spec 文件头强制回答：

```ts
/**
 * E2E type: user-path
 * User promise: A user can open Settings from the app chrome and change the Models tab.
 * Setup shortcuts: none
 * Internal probes: DOM layout metrics only, assertion phase
 * Forbidden in Act: browser.execute, store mutation, Tauri invoke, dispatchEvent, scrollTop mutation
 */
```

如果是 fixture regression：

```ts
/**
 * E2E type: fixture-regression
 * User promise: none; this verifies FlowChat virtualized rendering against a seeded session.
 * Fixture: seedStreamingFlowChatFixture
 * User actions after fixture: expand tool card, wheel scroll, click jump-to-latest
 */
```

### 给 Codex/agent 的 prompt 约束

当要求“写一个 E2E”时，提示应包含：

```text
先判断这是 user-path、fixture-regression、integration 还是 protocol。
如果是 user-path，Act 阶段只能通过用户可见 UI、键盘、鼠标、滚轮、菜单、对话框、文件选择器完成。
不要用 browser.execute、store setState、Tauri invoke、feature API、dispatchEvent 或 scrollTop 直接完成被测行为。
如果真实 UI 缺入口，优先补入口或测试 helper；不能补时，把测试降级并说明它不是用户路径验收。
```

做 code review 时，prompt 还应要求：

```text
检查 E2E 是否证明了用户能完成任务，而不是只证明内部 API 可调用。
特别标记 Act 阶段的 browser.execute、Tauri invoke、store mutation、DOM event dispatch、direct scroll mutation。
```

## 现有测试的迁移建议

### Files Workbench

- 第一个 spec 有真实 UI 操作价值，但 `openFilesHome()` 用 `openWorkspaceScene` 绕过入口，ctrl 多选用 `dispatchEvent`。应改成从 app/shell 真实入口打开 Files，并用 WebDriver action 做 ctrl-click。
- 后面直接调用 `fileWorkbenchAPI.planOperations/executePlan/restoreAuditItem` 的测试应拆成 integration 或 core/service 测试。若要保留 E2E 意义，需要补 UI 上的 plan review、confirm、execute、restore 路径。

### Goal mode

- `/goal` slash command、banner、header panel、resume/review/clear 这些是好的用户路径。
- setup 通过 store/manager 创建 session，completion 通过 `execute_tool` 直接提交证据并 complete。建议拆成两个测试：
  - `user-path`: 用户输入 `/goal`，看到目标被创建，可 pause/resume/review/clear。
  - `integration`: 目标工具 lifecycle、evidence、verification、completion 的 command/tool 层验证。

### FlowChat/Subagent scroll

- 这类测试需要大块合成消息，很适合 `fixture-regression`。
- 保留 fixture seed，但显式分类，不叫完整用户路径。
- 滚动改为 wheel action helper；不要 `scrollTop = ...`。

### Settings layout

- DOM metrics 作为断言合理。
- 打开 settings tab 不应直接 `openWorkspaceScene('settings')` + `setActiveTab`。应通过真实设置入口和 tab 点击；如果入口太难用，补 page object/用户动作 helper。

### Model selector hover

- 通过 `configManager.setConfig` seed 模型配置可以是 setup fixture。
- hover 本身应只用 `moveTo`/pointer action。如果 highlight 不稳定，优先修驱动 hover 或组件 hover 事件，而不是补一串 `dispatchEvent`。

## 推进顺序

1. 先加分类规范和文档模板，不动大量 spec。
2. 新增 `user-actions.ts`，覆盖点击、输入、快捷键、hover、wheel、ctrl-click。
3. 新增 faithfulness checker，先 report-only。
4. 把 `files-workbench`、`settings-ui-layout`、`model-selector-hover-highlight` 作为第一批迁移样板。
5. 把 FlowChat/Subagent scroll 明确改成 fixture-regression，并把 fixture seed 收敛到 helpers。
6. checker 对新增 user-path 绕路变成 fail。

这样改完后，E2E 会重新变成产品验收资产：它不仅告诉我们“代码路径能跑”，还告诉我们“真实用户真的能在 Sparo OS 桌面 UI 里完成这件事”。
