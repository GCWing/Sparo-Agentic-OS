# Sparo Computer Browser 一步到位产品与实施方案

## 1. 最终定位

Computer Browser 不做系统文件管理器的轻量替代品，也不做 IDE 文件树的旁支功能。它的最终定位是：

> Sparo 的智能本机文件工作台：比系统文件管理器更适合真实工作流，也能把本机文件无缝转化为 Sparo 的上下文、工作区、编辑对象和 Agent 可执行任务。

用户打开 Files 时，感知不应该是“这里也能浏览文件”，而应该是“这里能理解、选择、预览、组织、交给 Sparo，并安全执行文件工作”。

## 2. 一步到位原则

本方案不以阶段性 MVP 作为产品目标。工程上可以并行拆任务、拆提交、拆验证，但产品验收只有一个完整标准：Computer Browser 必须作为统一 File Workbench 交付。

不可接受的中间态：

- system browser 和 workspace file tree 心智割裂。
- 文件只作为路径字符串传给 Chat 或 Filer。
- 双击默认回到系统外部打开，Sparo 只是次要入口。
- Agent 文件操作没有结构化计划、确认、执行报告和审计。
- 预览、推荐动作、选择、多选、上下文传递只在局部可用。
- “以后再迁移 workspace tree”“以后再做 plan mode”作为产品完成口径。

最终交付必须同时满足：

- Places + Browser + Workbench + Operation Plan 的统一三栏工作台。
- workspace / system / pinned / recent / smart collections 使用同一 FileEntry、Selection、ContextPack、OpenStrategy。
- 单击选择并预览，双击或 Enter 走 Sparo-aware open strategy。
- Add to Chat、Ask Sparo、Open in Sparo、Open externally、Open as Workspace 使用同一上下文模型。
- Filer 能读取结构化 FileContextPack，并只能通过 Plan -> Review -> Execute -> Report 执行写操作。
- 批量或破坏性操作必须可预演、可确认、可审计，并尽量可恢复。
- 必须有单元测试、Rust 测试、前端类型检查、i18n 检查和聚焦 E2E 验证。

## 3. 最终产品形态

```text
Files Scene
  Places Sidebar
    Home
    Workspaces
    Quick Folders
    Drives
    Pinned
    Recent
    Smart Collections

  Browser Pane
    Path Bar
    Command Bar
    Search / Filter / Sort
    Tree / List / Grid / Grouped View
    Keyboard Focus
    Multi Selection
    Inline Status

  Workbench Pane
    Preview
    Metadata
    Selection Summary
    Recommended Actions
    Context Handoff
    Agent Plan Review
    Operation History
    Related Workspace / Chat / Editor Links
```

### Places Sidebar

必须统一呈现所有文件入口：

- Workspaces：最近和已打开工作区。
- Quick Folders：Desktop、Downloads、Documents 等系统目录。
- Drives：本机盘、移动盘、网络盘。
- Pinned：用户固定的文件或目录。
- Recent：最近访问的目录、文件、工作区。
- Smart Collections：Large Files、Recently Modified、Screenshots、Archives、Code Projects 等智能集合。

### Browser Pane

必须支持：

- 地址栏、面包屑、Back、Forward、Up、Refresh。
- List、Grid、Tree、Grouped 视图。
- 文件名搜索、当前目录内容搜索。
- 类型、时间、大小、隐藏、只读、git 状态过滤。
- name、modified、size、type 排序。
- Click、Ctrl/Cmd Click、Shift Range、Select All。
- Enter、Space preview、Delete、F2 rename、Ctrl/Cmd C/V、Ctrl/Cmd F。
- 拖放导入、目录内移动、外部拖出。
- 大目录虚拟列表和懒加载预览。

### Workbench Pane

Workbench 是与系统文件管理器拉开差距的核心。它必须根据 selection 动态显示：

- 文本、代码、图片、PDF、文档、媒体、二进制 metadata 预览。
- 文件夹摘要：子项数量、类型分布、总大小、最近修改、大文件、项目识别。
- 多选摘要：数量、总大小、类型分布、共同路径、风险提示。
- 推荐动作：Ask、Summarize、Add to Chat、Open in Sparo、Open externally、Open as Workspace、Organize、Find duplicates、Clean up。
- Agent plan：计划、影响范围、冲突、风险、确认控件、执行日志。
- 关联状态：是否属于当前 workspace、是否已打开、是否 dirty、是否被 agent 修改、git 状态。

