import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const sourceMarkPath = path.join(root, 'image', 'sparo-logo-mark.png');
const generatedRoot = path.join(root, 'brand', 'generated');
const manifestPath = path.join(generatedRoot, 'manifest.json');

const APP_BG = { r: 26, g: 26, b: 26 };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function rel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function roundedBackgroundSvg(size) {
  const r = Math.round(size * (size <= 48 ? 0.22 : 0.225));
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="rgb(${APP_BG.r},${APP_BG.g},${APP_BG.b})"/>` +
    `</svg>`
  );
}

function roundedMaskSvg(size) {
  const r = Math.round(size * (size <= 48 ? 0.22 : 0.225));
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>` +
    `</svg>`
  );
}

function paddingRatioFor(size) {
  if (size <= 20) return 0.02;
  if (size <= 32) return 0.035;
  if (size <= 48) return 0.05;
  if (size <= 128) return 0.07;
  return 0.085;
}

function sharpenFor(size) {
  if (size <= 24) return { sigma: 0.7, m1: 1.4, m2: 2.8 };
  if (size <= 48) return { sigma: 0.8, m1: 1.0, m2: 2.0 };
  if (size <= 128) return { sigma: 0.5, m1: 1.0, m2: 1.5 };
  return { sigma: 0.3, m1: 1.0, m2: 1.0 };
}

async function makeAppIcon(markBuffer, size) {
  const pad = Math.round(size * paddingRatioFor(size));
  const inner = Math.max(1, size - pad * 2);
  const mark = await sharp(markBuffer)
    .ensureAlpha()
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .toBuffer();
  const bg = await sharp(roundedBackgroundSvg(size), { density: 384 }).png().toBuffer();
  const composed = await sharp(bg).composite([{ input: mark, top: pad, left: pad }]).toBuffer();
  const sharpen = sharpenFor(size);
  return sharp(composed)
    .sharpen({ sigma: sharpen.sigma, m1: sharpen.m1, m2: sharpen.m2 })
    .composite([{ input: roundedMaskSvg(size), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeIco(markBuffer, outPath) {
  const sizes = [256, 128];
  const frames = await Promise.all(sizes.map((size) => makeAppIcon(markBuffer, size)));
  let dataOffset = 6 + sizes.length * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = sizes.map((size, index) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(frames[index].length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += frames[index].length;
    return entry;
  });
  writeBuffer(outPath, Buffer.concat([header, ...entries, ...frames]));
}

function writeBuffer(filePath, buffer) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return {
    path: rel(filePath),
    size: buffer.length,
    sha256: sha256(buffer),
  };
}

function copyFile(src, dest) {
  const buffer = fs.readFileSync(src);
  return writeBuffer(dest, buffer);
}

async function generateIconSet(iconDir, markBuffer, { includeLinuxHicolor }) {
  removeDir(path.join(iconDir, 'android'));
  removeDir(path.join(iconDir, 'ios'));
  for (const duplicateSource of ['app-icon-rounded-source.png', 'sparo-app-icon.png']) {
    const filePath = path.join(iconDir, duplicateSource);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }

  const files = [];
  await writeIco(markBuffer, path.join(iconDir, 'icon.ico'));
  files.push(fileInfo(path.join(iconDir, 'icon.ico')));
  files.push(writeBuffer(path.join(iconDir, 'icon.png'), await makeAppIcon(markBuffer, 512)));

  for (const [name, size] of [
    ['32x32.png', 32],
    ['64x64.png', 64],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
  ]) {
    files.push(writeBuffer(path.join(iconDir, name), await makeAppIcon(markBuffer, size)));
  }

  for (const [name, size] of [
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
  ]) {
    files.push(writeBuffer(path.join(iconDir, name), await makeAppIcon(markBuffer, size)));
  }

  if (includeLinuxHicolor) {
    for (const size of [16, 32, 48, 64, 96, 128, 256, 512]) {
      files.push(writeBuffer(
        path.join(iconDir, 'hicolor', `${size}x${size}`, 'apps', 'sparo-os.png'),
        await makeAppIcon(markBuffer, size)
      ));
    }
  }

  return files;
}

function fileInfo(filePath) {
  const buffer = fs.readFileSync(filePath);
  return {
    path: rel(filePath),
    size: buffer.length,
    sha256: sha256(buffer),
  };
}

async function run() {
  if (!fs.existsSync(sourceMarkPath)) {
    throw new Error(`Missing brand source: ${rel(sourceMarkPath)}`);
  }
  const markBuffer = fs.readFileSync(sourceMarkPath);
  const files = [];

  files.push(...await generateIconSet(
    path.join(root, 'src', 'apps', 'desktop', 'icons'),
    markBuffer,
    { includeLinuxHicolor: true }
  ));
  files.push(...await generateIconSet(
    path.join(root, 'installer', 'src-tauri', 'icons'),
    markBuffer,
    { includeLinuxHicolor: false }
  ));

  files.push(copyFile(sourceMarkPath, path.join(root, 'src', 'web-ui', 'public', 'sparo-logo-mark.png')));
  files.push(writeBuffer(
    path.join(root, 'src', 'web-ui', 'public', 'sparo-app-icon.png'),
    await makeAppIcon(markBuffer, 512)
  ));
  files.push(copyFile(sourceMarkPath, path.join(root, 'src', 'mobile-web', 'src', 'assets', 'sparo-logo-mark.png')));
  files.push(copyFile(sourceMarkPath, path.join(root, 'installer', 'src', 'assets', 'sparo-logo-mark.png')));
  files.push(writeBuffer(
    path.join(root, 'src', 'mobile-web', 'public', 'favicon.png'),
    await makeAppIcon(markBuffer, 32)
  ));
  files.push(writeBuffer(
    path.join(root, 'src', 'mobile-web', 'public', 'apple-touch-icon.png'),
    await makeAppIcon(markBuffer, 180)
  ));

  ensureDir(generatedRoot);
  writeBuffer(manifestPath, Buffer.from(JSON.stringify({
    source: rel(sourceMarkPath),
    generatedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n'));
  console.log(`Synchronized ${files.length} brand assets.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
