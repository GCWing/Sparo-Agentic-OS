import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const localesRoot = path.join(rootDir, 'src', 'web-ui', 'src', 'locales');
const constantsPath = path.join(rootDir, 'src', 'web-ui', 'src', 'infrastructure', 'i18n', 'constants.ts');
const configCatalogPath = path.join(
  rootDir,
  'src',
  'crates',
  'core',
  'src',
  'service',
  'config',
  'catalog.rs',
);
const customSettingsTabsDir = path.join(
  rootDir,
  'src',
  'web-ui',
  'src',
  'app',
  'scenes',
  'settings',
  'custom-tabs',
);

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

function extractRustConstArrayBody(source, constantName, filePath) {
  const signatureIndex = source.indexOf(`const ${constantName}`);
  if (signatureIndex < 0) {
    throw new Error(`Failed to find ${constantName} in ${filePath}`);
  }

  const assignmentIndex = source.indexOf('=', signatureIndex);
  const bodyStart = source.indexOf('[', assignmentIndex);
  if (bodyStart < 0) {
    throw new Error(`Failed to parse ${constantName} in ${filePath}`);
  }

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '[') {
      depth += 1;
    } else if (source[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`Unterminated ${constantName} array in ${filePath}`);
}

function parseFormalPublishedSettingKeys(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const body = extractRustConstArrayBody(source, 'STABLE_SETTING_DECLARATIONS', filePath);
  const publicPresentationPattern = /public_setting!\(\s*"[^"\r\n]+"\s*=>\s*[^,]+,\s*\(\s*"[^"\r\n]+"\s*,\s*"[^"\r\n]+"\s*,\s*"[^"\r\n]+"\s*,\s*"[^"\r\n]+"\s*\)\s*,\s*\(\s*"([^"\r\n]+:[^"\r\n]+)"\s*,\s*"([^"\r\n]+:[^"\r\n]+)"\s*\)/g;
  const keys = new Set();

  for (const match of body.matchAll(publicPresentationPattern)) {
    keys.add(match[1]);
    keys.add(match[2]);
  }

  if (keys.size === 0) {
    throw new Error(`No formal published setting i18n keys found in ${filePath}`);
  }

  return Array.from(keys).sort();
}

function parseFormalPublishedPresentationIds(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const body = extractRustConstArrayBody(source, 'STABLE_SETTING_DECLARATIONS', filePath);
  const pattern = /public_setting!\(\s*"[^"\r\n]+"\s*=>\s*[^,]+,\s*\(\s*"([^"\r\n]+)"\s*,\s*"([^"\r\n]+)"\s*,\s*"([^"\r\n]+)"\s*,\s*"[^"\r\n]+"\s*\)/g;
  const categories = new Set(['advanced']);
  const tabs = new Set();
  const sections = new Set();

  for (const match of body.matchAll(pattern)) {
    categories.add(match[1]);
    tabs.add(match[2]);
    sections.add(match[3]);
  }

  if (tabs.size === 0 || sections.size === 0) {
    throw new Error(`No formal published setting presentation IDs found in ${filePath}`);
  }

  return { categories, tabs, sections };
}

function parseCustomSettingsPresentationIds(directoryPath) {
  const categories = new Set();
  const tabs = new Set();

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.settings-tab.ts')) {
      continue;
    }
    const filePath = path.join(directoryPath, entry.name);
    const source = fs.readFileSync(filePath, 'utf8');
    const id = source.match(/\bid:\s*'([^']+)'/)?.[1];
    const categoryId = source.match(/\bcategoryId:\s*'([^']+)'/)?.[1];
    if (!id || !categoryId) {
      throw new Error(`Failed to parse custom settings presentation IDs from ${filePath}`);
    }
    tabs.add(id);
    categories.add(categoryId);
  }

  return { categories, tabs };
}

function resolveTranslation(localeId, translationKey) {
  const separatorIndex = translationKey.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === translationKey.length - 1) {
    throw new Error(`Invalid namespaced translation key: ${translationKey}`);
  }

  const namespace = translationKey.slice(0, separatorIndex);
  const nestedKey = translationKey.slice(separatorIndex + 1);
  const localePath = path.join(localesRoot, localeId, `${namespace}.json`);
  if (!fs.existsSync(localePath)) {
    return undefined;
  }

  let value = parseJsonFile(localePath);
  for (const segment of nestedKey.split('.')) {
    if (!isPlainObject(value) || !(segment in value)) {
      return undefined;
    }
    value = value[segment];
  }

  return typeof value === 'string' && value.trim() ? value : undefined;
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
  const formalPublishedSettingKeys = parseFormalPublishedSettingKeys(configCatalogPath);
  const formalPresentationIds = parseFormalPublishedPresentationIds(configCatalogPath);
  const customPresentationIds = parseCustomSettingsPresentationIds(customSettingsTabsDir);
  const settingsPresentationKeys = [
    ...new Set([
      ...formalPresentationIds.categories,
      ...customPresentationIds.categories,
    ]),
  ].map((id) => `settings/config-center:categories.${id}`)
    .concat([
      ...new Set([
        ...formalPresentationIds.tabs,
        ...customPresentationIds.tabs,
      ]),
    ].map((id) => `settings/config-center:tabs.${id}`))
    .concat([...formalPresentationIds.sections]
      .map((id) => `settings/config-center:sections.${id}`))
    .sort();

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

  for (const localeId of ['en-US', 'zh-CN']) {
    if (!localeIds.includes(localeId)) {
      issues.push(`Required published-settings locale is missing: ${localeId}`);
      continue;
    }
    const missingPublishedKeys = formalPublishedSettingKeys.filter(
      (translationKey) => resolveTranslation(localeId, translationKey) === undefined,
    );
    if (missingPublishedKeys.length > 0) {
      issues.push(
        `${localeId} is missing formal published setting copy:\n${missingPublishedKeys
          .map((translationKey) => `  - ${translationKey}`)
          .join('\n')}`,
      );
    }
    const missingPresentationKeys = settingsPresentationKeys.filter(
      (translationKey) => resolveTranslation(localeId, translationKey) === undefined,
    );
    if (missingPresentationKeys.length > 0) {
      issues.push(
        `${localeId} is missing settings navigation copy:\n${missingPresentationKeys
          .map((translationKey) => `  - ${translationKey}`)
          .join('\n')}`,
      );
    }
  }

  if (issues.length > 0) {
    console.error('i18n consistency check failed.\n');
    console.error(issues.join('\n\n'));
    process.exitCode = 1;
    return;
  }

  console.log(
    `i18n consistency check passed for ${localeIds.length} locales, ${referenceFiles.length} namespace files, ${formalPublishedSettingKeys.length} formal published setting keys, and ${settingsPresentationKeys.length} settings presentation keys.`,
  );
}

main();
