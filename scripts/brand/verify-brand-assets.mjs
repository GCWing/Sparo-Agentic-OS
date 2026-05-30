import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(root, 'brand', 'generated', 'manifest.json');
const allowedBitfunGlobs = [
  /^docs\/branding\.md$/,
  /^scripts\/brand\/verify-brand-assets\.mjs$/,
  /^src\/crates\//,
  /^src\/apps\/server\//,
  /^src\/apps\/relay-server\//,
  /^src\/apps\/cli\/src\/agent\//,
  /^installer\/src-tauri\/src\/installer\/ai_config\.rs$/,
  /^installer\/src-tauri\/src\/installer\/types\.rs$/,
  /^tests\/e2e\//,
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') return [];
      if (entry.name === 'dist' && filePath.replace(/\\/g, '/').includes('/src/mobile-web/')) return [];
      if (filePath.replace(/\\/g, '/').includes('/installer/src-tauri/gen/')) return [];
      return walk(filePath);
    }
    return [filePath];
  });
}

function rel(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function isTextFile(filePath) {
  return /\.(cjs|mjs|js|jsx|ts|tsx|rs|json|md|html|css|scss|toml|yaml|yml|sh|ps1|txt)$/i.test(filePath);
}

function isAllowedBitfunReference(relativePath) {
  return allowedBitfunGlobs.some((pattern) => pattern.test(relativePath));
}

function stripAllowedInternalReferences(text) {
  return text
    .replace(/\bOpenBitFun\b/g, '')
    .replace(/\bopenbitfun\b/g, '')
    .replace(/\bBitFun(Error|Result)\b/g, '')
    .replace(/\bbitfun_(core|events|transport|webdriver|desktop_lib|ai_adapters)\b/g, '')
    .replace(/\bbitfun-(core|events|transport|webdriver|desktop|cli|server|ai-adapters)\b/g, '');
}

const failures = [];

if (!fs.existsSync(manifestPath)) {
  failures.push('Missing brand/generated/manifest.json. Run pnpm run brand:sync.');
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const file of manifest.files ?? []) {
    const fullPath = path.join(root, file.path);
    if (!fs.existsSync(fullPath)) {
      failures.push(`Missing generated asset: ${file.path}`);
      continue;
    }
    const actual = sha256(fullPath);
    if (actual !== file.sha256) {
      failures.push(`Generated asset drifted: ${file.path}`);
    }
  }
}

for (const relativeDir of [
  'src/apps/desktop/icons/android',
  'src/apps/desktop/icons/ios',
  'installer/src-tauri/icons/android',
  'installer/src-tauri/icons/ios',
]) {
  if (fs.existsSync(path.join(root, relativeDir))) {
    failures.push(`Unused native mobile icon tree exists: ${relativeDir}`);
  }
}

for (const filePath of walk(root).filter(isTextFile)) {
  const relativePath = rel(filePath);
  if (isAllowedBitfunReference(relativePath)) continue;
  const text = stripAllowedInternalReferences(fs.readFileSync(filePath, 'utf8'));
  if (/\bBitFun\b|\bBITFUN\b|\bbitfun\b|\.bitfun/.test(text)) {
    failures.push(`User-facing BitFun/bitfun reference outside allowed internals: ${relativePath}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Brand assets and outward naming verified.');
