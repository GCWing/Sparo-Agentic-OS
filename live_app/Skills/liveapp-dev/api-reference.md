# Live App API 参考

此文档定义 AI 生成的 Live App 代码中可用的全部 API，供 Agent 工具 system prompt 或调试时参考。

> **实际全局对象为 `window.app`**（非 legacy host shim），以下各节均基于 `window.app`。

## 能力边界（先看这一节）

Live App **能且只能**用以下 API，没有任何"通用 Sparo OS 后端通道"。生成代码前请先确认你需要的能力在表内：

- `app.fs.*` —— 文件系统（受 `permissions.fs.read/write` 限制）
- `app.shell.exec` —— 子进程命令行（受 `permissions.shell.allow` 命令名白名单限制）
- `app.net.fetch` —— HTTP 请求（受 `permissions.net.allow` 域名白名单限制）
- `app.os.info` —— 只读系统信息
- `app.storage.get/set` —— 每应用独立 KV 存储
- `app.ai.complete / chat / cancel / getModels` —— 复用宿主 AI（无需 API Key）
- `app.agentic.createSession / sendMessage / cancelTurn / listSessions / restoreSession / deleteSession / confirmTool / rejectTool / openSession / onEvent` —— 创建/驱动真实 Sparo OS Agentic 会话
- `app.dialog.open/save/message` —— 文件对话框
- `app.clipboard.readText/writeText` —— 剪贴板
- `app.call('xxx', ...)` + `worker.js` —— 自定义 Node 后端（仅 `node.enabled = true` 时）
- `app.theme / locale / on*` —— 主题与 i18n

**框架不暴露**任意调用内部服务的通用 Sparo OS 后端通道。未开放直接 API 的能力包括：WorkspaceService（结构化搜索 / 索引）、GitService（结构化 status/diff/blame）、TerminalService、Session/AgenticSystem 的任意内部 API、LSP / Snapshot / Mermaid / Skills / Browser / Computer Use / Config 等。需要这些能力时：

1. 能用裸命令行解决就用 `app.shell.exec`（如 git → 在 `permissions.shell.allow` 加 `"git"`，参考 `live_app/Demo/git-graph`）；
2. 只是要读 Sparo OS 工作区里的文件就用 `app.fs.*`（把 `{workspace}` 加到 `permissions.fs.read`）；
3. 必须启动/驱动 Agentic 会话 → 用 `app.agentic.*`，不要用 `app.ai.chat` 模拟；
4. 必须真正调用其他内部服务 → 暂不支持，请先记录到需求池，**不要**自己 hack 一个 worker 去模拟服务行为。

## 标准 Node.js API（通过 require() shim）

### fs/promises

```javascript
const fs = require('fs/promises');
```


| 方法           | 签名                                    | 说明                                                     |
| ------------ | ------------------------------------- | ------------------------------------------------------ |
| `readFile`   | `(path, opts?) → Promise<string>`     | opts: `{ encoding: 'utf-8' | 'base64' }`               |
| `writeFile`  | `(path, data, opts?) → Promise<void>` | opts: `{ encoding: 'utf-8' | 'base64' }`               |
| `appendFile` | `(path, data) → Promise<void>`        |                                                        |
| `readdir`    | `(path, opts?) → Promise<string[]>`   | opts: `{ withFileTypes: boolean }`                     |
| `mkdir`      | `(path, opts?) → Promise<void>`       | opts: `{ recursive: boolean }`                         |
| `rmdir`      | `(path, opts?) → Promise<void>`       | opts: `{ recursive: boolean }`                         |
| `rm`         | `(path, opts?) → Promise<void>`       | opts: `{ recursive: boolean, force: boolean }`         |
| `stat`       | `(path) → Promise<Stats>`             | Returns: `{ size, isFile, isDirectory, mtime, ctime }` |
| `lstat`      | `(path) → Promise<Stats>`             |                                                        |
| `access`     | `(path) → Promise<void>`              | throws if not accessible                               |
| `copyFile`   | `(src, dst) → Promise<void>`          |                                                        |
| `rename`     | `(oldPath, newPath) → Promise<void>`  |                                                        |
| `unlink`     | `(path) → Promise<void>`              |                                                        |


