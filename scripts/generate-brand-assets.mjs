import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_ROOT = path.join(REPO_ROOT, 'assets', 'brand');
const MARK_SOURCE = 'source/sparo-mark-master.png';
const CORE_SOURCE = 'source/sparo-core-master.png';
const REFERENCE_SOURCE = 'reference/sparo-identity-board.png';

const MASTER_SIZE = 1024;
const MARK_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256, 512]);
const APP_ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256, 512, 1024]);
const SMALL_SIZES = Object.freeze([16, 24, 32, 48]);
const TRAY_SIZES = Object.freeze([16, 20, 24, 32, 48]);
const WORDMARK_STROKE_RADIUS = 3;

const COLORS = Object.freeze({
  coreRed: '#E53935',
  warmWhite: '#F5F2EE',
  softIvory: '#ECE7E1',
  sandGray: '#D8D3CC',
  deepCharcoal: '#1A1A1A',
  reversed: '#FFFDFC',
});

const TRAY_STATE_BADGES = Object.freeze({
  idle: null,
  running: '#168A5B',
  waiting: '#C77B12',
  error: '#8B3AA8',
});

function isQaArtifact(relativePath) {
  return relativePath.startsWith('qa/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hexChannels(value) {
  const normalized = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function labelSvg(width, height, value, size = 24, color = COLORS.deepCharcoal, anchor = 'start') {
  const x = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
  return Buffer.from([
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">',
    '<text x="' + x + '" y="' + Math.round(size * 1.08) + '" fill="' + color + '" font-family="Arial, sans-serif" font-size="' + size + '" font-weight="600" text-anchor="' + anchor + '">' + escapeXml(value) + '</text>',
    '</svg>',
  ].join(''));
}

function circleCoverage(x, y, centerX, centerY, radius) {
  return clamp(radius + 0.5 - Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY));
}

function roundedRectangleCoverage(x, y, left, top, width, height, radius) {
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const qx = Math.abs(x + 0.5 - centerX) - (width / 2 - radius);
  const qy = Math.abs(y + 0.5 - centerY) - (height / 2 - radius);
  const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return clamp(0.5 - distance);
}

async function rawRgba(input) {
  return sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function pngFromRaw(data, width, height) {
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function resizePng(input, width, height = width, { sharpen = false } = {}) {
  let pipeline = sharp(input).resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 });
  if (sharpen) pipeline = pipeline.sharpen({ sigma: 0.55, m1: 0.8, m2: 1.5 });
  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function resizePremultipliedRgba(input, width, height) {
  const source = await rawRgba(input);
  const premultiplied = Buffer.alloc(source.data.length);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    premultiplied[offset] = Math.round(source.data[offset] * alpha / 255);
    premultiplied[offset + 1] = Math.round(source.data[offset + 1] * alpha / 255);
    premultiplied[offset + 2] = Math.round(source.data[offset + 2] * alpha / 255);
    premultiplied[offset + 3] = alpha;
  }

  const resized = await sharp(premultiplied, {
    raw: { width: source.info.width, height: source.info.height, channels: 4 },
  }).resize(width, height, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  }).raw().toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < resized.data.length; offset += 4) {
    const alpha = resized.data[offset + 3];
    if (alpha === 0) {
      resized.data[offset] = 0;
      resized.data[offset + 1] = 0;
      resized.data[offset + 2] = 0;
      continue;
    }
    resized.data[offset] = Math.min(255, Math.round(resized.data[offset] * 255 / alpha));
    resized.data[offset + 1] = Math.min(255, Math.round(resized.data[offset + 1] * 255 / alpha));
    resized.data[offset + 2] = Math.min(255, Math.round(resized.data[offset + 2] * 255 / alpha));
  }

  return pngFromRaw(resized.data, width, height);
}

async function cropTransparentMargins(input, outputSize) {
  const source = await rawRgba(input);
  const bounds = alphaBounds(source.data, source.info.width, source.info.height, 8);
  if (Math.abs(bounds.width - bounds.height) > 1) {
    throw new Error('Expected circular artwork to have square visible bounds');
  }
  const cropSize = Math.max(bounds.width, bounds.height);
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const left = Math.max(0, Math.min(
    source.info.width - cropSize,
    Math.round(centerX - cropSize / 2),
  ));
  const top = Math.max(0, Math.min(
    source.info.height - cropSize,
    Math.round(centerY - cropSize / 2),
  ));
  const cropped = await sharp(input)
    .extract({ left, top, width: cropSize, height: cropSize })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const result = await resizePremultipliedRgba(cropped, outputSize, outputSize);
  const output = await rawRgba(result);
  const outputBounds = alphaBounds(output.data, output.info.width, output.info.height, 8);
  if (
    outputBounds.left !== 0 ||
    outputBounds.top !== 0 ||
    outputBounds.width !== outputSize ||
    outputBounds.height !== outputSize
  ) {
    throw new Error('Edge-fitted circular artwork must fill all four canvas edges');
  }
  return result;
}

