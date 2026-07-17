#!/usr/bin/env node
/**
 * Bundles pptxgenjs, pdf-lib, and jszip with PPT Live export logic for the Product App runtime WebView.
 * Output is committed under the app-private PPT Live surface source vendor directory.
 */
import { spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PPT_LIVE_RELEASES_DIR = join(
  ROOT,
  'bundles',
  'product-apps',
  'builtin-ppt-live',
);

function parseSemver(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return {
    value,
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? null,
  };
}

function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function latestPptLiveRelease() {
  const releases = readdirSync(PPT_LIVE_RELEASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseSemver(entry.name))
    .filter(Boolean)
    .sort(compareSemver);
  const latest = releases.at(-1);
  if (!latest) {
    throw new Error(`No semantic-versioned PPT Live release found under ${PPT_LIVE_RELEASES_DIR}`);
  }
  const releaseDir = join(PPT_LIVE_RELEASES_DIR, latest.value);
  const manifest = JSON.parse(readFileSync(join(releaseDir, 'app.json'), 'utf8'));
  if (manifest.id !== 'builtin-ppt-live' || manifest.version !== latest.value) {
    throw new Error(`PPT Live release identity mismatch at ${releaseDir}`);
  }
  return { releaseDir, version: latest.value };
}

const PPT_LIVE_RELEASE = latestPptLiveRelease();
const BUNDLE_DIR = join(
  PPT_LIVE_RELEASE.releaseDir,
  'components',
  'surfaces',
  'builtin-ppt-live-surface',
  'source',
);
const STAGING = join(ROOT, 'target', 'ppt-live-export-staging');
const OUT = join(BUNDLE_DIR, 'src', 'vendor', 'ppt-export.bundle.mjs');
const RAW_OUT = join(STAGING, 'ppt-export.bundle.raw.mjs');

const PKG = {
  name: 'ppt-live-export-bundle',
  private: true,
  type: 'module',
  dependencies: {
    'pptxgenjs': '^4.0.1',
    'pdf-lib': '^1.17.1',
    'jszip': '^3.10.1',
    'jsdom': '^25.0.0',
  },
  devDependencies: {
    esbuild: '0.25.0',
  },
};

function bundleEnv() {
  const env = { ...process.env };
  // Broken NODE_PATH (e.g. pointing at a node binary) breaks esbuild resolution.
  delete env.NODE_PATH;
  return env;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: bundleEnv(),
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error(`[bundle-ppt-live-export] failed to run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copyExportSources(targetSrc) {
  const names = [
    'export-bundle-entry.mjs',
    'export-deck-browser.js',
    'pptx-html-build.js',
    'pptx-element-export.js',
  ];
  mkdirSync(targetSrc, { recursive: true });
  for (const name of names) {
    cpSync(join(BUNDLE_DIR, 'src', name), join(targetSrc, name));
  }
}

function main() {
  console.log(`[bundle-ppt-live-export] using builtin-ppt-live@${PPT_LIVE_RELEASE.version}`);
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });
  const stagingSrc = join(STAGING, 'src');
  copyExportSources(stagingSrc);
  writeFileSync(join(STAGING, 'package.json'), `${JSON.stringify(PKG, null, 2)}\n`);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['install', '--no-audit', '--no-fund'], STAGING);

  const esbuildBin = join(STAGING, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const entry = join(stagingSrc, 'export-bundle-entry.mjs');
  mkdirSync(dirname(OUT), { recursive: true });

  run(esbuildBin, [
    entry,
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--target=es2020',
    `--outfile=${RAW_OUT}`,
    '--log-level=warning',
  ], STAGING);

  const banner = '/* PPT Live export runtime — generated by scripts/bundle-ppt-live-export-browser.mjs; do not edit. */\n';
  writeFileSync(OUT, banner + readFileSync(RAW_OUT, 'utf8'));

  const size = readFileSync(OUT).length;
  if (size < 500_000) {
    console.error(`[bundle-ppt-live-export] output too small (${size} bytes); bundle may be broken`);
    process.exit(1);
  }

  rmSync(STAGING, { recursive: true, force: true });
  rmSync(join(BUNDLE_DIR, '.export-bundle-tmp'), { recursive: true, force: true });
  console.log(`[bundle-ppt-live-export] wrote ${OUT}`);
}

main();
