/**
 * Sync mobile-remote Web branding from repository `image/` sources:
 * - Rounded favicons from image/logo-dark.png (home-screen / tab icon)
 * - Wordmarks image/logo-*-transparent.png → bundled assets + public (boot splash)
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
const srcMark = fs.readFileSync(path.join(imageDir, 'logo-dark.png'));
const publicDir = path.join(root, 'src', 'mobile-web', 'public');
const assetsDir = path.join(root, 'src', 'mobile-web', 'src', 'assets');

const WORDMARKS = ['logo-dark-transparent.png', 'logo-light-transparent.png'];

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

function copyWordmarks() {
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  for (const name of WORDMARKS) {
    const from = path.join(imageDir, name);
    if (!fs.existsSync(from)) {
      console.warn(`skip missing wordmark: ${from}`);
      continue;
    }
    fs.copyFileSync(from, path.join(assetsDir, name));
    const stalePublic = path.join(publicDir, name);
    if (fs.existsSync(stalePublic)) {
      fs.unlinkSync(stalePublic);
    }
    console.log(`copied ${name} → mobile-web src/assets (removed public copy — boot uses inline SVG)`);
  }
}

async function run() {
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), await makeRounded(32));
  console.log('wrote favicon.png (32x32 rounded)');

  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), await makeRounded(180));
  console.log('wrote apple-touch-icon.png (180x180 rounded)');

  copyWordmarks();

  console.log('Done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
