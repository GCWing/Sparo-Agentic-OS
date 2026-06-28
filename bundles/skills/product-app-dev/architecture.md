# Product App 系统架构

## 数据流全景

```text
AI 对话
→ CreateProductApp / CreateComponentPackage
→ 写入 Product App Package 或 Component Package
→ install-time resolver 读取 app.json / component.json
→ 解析 private + shared components
→ 生成 app.lock.json
→ App Catalog 只展示 Product App projection
→ Component Center 只展示 Component projection
→ Work Instance 记录 app id / version / lock digest / primary surface
→ 启动时按 ProductAppLaunch 打开 AgentSession、ApplicationSurface、AppStudio 或 ComponentStudio
```

## 发布对象

系统只保留两种可发布包：

- `Product App Package`: 用户可启动的智能应用，目录根包含 `app.json` 和 `app.lock.json`。
- `Component Package`: 可复用能力组件，目录根包含 `component.json`，只能进入 Component Center 或被 Product App 引用。

Surface / Agent / Bridge / Runtime / Tool / Skill 都是 Component，不再独立作为用户应用进入 App Catalog。

## Product App Package

```text
apps/<app-id>/<app-version>/
├── app.json
├── app.lock.json
├── work-objects/
│   └── <work-object>.json
├── components/
│   ├── surfaces/<component-id>/component.json
│   └── agents/<component-id>/component.json
└── tests/
    └── validation-plan.md
```

`app.json` 只声明逻辑依赖：

- `primarySurface`
- `primarySurfaceMode`: `chatPrimary` / `sidecarLinked` / `immersivePrimary` / `embeddedObject`
- `components`
- `launch`
- `permissions`

私有组件身份使用：

```text
app://<app-id>@<app-version>/<kind>/<component-id>
```

共享组件身份使用：

```text
component://<kind>/<component-id>@<component-version>
```

## Component Package

```text
components/<kind>/<component-id>/<component-version>/
├── component.json
├── src/
└── tests/
```

Component Package 不能包含 `app.json`，不能声明 catalog app visibility，也不能作为最终用户应用交付。创建后只有两条路径：

1. 被 Product App 引用。
2. 进入 Component Center / Component Marketplace。

## Lock 和运行期

`app.lock.json` 是运行期的唯一组件解析依据：

- install-time resolver 写 lock。
- runtime loader 只读 lock。
- runtime 不重新解析 semver。
- runtime 不扫描组件目录生成应用卡片。
- Work Instance 必须记录 app version 和 lock digest。

## Surface Runtime

`bundle://surface-components/<bundle-id>` 表示当前已经有可运行 surface runtime body，可由现有 iframe runner 打开。

`app://.../surfaces/<component-id>` 表示 app-private surface component 身份。它是包内组件契约，不应被复制到旧 `surface_components/<id>/meta.json + source/` 存储中。只有当该 surface 声明了明确 runtime body 时，才能被 ApplicationSurface loader 打开。

## Studio 工具

### App Studio

- 使用 `CreateProductApp` 创建 Product App Package。
- 默认创建 `chatPrimary` app，避免在没有 surface runtime body 时伪装成交互式 workspace。
- 用户明确要求交互型 workspace 时，可以设置 `primary_surface_mode` 为 `sidecarLinked` / `immersivePrimary` / `embeddedObject`，随后由 Surface Designer 补齐 runtime body。
- 后续编辑只写 package 内文件：`app.json`、`app.lock.json`、`work-objects/`、`components/`、`tests/`。

### Component Studio

- 使用 `CreateComponentPackage` 创建 Surface / Agent / Bridge / Runtime / Tool / Skill 六类 Component Package。
- Agent Component 仍可使用专门的 Agent Component 工具创建 prompt、工具选择、示例和 JS runtime tool。
- Component Studio 的输出不是 Product App；需要 App Studio 包装后才可启动。

## 前端入口

- App Catalog: `src/web-ui/src/infrastructure/api/service-api/AppCatalogAPI.ts`
- Apps Scene: `src/web-ui/src/app/scenes/apps/AppsScene.tsx`
- Product App open path: `src/web-ui/src/app/scenes/apps/surface-component/surfaceComponentWorkbenchService.ts`
- CreateProductApp card: `src/web-ui/src/flow_chat/tool-cards/CreateProductAppToolDisplay.tsx`
- Component Studio card: `src/web-ui/src/flow_chat/tool-cards/ComponentStudioToolDisplay.tsx`

## 后端入口

- Package authoring: `src/crates/core/src/app_platform/authoring.rs`
- Built-in package seeding: `src/crates/core/src/app_platform/builtin.rs`
- Resolver / lock: `src/crates/core/src/app_platform/resolver.rs`
- Catalog API: `src/apps/desktop/src/api/app_catalog_api.rs`
- App Studio tool: `src/crates/core/src/agentic/tools/implementations/surface_component_init_tool.rs`
- Component Studio tool: `src/crates/core/src/agentic/tools/implementations/component_package_tool.rs`
