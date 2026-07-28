# Sparo Website

This branch stores the standalone Sparo OS marketing website and publishes it through GitHub Pages.

## Development

```bash
pnpm install
pnpm run dev
pnpm run build
```

## Publishing

Pushing this branch runs `.github/workflows/publish-pages.yml`. The workflow reads the configured Pages base path, builds the Vite site into `dist/`, uploads the Pages artifact, and deploys it through the `github-pages` environment.

The build receives `GITHUB_PAGES_BASE_PATH` from `actions/configure-pages`, so repository renames and custom-domain root paths do not require a hard-coded path change.

## Branch Scope

This branch intentionally excludes local build outputs, dependency folders, previews, TypeScript build info, and promo-video production assets.