## 4. 统一领域模型

所有 UI 和 Agent 联动都必须消费统一模型，不能让 system browser 使用 `FsEntry`，workspace tree 使用另一套节点，再靠字符串拼接联动。

```ts
export type FileScope =
  | { kind: 'workspace'; root: string; workspaceId?: string }
  | { kind: 'system'; root?: string; permission: 'auto' | 'prompt' | 'denied' }
  | { kind: 'pinned'; pinId: string; path: string }
  | { kind: 'recent'; id: string }
  | { kind: 'smart'; collection: SmartCollectionId };

export interface FileEntry {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  scope: FileScope;
  size?: number;
  modifiedAt?: string;
  extension?: string;
  mimeType?: string;
  hidden?: boolean;
  readonly?: boolean;
  resolvedPath?: string;
  capabilities: FileCapability[];
  status?: FileEntryStatus;
}

export interface FileSelectionState {
  scope: FileScope;
  cwd: string;
  focusedPath?: string;
  anchorPath?: string;
  selectedPaths: string[];
  entriesByPath: Record<string, FileEntry>;
  updatedAt: number;
}

export interface FileContextPack {
  id: string;
  source: 'files-scene' | 'chat' | 'editor' | 'tool-card';
  scope: FileScope;
  cwd: string;
  workspaceRoot?: string;
  selection: FileEntry[];
  summary: FileSelectionSummary;
  capabilities: FileCapability[];
  safety: FileSafetyPolicy;
  createdAt: string;
}
```

约束：

- UI 组件只消费 `FileEntry`，不直接消费底层 DTO。
- Provider 负责把 `FsEntry`、workspace explorer node、search result 转成 `FileEntry`。
- Selection 只保存 path 和 entry map，避免大目录重复持有树结构。
- `FileContextPack` 是 Browser、Chat、Editor、Agent 之间传递文件上下文的唯一结构。

## 5. 架构一次性目标

```text
React Web UI
  FileViewerScene
    PlacesSidebar
    BrowserPane
    WorkbenchPane
    OperationPlanReview

  File Workbench Domain
    FileWorkbenchController
    BrowserController
    SelectionController
    PreviewController
    RecommendationController
    OperationPlanController
    WorkspaceFileProvider
    SystemFileProvider
    PinnedFileProvider
    RecentFileProvider
    SmartCollectionProvider

Desktop Adapter
  file_workbench_list
  file_workbench_stat
  file_workbench_preview
  file_workbench_plan_operations
  file_workbench_execute_plan
  file_workbench_audit_list
  native open / reveal
  permission prompts

Core
  file model
  browse/search/preview services
  safety policy
  operation planner
  operation executor
  audit/undo records
  file context registry

Agentic Runtime
  Filer
  file_context_read
  file_scan
  file_operation_plan
  file_operation_execute
```

边界要求：

- `src/crates/core` 不依赖 Tauri。
- Tauri command 必须使用 structured request object。
- 新 UI 不直接调用破坏性 `system_fs_delete` / `rename` / `create`，必须走 operation plan。
- Provider 不决定 UI 行为，打开策略和推荐动作由 domain services 决定。
- Filer 不直接执行文件写入，必须拿到用户确认后的 plan id 和 confirmation token。

## 6. 一次性实施清单

这是完整交付清单，不是阶段路线。实现顺序可以由工程依赖决定，但验收必须一次性覆盖全部能力。

### 6.1 File Workbench Domain

新增或整理：

```text
src/web-ui/src/tools/file-workbench/
  index.ts
  types/
    scope.ts
    entry.ts
    selection.ts
    preview.ts
    recommendation.ts
    operationPlan.ts
    contextPack.ts
  controllers/
    FileWorkbenchController.ts
    BrowserController.ts
    SelectionController.ts
    PreviewController.ts
    RecommendationController.ts
    OperationPlanController.ts
  providers/
    WorkspaceFileProvider.ts
    SystemFileProvider.ts
    PinnedFileProvider.ts
    RecentFileProvider.ts
    SmartCollectionProvider.ts
    CompositeFileProvider.ts
  services/
    fileClassification.ts
    fileOpenStrategy.ts
    fileContextPackBuilder.ts
    fileRecommendationRules.ts
    fileSafetyPolicy.ts
```