### path（纯 JS，零延迟）

```javascript
const path = require('path');
```

`join`, `resolve`, `dirname`, `basename`, `extname`, `parse`, `sep`

### child_process

```javascript
const { exec } = require('child_process');
```


| 方法     | 签名                                         | 说明                       |
| ------ | ------------------------------------------ | ------------------------ |
| `exec` | `(cmd, opts?, callback?) → Promise | void` | opts: `{ cwd, timeout }` |


支持两种调用风格：

- **Promise 风格**：`const result = await exec(cmd, opts)` → 返回 `{ stdout, stderr, exit_code }`
- **Callback 风格**：`exec(cmd, opts, (err, stdout, stderr) => { ... })` → 无返回值

受 `permissions.shell.allow` 命令白名单限制。

### os（纯 JS）

```javascript
const os = require('os');
```

`platform()`, `homedir()`, `tmpdir()`, `cpus()`, `hostname()`

### crypto

```javascript
const crypto = require('crypto');
```

映射 `window.crypto.subtle`，支持 `randomUUID()`。

## 标准浏览器 API

Live App 运行在 iframe 中，完整支持:

- DOM、CSS（含 CSS 变量 `--sparo-bg`, `--sparo-text`, `--sparo-accent` 等）
- Canvas 2D / WebGL
- Web Audio
- LocalStorage / SessionStorage（iframe 级隔离）
- `navigator.clipboard`（通过 `app.clipboard.*` 代理，绕过 sandbox 限制）

## `window.app` — 全局 Runtime Adapter

Live App 中所有与宿主通信的 API 均通过 `window.app` 暴露。

### 基本属性

```javascript
app.appId        // string — 当前 Live App 的 ID
app.appDataDir   // string — 应用数据目录绝对路径
app.workspaceDir // string — 当前工作区路径
app.theme        // 'dark' | 'light' — 当前主题
app.locale       // string — 当前语言 ID（如 'zh-CN' / 'en-US'），随宿主切换更新
app.platform     // 'win32' | 'darwin' | 'linux'
app.mode         // 'hosted'
```

### `app.fs.*` — 文件系统

需在 `permissions.fs` 中声明读写范围。


| 方法           | 签名                                    | 说明                                             |
| ------------ | ------------------------------------- | ---------------------------------------------- |
| `readFile`   | `(path, opts?) → Promise<string>`     | opts: `{ encoding: 'utf-8' | 'base64' }`       |
| `writeFile`  | `(path, data, opts?) → Promise<void>` | opts: `{ encoding: 'utf-8' | 'base64' }`       |
| `appendFile` | `(path, data) → Promise<void>`        |                                                |
| `readdir`    | `(path, opts?) → Promise<string[]>`   | opts: `{ withFileTypes: boolean }`             |
| `mkdir`      | `(path, opts?) → Promise<void>`       | opts: `{ recursive: boolean }`                 |
| `rm`         | `(path, opts?) → Promise<void>`       | opts: `{ recursive: boolean, force: boolean }` |
| `stat`       | `(path) → Promise<Stats>`             | `{ size, isFile, isDirectory, mtime, ctime }`  |
| `copyFile`   | `(src, dst) → Promise<void>`          |                                                |
| `rename`     | `(oldPath, newPath) → Promise<void>`  |                                                |


### `app.storage.*` — KV 持久化存储

无权限要求，数据存储在 `{appdata}/storage.json`。

```javascript
await app.storage.set('myKey', { foo: 'bar' });
const value = await app.storage.get('myKey'); // { foo: 'bar' }
```

### `app.dialog.*` — 系统对话框

```javascript
const path = await app.dialog.open({
  title: '选择文件',
  multiple: false,
  filters: [{ name: 'SVG', extensions: ['svg'] }]
});
const savePath = await app.dialog.save({ title: '保存', defaultPath: 'output.svg' });
await app.dialog.message({ title: '提示', message: '操作成功' });
```

### `app.shell.*` — Shell 命令执行

