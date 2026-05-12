# Locale Maintenance Guide

This directory owns Web UI translation resources for Sparo OS.

## Scope

- Store all user-facing Web UI copy under `src/web-ui/src/locales/<locale>/`.
- Keep the same relative file layout in every locale.
- Treat each JSON file as one namespace.

## Principles

- Organize by product surface, not by component implementation detail.
- Prefer stable, descriptive filenames over short or generic names.
- Keep a string close to the feature that owns it.
- Use `common.json` only for text reused across multiple product areas.
- Keep namespace boundaries stable so keys do not move without a product-level reason.

## File Layout Standard

- Top-level namespaces are reserved for cross-cutting surfaces such as `common`, `components`, `errors`, `flow-chat`, `notifications`, `settings`, `tools`, and `tray`.
- Feature-area namespaces should live in a feature folder, for example `scenes/apps.json`, `scenes/task-detail.json`, `panels/terminal.json`, `settings/appearance.json`, or `shell/navigation.json`.
- Filenames must use `kebab-case`.
- Do not create filenames based on temporary UI wording, tickets, or one-off experiments.

## Preferred Namespace Map

- Use `scenes/*` for scene-level product surfaces.
- Use `panels/*` for docked or embedded panel surfaces.
- Use `settings/*` for durable settings subpages.
- Use `shell/*` for global chrome, navigation, header, and app-level entry points.
- Use `flow-chat/*` for large chat-specific subdomains such as tool cards, welcome content, or canvas flows.

## When To Create A New File

- Create a new namespace file for a new scene, panel, settings subpage, or durable feature area.
- Create a new namespace file when a feature owns a distinct vocabulary and will keep evolving independently.
- Split an existing file when it grows beyond roughly 150 leaf keys or starts covering multiple unrelated sub-areas.
- Do not create a new file for a single dialog, button group, or one-off component. Nest those keys under the closest existing feature namespace.

## Key Standard

- Use semantic keys such as `empty.title`, `actions.save`, `messages.saveFailed`, and `dialog.confirm.title`.
- Keep key names stable when text changes.
- Avoid keys that encode presentation details such as `leftPanelTitle` or `blueButtonText`.
- Prefer grouping by intent: `actions`, `labels`, `messages`, `empty`, `dialog`, `sections`.

## Change Standard

- Update `en-US` and `zh-CN` in the same change.
- Keep the same relative path and key set across locales.
- Remove dead keys when the owning UI is removed.
- If a key moves to a different namespace, migrate both locales in the same change.
- Do not leave placeholder English or Chinese strings in committed code unless the product explicitly accepts it.

## Validation

- Run `pnpm run check:i18n` after editing locale files.
- Run `pnpm run type-check:web` for UI-facing i18n changes.
- Fix missing files, missing keys, and extra keys before merging.
