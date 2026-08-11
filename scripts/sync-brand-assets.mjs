import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  brandAssetCopies,
  legacyBrandAssets,
  legacyBrandDirectories,
  linuxHicolorSizes,
  platformIconTargets,
} from './brand-assets.config.mjs';
import { checkBrandAssets, generateBrandAssets } from './generate-brand-assets.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_ROOT = path.join(REPO_ROOT, 'assets', 'brand');
const ADOPTION_MANIFEST = path.join(BRAND_ROOT, 'adoption-manifest.json');
const CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'brand-assets.config.mjs');
const APP_ICON_SOURCE = path.join(BRAND_ROOT, 'exports', 'app-icon', 'sparo-app-icon-1024.png');
const APP_ICON_OPAQUE_BACKGROUND = '#F5F2EE';
const TAURI_CLI = path.join(REPO_ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

function repoPath(relativePath) {
  return path.join(REPO_ROOT, relativePath);
}

function brandPath(relativePath) {
  return path.join(BRAND_ROOT, relativePath);
}

function normalized(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceForAppIconSize(size) {
  if (size <= 20) return brandPath('exports/app-icon/sparo-app-icon-16.png');
  if (size <= 28) return brandPath('exports/app-icon/sparo-app-icon-24.png');
  if (size <= 40) return brandPath('exports/app-icon/sparo-app-icon-32.png');
  if (size < 64) return brandPath('exports/app-icon/sparo-app-icon-48.png');
  if (size === 64) return brandPath('exports/app-icon/sparo-app-icon-64.png');
  return APP_ICON_SOURCE;
}

async function renderAppIcon(size, { opaque = false } = {}) {
  let pipeline = sharp(await readFile(sourceForAppIconSize(size)))
    .resize(size, size, { fit: 'contain' });
  if (opaque) pipeline = pipeline.flatten({ background: APP_ICON_OPAQUE_BACKGROUND });
  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function writeFileWithRetry(destination, value) {
  const maximumAttempts = process.platform === 'win32' ? 5 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await writeFile(destination, value);
      return;
    } catch (error) {
      if (attempt === maximumAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}

async function writeRasterIcon(destination, size, options) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFileWithRetry(destination, await renderAppIcon(size, options));
}

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

async function writeResponsiveIco(destination) {
  // Tauri 2 uses the first ICO frame for its runtime window icon. A 64 px
  // compact-master frame is the best compromise for common 32-64 px taskbar
  // sizes; the remaining frames let Explorer choose an exact representation.
  const sizes = [64, 256, 128, 48, 32, 24, 16];
  const frames = await Promise.all(sizes.map((size) => renderAppIcon(size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  let dataOffset = 6 + sizes.length * 16;
  const entries = frames.map((frame, index) => {
    const size = sizes[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(frame.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += frame.length;
    return entry;
  });

  await writeFileWithRetry(destination, Buffer.concat([header, ...entries, ...frames]));
}

async function overwriteTauriRasterSet(iconDirectory) {
  const rootRasterSizes = new Map([
    ['32x32.png', 32],
    ['64x64.png', 64],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
    ['icon.png', 512],
    ['Square30x30Logo.png', 30],
    ['Square44x44Logo.png', 44],
    ['Square71x71Logo.png', 71],
    ['Square89x89Logo.png', 89],
    ['Square107x107Logo.png', 107],
    ['Square142x142Logo.png', 142],
    ['Square150x150Logo.png', 150],
    ['Square284x284Logo.png', 284],
    ['Square310x310Logo.png', 310],
    ['StoreLogo.png', 50],
  ]);

  for (const [fileName, size] of rootRasterSizes) {
    await writeRasterIcon(path.join(iconDirectory, fileName), size);
  }

  for (const platform of ['android', 'ios']) {
    const platformDirectory = path.join(iconDirectory, platform);
    for (const filePath of await walkFiles(platformDirectory)) {
      if (path.extname(filePath).toLowerCase() !== '.png') continue;
      const metadata = await sharp(filePath).metadata();
      if (!metadata.width || metadata.width !== metadata.height) {
        throw new Error('Expected a square platform icon: ' + filePath);
      }
      await writeRasterIcon(filePath, metadata.width, { opaque: true });
    }
  }

  await writeResponsiveIco(path.join(iconDirectory, 'icon.ico'));
}

function runTauriIcon(outputDirectory) {
  const maximumAttempts = process.platform === 'win32' ? 3 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = spawnSync(
      process.execPath,
      [TAURI_CLI, 'icon', APP_ICON_SOURCE, '--output', outputDirectory, '--ios-color', APP_ICON_OPAQUE_BACKGROUND],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    );
    if (result.status === 0) return;
    if (attempt < maximumAttempts) {
      console.warn(
        'Tauri platform icon generation failed; retrying (' +
          attempt +
          '/' +
          maximumAttempts +
          '): ' +
          outputDirectory,
      );
    }
  }
  throw new Error('Tauri platform icon generation failed for ' + outputDirectory);
}

async function generatePlatformIcons() {
  if (!existsSync(TAURI_CLI)) {
    throw new Error('Tauri CLI is unavailable. Run pnpm install before pnpm run brand:sync.');
  }

  for (const relativeTarget of platformIconTargets) {
    const target = repoPath(relativeTarget);
    await mkdir(target, { recursive: true });
    const temporaryOutput = await mkdtemp(path.join(BRAND_ROOT, '.platform-icons-'));
    try {
      // Generate into a fresh directory so Windows file mappings on an
      // installed/current icon cannot interrupt the Tauri CLI halfway through.
      runTauriIcon(temporaryOutput);
      for (const generatedFile of await walkFiles(temporaryOutput)) {
        const relativeFile = path.relative(temporaryOutput, generatedFile);
        const destination = path.join(target, relativeFile);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFileWithRetry(destination, await readFile(generatedFile));
      }
      await overwriteTauriRasterSet(target);
    } finally {
      await rm(temporaryOutput, { force: true, recursive: true });
    }
  }

  const hicolorRoot = repoPath('src/apps/desktop/icons/hicolor');
  for (const size of linuxHicolorSizes) {
    await writeRasterIcon(
      path.join(hicolorRoot, `${size}x${size}`, 'apps', 'sparo-os.png'),
      size,
    );
  }
}

async function syncCopies(groups) {
  const selected = groups.size === 0
    ? brandAssetCopies
    : brandAssetCopies.filter((entry) => groups.has(entry.group));

  if (groups.size > 0 && selected.length === 0) {
    throw new Error('Unknown brand sync target: ' + [...groups].join(', '));
  }

  for (const entry of selected) {
    const source = brandPath(entry.source);
    const target = repoPath(entry.target);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  return selected.length;
}

async function removeLegacyAssets() {
  for (const relativePath of legacyBrandAssets) {
    await rm(repoPath(relativePath), { force: true });
  }
  for (const relativePath of legacyBrandDirectories) {
    try {
      await rmdir(repoPath(relativePath));
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    }
  }
}

async function managedPlatformFiles() {
  const files = [];
  for (const relativeTarget of platformIconTargets) {
    const target = repoPath(relativeTarget);
    for (const filePath of await walkFiles(target)) {
      const relative = normalized(path.relative(REPO_ROOT, filePath));
      if (relative.includes('/tray/')) continue;
      files.push(relative);
    }
  }
  return files.sort();
}

async function manifestEntry(relativePath) {
  const value = await readFile(repoPath(relativePath));
  return { path: normalized(relativePath), bytes: value.length, sha256: sha256(value) };
}

async function writeAdoptionManifest() {
  const sourceManifest = await readFile(brandPath('manifest.json'));
  const config = await readFile(CONFIG_PATH);
  const managedPaths = new Set([
    ...brandAssetCopies.map((entry) => normalized(entry.target)),
    ...await managedPlatformFiles(),
  ]);
  const files = [];
  for (const relativePath of [...managedPaths].sort()) {
    files.push(await manifestEntry(relativePath));
  }

  const manifest = {
    schemaVersion: 1,
    generatedBy: 'pnpm run brand:sync',
    sourceManifestSha256: sha256(sourceManifest),
    configSha256: sha256(config),
    files,
  };
  await writeFile(ADOPTION_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

export async function checkProductBrandAssets() {
  await checkBrandAssets();
  const failures = [];

  for (const entry of brandAssetCopies) {
    try {
      const [source, target] = await Promise.all([
        readFile(brandPath(entry.source)),
        readFile(repoPath(entry.target)),
      ]);
      if (!source.equals(target)) failures.push(entry.target + ' is stale');
    } catch {
      failures.push(entry.target + ' is missing');
    }
  }

  for (const relativePath of legacyBrandAssets) {
    if (existsSync(repoPath(relativePath))) failures.push(relativePath + ' is a legacy asset');
  }

  try {
    const [manifestText, sourceManifest, config] = await Promise.all([
      readFile(ADOPTION_MANIFEST, 'utf8'),
      readFile(brandPath('manifest.json')),
      readFile(CONFIG_PATH),
    ]);
    const manifest = JSON.parse(manifestText);
    if (manifest.sourceManifestSha256 !== sha256(sourceManifest)) {
      failures.push('assets/brand/adoption-manifest.json has a stale source manifest');
    }
    if (manifest.configSha256 !== sha256(config)) {
      failures.push('assets/brand/adoption-manifest.json has a stale target configuration');
    }
    for (const entry of manifest.files ?? []) {
      try {
        const value = await readFile(repoPath(entry.path));
        if (value.length !== entry.bytes || sha256(value) !== entry.sha256) {
          failures.push(entry.path + ' differs from the adoption manifest');
        }
      } catch {
        failures.push(entry.path + ' is missing');
      }
    }
  } catch (error) {
    failures.push(
      'assets/brand/adoption-manifest.json is missing or invalid: ' +
      (error instanceof Error ? error.message : String(error)),
    );
  }

  if (failures.length > 0) {
    throw new Error(
      'Product brand assets are out of sync:\n- ' +
      failures.join('\n- ') +
      '\nRun pnpm run brand:sync.',
    );
  }

  console.log('Verified ' + brandAssetCopies.length + ' declared brand copies and platform icons.');
}

export async function syncBrandAssets({ groups = new Set(), full = groups.size === 0 } = {}) {
  if (full) {
    await generateBrandAssets();
  } else {
    await checkBrandAssets();
  }

  const copyCount = await syncCopies(groups);
  if (!full) {
    console.log('Synchronized ' + copyCount + ' brand assets for ' + [...groups].join(', ') + '.');
    return;
  }

  await generatePlatformIcons();
  await removeLegacyAssets();
  await writeAdoptionManifest();
  await checkProductBrandAssets();
  console.log('Synchronized the current Sparo brand across all declared product targets.');
}

function selectedGroups(argv) {
  const groups = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--target' && argv[index + 1]) {
      groups.add(argv[index + 1]);
      index += 1;
    }
  }
  return groups;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const groups = selectedGroups(process.argv.slice(2));
  syncBrandAssets({ groups }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
