# Sparo Files —— Agentic OS 原生文件场景设计

> 一步到位的最终形态方案。本文不区分迭代阶段，描述的是"做完之后系统应有的样子"。
> 实施次序由工程侧另行裁剪。

---

## 1. 目标与原则

### 1.1 目标
把当前位于 `src/web-ui/src/app/scenes/file-viewer/` 的 Workspace File Viewer 重塑为 **Sparo Files** —— Agentic OS 的伴生文件场景，同时具备：

- **System Explorer**：可浏览任意盘符 / 任意路径 / 外接设备 / 网络位置；
- **Multi-Workspace Cockpit**：`openedWorkspaces` 与 `recentWorkspaces` 作为一等公民进行横向切换与对比；
- **Agentic Companion**：每个目录、每个文件都可一键召唤 Sparo Agent 或 Files 类 Agent App，自然语言驱动查找、整理、批处理。

### 1.2 原则
1. **不建索引、不入向量**。所有"语义级"检索一律走 **Agentic Search**：以 `Grep / Glob / Read / LS` 为底层工具，由 `FileFinderAgent`（已有）规划与归纳。
2. **AI 能力必须落入既有体系**：
   - 系统固化能力 → **内置 Agent**（新增 `FilesAgent`），通过 `agents/registry.rs` 注册；
   - 用户/官方分发能力 → **Agent App**（FlowChat-native，`category=files`），通过 `agentAppAPI` 装载。
3. **场景是壳，Agent 是核**。Files 场景**不持有 AI runtime**，所有 AI 调用统一通过 FlowChat 启动会话，并附带 `FilesContext`。
4. **最大化复用**已有 `FileExplorer / useFileSystem / useExplorerSearch / workspaceAPI / workspaceManager / FlowChat / AgentRegistry / Agent App` 资产，新增模块控制到最小集合。
5. **职责清晰**：workspace 作用域与系统级作用域分离；read-only 元信息访问与写操作分离；UI 调用统一收口到 API 层。

---

## 2. 产品设计

### 2.1 信息架构

```
Sparo Files (scenes/files)
├─ Home               起始页：最近工作区 / 收藏 / Files Agent Apps
├─ Workspaces         多工作区切换条 + 每工作区文件树
├─ This PC            盘符 / 系统快捷目录（桌面/下载/文档…）/ 网络位置
├─ Pinned             用户跨域收藏（文件 + 目录）
└─ (常驻) Ask Sparo   右上角按钮，唤起 FlowChat 并注入当前选择
```

UI 骨架为 **三段式**：
- Activity Bar (48px)：Home / Workspaces / This PC / Pinned；
- Side Bar（可拖宽，默认 260px）：当前活动栏对应的列表/树；
- Main：地址栏 + 主视图（树/列表/网格/缩略图，可分屏）+ 底部状态条。

### 2.2 关键场景

#### A. 任意盘符 / 任意路径
- "This PC" 视图：所有盘符（带容量条、可移除/网络标识）+ 系统快捷目录。
- **地址栏（Breadcrumb + Path Input 双模）**：面包屑可点；点击空白处变成输入框，支持 `D:\xx`、`~/Downloads`、`\\server\share`，Tab 补全。
- 后退 / 前进 / 向上 / 刷新 + 历史下拉，浏览器式。
- 视图切换：树 / 列表 / 网格 / 缩略图（图片/视频自动缩略）。

#### B. 多工作区快速访问
- 顶部 **Workspace Switcher Bar**：消费 `workspaceManager.openedWorkspacesList`，作为可固定 Tab；`Ctrl+1..9` 切换；右键 Pin / Close / Reveal in This PC / Open New Window；末尾 `+` 从最近列表或浏览文件夹打开。
- **Home Recent Cards**：消费 `recentWorkspaces`，每张卡片显示名字、路径、上次活跃时间、最近 session 标题；悬停展开"上次离开正在做什么"。

#### C. Agentic 统一入口（核心）

