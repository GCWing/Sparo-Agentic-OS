import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const webSrc = path.join(repoRoot, 'src', 'web-ui', 'src');
const baselinePath = path.join(repoRoot, 'scripts', 'design-system-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');

const scanRoots = ['app', 'flow_chat', 'tools', 'shared', 'infrastructure', 'design-system'].map((root) =>
  path.join(webSrc, root)
);

const textExtensions = new Set(['.ts', '.tsx', '.scss', '.css']);
const importExtensions = new Set(['.ts', '.tsx', '.scss', '.css']);
const maxPrintedViolations = 120;
const retiredPackageSegment = ['component', 'library'].join('-');
const retiredPackageAlias = `@/${retiredPackageSegment}`;
const retiredComponentsAlias = `@${'components'}`;
const retiredDesignSystemLayer = 'components';
const retiredUiRoot = path.join(webSrc, retiredPackageSegment);

const allowedHardcodedColorRoots = [
  // Color source data and rendering engine adapters are allowed to carry raw palettes.
  path.join(webSrc, 'infrastructure', 'theme'),
  path.join(webSrc, 'design-system'),
  path.join(webSrc, 'tools', 'terminal', 'utils', 'xtermTheme.ts'),
  path.join(webSrc, 'tools', 'editor', 'themes'),
  path.join(webSrc, 'tools', 'design-canvas', 'tokensSchema.ts'),
];

const removedEntrypoints = [
  {
    label: 'retired reusable UI package alias',
    matches: (specifier) => specifier === retiredPackageAlias || specifier.startsWith(`${retiredPackageAlias}/`),
  },
  {
    label: 'retired component alias',
    matches: (specifier) => specifier === retiredComponentsAlias || specifier.startsWith(`${retiredComponentsAlias}/`),
  },
  {
    label: 'retired design-system layer',
    matches: (specifier) =>
      specifier === `design-system/${retiredDesignSystemLayer}` ||
      specifier.startsWith(`design-system/${retiredDesignSystemLayer}/`) ||
      specifier === `@/design-system/${retiredDesignSystemLayer}` ||
      specifier.startsWith(`@/design-system/${retiredDesignSystemLayer}/`),
  },
];

const removedDirectories = [
  retiredUiRoot,
  path.join(webSrc, 'design-system', retiredDesignSystemLayer),
];

const designSystemRoot = path.join(webSrc, 'design-system');
const designSystemCoreRoots = ['foundation', 'patterns', 'primitives', 'styles', 'types'].map((root) =>
  path.join(designSystemRoot, root)
);
const designSystemInternalRoots = ['foundation', 'patterns', 'primitives', 'preview', 'recipes', 'styles', 'testing', 'types'];
const designSystemInternalAbsoluteRoots = designSystemInternalRoots.map((root) => path.join(designSystemRoot, root));
const forbiddenProductRoots = ['app', 'flow_chat', 'tools', 'shared', 'infrastructure'].map((root) =>
  path.join(webSrc, root)
);

const violations = [];
const blockingRuleIds = new Set([
  'removed-directory',
  'removed-entrypoint',
  'design-system-public-api',
  'design-system-relative-public-api',
  'design-system-layering',
  'design-system-z-index',
  'feature-hardcoded-color',
  'feature-z-index',
  'feature-control-styling',
]);

function readRetiredBaseline() {
  if (!fs.existsSync(baselinePath)) {
    return [];
  }

  const raw = fs.readFileSync(baselinePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.violations)) {
    throw new Error('Invalid design-system baseline: expected a violations array.');
  }
  return parsed.violations;
}

