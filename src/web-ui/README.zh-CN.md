# Sparo OS Web UI

中文 | [English](./README.md)

## 概览

`src/web-ui` 是 Sparo OS 桌面端的 React + TypeScript 界面层。桌面 UI 工作通过 Tauri 宿主运行；CLI 工作流直接使用共享 Rust core，不经过 Web UI。

日常 UI 功能开发应从桌面应用体验以及支撑它的 Web UI 目录开始。除非任务明确要求，不要把新 UI 工作设计成独立的浏览器托管目标。

## 技术栈

- React 18
- TypeScript 5.8
- Vite 7
- SCSS
- Zustand
- Monaco Editor

## 产品结构

```text
src/web-ui/
|-- README.md
|-- README.zh-CN.md
|-- LOGGING.md
|-- index.html
|-- preview.html
|-- package.json
|-- public/
|-- src/
|   |-- app/              # 桌面应用外壳、场景、面板和导航
|   |-- design-system/    # 桌面与 Web UI 开发共用的可复用 UI 契约
|   |-- flow_chat/        # Agent 聊天、流式输出和工具事件展示
|   |-- hooks/            # 共享前端 hooks
|   |-- infrastructure/   # API 适配、配置、i18n、主题和状态接线
|   |-- locales/          # en-US 与 zh-CN 翻译
|   |-- shared/           # 共享工具、服务和类型
|   |-- tools/            # editor、terminal、git、mermaid 等工具 UI
|   |-- main.tsx
|   `-- vite-env.d.ts
|-- tsconfig.json
|-- tsconfig.node.json
|-- vite.config.ts
|-- vite.config.preview.ts
`-- vite.config.version-plugin.ts
```

## Design System

`src/design-system` 是可复用 UI API、视觉契约、预览覆盖和 AI UI 规则的事实来源。新的可复用 UI 应放在这里，不要重建 component package 或兼容层。

- `foundation`：设计 tokens、CSS 变量桥接、主题基础、图标策略、字体、动效和密度。
- `primitives`：叶子级可复用控件，例如按钮、输入框、对话框、标签页、徽标、提示和加载器。
- `patterns`：更高层的工作流和布局结构，例如场景外壳、面板、工具栏、表单、数据列表、设置区块和工具卡片。
- `recipes`：常见桌面页面和对话框的实现指南。构建熟悉的应用工作流时应先从这里开始。
- `preview`：可复用 UI 的确定性示例和状态覆盖。新增 primitive 或 pattern 示例时注册到 `preview/registries`。
- `styles`、`types` 和 `testing`：design system 发布的样式入口、共享类型契约和测试辅助能力。

产品和功能 TS/TSX 文件应从 `@/design-system` 导入。design-system 内部文件可以使用最终内部路径，例如 `@/design-system/primitives`、`@/design-system/patterns`、`@/design-system/foundation`、`@/design-system/recipes`、`@/design-system/preview`、`@/design-system/testing` 和 `@/design-system/types`。

## Design System Preview

Preview app 是一个 Vite 入口，用于在不启动桌面壳的情况下检查 design-system 示例。

```bash
# 从仓库根目录运行
pnpm run preview:design-system

# 构建 preview 输出到 src/web-ui/dist-preview
pnpm run build:design-system
```

Preview 入口是 `preview.html`，由 `vite.config.preview.ts` 和 `src/design-system/preview/main.tsx` 驱动。

## 开发

除非需要运行包内命令，默认从仓库根目录执行：

```bash
pnpm install
pnpm run desktop:dev
pnpm run dev:web
pnpm run type-check:web
pnpm run lint:web
pnpm run build:web
```

做 UI 修改时优先复用现有基础设施：

- 主题：`src/infrastructure/theme` 和 `src/design-system/foundation`
- I18n：`src/infrastructure/i18n` 和 `src/locales`
- 可复用 UI：`src/design-system`
- 共享服务与工具：`src/shared`
- 功能状态：靠近功能目录的现有 Zustand/module store 模式

## 桌面集成

UI 代码应通过共享 API 适配器和应用服务访问能力，不要在叶子组件里直接调用 Tauri API。桌面专属行为应放在 `src/apps/desktop` 或暴露给 Web UI 的适配层中。

Rust 命令名使用 `snake_case`；暴露到 UI 时，通过 TypeScript helper 以 camelCase 方式调用。

## 相关文档

- `LOGGING.md`
- `src/design-system/AGENTS.md`
- `src/infrastructure/i18n/README.md`