**所有 AI 入口都解析为：在 FlowChat 中以预选 Agent / Agent App 启动一轮会话，并注入 `FilesContext`**。Files 场景不引入新的 AI runtime。

| 入口 | 启动方式 |
|---|---|
| 右上常驻 **Ask Sparo** | `Agentic` 主代理，上下文 = 当前目录 + 当前选择 |
| 地址栏右侧 **Find…** / `Ctrl+P` Omnibox | `FileFinder` 子代理（已有），自然语言找文件 |
| 文件/目录右键 **Ask Sparo about this…** | `FilesAgent`（新增），上下文 = 该路径 |
| 多选后 **Operate with Sparo…** | `FilesAgent`，上下文 = 选中集合，提示偏批处理 |
| Home / 抽屉 **Files Agent Apps** | 列出 `category=files` 的 Agent App，点击 = 用该 App 启会话 |

#### D. 检索（Agentic Search，无索引）

Omnibox 统一：
- **文件名模糊**：本地走 `Glob` / 前端已加载树，瞬时；
- **全文关键字**：走 `Grep`（与现 `useExplorerSearch` 一致）；
- **语义查找**：直接把 query 转交 `FileFinder`，由它自行用 Grep/Glob/Read 规划；结果以 FlowChat 形式呈现，附"在 Files 中打开"动作。
- Scope 切换：当前目录 / 当前工作区 / 所有 openedWorkspaces / This PC。
- This PC 大范围搜索默认 disabled，要求先用 Glob 缩范围；FileFinder 设 30s/200 文件读取上限并报告进度。

#### E. 关键交互
- **选择 = 上下文**：选中即写入 `useFilesSelection` 全局 store，所有 AI 按钮据此重写其提示模板；
- **AI 写操作走标准链**：复用 FlowChat 的 `tool-card` 二次确认与撤销，不为 Files 自建撤销栈；
- **权限**：工作区外路径首次访问触发一次性显式授权（系统层 macOS FDA / Windows UAC 由 OS 兜底）；
- **多窗格**：水平/垂直分屏，比较两个目录，每窗格独立地址栏与选择上下文。

---

## 3. 与现有文件系统的职责划分

这是本次设计的关键。明确边界，避免重复造轮子。

### 3.1 三层 FS 责任划分

| 层级 | 模块 | 责任 | 备注 |
|---|---|---|---|
| **L1 元数据访问层** | `service/system_fs/`（**新增**） | 盘符枚举、系统快捷目录、`list_dir/stat/reveal_in_os/open_with_default`、缩略图、路径权限校验 | 不感知 workspace；所有路径均以绝对路径为契约 |
| **L2 工作区域语义层** | `service/workspace/`（已存在，**不改职责**） | `openedWorkspaces / recentWorkspaces / lastUsedWorkspace` 状态、持久化、session 维护、runtime 初始化 | 不做底层 fs；底层调用下沉到 L1 |
| **L3 写操作层** | `workspaceAPI` 上的 CRUD（`createFile/createDirectory/renameFile/deleteFile/pasteFiles/...`） | 文件/目录写操作；FS watcher；workspace 内 transfer | 当前实现绑死 workspace，**重构为通用 fs 操作并加 workspace 校验包装**，详见 3.3 |

### 3.2 模块去向

| 现状（绑 workspace） | 目标 | 处置 |
|---|---|---|
| `workspaceAPI.listDirectory(path)` | `systemFsAPI.listDirectory(path)` | 下沉到 L1；`workspaceAPI` 删除该方法或保留为薄包装 |
| `workspaceAPI.createFile/createDirectory/renameFile/deleteFile/deleteDirectory` | `systemFsAPI.*` + workspace 边界校验 | 下沉到 L1，校验逻辑由调用方提供 `scope`（workspace/system/pinned） |
| `workspaceAPI.revealInExplorer` | `systemFsAPI.revealInOs` | 下沉到 L1 |
| `workspaceAPI.getClipboardFiles/pasteFiles` | `systemFsAPI.clipboard.*` | 下沉到 L1 |
| `workspaceFileTransfer`（前端 service） | 不动 | 仍服务于"对话/远程会话场景下的工作区上传下载"，本地浏览不需要 |
| `tools/file-system/FileExplorer / useFileSystem / useExplorerSearch` | 不动，**参数化** | 把 `workspacePath` 形参语义改为通用 `rootPath`；移除"必须有 workspace 才能用"假设 |