async function coloredBlurredAlpha(alphaMask, width, height, color, sigma) {
  const blurred = await sharp(alphaMask, {
    raw: { width, height, channels: 1 },
  }).blur(sigma).raw().toBuffer({ resolveWithObject: true });
  const rgb = hexChannels(color);
  const output = Buffer.alloc(width * height * 4);
  for (let index = 0; index < alphaMask.length; index += 1) {
    const offset = index * 4;
    output[offset] = rgb[0];
    output[offset + 1] = rgb[1];
    output[offset + 2] = rgb[2];
    output[offset + 3] = blurred.data[index * blurred.info.channels];
  }
  return pngFromRaw(output, width, height);
}

function alphaBounds(data, width, height, threshold) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Raster source has no visible pixels');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeMarkMaster(sourceBuffer) {
  const source = await rawRgba(sourceBuffer);
  const bounds = alphaBounds(source.data, source.info.width, source.info.height, 8);
  const crop = Buffer.alloc(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const from = ((bounds.top + y) * source.info.width + bounds.left + x) * 4;
      const to = (y * bounds.width + x) * 4;
      crop[to] = source.data[from];
      crop[to + 1] = source.data[from + 1];
      crop[to + 2] = source.data[from + 2];
      crop[to + 3] = source.data[from + 3] < 8 ? 0 : source.data[from + 3];
    }
  }

  const fieldSize = 896;
  const resized = await sharp(crop, {
    raw: { width: bounds.width, height: bounds.height, channels: 4 },
  }).resize(fieldSize, fieldSize, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer();

  const clipped = Buffer.from(resized);
  const radius = 444;
  for (let y = 0; y < fieldSize; y += 1) {
    for (let x = 0; x < fieldSize; x += 1) {
      const offset = (y * fieldSize + x) * 4;
      const mask = circleCoverage(x, y, fieldSize / 2, fieldSize / 2, radius);
      clipped[offset + 3] = Math.round(clipped[offset + 3] * mask);
    }
  }

  const surface = await sharp({
    create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4, background: '#00000000' },
  }).composite([{ input: await pngFromRaw(clipped, fieldSize, fieldSize), left: 64, top: 64 }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  const shadowMask = Buffer.alloc(MASTER_SIZE * MASTER_SIZE);
  for (let y = 0; y < MASTER_SIZE; y += 1) {
    for (let x = 0; x < MASTER_SIZE; x += 1) {
      shadowMask[y * MASTER_SIZE + x] = Math.round(
        circleCoverage(x, y, 512, 528, radius) * 48,
      );
    }
  }
  const shadow = await coloredBlurredAlpha(
    shadowMask,
    MASTER_SIZE,
    MASTER_SIZE,
    '#695B50',
    22,
  );

  const mark = await sharp({
    create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4, background: '#00000000' },
  }).composite([{ input: shadow }, { input: surface }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  return { mark, surface, sourceBounds: bounds };
}

async function prepareCoreMaster(sourceBuffer) {
  const source = await rawRgba(sourceBuffer);
  const bounds = alphaBounds(source.data, source.info.width, source.info.height, 8);
  const crop = Buffer.alloc(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const from = ((bounds.top + y) * source.info.width + bounds.left + x) * 4;
      const to = (y * bounds.width + x) * 4;
      const alpha = source.data[from + 3] < 8 ? 0 : source.data[from + 3];
      crop[to] = alpha === 0 ? 0 : source.data[from];
      crop[to + 1] = alpha === 0 ? 0 : source.data[from + 1];
      crop[to + 2] = alpha === 0 ? 0 : source.data[from + 2];
      crop[to + 3] = alpha;
    }
  }
  return {
    artwork: await pngFromRaw(crop, bounds.width, bounds.height),
    bounds,
  };
}

async function extractWordmark(referenceBuffer) {
  // The approved board contains layout dividers on both sides of the wordmark
  // panel. Keep the extraction window strictly inside those rules.
  const region = { left: 875, top: 575, width: 490, height: 110 };
  const source = await sharp(referenceBuffer).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = Buffer.alloc(source.info.width * source.info.height * 4);
  const charcoal = hexChannels(COLORS.deepCharcoal);
  const red = hexChannels(COLORS.coreRed);
  for (let y = 0; y < source.info.height; y += 1) {
    for (let x = 0; x < source.info.width; x += 1) {
      const from = (y * source.info.width + x) * 3;
      const to = (y * source.info.width + x) * 4;
      const r = source.data[from];
      const g = source.data[from + 1];
      const b = source.data[from + 2];
      const isRed = r > 120 && r - g > 45 && r - b > 40;
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      let alpha;
      let color;
      if (isRed) {
        alpha = Math.max((255 - g) / (255 - red[1]), (255 - b) / (255 - red[2]));
        color = red;
      } else {
        alpha = (250 - luminance) / (250 - 26);
        color = charcoal;
      }
      alpha = alpha < 0.035 ? 0 : clamp(alpha);
      raw[to] = color[0];
      raw[to + 1] = color[1];
      raw[to + 2] = color[2];
      raw[to + 3] = Math.round(alpha * 255);
    }
  }
  const bounds = alphaBounds(raw, source.info.width, source.info.height, 8);
  const padding = 4;
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const width = Math.min(source.info.width - left, bounds.width + padding * 2);
  const height = Math.min(source.info.height - top, bounds.height + padding * 2);
  const cropped = await sharp(raw, {
    raw: { width: source.info.width, height: source.info.height, channels: 4 },
  }).extract({ left, top, width, height }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();

  return sharp({
    create: { width: 950, height: 192, channels: 4, background: '#00000000' },
  }).composite([{
    input: await sharp(cropped).resize(918, 176, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: '#00000000',
    }).toBuffer(),
    left: 16,
    top: 8,
  }]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function recolorWordmark(wordmark, foreground, { preserveRed = true } = {}) {
  const source = await rawRgba(wordmark);
  const color = hexChannels(foreground);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const isRed = source.data[offset] > source.data[offset + 1] + 80;
    if (preserveRed && isRed) continue;
    source.data[offset] = color[0];
    source.data[offset + 1] = color[1];
    source.data[offset + 2] = color[2];
  }
  return pngFromRaw(source.data, source.info.width, source.info.height);
}

function dilateAlphaMask(mask, width, height, radius) {
  const result = Buffer.alloc(mask.length);
  const offsets = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) offsets.push([x, y]);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let alpha = 0;
      for (const [offsetX, offsetY] of offsets) {
        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
        alpha = Math.max(alpha, mask[sampleY * width + sampleX]);
      }
      result[y * width + x] = alpha;
    }
  }
  return result;
}

