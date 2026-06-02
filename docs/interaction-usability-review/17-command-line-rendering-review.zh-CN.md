# 命令行场景渲染体验审视

审视日期：2026-06-02

审视范围：

- Web UI Shell / Terminal 场景：`src/web-ui/src/app/scenes/shell`、`src/web-ui/src/app/scenes/terminal`、`src/web-ui/src/tools/terminal`
- FlowChat 命令执行卡片：`src/web-ui/src/flow_chat/tool-cards/TerminalToolCard.tsx`
- 桌面终端桥接：`src/apps/desktop/src/api/terminal_api.rs`
- CLI TUI：`src/apps/cli/src/ui`
- E2E 覆盖：`tests/e2e/specs/l1-terminal.spec.ts`

## 总体判断

命令行场景已经不是一个简单的 terminal widget，而是由三条体验链路组成：

1. 用户手动进入 Shell 场景，新建/选择会话，在右侧 xterm 中交互。
2. Agent/FlowChat 执行 Bash 工具，在聊天卡片中预览输出，并可跳转到完整终端。
3. CLI TUI 在原生终端中渲染启动页、聊天页、Markdown、命令状态和快捷键。

当前最大风险不是单点功能缺失，而是“真实渲染体验缺少可信验证”。现有 Web E2E 终端用例可以在没有打开终端场景的情况下通过；CLI TUI 的部分测试则把已经乱码的基线当作参考输出。也就是说，用户看到的命令行体验可能退化，但验证体系仍然绿灯。

## 关键发现

### P1：Web 终端 E2E 没有真正覆盖终端场景

证据：

- `tests/e2e/specs/l1-terminal.spec.ts:46`、`:123`、`:145`、`:166`、`:194`、`:237` 仍在查找旧的 `.bitfun-terminal` 选择器，而当前终端组件实际渲染 `.sparo-terminal`，见 `src/web-ui/src/tools/terminal/components/Terminal.tsx:688` 和 `Terminal.scss:3`。
- 用例中多处在找不到终端时只断言 `typeof exists` 或 `typeof terminalFound` 是 boolean，导致没有终端也可通过。
- 本轮执行 `pnpm run e2e:test:spec -- tests/e2e/specs/l1-terminal.spec.ts` 返回 `exit 0`，但完成截图 `tests/e2e/reports/screenshots/l1-terminal-complete-2026-06-02T04-01-11-779Z.png` 停留在 FlowChat 首页，没有 ShellNav、TerminalScene 或 xterm。

影响：

- 终端入口、创建会话、输入回显、输出渲染、resize、历史回放、主题刷新都没有被真实端到端覆盖。
- 团队容易误判“终端体验已有 L1 保护”。

建议：

- 重写为真正打开 Shell 场景的 focused spec：点击底部/导航 Shell 入口，点击新建终端，等待 `.sparo-terminal .xterm`，输入 `echo SPARO_TERMINAL_E2E` 并断言回显/输出。
- 删除 `.bitfun-terminal` 兼容选择器，新增稳定 `data-testid`：Shell 入口、新建终端按钮、ShellNav item、Terminal root、xterm viewport。
- 把“找不到终端时记录日志但继续通过”的断言改为硬失败。

### P1：CLI 启动页的品牌 wordmark 和测试基线已经乱码

证据：

- `src/apps/cli/src/ui/startup.rs:44` 的 `WORDMARK_ROWS` 直接包含 mojibake 字符，例如 `鈻熲枅...`。
- 多个启动页测试继续断言这些 mojibake 常量，例如 `startup_home_uses_sparo_os_weighted_brand_wordmark_on_roomy_terminals` 在 `startup.rs:2367`、`:2368` 验证 `WORDMARK_ROWS` 出现在输出中。
- `startup_home_composer_hints_live_in_the_box_border`、`startup_home_composer_box_edges_stay_aligned` 等测试也出现 `鈹?`、`鈹€` 等坏字符断言，说明参考输出本身已污染。

影响：

- CLI roomy terminal 第一屏会显示损坏字符，直接伤害品牌感和可读性。
- 测试无法发现该问题，因为测试期待值也来自同一组坏字符。

建议：