### 3.3 写操作的边界模型

新增一个轻量 `scope` 概念，由调用方携带（不需要后端持久化）：

```ts
type FsScope =
  | { kind: 'workspace'; workspaceId: string; root: string }
  | { kind: 'system';   allowed: 'auto'|'prompt'|'denied' }
  | { kind: 'pinned';   pinId: string };
```

后端 `system_fs` 在执行写操作前调用一次 `permission::check(path, scope)`：
- `workspace`：仅允许 `path startsWith root`；
- `system`：首次写入弹一次性授权，记忆到 `pinned_paths.json` 的 `granted_roots`；
- `pinned`：必须命中已 pin 路径。

Agent 走 `Edit/Write/Bash` 工具时不感知 scope —— 由现有 readonly policy / tool policy / 用户确认链路兜底（参考 Agent App `toolPolicies`）。

### 3.4 与 `workspace_runtime` / `session_workspace_maintenance` 关系
不动。Files 场景只通过 `workspaceManager`（前端）→ `WorkspaceService`（后端）间接驱动，**不直接调用** runtime / maintenance。任何 workspace 打开/激活引起的 runtime 准备由 `WorkspaceService` 原链路负责。

---

## 4. 架构设计

### 4.1 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│ UI Layer  (src/web-ui)                                       │
│  scenes/files/                       ← 由 file-viewer 改名   │
│    FilesShell                       三段式骨架                │
│    activity-bar/                    Home/Workspaces/ThisPC/Pinned │
│    panes/                                                    │
│      HomePane                       最近 + 收藏 + Files Apps  │
│      WorkspacesPane                 SwitcherBar + FilesExplorer│
│      SystemPane                     盘符 / Quick Folders      │
│      PinnedPane                                              │
│    explorer/FilesExplorer           复用 tools/file-system    │
│    address-bar/                                              │
│    omnibox/                         Ctrl+P → FileFinder       │
│    ai-entries/                      Ask Sparo / Operate / Find│
├──────────────────────────────────────────────────────────────┤
│ Stores / Hooks                                               │
│   useFilesNavigation                后退/前进/scope/历史      │
│   useWorkspaceSwitcher              复用 workspaceManager     │
│   useSystemBrowser                  盘符 / 快捷目录            │
│   usePinned                         收藏                       │
│   useFilesSelection                 全局选择上下文              │
│   useFileSystem (existing)          rootPath 参数化            │
├──────────────────────────────────────────────────────────────┤
│ API Layer (TS, infrastructure/api)                           │
│   workspaceAPI    existing：退化为 workspace 语义薄包装        │
│   systemFsAPI     新增：list_drives/quick_folders/list_dir/    │
│                       stat/reveal/open_with/clipboard/CRUD     │
│   pinnedAPI       新增：JSON 持久化                            │
│   filesContextAPI 新增：把 FilesContext stash 给下一个 FlowChat│
│   flowChatAPI     existing：startSession(agentId, ctx)         │
│   agentAppAPI     existing：列出 / 启动 files 类 App            │
├──────────────────────────────────────────────────────────────┤
│ Tauri / RPC                                                  │
│   commands/system_fs.rs   drives / quick / stat / reveal / CRUD│
│   commands/pinned.rs      load/save pinned                    │
│   commands/files_ctx.rs   build & stash FilesContext           │
├──────────────────────────────────────────────────────────────┤
│ Core Services (Rust, src/crates/core)                        │
│   service/workspace/      existing，无改                       │
│   service/system_fs/      新增：L1 元数据 + 写操作 + 权限      │
│   service/pinned/         新增：极轻 JSON 持久化                │
│   service/files_context/  新增：内存级 FilesContext registry    │
├──────────────────────────────────────────────────────────────┤
│ Agentic Layer  (完全复用现有体系，无新 runtime)               │
│   agents/files_agent.rs          ← 新增内置 Agent             │
│   agents/file_finder_agent.rs    existing，作为子代理引用     │
│   agents/prompts/files_agent.md  ← 新增 prompt 模板           │
│   AgentCategory::Files           ← 新增分类（如缺）            │
│   Agent Apps (category=files)：                              │
│     · Batch Renamer                                          │
│     · Downloads Tidy                                         │
│     · Image Album                                            │
│     · Project Inspector                                      │
├──────────────────────────────────────────────────────────────┤
│ Storage（轻量、无索引/向量）                                  │
│   pinned_paths.json                                          │
│   files_context_cache.json （进程内为主，落盘为兜底）          │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 新增模块详述

