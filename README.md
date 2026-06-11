# Sparo Website

This branch stores the standalone Sparo OS marketing website and publishes it through GitHub Pages.

## Development

```bash
pnpm install
pnpm run dev
pnpm run build
```

## Publishing

Pushing this branch runs `.github/workflows/publish-pages.yml`. The workflow builds the Vite site into `dist/`, uploads the Pages artifact, and deploys it through the `github-pages` environment.

The workflow sets `GITHUB_PAGES_BASE_PATH=/Sparo-Agentic-OS/` for the default project Pages URL. Change that value to `/` if the repository is later served from a custom domain root.

## Branch Scope

This branch intentionally excludes local build outputs, dependency folders, previews, TypeScript build info, and promo-video production assets.
