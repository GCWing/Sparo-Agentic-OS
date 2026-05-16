# Design System Styles

This directory contains shared SCSS utilities for the Sparo OS design system.
Runtime styling should prefer CSS variables generated from `ThemeConfig` and
foundation token contracts.

## Role

- Provide shared token fallbacks, mixins, and tightly scoped style helpers.
- Keep reusable styling infrastructure close to the primitives and patterns that
  consume it.
- Avoid product-specific visual rules in this directory.

## Guidance

Use design-system CSS variables and foundation guidance in reusable and feature
code:

```scss
.feature-panel {
  background: var(--ds-color-bg-panel);
  color: var(--ds-color-text-primary);
  border-radius: var(--ds-radius-md);
}
```

## Semantic Token Families

Use semantic token families when cleaning feature hardcoding:

- Overlay and scrim: `--ds-overlay-scrim`, `--ds-overlay-scrim-strong`, `--ds-overlay-backdrop`.
- Focus and selection: `--ds-focus-ring`, `--ds-focus-ring-subtle`, `--ds-selection-bg`, `--ds-selection-fg`.
- Diff: `--ds-diff-added-*`, `--ds-diff-deleted-*`, `--ds-diff-modified-*`, plus gutter tokens.
- Terminal and syntax: `--ds-terminal-*`, `--ds-syntax-*`.
- Language and tool family chips: `--ds-language-typescript-*`, `--ds-tool-family-terminal-*`, etc.
- Markdown: `--ds-markdown-inline-code-*`, `--ds-markdown-code-block-*`, `--ds-markdown-table-*`, `--ds-markdown-link`.
- Status surfaces: `--ds-status-surface-success-*`, `--ds-status-surface-warning-*`, `--ds-status-surface-danger-*`, `--ds-status-surface-info-*`, `--ds-status-surface-running-*`, `--ds-status-surface-pending-*`, `--ds-status-surface-neutral-*`.
- Z-index: `--ds-z-local`, `--ds-z-raised`, `--ds-z-header`, `--ds-z-sticky`, `--ds-z-floating`, `--ds-z-dropdown`, `--ds-z-scrim`, `--ds-z-overlay`, `--ds-z-drawer`, `--ds-z-dialog`, `--ds-z-fullscreen`, `--ds-z-toast`, `--ds-z-popover`, `--ds-z-tooltip`, `--ds-z-notification`, `--ds-z-context-menu`.

Feature SCSS may also `@use '@/design-system/foundation/tokens/tokens.scss' as ds;`
for mixins such as `ds-focus-ring`, `ds-status-surface`, `ds-tool-family-surface`,
and `ds-selection`.

If a token is missing, add it to the design-system foundation layer and document
the impact in the relevant recipe or preview contract.