#### 4.2.1 `service/system_fs`（Rust）
- `list_drives() -> Vec<DriveInfo>`：Windows 走 `GetLogicalDrives`/`GetVolumeInformationW`；macOS/Linux 走 `sysinfo` 或解析 `/proc/mounts`。
- `list_quick_folders() -> Vec<QuickFolder>`：基于 `dirs` crate。
- `list_dir(path, opts) / stat(path) / reveal_in_os(path) / open_with_default(path)`。
- CRUD：`create_file / create_dir / rename / delete / copy / move / clipboard_*`。
- `compute_thumbnail(path)`：异步，带 LRU 内存缓存（不落盘索引）。
- `permission`：`granted_roots`（持久化于 `pinned.json` 的同一文件中），`check(path, scope)`。
- 所有写操作返回 `OperationResult { success, error, before?, after? }`，便于上层 UI 反馈与撤销。

> 取代当前 `WorkspaceService` 上耦合 fs 的部分。`WorkspaceService` 不再持有 fs 实现。

#### 4.2.2 `service/pinned`
- `PinnedStore`：单一 JSON 文件持久化 `Vec<PinnedPath> + granted_roots`；并发用 `RwLock`。
- 暴露 `add / remove / list / reorder`。

#### 4.2.3 `service/files_context`
- 内存 registry：`session_id → FilesContext`；可选落盘 24h 滚动缓存以应对会话重启。
- `prompt_builder` 新增 `RequestContextSection::FilesContext`：若当前 agent 支持 `with_files_context()`，则在 system prompt 末尾渲染：

  ```
  <FilesContext>
  scope: workspace
  cwd: D:\workspace\Sparo-Agentic-OS\src
  workspace_root: D:\workspace\Sparo-Agentic-OS
  selection:
    - file  src/main.rs       (2.1 KB)
    - dir   src/components/
  recently_opened:
    - src/lib.rs
  </FilesContext>
  ```
- 任何 Agent（含主 `Agentic`、`FilesAgent`、`FileFinder`、Files 类 Agent App）只要其 `request_context_policy()` 启用该段，即可消费，无需各自重新实现。

#### 4.2.4 `FilesAgent`（内置 Agent，新增）

文件位置：`src/crates/core/src/agentic/agents/files_agent.rs`，prompt：`src/crates/core/src/agentic/agents/prompts/files_agent.md`。

```rust
pub struct FilesAgent { default_tools: Vec<String> }

impl Agent for FilesAgent {
    fn id(&self) -> &str { "Files" }
    fn name(&self) -> &str { "Files" }
    fn description(&self) -> &str {
        "Agent for system-level file/folder reasoning and operations: \
         find, summarize, rename, organize, classify, archive. \
         Prefers search-first workflows (Glob/Grep) and delegates wide \
         exploration to FileFinder."
    }
    fn prompt_template_name(&self, _m: Option<&str>) -> &str { "files_agent" }
    fn default_tools(&self) -> Vec<String> {
        ["LS","Read","Grep","Glob","Edit","Write","Bash","FileFinder"]
            .into_iter().map(String::from).collect()
    }
    fn request_context_policy(&self) -> RequestContextPolicy {
        RequestContextPolicy::default()
            .with_workspace_instructions()
            .with_files_context()
    }
    fn is_readonly(&self) -> bool { false }
}
```