- 恢复为明确的 Unicode box drawing / block glyph 源文本，或改成 ASCII fallback wordmark，避免源文件编码漂移影响。
- 为 CLI TUI 增加“禁止 mojibake 字符片段”的断言，例如输出不得包含 `鈻`、`鈹`、`锟`、`脳`、`鉂`。
- 把参考结构测试拆成语义断言：包含 `Sparo OS` 或确定的合法 glyph，而不是直接复用被测常量。

### P1：Web TerminalScene / ConnectedTerminal 存在用户可见乱码和未本地化文案

证据：

- `src/web-ui/src/tools/terminal/components/ConnectedTerminal.tsx:442` 状态栏显示 `{session.cols}脳{session.rows}`，`脳` 是乘号 mojibake，用户会看到类似 `120脳32`。
- 同文件还有硬编码英文用户文案：`Connecting to terminal...`、`Retry`、`Send Ctrl+C`、`Close terminal`、`Paste multiple lines`、`Paste`、`Cancel`、`Exit code`。这些出现在 zh-CN UI 时会混杂语言。
- `src/web-ui/src/app/scenes/terminal/TerminalScene.tsx:2`、`src/web-ui/src/app/scenes/shell/ShellScene.tsx:2`、`src/web-ui/src/app/stores/terminalSceneStore.ts:2` 的注释同样出现 mojibake，虽然注释不直接影响用户，但说明该区域发生过编码污染。

影响：

- Shell 场景里最底部状态栏是高频可见区域，`cols x rows` 乱码会持续暴露。
- 终端错误、粘贴确认、工具栏动作在中文界面里仍然是英文，破坏整体产品一致性。

建议：

- 将 `脳` 改为 `x` 或合法 `×`，并纳入渲染测试。
- 把 ConnectedTerminal 的用户文案迁移到 `panels/terminal` 或对应 shell locale，更新 `en-US` 和 `zh-CN`。
- 对终端模块跑一次编码污染扫描，至少覆盖用户可见 TSX 和 CLI TUI 输出常量。

### P2：终端历史回放和 resize 渲染链路很复杂，但缺少场景级验证

证据：

- `Terminal.tsx` 依赖 WebGL addon、ResizeObserver、IntersectionObserver、`FitAddon.proposeDimensions()`、内部 `_core` 访问、texture atlas 清理、字体加载后二次测量等机制。
- `ConnectedTerminal.tsx` 对历史回放做了 PTY 尺寸预设、阻止 resize 收缩、ConPTY 绝对光标位置修正等特殊处理。
- `useTerminal.ts` 明确先取 history 再订阅 live event，以避免重复输出。

影响：

- 这些处理指向真实历史 bug：窗口动画中间尺寸导致永久截断、历史输出光标错位、回放和 live 输出重叠。
- 但当前 E2E 没有打开终端，也没有覆盖“已有历史 -> 打开 Shell -> resize -> 继续输入”的关键链路。

建议：

- 增加 focused E2E：创建终端，执行多行和长行输出，切换场景再返回，拖动 ShellNav 宽度，断言历史内容未截断且最新 prompt 可继续输入。
- 对 `TerminalOutputRenderer` 增加视觉/DOM 验证，覆盖 ANSI 光标序列、长行 wrap、中文宽字符和滚动高度。

### P2：FlowChat 命令输出卡片的高度估算可能低估真实渲染

证据：

- `TerminalOutputRenderer.tsx` 用 `text.split('\n')` 估算高度，每行固定 18px，再夹到 `minHeight/maxHeight`。
- 真实 xterm 会按容器宽度 wrap 长行；一行很长的命令输出在窄卡片里可能占多行，但估算仍按一行计算。
- `TerminalToolCard.tsx` 将预览高度限制为 4 行左右：`TERMINAL_OUTPUT_PREVIEW_ROWS = 4`，展开内容仍依赖 renderer 的高度估算。

影响：

- 长命令、JSON、路径列表、中文宽字符输出在 FlowChat 卡片中容易被压缩、滚动位置不直观，用户难以判断命令是否仍在输出。

建议：

- 高度应由 xterm fit 后的实际 buffer/viewport 或更保守的 wrap 估算决定。
- 命令输出卡片需要 E2E 或组件测试覆盖长行、ANSI、中文、stderr/stdout 混合输出。

