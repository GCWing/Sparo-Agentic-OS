# Design System Instructions

This directory is the default UI contract for Sparo OS Web UI and desktop surfaces.

## Scope

- Treat `src/web-ui/src/design-system` as the source of truth for reusable UI APIs, visual contracts, preview coverage, and AI-facing UI rules.
- Keep feature-specific behavior in product folders such as `app/scenes`, `flow_chat`, and `tools`.
- Do not introduce removed component package imports or compatibility shims.
- Do not move or rename public exports without a migration note.
- Do not create alternate reusable UI roots outside this package.

## Import Rule

- New UI code should import from `@/design-system`.
- Existing UI code should also import reusable primitives and patterns from `@/design-system`.
- Internal design-system files may use relative imports or final internal paths under `@/design-system/primitives`, `@/design-system/patterns`, `@/design-system/foundation`, `@/design-system/preview`, `@/design-system/recipes`, `@/design-system/testing`, and `@/design-system/types`.
- Product and feature TS/TSX code outside `src/web-ui/src/design-system` must not import design-system internals directly, including via relative paths such as `../../design-system/primitives/Button`. Use the `@/design-system` barrel.
- Feature SCSS may use published design-system token/style entrypoints when runtime CSS variables are not enough.
- Do not import from retired UI aliases or private reusable UI roots. The final public API is `@/design-system`.

## Architecture

- `foundation`: design tokens, theme bridges, icon policy, typography, motion, density.
- `primitives`: reusable controls without product-specific behavior.
- `patterns`: page and workflow structures that AI agents should prefer for feature work.
- `recipes`: implementation guides for common screens and dialogs.
- Product-specific components stay in their product folders, such as `flow_chat`, `app/scenes`, or `tools`.
- Core design-system layers (`foundation`, `primitives`, `patterns`, `styles`, and `types`) must not depend on `app`, `shared`, `flow_chat`, `tools`, or `infrastructure`.
- Primitives are leaf-level reusable controls. They must not import app services, shared utilities, flow chat code, tool code, infrastructure providers, or feature-local hooks.
- Preview and testing code may compose examples around providers when needed, but runtime primitives and patterns stay product-agnostic.

## Gate Rule

- `pnpm run check:design-system` is a strict architecture and styling gate. Any current violation fails the check.
- `scripts/design-system-baseline.json` is no longer an allowlist. It must stay empty and exists only to document that baseline tolerance has been retired.
- `--update-baseline` may only write an empty strict baseline after all current violations are fixed.
- Do not loosen blocking rules to pass a migration. Fix the import, token, layering, or styling violation instead.
- The gate blocks removed entrypoints, removed directories, design-system internal imports from feature TS/TSX code, relative feature TS/TSX imports into design-system internals, hardcoded z-index inside design-system source, core design-system dependencies on product layers, feature-local hardcoded colors, feature-local hardcoded z-index values, and feature-local control styling.

## AI UI Development Contract

- Start with the closest recipe in `recipes/`, then compose from patterns: `Scene`, `Panel`, `Toolbar`, `FormField`, `DataList`, `SettingsSection`, and `ToolCard`.
- Use primitives inside patterns or compact local compositions. Do not build a feature-local mini design system.
- Do not create custom button, input, select, dialog, tab, badge, or tooltip classes in feature code.
- Use `Button` / `IconButton` for commands and `lucide-react` icons when an icon exists.
- Keep desktop app screens dense, scannable, and work-focused. Avoid marketing-style hero layouts inside the app.
- Keep cards for repeated items, dialogs, and framed tools. Do not nest cards inside cards.
- User-visible strings must use the surrounding i18n namespace and update both `en-US` and `zh-CN`.
- Avoid hardcoded `#hex`, `rgb()`, and `rgba()` in feature SCSS and TS/TSX styling. Use design tokens and CSS variables.
- Avoid hardcoded `z-index`; use design system variables.
- Never represent state only with color. Pair color with text, iconography, shape, or affordance changes.
- Keep labels and dynamic content resilient: long text must wrap, truncate intentionally, or use a documented compact layout.
- Every new primitive or pattern must include preview coverage from `preview/status-matrix.md` when applicable.

## Preview Contract

- Register new reusable UI examples in `preview/registries`.
- Cover the required matrix states: default, disabled, loading, error, long text, narrow, theme, and i18n.
- Include empty and focused examples when the component or pattern has those states.
- Prefer deterministic sample data. Do not depend on live services, timers, local files, network calls, or user credentials.
- Preview examples should be small, named after the component or pattern, and safe to render side by side.

## Token Rule

`ThemeConfig -> createThemeCssVarMap -> CSS variables` is the design source of truth.

SCSS files may use `foundation/tokens/tokens.scss` for mixins and fallbacks, but runtime styling should consume CSS variables such as `--ds-color-*`, `--ds-space-*`, and `--ds-radius-*`.

Raw color literals are allowed only at color-data boundaries: theme presets and theme adapters, xterm ANSI palette data, Monaco theme data, design-token proposal parsing/resolution, and design-system token/component source. Feature styling must not introduce new raw `#hex`, `rgb()`, or `rgba()` values except as CSS variable fallbacks that are already backed by design-system variables.

## Change Rule

- Reusable UI imports go through `@/design-system` unless the file is inside the design system and needs a final internal path.
- Preserve runtime behavior during import migrations. Split visual cleanup from behavioral changes when possible.
- Update docs, previews, and tests in the same change when adding or replacing a reusable component.
- If a needed reusable component has no design-system equivalent yet, document the gap in the migration note or recipe instead of creating another local UI API.

## Accessibility Rule

- Interactive controls need keyboard support and visible focus states.
- Icon-only controls need accessible labels.
- Dialog-like UI must define close behavior, focus behavior, and Escape behavior.
- Lists, menus, and comboboxes need appropriate roles when custom-rendered.