注册：在 `agents/mod.rs` 与 `agents/registry.rs` 加入，`AgentCategory::Files`（新增分类）。

职责边界：
- 自身做"理解 + 计划 + 写动作"；
- 大范围/不确定位置的"找"统一委派 `FileFinder` 子代理；
- 所有写操作经 `Edit/Write/Bash` 走现有 readonly policy / tool policy / 二次确认，**不绕过**。

#### 4.2.5 文件类 Agent App（用户态，预置 + 可分发）

通过现有 `AgentAppStudioAgent` 创建；本期预置 3-4 个官方模板，存放在 Agent App 默认目录。Manifest 示例：

```json
{
  "schemaVersion": 1,
  "id": "files.downloads-tidy",
  "name": "Downloads Tidy",
  "description": "Organize ~/Downloads by category and age, with preview & undo.",
  "icon": "FolderArchive",
  "category": "files",
  "tags": ["files", "cleanup"],
  "level": "user",
  "model": "default",
  "readonly": false,
  "enabled": true,
  "tools": ["LS", "Glob", "Read", "Bash", "Edit"],
  "subagents": ["FileFinder"],
  "toolPolicies": { "Bash": { "allow": ["mv", "mkdir", "cp"] } },
  "serviceActions": [
    { "name": "tidy", "description": "Plan and execute a tidy run", "promptTemplate": "..." }
  ],
  "examples": [
    { "title": "Tidy my Downloads now",
      "prompt": "Group by file type and move files older than 30 days into /Archive." }
  ]
}
```

要点：
- **零新协议**：完全沿用现有 manifest / toolPolicies / serviceActions / examples；
- **场景集成**：Home 与右键菜单通过 `agentAppAPI.listAgentApps()` 过滤 `category=='files'` 渲染，点击 = 用该 App 启 FlowChat session 并注入 FilesContext。

### 4.3 数据模型（新增最小集合）

```ts
// 前端共享类型
interface DriveInfo {
  id: string; mount: string; label: string; fsType: string;
  totalBytes: number; freeBytes: number;
  kind: 'fixed' | 'removable' | 'network' | 'optical';
}

interface QuickFolder { id: string; name: string; path: string; icon: string; }

interface PinnedPath {
  id: string; path: string; label?: string;
  kind: 'file' | 'dir'; addedAt: string;
}

interface FilesContext {
  scope: 'workspace' | 'system' | 'pinned';
  cwd: string;
  workspaceRoot?: string;
  selection: Array<{ path: string; kind: 'file' | 'dir'; size?: number }>;
  recentlyOpenedPaths?: string[];
}

type FsScope =
  | { kind: 'workspace'; workspaceId: string; root: string }
  | { kind: 'system';   allowed: 'auto' | 'prompt' | 'denied' }
  | { kind: 'pinned';   pinId: string };
```

Rust 侧对应 struct 一一对应。**全程无 sqlite、无 FTS、无 embedding。**

---

## 5. 复用清单（避免重复造）

