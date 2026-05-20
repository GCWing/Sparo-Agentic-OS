#!/usr/bin/env node

/**
 * Version info generation script
 * Generates version file with version, build date, Git info at build time
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  printSuccess,
  printInfo,
  printWarning,
  colors,
  colorize,
} = require('./console-style.cjs');

const packageJsonPath = path.resolve(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const versionJsonPath = path.resolve(__dirname, '../src/web-ui/public/version.json');

function readExistingVersionInfo() {
  try {
    return JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
  } catch {
    return null;
  }
}

function canReuseBuildTime(existingInfo, nextInfo) {
  return Boolean(
    existingInfo &&
      nextInfo.isDev &&
      existingInfo.version === nextInfo.version &&
      existingInfo.buildEnv === nextInfo.buildEnv &&
      existingInfo.gitCommitFull === nextInfo.gitCommitFull &&
      existingInfo.gitBranch === nextInfo.gitBranch &&
      existingInfo.buildDate &&
      existingInfo.buildTimestamp
  );
}

function writeFileIfChanged(outputPath, content) {
  if (fs.existsSync(outputPath) && fs.readFileSync(outputPath, 'utf-8') === content) {
    return false;
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
  return true;
}

function getGitInfo() {
  try {
    const gitCommitFull = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const gitCommit = gitCommitFull.substring(0, 7);
    const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();

    return {
      gitCommit,
      gitCommitFull,
      gitBranch
    };
  } catch (error) {
    printWarning('Could not get Git info (may not be a Git repo)');
    return {
      gitCommit: undefined,
      gitCommitFull: undefined,
      gitBranch: undefined
    };
  }
}

function generateVersionInfo() {
  const gitInfo = getGitInfo();
  const buildDate = new Date().toISOString();
  const buildTimestamp = Date.now();
  const buildEnv = process.env.NODE_ENV || 'development';
  const isDev = buildEnv === 'development';

  const versionInfo = {
    name: 'Sparo OS',
    version: packageJson.version,
    buildDate,
    buildTimestamp,
    buildEnv,
    isDev,
    ...gitInfo
  };

  const existingInfo = readExistingVersionInfo();
  if (canReuseBuildTime(existingInfo, versionInfo)) {
    versionInfo.buildDate = existingInfo.buildDate;
    versionInfo.buildTimestamp = existingInfo.buildTimestamp;
  }

  return versionInfo;
}

function saveVersionInfoToJson(versionInfo) {
  const outputPath = versionJsonPath;

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  writeFileIfChanged(
    outputPath,
    JSON.stringify(versionInfo, null, 2),
  );
}

function saveVersionInfoToTS(versionInfo) {
  const outputPath = path.resolve(__dirname, '../src/web-ui/src/generated/version.ts');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = `/**
 * Auto-generated version info. Do not edit.
 * Generated: ${versionInfo.buildDate}
 */

import type { VersionInfo } from '../shared/types/version';

export const VERSION_INFO: VersionInfo = ${JSON.stringify(versionInfo, null, 2)};
`;

  writeFileIfChanged(outputPath, content);
}

function generateHtmlInjectionScript(versionInfo) {
  return `<script>
  // Version info injected at build time
  window.__VERSION_INFO__ = ${JSON.stringify(versionInfo)};
</script>`;
}

function main() {
  const versionInfo = generateVersionInfo();

  saveVersionInfoToJson(versionInfo);
  saveVersionInfoToTS(versionInfo);

  const htmlScript = generateHtmlInjectionScript(versionInfo);
  const htmlScriptPath = path.resolve(__dirname, '../src/web-ui/src/generated/version-injection.html');

  const htmlDir = path.dirname(htmlScriptPath);
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir, { recursive: true });
  }

  writeFileIfChanged(htmlScriptPath, htmlScript);

  const gitStr = versionInfo.gitCommit ? ` ${versionInfo.gitBranch}@${versionInfo.gitCommit}` : '';
  printSuccess(`${versionInfo.name} v${versionInfo.version}${gitStr}`);
}

// On failure: warn and exit 0 so build is not interrupted
try {
  main();
} catch (err) {
  printWarning('Version info generation failed, skipped: ' + (err.message || err));
  process.exit(0);
}


