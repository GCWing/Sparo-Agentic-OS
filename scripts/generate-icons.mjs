/**
 * Generate rounded-rect Tauri desktop icons from the new logo.
 *
 * Strategy: start from logo-dark-transparent.png (logo mark on transparent bg,
 * trimmed tight). Composite it onto a rounded-rect filled with the brand dark
 * navy. Padding is pixel-controlled so small sizes stay crisp and legible.
 *
 * Run AFTER `pnpm tauri icon` so rounded versions overwrite the plain ones.
 * Handles both the main desktop app and the installer.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Source = trimmed logo mark (transparent background).
const markSrc = path.join(root, 'image', 'logo-dark-transparent.png');
// Brand background colour (dark navy) sampled from logo-dark.png
const BG = { r: 3, g: 12, b: 32 };

// Padding ratio (fraction of icon size used as inner padding on each side).
// Smaller padding → mark fills more of the icon. Adaptive: tiny icons need
// minimal padding so the mark doesn't shrink to an unreadable blob.
function paddingRatioFor(size) {
  if (size <= 20) return 0.04;
  if (size <= 32) return 0.06;
  if (size <= 48) return 0.08;
  if (size <= 128) return 0.10;
  return 0.12;
}

// Rounded-rect corner radius (ratio of size).
function radiusRatioFor(size) {
  if (size <= 20) return 0.20;
  if (size <= 48) return 0.22;
  return 0.225;
}

// Sharpen strength by size.
function sharpenFor(size) {
  if (size <= 24) return { sigma: 0.7, m1: 1.4, m2: 2.8 };
  if (size <= 48) return { sigma: 0.8, m1: 1.0, m2: 2.0 };
  if (size <= 128) return { sigma: 0.5, m1: 1.0, m2: 1.5 };
  return { sigma: 0.3, m1: 1.0, m2: 1.0 };
}

function roundedBackgroundSvg(size) {
  const r = Math.round(size * radiusRatioFor(size));
  const hex = `rgb(${BG.r},${BG.g},${BG.b})`;
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${hex}"/>` +
    `</svg>`
  );
}

function roundedMaskSvg(size) {
  const r = Math.round(size * radiusRatioFor(size));
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>` +
    `</svg>`
  );
}

/**
 * Build a rounded icon:
 *  1. Render the rounded-rect navy background from SVG (crisp vector edges).
 *  2. Resize the transparent mark to (size - 2*padding) with high-quality filter.
 *  3. Composite mark at centre.
 *  4. Sharpen gently for small sizes.
 *  5. Apply rounded-rect mask to guarantee clean corners (alpha-cut).
 */
