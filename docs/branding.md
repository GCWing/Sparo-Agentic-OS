# Sparo OS Branding

This document defines the product-facing brand rules for Sparo OS. Treat this
as the source of truth for names, logo usage, and generated brand assets.

## Names

- Product name: `Sparo OS`
- Short name: `Sparo`
- Product slug: `sparo-os`
- Config directory: `sparo_os`
- Project directory: `.sparo_os`
- Desktop bundle identifier: `com.sparo-os.desktop`

Do not introduce new user-facing `BitFun`, `bitfun`, or `BITFUN` names. Rust
crate and upstream dependency names that still use `bitfun` are inherited from
the upstream project and may remain internal implementation details.

## Source Assets

The canonical brand source files live in `image/`:

- `image/sparo-logo-mark.png` - primary mark on transparent background.
- `image/sparo-app-icon-rounded.png` - legacy reference icon, not a generation
  source for runtime app icons.
- `image/Sparo_title.png`, `image/readme_hero.png`, and
  `image/readme_hero_CN.png` - README and marketing images.

Runtime assets under application folders are generated outputs. Do not edit
these by hand.

## Generated Assets

Run this from the repository root whenever the logo source changes:

```bash
pnpm run brand:sync
```

The command generates and synchronizes:

- Desktop app icons under `src/apps/desktop/icons/`.
- Installer icons under `installer/src-tauri/icons/`.
- Web UI public brand assets under `src/web-ui/public/`.
- Mobile web favicons and bundled logo assets.
- Installer UI bundled logo assets.

Run this before release:

```bash
pnpm run brand:verify
```

## Icon Policy

- Use bitmap logo assets only for app identity: splash screens, top bars,
  installer, About surfaces, release collateral, and README imagery.
- Use `lucide-react` for generic UI actions and objects.
- Use `SparoAgentIcon` and `SparoSubagentIcon` only for first-party agent
  concepts that need Sparo OS recognition.
- Do not use the Sparo logo as a generic AI, app, file, or command icon.

## Platform Assets

Keep only platform assets that are used by the current product:

- Windows: `.ico` plus Windows tile PNGs.
- macOS: `.icns`.
- Linux: `hicolor/*/apps/sparo-os.png`.
- Web: `sparo-app-icon.png` and `sparo-logo-mark.png`.
- Mobile web: `favicon.png`, `apple-touch-icon.png`, and bundled logo mark.
- Tray: `tray-idle.png`, `tray-running.png`, `tray-waiting.png`,
  `tray-error.png`.

Do not keep Android or iOS native icon trees in the desktop or installer icon
folders unless a native mobile target is added and wired into the build.
