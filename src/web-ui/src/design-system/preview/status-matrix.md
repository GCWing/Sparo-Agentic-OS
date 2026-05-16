# Preview Status Matrix

Every reusable primitive and pattern should document the states it supports in preview. Use this matrix when adding or migrating examples.

## Required States

| State | Purpose | Preview expectation |
| --- | --- | --- |
| Default | Normal interactive or display state | Shows the example with realistic content and the most common props. |
| Disabled | Unavailable commands or fields | Shows disabled styling, blocked interaction affordance, and accessible disabled semantics where applicable. |
| Loading | In-progress work | Shows stable dimensions, progress affordance, and no layout shift when loading starts or ends. |
| Error | Failed validation, request, or operation | Shows clear error styling, message placement, and accessible error relationship where applicable. |
| Long text | Overflow resilience | Uses long labels, metadata, paths, or translated text to prove wrapping, truncation, and alignment behavior. |
| Narrow | Small container or mobile-width surface | Renders in a constrained wrapper and keeps controls reachable without overlap. |
| Theme | Light/dark/high-contrast readiness | Renders against current theme variables and avoids hardcoded colors. Include both available app themes when the preview shell supports it. |
| I18n | Translation resilience | Uses locale-backed strings or representative English and Chinese-length strings to verify spacing and copy expansion. |

## Conditional States

| State | When to include |
| --- | --- |
| Empty | Lists, search results, cards, tables, menus, and panels that can have no data. |
| Focused | Custom interactive controls, menu items, list items, tabs, dialogs, and keyboard workflows. |
| Selected | Lists, tabs, segmented controls, tree items, and selectable cards. |
| Overflow | Toolbars, command groups, breadcrumbs, file paths, code blocks, and metadata rows. |

## AI Authoring Checklist

- Start from the default preview, then add only the states the primitive or pattern can actually enter.
- Use deterministic local sample data. Do not call Tauri commands, network APIs, timers, or workspace files from preview examples.
- Keep preview state names explicit, for example `Button / Loading`, `DataList / Empty`, or `ToolCard / Error`.
- For long text, include both a long single token and a natural long sentence when the layout may encounter both.
- For narrow previews, constrain the outer wrapper instead of changing primitive or pattern internals.
- For theme previews, verify all colors come from design tokens or runtime CSS variables.
- For i18n previews, prefer real translation keys when the surrounding preview shell supports i18n. Otherwise use representative localized sample strings.

## Migration Coverage

When adding or changing a reusable design-system API, add preview coverage before relying on it in product code. If coverage is temporarily partial, document the missing states in the relevant recipe or migration note.