| 现有资产 | 在 Sparo Files 中的复用方式 |
|---|---|
| `tools/file-system/FileExplorer` | `<FilesExplorer rootPath mode>`，把 `workspacePath` 形参语义改为 `rootPath` |
| `tools/file-system/useFileSystem` | 同上，去掉"必须有 workspace 才能用"假设 |
| `tools/file-explorer/useExplorerSearch` | 直接用于 Omnibox keyword/regex/全文模式 |
| `app/components/panels/FilesPanel` | 拆为 `<FilesExplorer>` + 业务包装；旧 `FilesPanel` 作为 deprecated 别名一段时间 |
| `infrastructure/contexts/WorkspaceContext` / `workspaceManager` | 驱动 `WorkspaceSwitcherBar` 与 Home 卡片墙；不改其语义 |
| `service/workspace/WorkspaceService` | 完全保留；底层 fs 调用迁出到 `system_fs` |
| `FlowChat`（含 `tool-card` 二次确认、tool 渲染、撤销/重试） | 承接所有 AI 操作的展示与确认 |
| `FileFinderAgent` / `ExploreAgent` | Omnibox 语义检索与大范围探查的执行者 |
| `AgentAppStudioAgent` + `agentAppAPI` | 承接所有"文件类自定义能力"的封装与分发 |
| `AgentRegistry` / `AgentCategory` | 注册新 `FilesAgent`；新增 `Files` 分类 |
| `PromptBuilder` / `RequestContextPolicy` | 新增 `with_files_context()` 与对应 section，渲染 FilesContext |
| `workspaceFileTransfer`（远程上传/下载） | 不动，仍服务远程会话场景，与本地浏览解耦 |

---

## 6. 性能、安全、降级

### 6.1 性能
- 大目录懒加载（现有）+ **虚拟滚动**（>1000 项自动启用）；
- 缩略图、`reveal_in_os` 走独立 tokio task pool，不阻塞 RPC；
- This PC 全盘搜索默认 disabled；FileFinder 设 30s 与 200 文件读取上限，并向 UI 报告进度；
- 单次 `list_dir` 设上限 10000，超出则前端提示"目录过大，请用 Glob 过滤"。

### 6.2 安全
- 工作区外路径首次访问 → 一次性显式授权，记忆到 `granted_roots`；
- 系统层授权（macOS Full Disk Access / Windows UAC）由 OS 兜底，前端只引导；
- Agent 写盘统一通过 `Edit/Write/Bash`，命中现有 readonly / tool policy / 用户确认；
- Agent App `toolPolicies` 必须显式声明白名单，未声明工具不可调用。

### 6.3 降级
- 盘符列表失败 → 退化为"输入路径"模式；
- FileFinder 不可用 → 退化为纯 Grep；
- FilesContext 注入失败 → Agent 仍可工作，仅失去"当前选择"上下文；
- Agent App 加载失败 → Home / 右键菜单显示"未安装"占位，不阻断其他入口。

---

## 7. 验收标准（最终形态）

1. 可在 "This PC" 看到本机全部盘符与系统快捷目录，并打开任一路径浏览；
2. 顶部 Workspace Switcher Bar 显示所有 `openedWorkspaces`，单击切换；Home 卡片墙展示 `recentWorkspaces` 并支持快速恢复；
3. 地址栏支持手输路径与 Tab 补全；后退/前进/向上/历史齐备；
4. 任意目录/文件右键 **Ask Sparo about this…** 唤起 FlowChat，system prompt 中可见正确的 `FilesContext` 段；
5. Omnibox 语义搜索调用 `FileFinder`，结果可点击跳回 Files 中对应位置；
6. 至少 2 个官方 Files 类 Agent App（如 *Batch Renamer* / *Downloads Tidy*）可在 Home 列出并启动；
7. `WorkspaceService` 不再持有任何 fs 实现；现 `workspaceAPI` 的 CRUD 全部由 `systemFsAPI` 实现并通过 scope 校验；
8. 全期代码中 **不出现** sqlite/FTS/embedding/索引子系统。

---

## 8. 不做清单（明确边界）

- ❌ 文件索引服务、FTS、向量库；
- ❌ SmartFolder 规则 DSL 引擎；
- ❌ Files 场景自建的 AI runtime / Operation Plan / Undo Stack（统一复用 FlowChat 与 tool-card 机制）；
- ❌ Files 场景自建的定时调度器（自动化由 Agent App 触发器机制承担）；
- ❌ 对 `service/workspace` 与 `service/workspace_runtime` 的职责改动；
- ❌ 对 `workspaceFileTransfer`（远程上传下载）的合并改造。
