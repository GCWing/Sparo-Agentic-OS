# Sparo OS brand assets

This directory is the single source of truth for Sparo OS brand artwork.

## Roles

- The default product logo is the circular material mark derived from `source/sparo-mark-master.png`.
- Launch, dock, taskbar, installer, home-screen, favicon, application-list, and system-tray surfaces use the circular material Logo at every size.
- The `Sparo OS` wordmark is extracted from `reference/sparo-identity-board.png`; it is not recreated with a font or redrawn path.
- Tray artwork uses the complete circular material Logo with its red core. Active states add only a compact semantic badge. The app's compact top-left home control keeps a separate source-derived red-core asset.

## Canonical inputs

- `source/sparo-mark-master.png` — user-supplied high-resolution transparent mark master.
- `source/sparo-core-master.png` — user-supplied high-resolution transparent red-core master.
- `reference/sparo-identity-board.png` — approved identity board and wordmark reference.

The generator removes low-alpha speckles, normalizes the visible mark to a true circular field, tightly crops application and tray icons to the visible circular bounds, preserves material lighting, and creates every product asset deterministically. Brand artwork is PNG-only: do not trace the mark or wordmark into SVG, and do not hand-edit generated copies.

## Generated outputs

- `exports/mark/` — responsive circular marks from 16 to 512 px.
- `exports/app-icon/` — edge-fitted circular application icons from 16 to 1024 px, each exported without added transparent padding and with alpha-safe target-size reduction.
- `exports/core/` — target-specific red-core PNGs reserved for compact in-product controls.
- `exports/wordmark/` — globally consistent optically bold primary, reversed, and monochrome wordmarks.
- `exports/lockup/` — horizontal mark-and-wordmark lockups.
- `exports/tray/` — target-specific 16, 20, 24, 32, and 48 px full-Logo tray PNGs, plus light, dark, and semantic state variants.
- `exports/web/` — favicons, Apple touch icon, and Web app icons.
- `qa/` — large-format, small-size, and tray-state review matrices.
- `manifest.json` — source provenance and deterministic output hashes.
- `adoption-manifest.json` — hashes of synchronized product copies and platform icon files.

## Color reference

- Core Red: `#E53935`
- Warm White: `#F5F2EE`
- Soft Ivory: `#ECE7E1`
- Sand Gray: `#D8D3CC`
- Deep Charcoal: `#1A1A1A`

The master contains photographic/material variation around these reference colors. Do not flatten its red core or replace its shadows with generic CSS effects.

## Usage rules

- Use the circular material Logo for general in-product identity, operating-system application icons, and tray states. Use the red core only for the compact app-chrome home control.
- Use the dedicated 16–64px edge-fitted app-icon exports for taskbars, window icons, favicons, and other compact surfaces instead of relying on operating-system downscaling.
- Use the same canonical primary or reversed wordmark on every product surface, including the boot splash and About dialog. Its neutral strokes are expanded deterministically in the source export while the approved letterforms and red core remain unchanged; do not simulate boldness with CSS or create surface-specific copies.
- Select the nearest generated raster size; never upscale a small copy. Application and tray icons use target-specific alpha-safe reduction with the circular container fitted to all four canvas edges instead of operating-system downscaling of the padded master.
- Use the material mark at 64 px and above. At 16–48 px, use the dedicated target-size PNG.
- Preserve a clear space of at least one red-core radius around standalone marks and lockups.
- Never crop the red core, recolor the material master, add an extra drop shadow, or redraw the geometry.

## Commands

```text
pnpm run brand:generate
pnpm run brand:sync
pnpm run brand:check
```

`brand:generate` rebuilds the deterministic PNG package. `brand:sync` also copies declared consumers, regenerates desktop/installer platform icons, removes retired vector assets, and records adoption hashes. `brand:check` fails on stale, missing, unmanaged, or legacy brand resources.
