import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'src', 'web-ui', 'src');
const baselinePath = path.join(repoRoot, 'scripts', 'architecture-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');
const sourceExtensions = new Set(['.ts', '.tsx']);

function normalize(file) {
  return path.resolve(file).replaceAll('\\', '/');
}

function repoPath(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function walk(dir, files = [], extensions = sourceExtensions) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-preview'].includes(entry.name)) walk(fullPath, files, extensions);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function importSpecifiers(content) {
  const entries = [];
  const patterns = [
    /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      entries.push({ specifier: match[1], index: match.index ?? 0 });
    }
  }
  return entries;
}

function resolveWebImport(file, specifier) {
  if (specifier.startsWith('@/')) return path.join(webRoot, specifier.slice(2));
  if (specifier.startsWith('.')) return path.resolve(path.dirname(file), specifier);
  return null;
}

function webRootName(file) {
  if (!file) return null;
  const relative = path.relative(webRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0];
}

function classifyWebViolation(sourceRoot, targetRoot, sourcePath) {
  if (sourceRoot === 'shared' && ['app', 'flow_chat', 'tools'].includes(targetRoot)) {
    return 'shared-to-feature';
  }
  if (sourceRoot === 'infrastructure' && ['app', 'flow_chat', 'tools'].includes(targetRoot)) {
    return 'infrastructure-to-feature';
  }
  if (sourceRoot === 'flow_chat' && targetRoot === 'app') {
    return 'flow-chat-to-shell';
  }
  if (sourceRoot === 'tools' && ['app', 'flow_chat'].includes(targetRoot)) {
    return 'tool-to-feature';
  }
  if (
    sourceRoot === 'design-system'
    && !sourcePath.includes('/design-system/preview/')
    && ['app', 'flow_chat', 'tools', 'shared', 'infrastructure'].includes(targetRoot)
  ) {
    return 'design-system-to-product';
  }
  return null;
}

function collectWebViolations() {
  const violations = [];
  const scanRoots = ['app', 'flow_chat', 'tools', 'shared', 'infrastructure', 'design-system'];
  for (const root of scanRoots) {
    for (const file of walk(path.join(webRoot, root))) {
      const content = fs.readFileSync(file, 'utf8');
      for (const entry of importSpecifiers(content)) {
        const target = resolveWebImport(file, entry.specifier);
        const targetRoot = webRootName(target);
        const sourcePath = normalize(file);
        const rule = classifyWebViolation(root, targetRoot, sourcePath);
        if (!rule) continue;
        const filePath = repoPath(file);
        violations.push({
          key: `${rule}|${filePath}|${entry.specifier}`,
          rule,
          file: filePath,
          line: getLineNumber(content, entry.index),
          specifier: entry.specifier,
        });
      }
    }
  }
  return [...new Map(violations.map((entry) => [entry.key, entry])).values()]
    .sort((a, b) => a.key.localeCompare(b.key));
}

function collectRustViolations() {
  const raw = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const metadata = JSON.parse(raw);
  const packages = new Map(metadata.packages.map((pkg) => [pkg.name, pkg]));
  const violations = [];
  const core = packages.get('sparo-core');
  const events = packages.get('sparo-events');
  const relay = packages.get('sparo-relay');
  const toolRuntime = packages.get('tool-runtime');

  if (!core || !events || !relay || !toolRuntime) {
    throw new Error('Missing one or more required architecture packages.');
  }

  for (const dependency of core.dependencies) {
    const manifestPath = normalize(dependency.path ?? '');
    if (manifestPath.includes('/src/apps/')) {
      violations.push(`sparo-core must not depend on app package ${dependency.name}`);
    }
    if (dependency.name === 'sparo-transport' || dependency.name === 'tauri') {
      violations.push(`sparo-core must not depend on host adapter ${dependency.name}`);
    }
  }

  const localEventDependencies = events.dependencies.filter((dependency) => dependency.path);
  for (const dependency of localEventDependencies) {
    violations.push(`sparo-events must remain independent of local crate ${dependency.name}`);
  }

  const expectedRelayManifest = normalize(path.join(repoRoot, 'src', 'crates', 'relay', 'Cargo.toml'));
  if (normalize(relay.manifest_path) !== expectedRelayManifest) {
    violations.push('sparo-relay must live under src/crates/relay');
  }

  const expectedToolRuntimeManifest = normalize(path.join(repoRoot, 'src', 'crates', 'tool-runtime', 'Cargo.toml'));
  if (normalize(toolRuntime.manifest_path) !== expectedToolRuntimeManifest) {
    violations.push('tool-runtime must live under src/crates/tool-runtime');
  }

  const coreSource = path.join(repoRoot, 'src', 'crates', 'core', 'src');
  for (const file of walk(coreSource, [], new Set(['.rs']))) {
    if (/\btauri::/.test(fs.readFileSync(file, 'utf8'))) {
      violations.push(`sparo-core source must not use Tauri types: ${repoPath(file)}`);
    }
  }

  return violations;
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (!Array.isArray(parsed.allowedViolations)) {
    throw new Error('Invalid architecture baseline: expected allowedViolations array.');
  }
  return parsed.allowedViolations;
}

const rustViolations = collectRustViolations();
const webViolations = collectWebViolations();

if (updateBaseline) {
  const payload = {
    version: 1,
    generatedBy: 'scripts/check-architecture.mjs --update-baseline',
    note: 'Exact pre-existing frontend reverse dependencies. New entries fail the architecture gate.',
    allowedViolations: webViolations.map((entry) => entry.key),
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Architecture baseline updated with ${webViolations.length} frontend violations.`);
}

const baseline = new Set(readBaseline());
const current = new Set(webViolations.map((entry) => entry.key));
const newWebViolations = webViolations.filter((entry) => !baseline.has(entry.key));
const staleBaseline = [...baseline].filter((key) => !current.has(key));

if (rustViolations.length || newWebViolations.length || staleBaseline.length) {
  console.error('Architecture check failed.');
  for (const violation of rustViolations) console.error(`- [rust-boundary] ${violation}`);
  for (const violation of newWebViolations) {
    console.error(`- [${violation.rule}] ${violation.file}:${violation.line} imports ${violation.specifier}`);
  }
  for (const key of staleBaseline) {
    console.error(`- [stale-baseline] Remove resolved entry: ${key}`);
  }
  process.exit(1);
}

console.log(`Architecture check passed (${webViolations.length} tracked frontend violations, 0 new).`);