需在 `permissions.shell.allow` 中声明命令白名单。

```javascript
const result = await app.shell.exec('git log --oneline -10', { cwd: app.workspaceDir });
```

### `app.net.*` — 网络请求（Worker 侧）

需在 `permissions.net.allow` 中声明域名白名单。

```javascript
const data = await app.net.fetch('https://api.example.com/data', { method: 'GET' });
```

### `app.os.*` — 系统信息

```javascript
const info = await app.os.info(); // { platform, homedir, tmpdir, ... }
```

### `app.call(method, params)` — 调用 Worker 方法

调用 `source/worker.js` 中导出的函数。

```javascript
const result = await app.call('myWorkerMethod', { key: 'value' });
```

> **要求 `permissions.node.enabled = true`**。`node.enabled = false` 时只能调用宿主桥接原语（`app.fs.* / shell.* / net.* / os.* / storage.* / ai.* / agentic.*`），调用任何自定义方法会得到明确的错误提示。

---

## `app.ai.*` — AI 接口（v2）

直接复用宿主应用的 AI Client，无需配置 API Key。需在 `permissions.ai` 中声明。

### `app.ai.complete(prompt, opts?)` — 单次补全

返回完整文本，适合一次性生成场景。

```javascript
const result = await app.ai.complete('生成一个设置图标的 SVG，viewBox 24x24，线性风格', {
  systemPrompt: '你是一个图标设计专家，只输出 SVG 代码，不含任何说明文字。',
  model: 'fast',        // 'primary' | 'fast' | 具体 model_id，默认 'primary'
  maxTokens: 4096,
  temperature: 0.7,
});
console.log(result.text);   // SVG 字符串
console.log(result.usage);  // { promptTokens, completionTokens, totalTokens }
```

### `app.ai.chat(messages, opts?)` — 流式对话

支持多轮对话和流式输出，适合交互式生成场景。

```javascript
const handle = await app.ai.chat(
  [
    { role: 'user', content: '设计一个首页图标，圆角风格，24px 网格' }
  ],
  {
    systemPrompt: '你是图标设计专家，生成符合设计规范的 SVG 代码。',
    model: 'primary',
    onChunk: ({ text, reasoningContent }) => {
      // 实时更新预览
      if (text) appendToPreview(text);
    },
    onDone: ({ fullText, usage }) => {
      // 完成后处理完整结果
      const svg = extractSvg(fullText);
      renderIcon(svg);
    },
    onError: ({ message }) => {
      console.error('AI error:', message);
    },
  }
);

// 取消流式请求
cancelButton.onclick = () => handle.cancel();

// handle.streamId — 当前流的唯一 ID
```

### `app.ai.getModels()` — 查询可用模型

返回当前 Live App 权限范围内可用的模型列表（不含 API Key 等敏感信息）。

```javascript
const models = await app.ai.getModels();
// [{ id: 'gpt4o', name: 'GPT-4o', provider: 'openai', isDefault: true }, ...]
```

### `app.ai.cancel(streamId)` — 取消流式请求

```javascript
await app.ai.cancel(handle.streamId);
```

### AI 权限声明

```json
{
  "permissions": {
    "ai": {
      "enabled": true,
      "allowed_models": ["primary", "fast"],
      "max_tokens_per_request": 8192,
      "rate_limit_per_minute": 30
    }
  }
}
```

- `allowed_models`：可用模型引用列表，支持 `"primary"`、`"fast"` 及具体 model_id；为空则允许所有模型
- `rate_limit_per_minute`：每分钟最大请求次数（按 app 计数）
- 当前后端实际强制 `enabled`、`allowed_models`、`rate_limit_per_minute`；`max_tokens_per_request`、调用参数 `maxTokens` 和 `temperature` 已在 DTO 中保留，但尚未传入底层 AI 请求，不要依赖它们做硬限制。

---

## `app.agentic.*` — Sparo OS Agentic 会话接口（v2）

当 Live App 需要创建/管理一个真正的 Sparo OS Agentic 会话、把 prompt 交给 Sparo OS 执行、接收工具事件/错误/完成事件，并允许用户跳转到原生 Flow Chat 查看时，使用 `app.agentic.*`。