完成标准：

- workspace/system/pinned/recent/smart 均可通过 provider 读取。
- controller 可单元测试，不依赖 DOM。
- selection、preview、recommendation、operation plan 逻辑不写在 `FileViewerScene.tsx`。

### 6.2 FileViewerScene 重构

`FileViewerScene.tsx` 最终只负责 scene shell：

- 接入 `CanvasStoreModeContext.Provider`。
- 布局 Places、Browser、Workbench、OperationPlanReview。
- 注入 workspacePath 和 scene-level routing。
- 不持有文件分类、打开策略、多选算法、context pack 构建等领域逻辑。

完成标准：

- system browser 和 workspace tree 使用同一 Browser/Workbench 心智。
- 右键菜单、工具栏、推荐动作都来自同一 recommendation system。
- 当前 editor active file 可 reveal 到 Browser。

### 6.3 预览系统

PreviewController 分层加载：

- metadata：永远先返回。
- light preview：文本片段、图片缩略图、PDF 首页、文档摘要。
- deep preview：按用户动作或 Agent 需要加载。

完成标准：

- 大文件有保护，不阻塞滚动。
- 预览失败显示原因和替代动作。
- 文本、图片、文件夹、多选摘要至少完整支持。
- PDF/Office/媒体可降级为 metadata + external open，但模型中必须有 preview result 状态。

### 6.4 打开策略

所有打开动作经过 `fileOpenStrategy`：

```ts
export function decideFileOpenAction(input: {
  entry: FileEntry;
  scope: FileScope;
  workspacePath?: string;
  userIntent: 'singleClick' | 'doubleClick' | 'enter' | 'contextMenu';
}): FileOpenDecision;
```

策略：

- 单击永远 selection + preview。
- 文件夹双击进入目录。
- workspace 内代码/文本双击 Open in Sparo。
- system scope 代码/文本默认 Preview/Open in Sparo，external open 是次级动作。
- 图片、PDF、文档默认 preview。
- 未知二进制默认 metadata，external open 是主动作。

完成标准：

- `FileViewerScene` 中不直接散落 `openWithDefault` 决策。
- UI 明确展示 primary/secondary actions。

### 6.5 Context Pack 联动

Add to Chat、Ask Sparo、Filer session、Editor open 必须共享 `FileContextPack`。

完成标准：

- 单文件、多文件、文件夹、多 scope 都能生成 context pack。
- 后端 `FilesContext` 能承载 summary、capabilities、safety、source。
- Filer prompt 中渲染结构化 FilesContext，而不是路径字符串。
- Chat 可显示文件上下文附件或摘要。

### 6.6 Operation Plan

新增 core service：

```text
src/crates/core/src/service/files/
  mod.rs
  model.rs
  host.rs
  browser.rs
  preview.rs
  safety.rs
  audit.rs
  operations/
    mod.rs
    planner.rs
    executor.rs
    conflict.rs
```

计划结构：

```ts
export interface FileOperationPlan {
  id: string;
  title: string;
  scope: FileScope;
  cwd: string;
  createdBy: 'user' | 'agent';
  createdAt: string;
  items: FileOperationPlanItem[];
  summary: {
    total: number;
    byType: Record<FileOperationType, number>;
    highRiskCount: number;
    conflictCount: number;
  };
  safety: FileSafetyReview;
  status: 'draft' | 'ready' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
}
```

执行规则：

- 计划生成不改变文件系统。
- 用户可逐项 include / exclude。
- 冲突必须先解决，不能静默覆盖。
- 高风险项默认不勾选。
- 执行前生成 confirmation token。
- 执行后生成 audit record。
- Browser 根据 refreshPaths 刷新。

必须支持的操作：

- mkdir
- rename
- move
- copy
- delete-to-trash 或可恢复删除
- delete-permanent，高风险确认
- archive
- extract

### 6.7 Filer 接入

Filer 不是泛聊天助手，而是 Files 场景的文件工作 agent。

必须提供工具：

- `file_context_read`：读取当前 session 的 FileContextPack。
- `file_scan`：按 scope/cwd/maxDepth/limits 返回目录摘要。
- `file_operation_plan`：根据用户意图和扫描结果生成 FileOperationPlan。
- `file_operation_execute`：只执行用户确认后的 plan。

完成标准：