async function makeRoundedIcon(markBuffer, size) {
  const pad = Math.round(size * paddingRatioFor(size));
  const inner = Math.max(1, size - pad * 2);

  const markResized = await sharp(markBuffer)
    .ensureAlpha()
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .toBuffer();

  const bg = await sharp(roundedBackgroundSvg(size), { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();

  const composited = await sharp(bg)
    .composite([{ input: markResized, top: pad, left: pad }])
    .toBuffer();

  const sh = sharpenFor(size);
  return sharp(composited)
    .sharpen({ sigma: sh.sigma, m1: sh.m1, m2: sh.m2 })
    .composite([{ input: roundedMaskSvg(size), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Multi-size ICO writer with PNG frames (PNG-in-ICO, Vista+).
//
// Frame order matters a lot on Tauri 2 (up to at least 2.11):
// tauri-codegen's `new_ico()` only reads `entries()[0]` and uses that single
// RGBA for the runtime window icon AND the taskbar HICON — every other frame
// in the ICO is ignored at runtime. So we must put the HIGHEST resolution
// first; Windows will downsample from 256 to taskbar size (32 / 40 / 48 / 64
// depending on DPI) using its high-quality filter, which looks far crisper
// than a pre-baked 32x32 bitmap.
// bitCount=32 (RGBA) matches stock Tauri output; bitCount=0 makes some
// Windows icon selection paths treat the frame as low-quality.
async function writeIco(markBuf, outPath) {
  const icoSizes = [256, 128, 64, 48, 32, 24, 16];
  const pngFrames = await Promise.all(icoSizes.map((s) => makeRoundedIcon(markBuf, s)));

  const count = icoSizes.length;
  let dataOffset = 6 + count * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = icoSizes.map((s, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s >= 256 ? 0 : s, 0);
    entry.writeUInt8(s >= 256 ? 0 : s, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);   // planes
    entry.writeUInt16LE(32, 6);  // bitCount = 32 (RGBA) — matches stock Tauri output
    entry.writeUInt32LE(pngFrames[i].length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += pngFrames[i].length;
    return entry;
  });

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngFrames]));
}

async function writeFile(filePath, buf) {
  try {
    fs.writeFileSync(filePath, buf);
    console.log(`  ${path.basename(filePath)}`);
  } catch {
    console.warn(`  ${path.basename(filePath)} (skipped - file locked)`);
  }
}

async function generateForDir(iconDir) {
  const markBuf = fs.readFileSync(markSrc);

  try {
    await writeIco(markBuf, path.join(iconDir, 'icon.ico'));
    console.log(`  icon.ico (rounded, 16-256px)`);
  } catch {
    console.warn(`  icon.ico (skipped - file locked)`);
  }

  await writeFile(path.join(iconDir, 'icon.png'), await makeRoundedIcon(markBuf, 512));

  for (const [name, size] of [
    ['32x32.png', 32],
    ['64x64.png', 64],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
  ]) {
    await writeFile(path.join(iconDir, name), await makeRoundedIcon(markBuf, size));
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
    await writeFile(path.join(iconDir, name), await makeRoundedIcon(markBuf, size));
  }

  await writeFile(
    path.join(iconDir, 'app-icon-rounded-source.png'),
    await makeRoundedIcon(markBuf, 1024),
  );

  const appIconPath = path.join(iconDir, 'sparo-app-icon.png');
  if (fs.existsSync(appIconPath)) {
    await writeFile(appIconPath, await makeRoundedIcon(markBuf, 512));
  }

  const iosDir = path.join(iconDir, 'ios');
  if (fs.existsSync(iosDir)) {
    for (const f of fs.readdirSync(iosDir)) {
      if (!f.endsWith('.png')) continue;
      const m = f.match(/(\d+)x\1@(\d+)x/);
      if (m) {
        const size = parseInt(m[1]) * parseInt(m[2]);
        try {
          fs.writeFileSync(path.join(iosDir, f), await makeRoundedIcon(markBuf, size));
          console.log(`  ios/${f}`);
        } catch {
          console.warn(`  ios/${f} (skipped - file locked)`);
        }
      }
    }
  }

  const androidDir = path.join(iconDir, 'android');
  if (fs.existsSync(androidDir)) {
    const sizeMap = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
    for (const [folder, size] of Object.entries(sizeMap)) {
      const dir = path.join(androidDir, folder);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.png')) continue;
        await writeFile(path.join(dir, f), await makeRoundedIcon(markBuf, size));
      }
    }
  }

  const hicolorDir = path.join(iconDir, 'hicolor');
  if (fs.existsSync(hicolorDir)) {
    for (const sizeFolder of fs.readdirSync(hicolorDir)) {
      const appsDir = path.join(hicolorDir, sizeFolder, 'apps');
      if (!fs.existsSync(appsDir)) continue;
      const size = parseInt(sizeFolder);
      if (!size) continue;
      const oldFile = path.join(appsDir, 'bitfun-desktop.png');
      const newFile = path.join(appsDir, 'sparo-os.png');
      if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
        fs.renameSync(oldFile, newFile);
      }
      for (const f of fs.readdirSync(appsDir)) {
        if (!f.endsWith('.png')) continue;
        await writeFile(path.join(appsDir, f), await makeRoundedIcon(markBuf, size));
      }
    }
  }
}

async function run() {
  const targets = [
    path.join(root, 'src', 'apps', 'desktop', 'icons'),
    path.join(root, 'installer', 'src-tauri', 'icons'),
  ];
  for (const dir of targets) {
    console.log(`\n[${dir}]`);
    await generateForDir(dir);
  }
  console.log('\nAll rounded icons generated successfully.');
}

run().catch((err) => { console.error(err); process.exit(1); });
