---
name: product-app-surface
description: Product App surface development guidance. Use when creating, editing, reviewing, or validating an app-private surface, including Product App UI entrypoints, source/index.html, style.css, ui.js, worker.js coordination, primary surface behavior, runtime preview, and user-path evidence.
---

# Product App Surface Skill

Use this skill when the Product App work changes what the user sees or operates. A surface is the app-private UI contract for a Product App, not a standalone web page and not a shared Component package.

## Development Boundary

- Start from the package facts and the generated surface scaffold. If the surface is missing, create it with `CreateProductAppComponent` using kind `surface`.
- Treat `source/index.html`, `source/style.css`, `source/ui.js`, and optional `source/worker.js` as the editable surface source set.
- Keep browser UI work in `ui.js`: DOM rendering, interaction, runtime events, theme, locale, and calls to `window.app`.
- Keep custom backend logic in `worker.js` only when the app needs it, and align it with the Product App permission boundary.
- Do not import Sparo host Web UI internals or React design-system modules from Product App surface code.

## Key Decisions

- Decide the primary user path first: what opens, what the user can do immediately, and what state proves the app is useful.
- Use `product-app-api` when surface code touches `window.app`, permissions, backend calls, storage, file/network/shell access, AI, or runtime events.
- Use `product-app-ui-polish` when the task is visual quality, layout, runtime UI Kit use, states, theme, density, responsiveness, or zh-CN/en-US polish.
- If the surface needs intelligent behavior, call an app-private Agent or Bridge through backend bindings/service actions instead of treating the authoring session as app state.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- Run or observe a Studio preview/runtime path for the surface. Completion requires evidence that the surface rendered and the main user path was exercised or that missing evidence is reported clearly.
- For UI changes, check light/dark theme, empty/loading/error states, responsive behavior, and locale-sensitive text when relevant.
