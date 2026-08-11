export const brandAssetCopies = Object.freeze([
  // Web UI public assets: stable PNG URLs for boot HTML and exported images.
  { group: 'web', source: 'exports/app-icon/sparo-app-icon-512.png', target: 'src/web-ui/public/brand/app-icon-512.png' },
  { group: 'web', source: 'exports/web/favicon-32.png', target: 'src/web-ui/public/brand/favicon-32.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-256.png', target: 'src/web-ui/public/brand/sparo-mark-256.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-512.png', target: 'src/web-ui/public/brand/sparo-mark-full.png' },
  { group: 'web', source: 'exports/wordmark/sparo-wordmark-primary.png', target: 'src/web-ui/public/brand/sparo-wordmark-primary.png' },
  { group: 'web', source: 'exports/wordmark/sparo-wordmark-reversed.png', target: 'src/web-ui/public/brand/sparo-wordmark-reversed.png' },

  // Design-system-owned copies keep the reusable logo component self-contained.
  { group: 'web', source: 'exports/mark/sparo-mark-16.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-16.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-24.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-24.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-32.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-32.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-48.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-48.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-256.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-256.png' },
  { group: 'web', source: 'exports/mark/sparo-mark-512.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-mark-full.png' },
  { group: 'web', source: 'exports/app-icon/sparo-app-icon-32.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-app-icon-32.png' },

  // Compact app chrome keeps its dedicated source-derived red core.
  { group: 'web', source: 'exports/core/sparo-core-16.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-core-16.png' },
  { group: 'web', source: 'exports/core/sparo-core-20.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-core-20.png' },
  { group: 'web', source: 'exports/core/sparo-core-24.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-core-24.png' },
  { group: 'web', source: 'exports/core/sparo-core-32.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-core-32.png' },
  { group: 'web', source: 'exports/core/sparo-core-48.png', target: 'src/web-ui/src/design-system/foundation/brand/sparo-core-48.png' },

  // Mobile Web uses stable public URLs so a later logo swap does not change JS hashes.
  { group: 'mobile', source: 'exports/web/favicon-32.png', target: 'src/mobile-web/public/brand/favicon-32.png' },
  { group: 'mobile', source: 'exports/web/apple-touch-icon-180.png', target: 'src/mobile-web/public/brand/app-icon-180.png' },
  { group: 'mobile', source: 'exports/mark/sparo-mark-16.png', target: 'src/mobile-web/public/brand/sparo-mark-16.png' },
  { group: 'mobile', source: 'exports/mark/sparo-mark-24.png', target: 'src/mobile-web/public/brand/sparo-mark-24.png' },
  { group: 'mobile', source: 'exports/mark/sparo-mark-32.png', target: 'src/mobile-web/public/brand/sparo-mark-32.png' },
  { group: 'mobile', source: 'exports/mark/sparo-mark-48.png', target: 'src/mobile-web/public/brand/sparo-mark-48.png' },
  { group: 'mobile', source: 'exports/mark/sparo-mark-512.png', target: 'src/mobile-web/public/brand/sparo-mark-full.png' },

  // The relay fallback mirrors the same stable mobile assets without rebuilding JS.
  { group: 'relay', source: 'exports/web/favicon-32.png', target: 'src/apps/relay-server/static/brand/favicon-32.png' },
  { group: 'relay', source: 'exports/web/apple-touch-icon-180.png', target: 'src/apps/relay-server/static/brand/app-icon-180.png' },
  { group: 'relay', source: 'exports/mark/sparo-mark-16.png', target: 'src/apps/relay-server/static/brand/sparo-mark-16.png' },
  { group: 'relay', source: 'exports/mark/sparo-mark-24.png', target: 'src/apps/relay-server/static/brand/sparo-mark-24.png' },
  { group: 'relay', source: 'exports/mark/sparo-mark-32.png', target: 'src/apps/relay-server/static/brand/sparo-mark-32.png' },
  { group: 'relay', source: 'exports/mark/sparo-mark-48.png', target: 'src/apps/relay-server/static/brand/sparo-mark-48.png' },
  { group: 'relay', source: 'exports/mark/sparo-mark-512.png', target: 'src/apps/relay-server/static/brand/sparo-mark-full.png' },

  // Installer source assets are package-local because it is an independently built app.
  { group: 'installer', source: 'exports/mark/sparo-mark-16.png', target: 'installer/src/assets/brand/sparo-mark-16.png' },
  { group: 'installer', source: 'exports/mark/sparo-mark-24.png', target: 'installer/src/assets/brand/sparo-mark-24.png' },
  { group: 'installer', source: 'exports/mark/sparo-mark-32.png', target: 'installer/src/assets/brand/sparo-mark-32.png' },
  { group: 'installer', source: 'exports/mark/sparo-mark-48.png', target: 'installer/src/assets/brand/sparo-mark-48.png' },
  { group: 'installer', source: 'exports/mark/sparo-mark-512.png', target: 'installer/src/assets/brand/sparo-mark-full.png' },

  // Desktop tray states use the complete circular Logo; active states add a compact status badge.
  { group: 'desktop', source: 'exports/tray/sparo-tray-idle.png', target: 'src/apps/desktop/icons/tray/tray-idle.png' },
  { group: 'desktop', source: 'exports/tray/sparo-tray-running.png', target: 'src/apps/desktop/icons/tray/tray-running.png' },
  { group: 'desktop', source: 'exports/tray/sparo-tray-waiting.png', target: 'src/apps/desktop/icons/tray/tray-waiting.png' },
  { group: 'desktop', source: 'exports/tray/sparo-tray-error.png', target: 'src/apps/desktop/icons/tray/tray-error.png' },
]);