不要用 `app.ai.chat` 模拟 Agentic 会话；`app.ai.*` 只直连模型，不经过 Sparo OS 的工具链、会话持久化、调度、压缩和原生查看能力。

### `app.agentic.createSession(opts?)`

```javascript
const session = await app.agentic.createSession({
  sessionName: 'Project helper',
  agentType: 'agentic', // 'agentic' | 'Plan' | 'LiveAppStudio' 等权限允许的模式
  model: 'auto',
});
// { sessionId, sessionName, agentType, workspacePath }
```

### `app.agentic.sendMessage(sessionId, prompt, opts?)`

```javascript
const turn = await app.agentic.sendMessage(session.sessionId, 'Analyze this workspace');
// { sessionId, turnId, status: 'started' | 'queued' }
```

### `app.agentic.onEvent(handler)`

宿主只会把当前 Live App 拥有的 Agentic session 事件转发进 iframe。

```javascript
app.agentic.onEvent((event) => {
  if (event.sourceEvent === 'agentic://text-chunk') appendAssistantText(event.text || '');
  if (event.sourceEvent === 'agentic://tool-event') renderToolEvent(event.toolEvent);
  if (event.sourceEvent === 'agentic://dialog-turn-failed') showError(event.error || 'Agentic turn failed');
  if (event.sourceEvent === 'agentic://dialog-turn-completed') markDone(event.turnId);
});
```

### 其他方法

- `app.agentic.cancelTurn(sessionId, turnId)`
- `app.agentic.listSessions()`
- `app.agentic.restoreSession(sessionId)`
- `app.agentic.deleteSession(sessionId)`
- `app.agentic.confirmTool(sessionId, toolId, { updatedInput? })`
- `app.agentic.rejectTool(sessionId, toolId, { reason? })`
- `app.agentic.openSession(sessionId)` — 跳转到 Sparo OS 原生 Flow Chat 会话

### Agentic 权限声明

```json
{
  "permissions": {
    "agentic": {
      "enabled": true,
      "allowed_agents": ["agentic", "Plan", "LiveAppStudio"],
      "allow_workspace": false,
      "max_sessions": 5,
      "allow_tools": true
    }
  }
}
```

- `allow_workspace` 默认保持 `false`。只有用户明确要求 Live App 绑定/读取当前工作区时才开启，并写清 `permission_rationale`。
- `allow_tools` 为 `true` 时仍由 Sparo OS safe mode 和工具确认机制保护，不要在 Live App 中静默批准高风险工具。

---

## `app.clipboard.*` — 剪贴板

通过宿主代理，绕过 iframe sandbox 的 clipboard 限制。

```javascript
await app.clipboard.writeText('Hello World');
const text = await app.clipboard.readText();
```

---

## 生命周期钩子

```javascript
app.onActivate(() => { /* Tab 变为活跃状态 */ });
app.onDeactivate(() => { /* Tab 切走 */ });
app.onThemeChange((payload) => {
  // payload: { type: 'dark'|'light', vars: { '--sparo-bg': '...', ... } }
});
app.onLocaleChange((locale) => {
  // locale: 新的语言 ID 字符串（如 'zh-CN' / 'en-US'）
});
```

## 国际化 i18n

### `app.t(table, fallback)` — 多语言字符串挑选

```javascript
const label = app.t({ 'zh-CN': '保存', 'en-US': 'Save' }, 'Save');
```

挑选顺序：`app.locale` → `'en-US'` → `'zh-CN'` → 表的第一个值 → `fallback`。适合在 JS 里就地写少量翻译。

更完整的做法（推荐）：

1. 在 `meta.json` 顶层加 `i18n.locales` 块翻译 `name` / `description` / `tags`，宿主 Gallery 自动按当前语言显示。
2. 在 HTML 静态文案上加 `data-i18n="key"`（可选 `data-i18n-attr="aria-label"` 翻译属性）。
3. 在 `ui.js` 中维护 `I18N` 字典，封装 `t(key)` 与 `applyStaticI18n()`，并 `app.onLocaleChange(...)` 时重新渲染动态内容。
4. `app.storage` 持久化的字段保存语言无关的索引/键，避免存了翻译后字符串导致切换语言失效。

