---
name: product-app-ui-polish
description: Sparo OS Product App UI polish guidance. Use when improving Product App visuals, layout, runtime UI Kit usage, Sparo OS theme variables, density, empty/loading/error states, accessibility, responsive behavior, light/dark QA, zh-CN/en-US QA, or aligning Product App surfaces with existing built-in app design.
---

# Product App UI Polish Skill

Use this skill for Product App visual polish and experience quality. Do not start from generic web aesthetics; prefer the current scaffold, existing Product App shape, and real issues exposed by runtime preview.

## Product App UI Boundary

- Product App surfaces run inside sandboxed iframes and usually use native HTML/CSS/ESM JavaScript.
- Product Apps cannot directly import `@/design-system` or main-app React components. Those belong to the Web UI / desktop app development contract.
- Product Apps can use `window.app.ui`. It is a runtime-injected DOM UI Kit and does not depend on React, Vite aliases, or main-app context.
- If the change is inside `src/web-ui`, follow `src/web-ui/src/design-system/AGENTS.md` and import primitives/patterns from the public `@/design-system` barrel.

## Runtime UI Kit

Current `window.app.ui` exports:

- `ui.Button({ text, children, variant, size, iconOnly, loading, loadingText, disabled, onClick })`
- `ui.Card({ children, variant, padding, radius, interactive, fullWidth, onClick })`
- `ui.CardHeader({ title, subtitle, extra, children })`
- `ui.CardBody({ children })`
- `ui.CardFooter({ children, align })`
- `ui.Input({ label, placeholder, value, prefix, suffix, error, errorMessage, hint, onInput, onChange })`
- `ui.Badge({ text, children, variant })`
- `ui.Alert({ type, title, message, description, icon })`
- `ui.Empty({ title, description, children })`
- `ui.Stack({ children, direction, gap })`
- `ui.Toolbar({ children })`
- `ui.createElement(tag, attrs, ...children)`
- `ui.mount(target, child)`

Component class contracts include `btn`, `v-card`, `sparo-input-wrapper`, `badge`, `alert`, `bfui-empty`, `bfui-stack`, and `bfui-toolbar`. For routine tool-like Product Apps, build the skeleton with the runtime UI Kit first, then add minimal product-specific styles.

## Theme Variables

The Product App iframe canonical runtime namespace is `--sparo-*`. Prefer semantic app slots:

- Background and layers: `--sparo-app-bg`, `--sparo-app-surface`, `--sparo-app-panel`, `--sparo-app-card`, `--sparo-app-card-hover`
- Controls: `--sparo-app-control-bg`, `--sparo-app-control-hover`
- Text: `--sparo-app-text`, `--sparo-app-text-secondary`, `--sparo-app-text-muted`
- Borders: `--sparo-app-border`, `--sparo-app-border-subtle`
- Accent: `--sparo-app-accent`, `--sparo-app-accent-hover`, `--sparo-app-accent-soft`, `--sparo-app-accent-text`
- State: `--sparo-success`, `--sparo-success-bg`, `--sparo-warning`, `--sparo-warning-bg`, `--sparo-error`, `--sparo-error-bg`, `--sparo-info`, `--sparo-info-bg`
- Interaction: `--sparo-app-focus-ring`, `--sparo-app-selection`, `--sparo-app-overlay`
- Radius and shadow: `--sparo-app-radius-sm`, `--sparo-app-radius`, `--sparo-app-radius-lg`, `--sparo-app-shadow-sm`, `--sparo-app-shadow`
- Fonts: `--sparo-font-sans`, `--sparo-font-mono`
- Scrollbar: `--sparo-scrollbar-thumb`, `--sparo-scrollbar-thumb-hover`

The lower-level slots such as `--sparo-bg`, `--sparo-bg-secondary`, `--sparo-bg-elevated`, `--sparo-text`, `--sparo-text-secondary`, `--sparo-border`, and `--sparo-accent` are also available.

Do not treat unchecked `--theme-*`, `--color-*`, or `--surface-*` names as host variables. `--ds-*` belongs to the main Web UI design system and is not the preferred Product App runtime namespace unless the app defines a fallback or the iframe context confirms it exists.

Recommended app aliases at the top of `style.css`:

```css
:root {
  color-scheme: light dark;
  --app-bg: var(--sparo-app-bg, Canvas);
  --app-panel: var(--sparo-app-panel, Canvas);
  --app-card: var(--sparo-app-card, Canvas);
  --app-text: var(--sparo-app-text, CanvasText);
  --app-muted: var(--sparo-app-text-secondary, GrayText);
  --app-border: var(--sparo-app-border-subtle, GrayText);
  --app-accent: var(--sparo-app-accent, Highlight);
  --app-radius: var(--sparo-app-radius, 10px);
  font-family: var(--sparo-font-sans, system-ui, sans-serif);
}
```

## Reference Choices

- Tool-like, state-dense, frequently operated apps: prefer `builtin-spark-board`. It uses a compact topbar, clear tool buttons, restrained theme aliases, and a fixed full-screen canvas.
- Complex production tools or multi-panel flows: prefer `builtin-ppt-live`. It defines local tokens for spacing, typography, z-index, motion, and panel widths, and handles light/dark overrides explicitly.
- Workspace/devtool apps: refer to `builtin-harmony-dev` and `builtin-remotion-live`. They split actions, state, and views into modules, and organize UI around fact refresh, preview, selection, and sending context.
- Placeholder or minimal package surfaces can use `builtin-deep-research` as a basic reference, but do not treat its `--ds-*` usage as the default theme strategy for new Product Apps.

## Polish Flow

1. Read the closest existing Product App source and summarize its layout, density, states, and token approach.
2. Decide whether the current app is tool-like, canvas-based, workspace-aware, generative, or showcase-oriented. Sparo OS defaults toward tool-like apps, not marketing-page heroes.
3. Define a small set of local tokens/aliases at the top of `style.css`. Reuse one spacing, radius, font, panel width, and accent language across the app.
4. Prefer `app.ui` for routine controls. Handwrite DOM/CSS for complex layout, but keep class naming and state structure consistent.
5. Cover states: empty, loading, error, permission required, offline/degraded, success/complete, and disabled.
6. Cover i18n: all user-visible text supports `zh-CN` and `en-US`; refresh on `onLocaleChange` or `localeChange`.
7. Cover theme: use `onThemeChange` or `[data-theme-type="light"]` / `[data-theme-type="dark"]` checks. Do not inspect only the default theme.

## Visual Rules

- Desktop tool UI should be dense, scannable, and work-focused. Avoid large titles, large images, marketing cards, and purely decorative backgrounds.
- Use cards only for repeated items, dialogs, or framed tools. Do not nest cards inside cards.
- Click targets should be at least 32px. Icon-only controls need `aria-label` or `title`.
- Typical type sizes: title 18-22px, section 14-15px, body 13-14px, caption 11-12px.
- Use one or two radius levels. Do not mix 4/8/12/16px as separate visual languages.
- Do not express state with color alone. Pair color with text, iconography, borders, disabled affordances, or progress copy.
- Do not use emoji as primary icons. Prefer line SVGs, letter marks, or the runtime UI Kit.
- Avoid default AI-looking patterns such as blue-purple gradients, aurora backgrounds, left color strip plus rounded card, or decorative line under every heading unless the user explicitly asks and the context supports it.
- Do not fill empty space with fake data, fake stats, or decorative sparklines. Empty space usually means the structure should be simpler.

## State Templates

Empty state:

- Title states what is missing.
- Description states the user's next step.
- Keep one primary CTA and at most one secondary action.

Loading state:

- Preserve layout dimensions to avoid large jumps.
- For long tasks, show phase text. When a backend action has an `actionRunId`, listen to `backend:event`.

Error state:

- Use `app.log.warn/error` for developer clues.
- UI copy should say what the user can do next, not expose stack traces.
- Distinguish permission, network, backend, and corrupted-data failures.

## QA Checklist

- Light and dark themes have both been checked; there is no low contrast, white panel on dark text, or dark panel with unreadable muted text.
- zh-CN and en-US have both been checked; long text does not squeeze buttons or cover later content.
- Common viewports have no horizontal overflow. Fixed panels use `min-width: 0`, and scroll regions have explicit height.
- Host variables used by CSS come from Product App runtime theme variables or are defined by the app itself.
- No placeholder, TODO, or Lorem ipsum text remains in final UI.
- Async paths such as `app.storage`, backend, AI, file selection, and export have loading/error/success states.
- Key interactions are keyboard-accessible and `focus-visible` is visible.
- Preview/runtime evidence shows the main UI is non-empty and key states can be reached.