### P2：Shell 场景产品模型存在多入口分叉，用户心智不够稳定

证据：

- `openShellSessionTarget.ts` 根据 `activeSurface.kind` 决定打开位置：如果不在 scene，则创建 Agent 右侧 Terminal tab；否则打开 standalone shell scene。
- ShellNav 里“Manual / Agent / All”过滤、保存的 terminal profile、运行中 session、agent session 都混在同一个列表，但空状态和上下文动作主要围绕“新建终端/删除/保存配置”。

影响：

- 同一个终端会话从 FlowChat、Shell 场景、右侧 tab 打开时位置不同，用户可能不知道“终端去哪了”。
- Agent 命令输出卡片的 “Open in panel” 与 standalone Shell 场景不是同一个心智模型。

建议：

- 明确产品语言：Shell 是“所有终端会话中心”，右侧 Terminal tab 是“当前 Agent 工作区的临时查看器”。
- ShellNav 中区分“保存的配置”和“运行中的会话”，减少用同一个垃圾桶图标同时表达关闭、删除配置、删除临时会话。

### P3：状态栏和列表的紧凑布局仍有溢出风险

证据：

- `ConnectedTerminal.tsx:437` 直接渲染 `session.cwd`，`Terminal.scss` 的 statusbar left/right 是 flex，但没有看到对 cwd 项设置 `min-width: 0`、ellipsis 或 title。
- ShellNav item 有 ellipsis，但 badges、状态 dot、hover close button 会替换可视区域；在窄 nav 下需要验证 saved/startup badge 与名称不会互相挤掉。

影响：

- 深路径工作区是常态，状态栏可能挤压 PID、尺寸、退出码，导致底部信息不可读。

建议：

- cwd 项做中间省略或末尾省略，并提供 tooltip/copy。
- focused visual test 覆盖窄 ShellNav、长 workspace name、长 terminal profile name、长 cwd。

## 架构观察

### 做得好的地方

- Core terminal API 通过桌面 Tauri command 暴露，Web UI 不直接依赖后端实现细节。
- 前端终端组件显式处理主题、字体加载、WebGL fallback、可见性恢复、resize debounce，说明已有较多真实问题被修过。
- `useTerminal.ts` 的 history-before-subscribe 策略是正确方向，避免历史和 live event 双写。
- CLI TUI 已有 Unicode width 包裹、快捷键紧凑化、ASCII spinner 等基础保护。

### 主要结构风险

- Web terminal 渲染正确性依赖 xterm 内部 API 和多个异步观察器，缺少高层 contract test。
- CLI TUI 测试过多复用源码常量作为断言，容易把坏基线固化。
- Shell 场景、TerminalScene、Agent tab、FlowChat terminal card 的打开策略分散在多个模块，缺少统一产品行为说明和端到端测试。

## 本轮验证记录

已执行：

```powershell
pnpm run e2e:test:spec -- tests/e2e/specs/l1-terminal.spec.ts
```

结果：`exit 0`。但完成截图显示应用停留在 FlowChat 首页，未进入 Shell/Terminal 场景；因此该结果只能证明当前 spec 可运行，不能证明终端体验可用。

尝试执行：

```powershell
cargo test -p sparo-cli ui::
cargo test -p sparo-cli startup_home_uses_sparo_os_weighted_brand_wordmark_on_roomy_terminals
cargo test -p sparo-cli test_render_wraps_to_terminal_width
cargo test -p sparo-cli chat_plain_message_lines_wrap_to_terminal_width
```

结果：均因本轮超时未完成。源码证据已足以确认 CLI TUI 存在 mojibake 风险，但仍建议后续在 Rust 构建缓存稳定后重跑。

## 建议优先级

1. 修复 Web 终端 E2E，让它真正打开 Shell 场景并硬断言 xterm、输入、输出、截图。
2. 修复 CLI 启动页 wordmark/box drawing mojibake，并添加禁止 mojibake 的测试。
3. 修复 ConnectedTerminal 用户可见乱码和未本地化文案。
4. 补 history replay + resize + reopen 的 focused E2E。
5. 改进 FlowChat TerminalOutputRenderer 对长行/wrap 的高度处理。
6. 梳理 Shell 场景与 Agent 右侧 Terminal tab 的产品语言和入口一致性。

