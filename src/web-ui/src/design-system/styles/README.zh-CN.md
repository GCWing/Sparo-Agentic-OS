# Design System Styles

本目录提供 Sparo OS 设计系统共享 SCSS 工具。运行时样式应优先使用从
`ThemeConfig` 和 foundation token contract 生成的 CSS 变量。

## 角色

- 提供共享 token fallback、mixin 和范围明确的样式工具。
- 让可复用样式基础设施靠近消费它的 primitives 和 patterns。
- 不在本目录加入产品业务视觉规则。

## 使用建议

在可复用代码和 feature 代码中使用 design-system CSS 变量：

```scss
.feature-panel {
  background: var(--ds-color-bg-panel);
  color: var(--ds-color-text-primary);
  border-radius: var(--ds-radius-md);
}
```

## 语义 Token 家族

清理 feature hardcoding 时优先使用这些语义 token：

- Overlay 和 scrim：`--ds-overlay-scrim`、`--ds-overlay-scrim-strong`、`--ds-overlay-backdrop`。
- Focus 和 selection：`--ds-focus-ring`、`--ds-focus-ring-subtle`、`--ds-selection-bg`、`--ds-selection-fg`。
- Diff：`--ds-diff-added-*`、`--ds-diff-deleted-*`、`--ds-diff-modified-*`，以及 gutter token。
- Terminal 和 syntax：`--ds-terminal-*`、`--ds-syntax-*`。
- Language 和 tool family chip：`--ds-language-typescript-*`、`--ds-tool-family-terminal-*` 等。
- Markdown：`--ds-markdown-inline-code-*`、`--ds-markdown-code-block-*`、`--ds-markdown-table-*`、`--ds-markdown-link`。
- Status surfaces：`--ds-status-surface-success-*`、`--ds-status-surface-warning-*`、`--ds-status-surface-danger-*`、`--ds-status-surface-info-*`、`--ds-status-surface-running-*`、`--ds-status-surface-pending-*`、`--ds-status-surface-neutral-*`。
- Z-index：`--ds-z-local`、`--ds-z-raised`、`--ds-z-header`、`--ds-z-sticky`、`--ds-z-floating`、`--ds-z-dropdown`、`--ds-z-scrim`、`--ds-z-overlay`、`--ds-z-drawer`、`--ds-z-dialog`、`--ds-z-fullscreen`、`--ds-z-toast`、`--ds-z-popover`、`--ds-z-tooltip`、`--ds-z-notification`、`--ds-z-context-menu`。

Feature SCSS 也可以 `@use '@/design-system/foundation/tokens/tokens.scss' as ds;`
使用 `ds-focus-ring`、`ds-status-surface`、`ds-tool-family-surface`、`ds-selection`
等 mixin。

如果缺少 token，请补到 design-system foundation 层，并在相关 recipe 或
preview contract 中说明影响。
