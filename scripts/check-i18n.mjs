import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const localesRoot = path.join(rootDir, 'src', 'web-ui', 'src', 'locales');
const constantsPath = path.join(rootDir, 'src', 'web-ui', 'src', 'infrastructure', 'i18n', 'constants.ts');

function listLocaleDirs(baseDir) {
  return fs.readdirSync(baseDir)
    .map((name) => path.join(baseDir, name))
    .filter((fullPath) => fs.statSync(fullPath).isDirectory())
    .map((fullPath) => path.basename(fullPath))
    .sort();
}

function listJsonFiles(baseDir, currentDir = baseDir, files = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      listJsonFiles(baseDir, fullPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path.relative(baseDir, fullPath).split(path.sep).join('/'));
    }
  }

  return files.sort();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenKeys(value, prefix = '', keys = new Set()) {
  if (!isPlainObject(value)) {
    if (prefix) {
      keys.add(prefix);
    }
    return keys;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(nestedValue)) {
      flattenKeys(nestedValue, nextPrefix, keys);
      continue;
    }

    keys.add(nextPrefix);
  }

  return keys;
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: ${error.message}`);
  }
}

function diffSets(expected, actual) {
  return expected.filter((item) => !actual.includes(item));
}

function parseDeclaredNamespaces(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const arrayMatch = fileContent.match(/export const I18N_NAMESPACES = \[(.*?)\] as const;/s);

  if (!arrayMatch) {
    throw new Error(`Failed to parse I18N_NAMESPACES from ${filePath}`);
  }

  return Array.from(arrayMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]).sort();
}

function main() {
  if (!fs.existsSync(localesRoot)) {
    throw new Error(`Locales directory not found: ${localesRoot}`);
  }

  const localeIds = listLocaleDirs(localesRoot);
  if (localeIds.length < 2) {
    throw new Error('Expected at least two locale directories under src/web-ui/src/locales.');
  }

  const issues = [];
  const localeFiles = new Map();

  for (const localeId of localeIds) {
    const localeDir = path.join(localesRoot, localeId);
    localeFiles.set(localeId, listJsonFiles(localeDir));
  }

  const referenceLocale = localeIds[0];
  const referenceFiles = localeFiles.get(referenceLocale) ?? [];
  const referenceNamespaces = referenceFiles.map((file) => file.replace(/\.json$/, '')).sort();
  const declaredNamespaces = parseDeclaredNamespaces(constantsPath);

  const missingDeclaredNamespaces = diffSets(referenceNamespaces, declaredNamespaces);
  const extraDeclaredNamespaces = diffSets(declaredNamespaces, referenceNamespaces);

  if (missingDeclaredNamespaces.length > 0) {
    issues.push(`constants.ts is missing namespaces:\n${missingDeclaredNamespaces.map((namespace) => `  - ${namespace}`).join('\n')}`);
  }

  if (extraDeclaredNamespaces.length > 0) {
    issues.push(`constants.ts has namespaces without locale files:\n${extraDeclaredNamespaces.map((namespace) => `  - ${namespace}`).join('\n')}`);
  }

  for (const localeId of localeIds.slice(1)) {
    const currentFiles = localeFiles.get(localeId) ?? [];
    const missingFiles = diffSets(referenceFiles, currentFiles);
    const extraFiles = diffSets(currentFiles, referenceFiles);

    if (missingFiles.length > 0) {
      issues.push(`${localeId} is missing files:\n${missingFiles.map((file) => `  - ${file}`).join('\n')}`);
    }

    if (extraFiles.length > 0) {
      issues.push(`${localeId} has extra files:\n${extraFiles.map((file) => `  - ${file}`).join('\n')}`);
    }
  }

  for (const relativeFile of referenceFiles) {
    const referencePath = path.join(localesRoot, referenceLocale, relativeFile);
    const referenceKeys = Array.from(flattenKeys(parseJsonFile(referencePath))).sort();

    for (const localeId of localeIds.slice(1)) {
      const localePath = path.join(localesRoot, localeId, relativeFile);
      const localeKeys = Array.from(flattenKeys(parseJsonFile(localePath))).sort();
      const missingKeys = diffSets(referenceKeys, localeKeys);
      const extraKeys = diffSets(localeKeys, referenceKeys);

      if (missingKeys.length > 0) {
        issues.push(`${localeId}/${relativeFile} is missing keys:\n${missingKeys.map((key) => `  - ${key}`).join('\n')}`);
      }

      if (extraKeys.length > 0) {
        issues.push(`${localeId}/${relativeFile} has extra keys:\n${extraKeys.map((key) => `  - ${key}`).join('\n')}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error('i18n consistency check failed.\n');
    console.error(issues.join('\n\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`i18n consistency check passed for ${localeIds.length} locales and ${referenceFiles.length} namespace files.`);
}

main();
