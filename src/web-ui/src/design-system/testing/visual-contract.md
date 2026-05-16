# Visual Contract

- Screens should be dense, calm, and optimized for repeated desktop use.
- Use `Scene` for app-level pages and `Panel` for bounded functional areas.
- Use `Toolbar` for command rows and `DataList` for repeated selectable items.
- Do not nest cards inside cards.
- Prefer 8px radius or less unless a component has a documented reason.
- Avoid feature-local hardcoded colors, shadows, z-indexes, and one-off input/button styles.
- Raw `#hex`, `rgb()`, and `rgba()` values are legal only in theme preset/adapter data, xterm palette data, Monaco theme data, design-token proposal parsing/resolution, and design-system token/component source. Feature styling should use design-system CSS variables, token SCSS entrypoints, or CSS variable fallbacks backed by design-system variables.
- Cover the preview status matrix in `../preview/status-matrix.md` for reusable primitives and patterns.
- Default, disabled, loading, error, long text, narrow, theme, and i18n states must preserve stable dimensions and spacing.
- Loading and error states should not resize fixed-format controls such as buttons, tiles, tabs, and toolbar items.
- Long single tokens, translated strings, and file paths must truncate or wrap intentionally.
- Narrow previews should prove the component inside a constrained parent, not only at full viewport width.
- Visual reuse must flow through the final design-system API. Feature TS/TSX code imports from `@/design-system`, while design-system runtime code may use final internal paths only within the package.
- Feature TS/TSX code must not reach `design-system/primitives`, `design-system/patterns`, `design-system/foundation`, `design-system/styles`, `design-system/preview`, `design-system/recipes`, `design-system/testing`, or `design-system/types` through either aliases or relative paths.
- Feature SCSS may use published design-system token/style entrypoints, but it must still avoid hardcoded colors, hardcoded z-index values, and feature-local control classes.
- Do not preserve visual compatibility by reintroducing retired UI entrypoints or alternate reusable UI roots.
- Core design-system visuals must not depend on product folders or application infrastructure. Primitives and patterns remain reusable without `app`, `shared`, `flow_chat`, `tools`, or `infrastructure` imports.
- The design-system check is a strict architecture and styling gate with an empty baseline. Removed entrypoints, removed directories, design-system layering, feature TS/TSX imports into design-system internals, design-system z-index, feature hardcoded colors, feature hardcoded z-index values, and feature-local button, input, select, modal, or dialog classes fail the check.
