# Sparo OS Web UI

[中文](./README.zh-CN.md) | English

## Overview

`src/web-ui` contains the React + TypeScript interface for the Sparo OS desktop app. Desktop UI work runs through the Tauri host, while CLI workflows use the shared Rust core directly without this Web UI.

Routine UI feature work should start from the desktop app experience and the Web UI folders that support it. Do not frame new UI work around a separate browser-served target unless that target is explicitly requested.

## Tech Stack

- React 18
- TypeScript 5.8
- Vite 7
- SCSS
- Zustand
- Monaco Editor

## Product Structure

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
|   |-- app/              # Desktop application shell, scenes, panels, and navigation
|   |-- design-system/    # Reusable UI contract for desktop and Web UI work
|   |-- flow_chat/        # Agent chat, streaming output, and tool event presentation
|   |-- hooks/            # Shared frontend hooks
|   |-- infrastructure/   # API adapters, config, i18n, theme, and state wiring
|   |-- locales/          # en-US and zh-CN translations
|   |-- shared/           # Shared utilities, services, and types
|   |-- tools/            # Tool UIs such as editor, terminal, git, and mermaid
|   |-- main.tsx
|   `-- vite-env.d.ts
|-- tsconfig.json
|-- tsconfig.node.json
|-- vite.config.ts
|-- vite.config.preview.ts
`-- vite.config.version-plugin.ts
```

## Design System

`src/design-system` is the source of truth for reusable UI APIs, visual contracts, preview coverage, and AI-facing UI rules. New reusable UI should be added there instead of recreating a component package or compatibility layer.

- `foundation`: design tokens, CSS variable bridges, theme primitives, icon policy, typography, motion, and density.
- `primitives`: leaf-level reusable controls such as buttons, inputs, dialogs, tabs, badges, tooltips, and loaders.
- `patterns`: higher-level workflow and layout structures such as scene shells, panels, toolbars, forms, data lists, settings sections, and tool cards.
- `recipes`: implementation guidance for common desktop screens and dialogs. Start here when building a familiar app workflow.
- `preview`: deterministic examples and state coverage for reusable UI. Register new primitive and pattern examples in `preview/registries`.
- `styles`, `types`, and `testing`: published style entrypoints, shared type contracts, and test helpers for the design system.

Use `@/design-system` from product and feature TS/TSX files. Internal design-system files may import from final internal paths such as `@/design-system/primitives`, `@/design-system/patterns`, `@/design-system/foundation`, `@/design-system/recipes`, `@/design-system/preview`, `@/design-system/testing`, and `@/design-system/types`.

## Design System Preview

The preview app is a Vite entry for inspecting design-system examples without launching the desktop shell.

```bash
# From the repository root
pnpm run preview:design-system

# Build the preview output into src/web-ui/dist-preview
pnpm run build:design-system
```

The preview entry is `preview.html`, backed by `vite.config.preview.ts` and `src/design-system/preview/main.tsx`.

## Development

Run commands from the repository root unless a package-local command is needed.

```bash
pnpm install
pnpm run desktop:dev
pnpm run dev:web
pnpm run type-check:web
pnpm run lint:web
pnpm run build:web
```

For UI changes, prefer existing infrastructure:

- Theme: `src/infrastructure/theme` and `src/design-system/foundation`
- I18n: `src/infrastructure/i18n` and `src/locales`
- Reusable UI: `src/design-system`
- Shared services and utilities: `src/shared`
- Feature state: existing Zustand/module store patterns near the feature

## Desktop Integration

UI code should go through the shared API adapters and app services rather than calling Tauri APIs directly from leaf components. Desktop-specific behavior belongs in `src/apps/desktop` or the adapter layer exposed to the Web UI.

Command names are `snake_case` in Rust and invoked through camelCase TypeScript helpers when exposed to UI code.

## Related Docs

- `LOGGING.md`
- `src/design-system/AGENTS.md`
- `src/infrastructure/i18n/README.md`
