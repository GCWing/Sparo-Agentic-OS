/**
 * Sync mobile-remote Web branding from repository `image/` sources:
 * - Rounded favicons from image/sparo-app-icon-rounded.png (home-screen / tab icon)
 * - Logo mark from image/sparo-logo-mark.png → bundled assets
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const imageDir = path.join(root, 'image');
const srcMark = fs.readFileSync(path.join(imageDir, 'sparo-app-icon-rounded.png'));
const logoMark = 'sparo-logo-mark.png';
const publicDir = path.join(root, 'src', 'mobile-web', 'public');
const assetsDir = path.join(root, 'src', 'mobile-web', 'src', 'assets');

function roundedMask(size, ratio = 0.225) {
  const r = Math.round(size * ratio);
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>` +
    `</svg>`
  );
}

async function makeRounded(size) {
  const resized = await sharp(srcMark).resize(size, size, { fit: 'cover', position: 'centre' }).toBuffer();
  return sharp(resized).composite([{ input: roundedMask(size), blend: 'dest-in' }]).png().toBuffer();
}

function copyLogoMark() {
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  const from = path.join(imageDir, logoMark);
  if (!fs.existsSync(from)) {
    console.warn(`skip missing logo mark: ${from}`);
    return;
  }
  fs.copyFileSync(from, path.join(assetsDir, logoMark));
  console.log(`copied ${logoMark} → mobile-web src/assets`);
}

async function run() {
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), await makeRounded(32));
  console.log('wrote favicon.png (32x32 rounded)');

  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), await makeRounded(180));
  console.log('wrote apple-touch-icon.png (180x180 rounded)');

  copyLogoMark();

  console.log('Done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