参考实现：`bundles/live-apps/spark-board/ui.js`、`bundles/live-apps/ppt-live/ui.js`。

## 自定义事件

```javascript
app.on('myEvent', (payload) => { /* 处理事件 */ });
app.off('myEvent', handler);
```

---

## `app.dialog.*` — 系统对话框（详细）

### `app.dialog.open`

```javascript
const filePath = await app.dialog.open({
  title: '选择文件',
  directory: false,           // true 选目录
  multiple: false,            // true 多选
  filters: [
    { name: 'Images', extensions: ['png', 'jpg', 'webp'] }
  ]
});
```

### `app.dialog.save`

```javascript
const savePath = await app.dialog.save({
  title: '保存文件',
  defaultPath: 'output.png',
  filters: [
    { name: 'PNG', extensions: ['png'] }
  ]
});
```

## 权限声明格式

```json
{
  "permissions": {
    "fs": {
      "read": ["{workspace}", "{appdata}", "{user-selected}"],
      "write": ["{appdata}", "{user-selected}"]
    },
    "shell": {
      "allow": ["git", "ffmpeg"]
    },
    "net": {
      "allow": ["api.example.com", "cdn.jsdelivr.net"]
    },
    "ai": {
      "enabled": true,
      "allowed_models": ["primary", "fast"],
      "max_tokens_per_request": 8192,
      "rate_limit_per_minute": 30
    },
    "agentic": {
      "enabled": true,
      "allowed_agents": ["agentic", "Plan", "LiveAppStudio"],
      "allow_workspace": false,
      "max_sessions": 5,
      "allow_tools": true
    },
    "node": {
      "enabled": true,
      "timeout_ms": 30000
    }
  }
}
```

### 无 Node 模式：`node.enabled = false`

如果你的小应用只用 `app.fs.* / app.shell.* / app.net.fetch / app.os.info / app.storage.* / app.ai.* / app.agentic.*`（即不需要在 `worker.js` 里自定义任何方法、也不需要安装 npm 依赖），把 `node.enabled` 设为 `false`：

```json
{
  "permissions": {
    "fs":   { "read": ["{workspace}", "{appdata}"], "write": ["{appdata}"] },
    "shell": { "allow": ["git"] },
    "node": { "enabled": false }
  }
}
```

宿主会把这些框架原语直接路由到 Rust 实现（`bitfun_core::live_app::host_dispatch`），完全不需要 Bun/Node 运行时；权限策略与 Worker 路径共用同一份 `resolve_policy`，行为完全等价。在这种模式下：

- `app.shell.exec` / `app.fs.*` / `app.net.fetch` / `app.os.info` / `app.storage.get|set` / `app.ai.*` / `app.agentic.*` —— 全部可用；
- `app.call('myCustomMethod', …)` —— **不可用**（宿主会显式报错），需要走完整的 Worker 路径请把 `node.enabled` 设回 `true` 并提供 `worker.js`。

推荐：所有"只是包一下 git/curl/系统命令"的开发者工具型小应用都使用此模式，避免 bundle 后宿主缺少 Bun/Node 时的运行时报错。

路径变量:

- `{appdata}` — `{user_data_dir}/liveapps/{app_id}/data/`，始终可读写
- `{workspace}` — 当前打开的工作区路径
- `{user-selected}` — 用户通过 app.dialog.open/save 选择的路径
- `{home}` — 用户主目录（高风险）

## CDN 依赖

通过 `source.dependencies` 声明，编译器自动注入 `<script>/<link>` 标签:

```json
{
  "dependencies": [
    { "url": "https://cdn.jsdelivr.net/npm/fabric@5/dist/fabric.min.js", "type": "script" },
    { "url": "https://cdn.jsdelivr.net/npm/monaco-editor@0.40/min/vs/loader.js", "type": "script" }
  ]
}
```

依赖 URL 的域名必须在 `permissions.net.allow` 中声明。