function writeEmptyBaseline() {
  const payload = {
    version: 2,
    mode: 'strict',
    generatedBy: 'scripts/check-design-system.mjs --update-baseline',
    note: 'The design-system baseline is retired as an allowlist. Current violations fail the gate.',
    violations: [],
  };
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') {
        continue;
      }
      walk(fullPath, files);
    } else if (textExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function normalizeAbsolute(file) {
  return path.resolve(file);
}

function isInside(file, root) {
  const resolvedFile = normalizeAbsolute(file);
  const resolvedRoot = normalizeAbsolute(root);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${path.sep}`);
}

function isAllowedHardcodedColorFile(file) {
  return allowedHardcodedColorRoots.some((allowedRoot) => isInside(file, allowedRoot));
}

function isDesignSystemFile(file) {
  return isInside(file, designSystemRoot);
}

function isDesignSystemCoreFile(file) {
  return designSystemCoreRoots.some((root) => isInside(file, root));
}

function isOutsideDesignSystem(file) {
  return !isDesignSystemFile(file);
}

function isTypeScriptFile(file) {
  return /\.(ts|tsx)$/.test(file);
}

function isFeatureDesignSystemInternalImport(file, specifier, resolvedSpecifier) {
  if (!isTypeScriptFile(file) || !isOutsideDesignSystem(file)) {
    return false;
  }

  const usesAliasInternalPath = designSystemInternalRoots.some(
    (root) => specifier === `@/design-system/${root}` || specifier.startsWith(`@/design-system/${root}/`)
  );

  return usesAliasInternalPath || pointsIntoAnyRoot(resolvedSpecifier, designSystemInternalAbsoluteRoots);
}

function isFeatureDesignSystemRelativePublicImport(file, specifier, resolvedSpecifier) {
  if (!isTypeScriptFile(file) || !isOutsideDesignSystem(file) || !specifier.startsWith('.')) {
    return false;
  }

  return resolvedSpecifier !== null && isInside(resolvedSpecifier, designSystemRoot);
}

function report(ruleId, file, lineNumber, message) {
  violations.push({
    ruleId,
    file: toRepoPath(file),
    lineNumber,
    message,
  });
}

function formatViolation(violation) {
  return `${violation.file}:${violation.lineNumber} [${violation.ruleId}] ${violation.message}`;
}

function resolveSpecifier(file, specifier) {
  if (specifier.startsWith('@/')) {
    return path.join(webSrc, specifier.slice(2));
  }

  if (specifier === retiredComponentsAlias || specifier.startsWith(`${retiredComponentsAlias}/`)) {
    return path.join(retiredUiRoot, retiredDesignSystemLayer, specifier.slice(retiredComponentsAlias.length));
  }

  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(file), specifier);
  }

  return null;
}

function pointsIntoRoot(file, root) {
  return file !== null && isInside(file, root);
}

function pointsIntoAnyRoot(file, roots) {
  return roots.some((root) => pointsIntoRoot(file, root));
}

function getLineNumberAtIndex(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function getSpecifiers(content, file) {
  const specifiers = [];
  const importExportPattern = /(?:^|[;\n])\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffectImportPattern = /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const scssImportPattern = /@(use|import|forward)\s+['"]([^'"]+)['"]/g;

  for (const match of content.matchAll(importExportPattern)) {
    specifiers.push({
      specifier: match[1],
      lineNumber: getLineNumberAtIndex(content, match.index + match[0].lastIndexOf(match[1])),
    });
  }
  for (const match of content.matchAll(sideEffectImportPattern)) {
    specifiers.push({
      specifier: match[1],
      lineNumber: getLineNumberAtIndex(content, match.index + match[0].lastIndexOf(match[1])),
    });
  }
  for (const match of content.matchAll(dynamicImportPattern)) {
    specifiers.push({
      specifier: match[1],
      lineNumber: getLineNumberAtIndex(content, match.index + match[0].lastIndexOf(match[1])),
    });
  }

  if (/\.(scss|css)$/.test(file)) {
    for (const match of content.matchAll(scssImportPattern)) {
      specifiers.push({
        specifier: match[2],
        lineNumber: getLineNumberAtIndex(content, match.index + match[0].lastIndexOf(match[2])),
      });
    }
  }

  return specifiers;
}

function checkRemovedDirectories() {
  removedDirectories.forEach((directory) => {
    if (fs.existsSync(directory)) {
      report(
        'removed-directory',
        directory,
        1,
        'Removed UI library directories must not exist in the final design-system architecture.'
      );
    }
  });
}

function checkImport(file, lineNumber, specifier) {
  const resolvedSpecifier = resolveSpecifier(file, specifier);

  removedEntrypoints.forEach((entrypoint) => {
    if (entrypoint.matches(specifier)) {
      report(
        'removed-entrypoint',
        file,
        lineNumber,
        `Do not import ${entrypoint.label}; use @/design-system public exports or final design-system internal paths.`
      );
    }
  });

  if (resolvedSpecifier && pointsIntoRoot(resolvedSpecifier, retiredUiRoot)) {
    report(
      'removed-entrypoint',
      file,
      lineNumber,
      'Do not depend on retired reusable UI source roots; use the final design-system architecture.'
    );
  }

  if (isFeatureDesignSystemInternalImport(file, specifier, resolvedSpecifier)) {
    report(
      'design-system-public-api',
      file,
      lineNumber,
      'Feature TS/TSX must import reusable UI through @/design-system, not design-system internal paths or relative paths into design-system internals.'
    );
  }

  if (isFeatureDesignSystemRelativePublicImport(file, specifier, resolvedSpecifier)) {
    report(
      'design-system-relative-public-api',
      file,
      lineNumber,
      'Feature TS/TSX must import reusable UI through the @/design-system alias, not relative paths into design-system.'
    );
  }

  if (isDesignSystemCoreFile(file) && pointsIntoAnyRoot(resolvedSpecifier, forbiddenProductRoots)) {
    report(
      'design-system-layering',
      file,
      lineNumber,
      'Design-system foundation, primitives, patterns, styles, and types must not depend on app, shared, flow_chat, tools, or infrastructure.'
    );
  }
}

function checkLine(file, relative, line, lineNumber) {
  if (/\bz-index\s*:\s*\d+/.test(line)) {
    report(file.includes(`${path.sep}design-system${path.sep}`) ? 'design-system-z-index' : 'feature-z-index', file, lineNumber, 'Avoid hardcoded z-index; use design-system z-index variables.');
  }

  if (!isAllowedHardcodedColorFile(file) && /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)) {
    const usesTokenFallback = /var\(--/.test(line);
    if (!usesTokenFallback) {
      report(
        'feature-hardcoded-color',
        file,
        lineNumber,
        'Avoid feature-local hardcoded colors; use design-system CSS variables.'
      );
    }
  }

  if (
    /\.(scss|css)$/.test(relative) &&
    /\.(button|btn|input|select|modal|dialog)\b/.test(line) &&
    !relative.includes('/design-system/')
  ) {
    report(
      'feature-control-styling',
      file,
      lineNumber,
      'Avoid feature-local control styling; use design-system primitives and patterns.'
    );
  }
}

checkRemovedDirectories();

for (const root of scanRoots) {
  for (const file of walk(root)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const relative = toRepoPath(file);

    if (importExtensions.has(path.extname(file))) {
      getSpecifiers(content, file).forEach(({ specifier, lineNumber }) => checkImport(file, lineNumber, specifier));
    }

    lines.forEach((line, index) => {
      checkLine(file, relative, line, index + 1);
    });
  }
}

const currentViolations = [...new Map(violations.map((violation) => [formatViolation(violation), violation])).values()].sort(
  (left, right) => formatViolation(left).localeCompare(formatViolation(right))
);
const retiredBaseline = readRetiredBaseline();

const blockingViolations = currentViolations.filter((violation) => blockingRuleIds.has(violation.ruleId));
const advisoryViolations = currentViolations.filter((violation) => !blockingRuleIds.has(violation.ruleId));

if (updateBaseline) {
  if (blockingViolations.length > 0) {
    console.error(
      `Design system baseline was not updated: ${blockingViolations.length} blocking architecture violations must be fixed instead of baselined.`
    );
    process.exit(1);
  }
  writeEmptyBaseline();
  console.log('Design system baseline is strict and empty: 0 violations recorded.');
  process.exit(0);
}

console.log(
  `Design system check: ${blockingViolations.length} blocking, ${advisoryViolations.length} advisory. Baseline allowlisting is disabled (${retiredBaseline.length} retired entries ignored).`
);

if (currentViolations.length === 0) {
  process.exit(0);
}

const countsByRule = currentViolations.reduce((counts, violation) => {
  counts.set(violation.ruleId, (counts.get(violation.ruleId) ?? 0) + 1);
  return counts;
}, new Map());

console.error('Design system violations by rule:');
[...countsByRule.entries()]
  .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  .forEach(([ruleId, count]) => {
    console.error(`- ${ruleId}: ${count}`);
  });

const printedViolations = blockingViolations.length > 0 ? blockingViolations : advisoryViolations;
console.error(blockingViolations.length > 0 ? 'Blocking design system violations:' : 'Advisory design system debt:');
printedViolations.slice(0, maxPrintedViolations).forEach((violation) => {
  console.error(`- ${formatViolation(violation)}`);
});

if (printedViolations.length > maxPrintedViolations) {
  console.error(`- ...and ${printedViolations.length - maxPrintedViolations} more violations.`);
}

process.exit(blockingViolations.length > 0 ? 1 : 0);