- Workbench 推荐动作可启动 Filer。
- Filer 生成 plan 后，UI 打开 OperationPlanReview。
- 用户确认后执行，不允许 chat 文本直接触发破坏性写操作。
- 执行结果返回 report，并在 Workbench 中显示。

## 7. 安全与权限

Agent 默认只读。写操作必须通过 plan confirmation。

安全策略：

- Read-only scan 不需要额外确认。
- 批量移动、批量重命名、删除、覆盖、解压、归档必须显示计划。
- Delete 默认进入可恢复位置；不可恢复时必须高风险确认。
- OS root、用户 profile root、AppData、系统目录等敏感路径需要额外拦截。
- 所有 backend log English-only，不记录 token、密钥、个人敏感内容。
- 用户可见文案必须走 i18n。

## 8. 验收标准

这部分是“一步到位”的验收门槛。缺任何一项都不能称为完整实现。

### 产品验收

- 用户能从任意本机目录把文件交给 Sparo。
- 用户能清楚知道文件会在 Sparo 内打开还是外部打开。
- 用户能预览、理解、选择、批量选择并组织文件。
- 用户能把文件作为上下文加入 Chat 或 Filer。
- 用户能把文件夹打开为 workspace。
- 用户能让 Filer 生成整理、清理、查重、移动、重命名等计划。
- 用户在执行批量或破坏性操作前能看到计划、风险、冲突和影响范围。
- 执行后能看到结果、失败项、刷新路径和审计记录。

### 技术验收

- `FileViewerScene.tsx` 不是领域逻辑集中地。
- workspace 和 system 文件使用同一 `FileEntry` / `FileSelectionState` / `FileContextPack`。
- `FilesContext` 后端结构能承载 summary、capabilities、safety、source。
- Core 文件服务保持平台无关。
- Desktop adapter 只做命令适配和 host capability 注入。
- Agent 写操作只能通过 confirmed operation plan。

### 测试验收

必须通过：

```bash
pnpm run check:i18n
pnpm run type-check:web
pnpm run lint:web
pnpm --dir src/web-ui run test:run -- src/tools/file-workbench
cargo test -p bitfun-core files
pnpm run e2e:test:spec -- tests/e2e/specs/files-workbench.spec.ts
```

E2E 必须覆盖：

- 打开 Files。
- 从 Quick Folder 或 Drive 进入目录。
- 搜索文件。
- 单击预览。
- 多选并更新 Workbench summary。
- Add to Chat。
- Ask Sparo / Filer。
- 代码或文本 Open in Sparo。
- 文件夹 Open as Workspace。
- 生成只读 Filer summary。
- 生成 operation plan。
- 用户确认后执行安全文件操作。
- 执行后 Browser 刷新并显示 report。

Rust 测试必须覆盖：

- safety policy：敏感路径、scope 越界、pinned scope、workspace scope。
- planner：冲突检测、重复目标、非法路径、高风险识别。
- executor：成功、部分失败、audit record、refresh paths。
- FilesContext prompt：结构化 summary、capabilities、selection metadata。

## 9. 不做什么

- 不做通用 app server 文件管理后台。
- 不把 core 绑定到 Tauri。
- 不让 agent 直接执行未经确认的破坏性文件操作。
- 不把 system browser 和 workspace tree 做成两个产品。
- 不把预览、推荐动作、上下文传递藏在 chat 内部。
- 不以“第一阶段可用”作为最终交付口径。

## 10. 当前实现与最终方案差距

当前代码已经完成了最终方案的一部分基础：

- system browser 的搜索、排序、多选、Workbench summary、基础预览。
- `file-workbench` 初始领域层。
- `fileOpenStrategy` 初始版本。
- `FileContextPack` 初始构建和后端 FilesContext summary 承载。
- Files 真实入口 E2E。

但这还不是最终方案的全量完成。剩余必须补齐：

- workspace tree 迁移到统一 FileEntry / Selection / Workbench。
- Provider、Controller、Preview、Recommendation 完整化。
- Operation Plan core service、desktop commands、UI review。
- Filer 工具链和 confirmed execution。
- Smart Collections、Recent、Operation History、Audit/Undo。
- Add to Chat / Ask Sparo 的可见 context attachment。
- E2E 覆盖 operation plan 和 Filer 闭环。

最终目标不是分段上线，而是按本文件的验收标准一次性定义完成态。
