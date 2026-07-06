import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

const forbidden = [
  'Bit' + 'Fun' + 'Error',
  'Bit' + 'Fun' + 'Result',
  'Bit' + 'Fun',
  'BIT' + 'FUN',
  'bit' + 'fun',
  'sparo_core::util::' + 'errors',
  'crate::util::' + 'errors',
  'util::' + 'errors',
];

const allowedPhrases = [
  'Bit' + 'Fun' + ' Coder',
  'Bit' + 'Fun' + 'Coder',
  'Bit' + 'Fun' + ' Plan',
  'Bit' + 'Fun' + 'Plan',
  'Bit' + 'Fun' + ' Debug',
  'Bit' + 'Fun' + 'Debug',
  'Bit' + 'Fun' + ' Team',
  'Bit' + 'Fun' + 'Team',
  'Bit' + 'Fun' + ' Agent',
  'Bit' + 'Fun' + 'Agent',
  'Bit' + 'Fun' + ' Mode',
  'Bit' + 'Fun' + 'Mode',
  'bit' + 'fun' + ' coder',
  'bit' + 'fun' + '-code',
  'bit' + 'fun' + '-coder',
  'bit' + 'fun' + '-plan',
  'bit' + 'fun' + '-debug',
  'bit' + 'fun' + '-team',
  'bit' + 'fun' + '-*',
  'bit' + 'fun' + 'Coder',
  'bit' + 'fun' + 'Plan',
  'bit' + 'fun' + 'Debug',
  'bit' + 'fun' + 'Team',
  'bit' + 'fun' + '_coder',
  'bit' + 'fun' + '_plan',
  'bit' + 'fun' + '_debug',
  'bit' + 'fun' + '_team',
  'BIT' + 'FUN' + '_MODE',
  'BIT' + 'FUN' + '_AGENT',
  'BIT' + 'FUN' + '_CODER',
  'GCWing/' + 'Bit' + 'Fun',
  'github.com/GCWing/' + 'Bit' + 'Fun',
];

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  'docs',
  '.turbo',
]);

const ignoredFiles = new Set([
  path.basename(scriptPath),
]);

const findings = [];

function shouldSkipDir(name) {
  return ignoredDirs.has(name);
}

function isProbablyBinary(buffer) {
  const sampleLength = Math.min(buffer.length, 8192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function lineAndColumn(text, offset) {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function isAllowedOccurrence(text, token, offset) {
  for (const phrase of allowedPhrases) {
    const windowStart = Math.max(0, offset - phrase.length);
    const windowEnd = Math.min(text.length, offset + token.length + phrase.length);
    const windowText = text.slice(windowStart, windowEnd);
    let phraseOffset = windowText.indexOf(phrase);
    while (phraseOffset !== -1) {
      const phraseStart = windowStart + phraseOffset;
      const phraseEnd = phraseStart + phrase.length;
      if (phraseStart <= offset && offset + token.length <= phraseEnd) {
        return true;
      }
      phraseOffset = windowText.indexOf(phrase, phraseOffset + 1);
    }
  }

  return false;
}

function scanFile(filePath) {
  if (ignoredFiles.has(path.basename(filePath))) {
    return;
  }

  const buffer = fs.readFileSync(filePath);
  if (isProbablyBinary(buffer)) {
    return;
  }

  const text = buffer.toString('utf8');
  for (const token of forbidden) {
    let offset = text.indexOf(token);
    while (offset !== -1) {
      if (!isAllowedOccurrence(text, token, offset)) {
        const location = lineAndColumn(text, offset);
        findings.push({
          file: path.relative(repoRoot, filePath),
          token,
          ...location,
        });
      }
      offset = text.indexOf(token, offset + token.length);
    }
  }
}

function scanDir(dirPath) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        scanDir(path.join(dirPath, entry.name));
      }
      continue;
    }

    if (entry.isFile()) {
      scanFile(path.join(dirPath, entry.name));
    }
  }
}

scanDir(repoRoot);

if (findings.length > 0) {
  console.error('Forbidden legacy brand/API residue found:');
  for (const finding of findings.slice(0, 100)) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} contains ${JSON.stringify(finding.token)}`,
    );
  }
  if (findings.length > 100) {
    console.error(`...and ${findings.length - 100} more.`);
  }
  process.exit(1);
}

console.log('No legacy brand/API residue found.');