async function buildOpticallyBoldWordmark(
  wordmark,
  foreground,
  { radius = WORDMARK_STROKE_RADIUS, preserveRed = true } = {},
) {
  const source = await rawRgba(wordmark);
  const neutralAlpha = Buffer.alloc(source.info.width * source.info.height);
  const redAlpha = Buffer.alloc(source.info.width * source.info.height);
  for (let index = 0; index < neutralAlpha.length; index += 1) {
    const offset = index * 4;
    const isRed = source.data[offset] > source.data[offset + 1] + 80;
    if (isRed && preserveRed) {
      redAlpha[index] = source.data[offset + 3];
    } else {
      neutralAlpha[index] = source.data[offset + 3];
    }
  }

  const expandedNeutral = dilateAlphaMask(
    neutralAlpha,
    source.info.width,
    source.info.height,
    radius,
  );
  const foregroundRgb = hexChannels(foreground);
  const redRgb = hexChannels(COLORS.coreRed);
  const output = Buffer.alloc(source.data.length);
  for (let index = 0; index < expandedNeutral.length; index += 1) {
    const offset = index * 4;
    const foregroundAlpha = expandedNeutral[index] / 255;
    const accentAlpha = redAlpha[index] / 255;
    const alpha = accentAlpha + foregroundAlpha * (1 - accentAlpha);
    if (alpha === 0) continue;
    const foregroundContribution = foregroundAlpha * (1 - accentAlpha);
    output[offset] = Math.round(
      (redRgb[0] * accentAlpha + foregroundRgb[0] * foregroundContribution) / alpha,
    );
    output[offset + 1] = Math.round(
      (redRgb[1] * accentAlpha + foregroundRgb[1] * foregroundContribution) / alpha,
    );
    output[offset + 2] = Math.round(
      (redRgb[2] * accentAlpha + foregroundRgb[2] * foregroundContribution) / alpha,
    );
    output[offset + 3] = Math.round(alpha * 255);
  }
  return pngFromRaw(output, source.info.width, source.info.height);
}

