import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseDir = path.join(packageRoot, 'src', 'svg', 'base');
const emphasisDir = path.join(packageRoot, 'src', 'svg', 'emphasis');
const spritePath = path.join(packageRoot, 'src', 'svg', 'sparo-system-icons.svg');
const metadataPath = path.join(packageRoot, 'src', 'icons.json');
const checkOnly = process.argv.includes('--check');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const viewBoxSize = 48;
const strokeWidth = 2;
const emphasisScale = 0.78;
const emphasisTranslate = 5.28;
const emphasisStrokeWidth = Number((strokeWidth / emphasisScale).toFixed(4));
const detailStrokeWidth = 1.4;
const emphasisDetailStrokeWidth = Number((detailStrokeWidth / emphasisScale).toFixed(4));

function normalize(value) {
  return value.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function extractGlyph(source, id) {
  const rootMatch = source.match(/^<svg\s+([^>]+)>([\s\S]*)<\/svg>\s*$/);
  if (!rootMatch) {
    throw new Error(`${id}: expected one root <svg> element`);
  }

  const attributes = rootMatch[1];
  const body = rootMatch[2].trim();
  const requiredAttributes = [
    `viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"`,
    'fill="none"',
    'stroke="currentColor"',
    `stroke-width="${strokeWidth}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    `data-sparo-icon="${id}"`,
  ];

  for (const attribute of requiredAttributes) {
    if (!attributes.includes(attribute)) {
      throw new Error(`${id}: missing required root attribute ${attribute}`);
    }
  }

  if (/\s(?:width|height)="/.test(attributes)) {
    throw new Error(`${id}: canonical SVG must not fix width or height`);
  }
  if (/#[0-9a-f]{3,8}\b/i.test(body)) {
    throw new Error(`${id}: glyph geometry must not contain hardcoded colors`);
  }
  if (/\s(?:stroke|stroke-linecap|stroke-linejoin)="/.test(body)) {
    throw new Error(`${id}: stroke styling belongs on the SVG root`);
  }
  const childStrokeWidths = [...body.matchAll(/\sstroke-width="([^"]+)"/g)];
  for (const match of childStrokeWidths) {
    if (match[1] !== 'var(--sparo-icon-detail-stroke-width, 1.4)') {
      throw new Error(`${id}: unsupported child stroke-width ${match[1]}`);
    }
  }

  return body;
}

function indent(value, spaces) {
  const prefix = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function emphasisSvg(id, body) {
  const detailStrokeStyle = body.includes('--sparo-icon-detail-stroke-width')
    ? ` style="--sparo-icon-detail-stroke-width: var(--sparo-icon-detail-stroke-width-override, ${emphasisDetailStrokeWidth})"`
    : '';
  return normalize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" fill="none" data-sparo-icon="${id}" data-sparo-variant="emphasis">
  <circle cx="24" cy="24" r="22" fill="var(--sparo-icon-background, #d9231b)" />
  <g transform="translate(${emphasisTranslate} ${emphasisTranslate}) scale(${emphasisScale})" stroke="var(--sparo-icon-foreground, #fff)" stroke-width="var(--sparo-icon-stroke-width, ${emphasisStrokeWidth})" stroke-linecap="round" stroke-linejoin="round"${detailStrokeStyle}>
${indent(body, 4)}
  </g>
</svg>`);
}

function baseSymbol(id, body) {
  return `  <symbol id="${id}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}">
    <g fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
${indent(body, 6)}
    </g>
  </symbol>`;
}

function emphasisSymbol(id, body) {
  const detailStrokeStyle = body.includes('--sparo-icon-detail-stroke-width')
    ? ` style="--sparo-icon-detail-stroke-width: var(--sparo-icon-detail-stroke-width-override, ${emphasisDetailStrokeWidth})"`
    : '';
  return `  <symbol id="${id}-emphasis" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}">
    <circle cx="24" cy="24" r="22" fill="var(--sparo-icon-background, #d9231b)" />
    <g transform="translate(${emphasisTranslate} ${emphasisTranslate}) scale(${emphasisScale})" fill="none" stroke="var(--sparo-icon-foreground, #fff)" stroke-width="var(--sparo-icon-stroke-width, ${emphasisStrokeWidth})" stroke-linecap="round" stroke-linejoin="round"${detailStrokeStyle}>
${indent(body, 6)}
    </g>
  </symbol>`;
}

function verifyOrWrite(filePath, expected) {
  if (checkOnly) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing generated file: ${path.relative(packageRoot, filePath)}`);
    }
    const actual = normalize(fs.readFileSync(filePath, 'utf8'));
    if (actual !== expected) {
      throw new Error(`Generated file is stale: ${path.relative(packageRoot, filePath)}`);
    }
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, expected, 'utf8');
}

const ids = new Set();
const symbols = [];
for (const icon of metadata) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon.id)) {
    throw new Error(`Invalid icon id: ${icon.id}`);
  }
  if (ids.has(icon.id)) {
    throw new Error(`Duplicate icon id: ${icon.id}`);
  }
  ids.add(icon.id);

  const basePath = path.join(baseDir, `${icon.id}.svg`);
  if (!fs.existsSync(basePath)) {
    throw new Error(`Missing canonical SVG: ${path.relative(packageRoot, basePath)}`);
  }

  const body = extractGlyph(normalize(fs.readFileSync(basePath, 'utf8')), icon.id);
  verifyOrWrite(path.join(emphasisDir, `${icon.id}.svg`), emphasisSvg(icon.id, body));
  symbols.push(baseSymbol(icon.id, body), emphasisSymbol(icon.id, body));
}

const unexpectedBaseFiles = fs.readdirSync(baseDir)
  .filter((file) => file.endsWith('.svg') && !ids.has(path.basename(file, '.svg')));
if (unexpectedBaseFiles.length > 0) {
  throw new Error(`Canonical SVG files missing metadata: ${unexpectedBaseFiles.join(', ')}`);
}

const sprite = normalize(`<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">
${symbols.join('\n')}
</svg>`);
verifyOrWrite(spritePath, sprite);

console.log(`${checkOnly ? 'Verified' : 'Generated'} ${metadata.length} base SVGs, ${metadata.length} emphasis SVGs, and one sprite.`);