export const platformIconTargets = Object.freeze([
  'src/apps/desktop/icons',
  'installer/src-tauri/icons',
]);

export const linuxHicolorSizes = Object.freeze([16, 32, 48, 64, 96, 128, 256, 512]);

// These paths belong to the retired hand-drawn vector and one-off raster pipelines.
export const legacyBrandAssets = Object.freeze([
  'assets/brand/source/sparo-mark-full.svg',
  'assets/brand/source/sparo-app-icon.svg',
  'assets/brand/source/sparo-wordmark.svg',
  'assets/brand/source/sparo-lockup-horizontal.svg',
  'src/web-ui/public/brand/favicon.svg',
  'src/web-ui/public/brand/sparo-mark-full.svg',
  'src/web-ui/public/brand/sparo-wordmark-primary.svg',
  'src/web-ui/public/brand/sparo-wordmark-reversed.svg',
  'src/web-ui/public/brand/sparo-wordmark-startup-primary.png',
  'src/web-ui/public/brand/sparo-wordmark-startup-reversed.png',
  'src/web-ui/src/design-system/foundation/brand/sparo-mark-16.svg',
  'src/web-ui/src/design-system/foundation/brand/sparo-mark-24.svg',
  'src/web-ui/src/design-system/foundation/brand/sparo-mark-32.svg',
  'src/web-ui/src/design-system/foundation/brand/sparo-mark-48.svg',
  'src/web-ui/src/design-system/foundation/brand/sparo-mark-full.svg',
  'src/web-ui/src/design-system/foundation/brand/sparo-app-icon-32.svg',
  'src/mobile-web/public/brand/sparo-mark-16.svg',
  'src/mobile-web/public/brand/sparo-mark-24.svg',
  'src/mobile-web/public/brand/sparo-mark-32.svg',
  'src/mobile-web/public/brand/sparo-mark-48.svg',
  'src/mobile-web/public/brand/sparo-mark-full.svg',
  'src/apps/relay-server/static/brand/sparo-mark-16.svg',
  'src/apps/relay-server/static/brand/sparo-mark-24.svg',
  'src/apps/relay-server/static/brand/sparo-mark-32.svg',
  'src/apps/relay-server/static/brand/sparo-mark-48.svg',
  'src/apps/relay-server/static/brand/sparo-mark-full.svg',
  'installer/src/assets/brand/sparo-mark-16.svg',
  'installer/src/assets/brand/sparo-mark-24.svg',
  'installer/src/assets/brand/sparo-mark-32.svg',
  'installer/src/assets/brand/sparo-mark-48.svg',
  'installer/src/assets/brand/sparo-mark-full.svg',
  'image/sparo-logo-mark.png',
  'image/sparo-app-icon-rounded.png',
  'image/wordmark/README.md',
  'image/wordmark/manifest.json',
  'image/wordmark/sparo-os-wordmark.svg',
  'image/wordmark/sparo-os-wordmark-reversed.svg',
  'image/wordmark/sparo-os-wordmark-monochrome.svg',
  'src/web-ui/public/sparo-logo-mark.png',
  'src/web-ui/public/sparo-app-icon.png',
  'src/mobile-web/public/favicon.png',
  'src/mobile-web/public/apple-touch-icon.png',
  'src/mobile-web/src/assets/sparo-logo-mark.png',
  'installer/src/assets/sparo-logo-mark.png',
  'src/apps/desktop/icons/sparo-app-icon.png',
  'src/apps/desktop/icons/app-icon-rounded-source.png',
  'installer/src-tauri/icons/app-icon-rounded-source.png',
  'src/apps/relay-server/static/favicon.png',
  'src/apps/relay-server/static/apple-touch-icon.png',
  'src/apps/relay-server/static/assets/sparo-logo-mark-BchWKRwx.png',
  'scripts/generate-icons.mjs',
  'scripts/generate-rounded-app-icon.mjs',
  'scripts/generate-mobile-web-icons.mjs',
]);

export const legacyBrandDirectories = Object.freeze([
  'assets/brand/source/small',
  'image/wordmark',
]);