async function buildLockup(mark, wordmark, dividerColor) {
  const divider = await sharp({
    create: { width: 4, height: 176, channels: 4, background: dividerColor },
  }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  return sharp({
    create: { width: 1340, height: 256, channels: 4, background: '#00000000' },
  }).composite([
    { input: await resizePng(mark, 256), left: 0, top: 0 },
    { input: divider, left: 302, top: 40 },
    { input: wordmark, left: 352, top: 32 },
  ]).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function buildCompactCore(coreArtwork, size) {
  const metadata = await sharp(coreArtwork).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Core master has invalid dimensions');

  // Keep a target-specific transparent safe zone. Directly assigning the
  // 1536x1024 master to a 32px tray slot causes dark alpha fringes and lets
  // platform scaling choose inconsistent optical sizes.
  const contentLimit = Math.max(1, Math.round(size * 0.875));
  const scale = Math.min(contentLimit / metadata.width, contentLimit / metadata.height);
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  const core = await resizePremultipliedRgba(coreArtwork, width, height);

  return sharp({
    create: { width: size, height: size, channels: 4, background: '#00000000' },
  }).composite([{
    input: core,
    left: Math.floor((size - width) / 2),
    top: Math.floor((size - height) / 2),
  }]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function buildTrayLogo(appIcon, size) {
  return resizePremultipliedRgba(appIcon, size, size);
}

async function buildTrayState(appIcon, size, badgeColor) {
  const logo = await buildTrayLogo(appIcon, size);
  if (!badgeColor) return logo;

  const badge = Buffer.alloc(size * size * 4);
  const rgb = hexChannels(badgeColor);
  const radius = Math.max(2, size * 0.125);
  const borderWidth = Math.max(0.75, size / 32);
  const center = size - radius - Math.max(0.5, size * 0.035);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const outer = circleCoverage(x, y, center, center, radius + borderWidth);
      const inner = circleCoverage(x, y, center, center, radius);
      const border = Math.max(0, outer - inner);
      const alpha = Math.max(inner, border);
      if (alpha === 0) continue;
      const useBorder = border > inner;
      badge[offset] = useBorder ? 255 : rgb[0];
      badge[offset + 1] = useBorder ? 253 : rgb[1];
      badge[offset + 2] = useBorder ? 252 : rgb[2];
      badge[offset + 3] = Math.round(alpha * 255);
    }
  }

  return sharp(logo).composite([{ input: await pngFromRaw(badge, size, size) }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function roundedSwatch(color) {
  const size = 104;
  const raw = Buffer.alloc(size * size * 4);
  const rgb = hexChannels(color);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alpha = roundedRectangleCoverage(x, y, 0, 0, size, size, 20);
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
      raw[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pngFromRaw(raw, size, size);
}

async function buildBrandPreview(variants) {
  const composites = [
    { input: labelSvg(1450, 54, 'Sparo OS raster brand asset matrix', 36), left: 72, top: 50 },
    { input: labelSvg(560, 38, 'Circular default logo', 22), left: 84, top: 126 },
    { input: await resizePng(variants.mark, 510), left: 84, top: 176 },
    { input: labelSvg(390, 38, 'Circular application icon', 22), left: 710, top: 126 },
    { input: await resizePng(variants.appIcon, 330), left: 748, top: 184 },
    { input: labelSvg(440, 38, 'Reference-derived wordmark', 22), left: 710, top: 560 },
    { input: await sharp(variants.wordmarkPrimary).resize({ width: 760, fit: 'contain' }).toBuffer(), left: 710, top: 614 },
    { input: labelSvg(440, 38, 'Horizontal lockup', 22), left: 710, top: 800 },
    { input: await sharp(variants.lockupPrimary).resize({ width: 800, fit: 'contain' }).toBuffer(), left: 710, top: 848 },
  ];
  const palette = [
    ['CORE RED', COLORS.coreRed],
    ['WARM WHITE', COLORS.warmWhite],
    ['SOFT IVORY', COLORS.softIvory],
    ['SAND GRAY', COLORS.sandGray],
    ['DEEP CHARCOAL', COLORS.deepCharcoal],
  ];
  for (const [index, [name, color]] of palette.entries()) {
    const left = 76 + index * 124;
    composites.push({ input: await roundedSwatch(color), left, top: 792 });
    composites.push({ input: labelSvg(112, 24, name, 12), left: left - 2, top: 910 });
    composites.push({ input: labelSvg(112, 22, color, 12), left: left - 2, top: 936 });
  }
  return sharp({ create: { width: 1600, height: 1040, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function buildSmallPreview(smallMarks, smallAppIcons) {
  const composites = [
    { input: labelSvg(1080, 52, 'Sparo small-size raster QA', 34), left: 60, top: 42 },
    { input: labelSvg(480, 34, 'Default circular logo', 21), left: 72, top: 124 },
    { input: labelSvg(480, 34, 'Application icon', 21), left: 620, top: 124 },
  ];
  for (const [index, size] of SMALL_SIZES.entries()) {
    const top = 184 + index * 110;
    composites.push({ input: await resizePng(smallMarks[size], 84), left: 76, top });
    composites.push({ input: await resizePng(smallAppIcons[size], 84), left: 624, top });
    composites.push({ input: smallMarks[size], left: 206, top: top + 22 });
    composites.push({ input: smallAppIcons[size], left: 754, top: top + 22 });
    composites.push({ input: labelSvg(250, 30, size + ' px raster / native', 18), left: 292, top: top + 28 });
    composites.push({ input: labelSvg(250, 30, size + ' px raster / native', 18), left: 840, top: top + 28 });
  }
  return sharp({ create: { width: 1160, height: 670, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function buildStartupBrandPreview(mark, wordmarkPrimary, wordmarkReversed) {
  const lightPanel = await sharp({
    create: { width: 500, height: 500, channels: 4, background: COLORS.warmWhite },
  }).png().toBuffer();
  const darkPanel = await sharp({
    create: { width: 500, height: 500, channels: 4, background: COLORS.deepCharcoal },
  }).png().toBuffer();
  const mark128 = await resizePng(mark, 128);
  const primary220 = await sharp(wordmarkPrimary).resize({ width: 220, fit: 'contain' }).png().toBuffer();
  const reversed220 = await sharp(wordmarkReversed).resize({ width: 220, fit: 'contain' }).png().toBuffer();
  return sharp({ create: { width: 1100, height: 620, channels: 4, background: '#FFFFFF' } })
    .composite([
      { input: labelSvg(1000, 52, 'Sparo startup brand lockup / actual CSS pixel scale', 32), left: 50, top: 38 },
      { input: lightPanel, left: 40, top: 100 },
      { input: darkPanel, left: 560, top: 100 },
      { input: labelSvg(440, 32, 'LIGHT', 17, COLORS.deepCharcoal, 'middle'), left: 70, top: 126 },
      { input: labelSvg(440, 32, 'DARK', 17, COLORS.reversed, 'middle'), left: 590, top: 126 },
      { input: mark128, left: 226, top: 190 },
      { input: mark128, left: 746, top: 190 },
      { input: primary220, left: 180, top: 336 },
      { input: reversed220, left: 700, top: 336 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function buildAppIconSizePreview(appIcons) {
  const sizes = [16, 24, 32, 48, 64, 128];
  const composites = [
    { input: labelSvg(1080, 52, 'Sparo application icon size policy', 34), left: 56, top: 42 },
    { input: labelSvg(980, 32, 'Circular material logo at every size / target-specific alpha-safe raster reduction', 18), left: 58, top: 92 },
  ];
  for (const [index, size] of sizes.entries()) {
    const icon = appIcons[size];
    const left = 58 + index * 182;
    const enlarged = size < 128
      ? await sharp(icon).resize(128, 128, { kernel: sharp.kernel.nearest }).png().toBuffer()
      : icon;
    composites.push({ input: enlarged, left, top: 156 });
    composites.push({ input: icon, left: left + Math.floor((128 - size) / 2), top: 304 });
    composites.push({ input: labelSvg(154, 28, size + ' px', 17, COLORS.deepCharcoal, 'middle'), left: left - 12, top: 448 });
    composites.push({
      input: labelSvg(
        154,
        26,
        'CIRCULAR',
        14,
        COLORS.coreRed,
        'middle',
      ),
      left: left - 12,
      top: 482,
    });
  }
  return sharp({ create: { width: 1160, height: 550, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

async function buildTrayPreview(trayStates, traySizes) {
  const composites = [
    { input: labelSvg(920, 52, 'Sparo full-logo tray assets', 34), left: 54, top: 42 },
    { input: labelSvg(820, 32, 'Edge-fitted circular Logo; active states add a compact badge.', 17), left: 56, top: 92 },
  ];
  for (const [index, [state, icon]] of Object.entries(trayStates).entries()) {
    const left = 64 + index * 218;
    composites.push({
      input: await sharp(icon).resize(128, 128, { kernel: sharp.kernel.nearest }).png().toBuffer(),
      left,
      top: 142,
    });
    composites.push({ input: icon, left: left + 160, top: 190 });
    composites.push({ input: labelSvg(192, 30, state.toUpperCase(), 18, COLORS.deepCharcoal, 'middle'), left, top: 294 });
  }
  for (const [index, [size, icon]] of Object.entries(traySizes).entries()) {
    const left = 72 + index * 170;
    composites.push({
      input: await sharp(icon).resize(96, 96, { kernel: sharp.kernel.nearest }).png().toBuffer(),
      left,
      top: 388,
    });
    composites.push({ input: icon, left: left + 112, top: 420 });
    composites.push({ input: labelSvg(142, 28, size + ' px', 17, COLORS.deepCharcoal, 'middle'), left: left - 12, top: 500 });
  }
  return sharp({ create: { width: 940, height: 570, channels: 4, background: '#FFFFFF' } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
}

function manifestFor(assets, sources, metadata, sourceBounds, coreBounds) {
  const files = [...assets.entries()]
    // QA boards contain host-rendered labels. Their pixels can differ with the
    // system font stack even when every product asset is byte-identical.
    .filter(([filePath]) => !isQaArtifact(filePath))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, value]) => ({ path: filePath, bytes: value.length, sha256: sha256(value) }));
  return {
    schemaVersion: 5,
    brandVersion: '2026.08-tight-circular-system-icons',
    status: 'current',
    generatedBy: 'pnpm run brand:generate',
    provenance: {
      mark: {
        path: MARK_SOURCE,
        pixels: [metadata.mark.width, metadata.mark.height],
        sha256: sha256(sources[MARK_SOURCE]),
        treatment: 'Low-alpha speckles removed, visible bounds normalized to a true circle, supplied material detail preserved.',
      },
      core: {
        path: CORE_SOURCE,
        pixels: [metadata.core.width, metadata.core.height],
        sha256: sha256(sources[CORE_SOURCE]),
        treatment: 'Source silhouette and material preserved for compact in-product core exports; target sizes use alpha-safe reduction and lossless PNG compression.',
      },
      reference: {
        path: REFERENCE_SOURCE,
        pixels: [metadata.reference.width, metadata.reference.height],
        sha256: sha256(sources[REFERENCE_SOURCE]),
      },
      appIcon: 'Transparent margins are removed on all four sides of the normalized circular material Logo before platform-size reduction; source proportions and material are preserved.',
      wordmark: 'Deterministic transparent raster extraction from the approved identity board with a global 3px optical stroke expansion; the approved letter geometry and red core are preserved without redrawn paths.',
    },
    roles: {
      defaultLogo: 'circular',
      applicationIcon: 'circular at every size, including taskbar and window icons',
      trayIcon: 'edge-fitted circular material Logo with the red core; active states add a compact status badge',
      wordmark: 'Globally optically bold Sparo OS wordmark with a red core inside the lowercase a',
    },
    formatPolicy: 'Brand artwork is PNG-only. Product code must not redraw or embed brand geometry as SVG.',
    qaPolicy: 'QA preview boards are validated for presence, PNG format, and dimensions but excluded from cross-platform byte hashes because their labels use host font rasterization.',
    colors: {
      coreRed: COLORS.coreRed,
      warmWhite: COLORS.warmWhite,
      softIvory: COLORS.softIvory,
      sandGray: COLORS.sandGray,
      deepCharcoal: COLORS.deepCharcoal,
    },
    sourceProcessing: {
      alphaThreshold: 8,
      detectedVisibleBounds: sourceBounds,
      detectedCoreBounds: coreBounds,
      normalizedCanvas: [MASTER_SIZE, MASTER_SIZE],
      wordmark: {
        neutralStrokeExpansionPx: WORDMARK_STROKE_RADIUS,
        primaryAndReversedPreserveRedCore: true,
        redrawnGeometry: false,
      },
    },
    sizePolicy: {
      canonicalMinimumPx: 64,
      responsiveMinimumPx: 16,
      rule: 'Use the normalized raster master at 64px and above and target-specific raster reductions at 16-48px.',
      smallSizes: SMALL_SIZES,
    },
    appIcon: {
      master: 'exports/app-icon/sparo-app-icon-1024.png',
      geometry: 'circular',
      transparentOutsideCircle: true,
      edgeFit: 'Visible bounds fill all four sides of the square canvas; only the circular corners remain transparent.',
      smallSizeProcessing: 'Premultiplied-alpha Lanczos reduction from the normalized circular mark.',
      iosOpaqueBackground: COLORS.warmWhite,
    },
    tray: {
      geometry: 'Direct target-size raster derivatives of the edge-fitted circular material Logo with its red core.',
      stateBadges: TRAY_STATE_BADGES,
      sizes: TRAY_SIZES,
      contentLimit: 'Visible circular Logo fills all four sides of the target canvas without added transparent padding.',
      compression: 'Lossless PNG, level 9, adaptive filtering.',
    },
    sources: Object.fromEntries(
      Object.entries(sources).map(([filePath, value]) => [filePath, { bytes: value.length, sha256: sha256(value) }]),
    ),
    files,
  };
}

async function buildBrandAssets() {
  const [markSource, coreSource, referenceSource] = await Promise.all([
    readFile(path.join(BRAND_ROOT, MARK_SOURCE)),
    readFile(path.join(BRAND_ROOT, CORE_SOURCE)),
    readFile(path.join(BRAND_ROOT, REFERENCE_SOURCE)),
  ]);
  const [markMetadata, coreMetadata, referenceMetadata] = await Promise.all([
    sharp(markSource).metadata(),
    sharp(coreSource).metadata(),
    sharp(referenceSource).metadata(),
  ]);
  if (!markMetadata.hasAlpha || !markMetadata.width || !markMetadata.height) {
    throw new Error(MARK_SOURCE + ' must be a transparent PNG');
  }
  if (!coreMetadata.hasAlpha || !coreMetadata.width || !coreMetadata.height) {
    throw new Error(CORE_SOURCE + ' must be a transparent PNG');
  }
  if (referenceMetadata.width !== 1448 || referenceMetadata.height !== 1086) {
    throw new Error(REFERENCE_SOURCE + ' must retain the approved 1448x1086 board');
  }

  const normalized = await normalizeMarkMaster(markSource);
  const core = await prepareCoreMaster(coreSource);
  const appIcon = await cropTransparentMargins(normalized.surface, MASTER_SIZE);
  const wordmarkSource = await extractWordmark(referenceSource);
  const wordmarkPrimary = await buildOpticallyBoldWordmark(wordmarkSource, COLORS.deepCharcoal);
  const wordmarkReversed = await buildOpticallyBoldWordmark(wordmarkSource, COLORS.reversed);
  const wordmarkMono = await buildOpticallyBoldWordmark(
    wordmarkSource,
    COLORS.deepCharcoal,
    { preserveRed: false },
  );
  const lockupPrimary = await buildLockup(normalized.mark, wordmarkPrimary, COLORS.sandGray);
  const lockupReversed = await buildLockup(normalized.mark, wordmarkReversed, '#8A8580');
  const lockupMono = await buildLockup(
    await recolorWordmark(normalized.mark, COLORS.deepCharcoal, { preserveRed: false }),
    wordmarkMono,
    COLORS.deepCharcoal,
  );
  const variants = {
    mark: normalized.mark,
    appIcon,
    wordmarkPrimary,
    wordmarkReversed,
    wordmarkMono,
    lockupPrimary,
    lockupReversed,
    lockupMono,
  };

  const assets = new Map();
  for (const size of MARK_SIZES) {
    assets.set('exports/mark/sparo-mark-' + size + '.png', await resizePng(normalized.mark, size));
  }
  for (const size of APP_ICON_SIZES) {
    assets.set(
      'exports/app-icon/sparo-app-icon-' + size + '.png',
      await resizePremultipliedRgba(appIcon, size, size),
    );
  }
  assets.set('exports/wordmark/sparo-wordmark-primary.png', wordmarkPrimary);
  assets.set('exports/wordmark/sparo-wordmark-reversed.png', wordmarkReversed);
  assets.set('exports/wordmark/sparo-wordmark-mono.png', wordmarkMono);
  assets.set('exports/lockup/sparo-lockup-horizontal-primary.png', lockupPrimary);
  assets.set('exports/lockup/sparo-lockup-horizontal-reversed.png', lockupReversed);
  assets.set('exports/lockup/sparo-lockup-horizontal-mono.png', lockupMono);

  const smallMarks = {};
  const smallAppIcons = {};
  for (const size of SMALL_SIZES) {
    smallMarks[size] = assets.get('exports/mark/sparo-mark-' + size + '.png');
    smallAppIcons[size] = assets.get('exports/app-icon/sparo-app-icon-' + size + '.png');
  }

  const traySizes = {};
  for (const size of TRAY_SIZES) {
    assets.set('exports/core/sparo-core-' + size + '.png', await buildCompactCore(core.artwork, size));
    traySizes[size] = await buildTrayLogo(appIcon, size);
    assets.set('exports/tray/sparo-tray-idle-' + size + '.png', traySizes[size]);
    assets.set('exports/tray/sparo-tray-' + size + '-dark.png', traySizes[size]);
    assets.set('exports/tray/sparo-tray-' + size + '-light.png', traySizes[size]);
  }
  const trayStates = {};
  for (const [state, badgeColor] of Object.entries(TRAY_STATE_BADGES)) {
    trayStates[state] = await buildTrayState(appIcon, 32, badgeColor);
    assets.set('exports/tray/sparo-tray-' + state + '.png', trayStates[state]);
  }

  for (const size of [16, 32, 48]) {
    assets.set('exports/web/favicon-' + size + '.png', smallAppIcons[size]);
  }
  assets.set('exports/web/apple-touch-icon-180.png', await resizePng(appIcon, 180));
  assets.set('exports/web/web-app-icon-192.png', await resizePng(appIcon, 192));
  assets.set('exports/web/web-app-icon-512.png', await resizePng(appIcon, 512));
  const appIconPreviewSizes = Object.fromEntries(
    [16, 24, 32, 48, 64, 128].map((size) => [
      size,
      assets.get('exports/app-icon/sparo-app-icon-' + size + '.png'),
    ]),
  );
  assets.set('qa/sparo-brand-asset-matrix.png', await buildBrandPreview(variants));
  assets.set('qa/sparo-app-icon-size-matrix.png', await buildAppIconSizePreview(appIconPreviewSizes));
  assets.set('qa/sparo-small-mark-matrix.png', await buildSmallPreview(smallMarks, smallAppIcons));
  assets.set('qa/sparo-startup-brand-preview.png', await buildStartupBrandPreview(
    normalized.mark,
    wordmarkPrimary,
    wordmarkReversed,
  ));
  assets.set('qa/sparo-tray-state-matrix.png', await buildTrayPreview(trayStates, traySizes));

  const sources = {
    [MARK_SOURCE]: markSource,
    [CORE_SOURCE]: coreSource,
    [REFERENCE_SOURCE]: referenceSource,
  };
  assets.set('manifest.json', Buffer.from(JSON.stringify(manifestFor(
    assets,
    sources,
    {
      mark: markMetadata,
      core: coreMetadata,
      reference: referenceMetadata,
    },
    normalized.sourceBounds,
    core.bounds,
  ), null, 2) + '\n'));
  return assets;
}

async function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(fullPath));
    if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

async function clearGeneratedAssets() {
  for (const relativePath of ['exports', 'qa']) {
    await rm(path.join(BRAND_ROOT, relativePath), { force: true, recursive: true });
  }
  await rm(path.join(BRAND_ROOT, 'manifest.json'), { force: true });
}

export async function generateBrandAssets() {
  const assets = await buildBrandAssets();
  await clearGeneratedAssets();
  for (const [relativePath, value] of assets) {
    const destination = path.join(BRAND_ROOT, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, value);
  }
  const qaCount = [...assets.keys()].filter(isQaArtifact).length;
  const deterministicCount = assets.size - qaCount;
  console.log(
    'Generated ' + deterministicCount + ' deterministic Sparo brand files and ' +
      qaCount + ' host-rendered QA previews.',
  );
}

export async function checkBrandAssets() {
  const expected = await buildBrandAssets();
  const failures = [];
  for (const [relativePath, value] of expected) {
    try {
      const actual = await readFile(path.join(BRAND_ROOT, relativePath));
      if (isQaArtifact(relativePath)) {
        const [actualMetadata, expectedMetadata] = await Promise.all([
          sharp(actual).metadata(),
          sharp(value).metadata(),
        ]);
        if (
          actualMetadata.format !== 'png' ||
          actualMetadata.width !== expectedMetadata.width ||
          actualMetadata.height !== expectedMetadata.height
        ) {
          failures.push(relativePath + ' has an invalid format or dimensions');
        }
      } else if (!actual.equals(value)) {
        failures.push(relativePath + ' is stale');
      }
    } catch {
      failures.push(relativePath + ' is missing');
    }
  }
  const expectedPaths = new Set(expected.keys());
  for (const directory of ['exports', 'qa']) {
    for (const filePath of await walkFiles(path.join(BRAND_ROOT, directory))) {
      const relativePath = path.relative(BRAND_ROOT, filePath).replaceAll('\\', '/');
      if (!expectedPaths.has(relativePath)) failures.push(relativePath + ' is unmanaged');
      if (path.extname(relativePath).toLowerCase() === '.svg') failures.push(relativePath + ' violates the PNG-only policy');
    }
  }
  for (const legacyPath of [
    'source/sparo-mark-full.svg',
    'source/sparo-app-icon.svg',
    'source/sparo-wordmark.svg',
    'source/sparo-lockup-horizontal.svg',
    'source/small',
  ]) {
    if (existsSync(path.join(BRAND_ROOT, legacyPath))) failures.push(legacyPath + ' is a legacy vector source');
  }
  if (failures.length > 0) {
    throw new Error('Brand assets are not current:\n- ' + failures.join('\n- ') + '\nRun pnpm run brand:generate.');
  }
  const qaCount = [...expected.keys()].filter(isQaArtifact).length;
  const deterministicCount = expected.size - qaCount;
  console.log(
    'Verified ' + deterministicCount + ' deterministic Sparo brand files and ' +
      qaCount + ' host-rendered QA previews.',
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const shouldCheck = process.argv.includes('--check');
  (shouldCheck ? checkBrandAssets() : generateBrandAssets()).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
