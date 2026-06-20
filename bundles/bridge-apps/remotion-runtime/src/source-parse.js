const fs = require("node:fs");
const path = require("node:path");
const { readText, safeStat } = require("./util");
const { relativeToWorkspace } = require("./paths");

function resolveModule(fromFile, request) {
  if (!request || !request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.jsx"),
    path.join(base, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && safeStat(candidate)?.isFile()) || null;
}

function attrRaw(source, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, "m");
  const match = pattern.exec(source);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function attrExpression(source, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*`, "m");
  const match = pattern.exec(source);
  if (!match) return null;
  let index = match.index + match[0].length;
  while (/\s/.test(source[index] || "")) index += 1;
  const quote = source[index];
  if (quote === '"' || quote === "'" || quote === "`") {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\" && cursor + 1 < source.length) {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) return source.slice(index, cursor + 1);
      cursor += 1;
    }
    return null;
  }
  if (source[index] !== "{") return null;
  let depth = 0;
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"' || char === "'" || char === "`") {
      const innerQuote = char;
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) {
          cursor += 2;
          continue;
        }
        if (source[cursor] === innerQuote) break;
        cursor += 1;
      }
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(index, cursor + 1);
    }
    cursor += 1;
  }
  return null;
}

function parseConstants(source) {
  const constants = {};
  const regex = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let match;
  while ((match = regex.exec(source))) {
    const name = match[1];
    const value = evaluateNumber(match[2], constants, null);
    if (Number.isFinite(value)) constants[name] = value;
  }
  return constants;
}

function evaluateNumber(raw, constants = {}, fallback = undefined) {
  if (raw === null || raw === undefined) return fallback;
  let expression = String(raw).trim();
  if (!expression) return fallback;
  expression = expression.replace(/^["']|["']$/g, "");
  const direct = Number(expression);
  if (Number.isFinite(direct)) return direct;
  expression = expression.replace(/\b[A-Za-z_$][\w$]*\b/g, (name) => {
    if (Object.prototype.hasOwnProperty.call(constants, name)) return String(constants[name]);
    return name;
  });
  if (/[A-Za-z_$]/.test(expression)) return fallback;
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return fallback;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function parseStringAttr(block, name, fallback = "") {
  const raw = attrRaw(block, name);
  if (raw === null || raw === undefined) return fallback;
  return String(raw).trim().replace(/^["'`]|["'`]$/g, "") || fallback;
}

function parseNumberAttr(block, name, constants, fallback) {
  return evaluateNumber(attrRaw(block, name), constants, fallback);
}

function parseDefaultProps(block) {
  const expression = attrExpression(block, "defaultProps");
  if (!expression) return {};
  let objectExpression = expression.trim();
  if (objectExpression.startsWith("{") && objectExpression.endsWith("}")) {
    objectExpression = objectExpression.slice(1, -1).trim();
  }
  if (objectExpression.startsWith("{") && objectExpression.endsWith("}")) {
    objectExpression = objectExpression.slice(1, -1).trim();
  }
  if (!objectExpression) return {};
  const withoutTypes = objectExpression
    .replace(/\s+satisfies\s+[A-Za-z_$][\w$.<>]*/g, "")
    .replace(/\s+as\s+(const|[A-Za-z_$][\w$.<>]*)/g, "");
  const jsonLike = `{${withoutTypes
    .replace(/(^|,\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')}}`;
  try {
    const parsed = JSON.parse(jsonLike);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function findRemotionEntry(workspacePath, files) {
  const explicit = ["src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx"]
    .map((relative) => path.join(workspacePath, relative))
    .find((candidate) => fs.existsSync(candidate));
  const withRegisterRoot = files.find((filePath) => {
    try {
      return readText(filePath).includes("registerRoot");
    } catch {
      return false;
    }
  });
  return withRegisterRoot || explicit || files.find((filePath) => readText(filePath).includes("<Composition")) || null;
}

function findImportedComponentFile(sourceFile, source, componentName) {
  const importRegex = /import\s+([^;]+?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(source))) {
    const clause = match[1];
    const request = match[2];
    const names = [];
    const defaultMatch = /^\s*([A-Za-z_$][\w$]*)/.exec(clause);
    if (defaultMatch) names.push(defaultMatch[1]);
    const namedMatch = /\{([^}]+)\}/.exec(clause);
    if (namedMatch) {
      namedMatch[1].split(",").forEach((part) => {
        const local = part.trim().split(/\s+as\s+/i).pop()?.trim();
        if (local) names.push(local);
      });
    }
    if (!names.includes(componentName)) continue;
    const resolved = resolveModule(sourceFile, request);
    if (resolved) return resolved;
  }
  return null;
}

function componentDefinedIn(source, componentName) {
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(function|const|class)\\s+${escaped}\\b`).test(source);
}

function findComponentFile(workspacePath, sourceFile, source, componentName, files) {
  if (!componentName) return sourceFile;
  if (componentDefinedIn(source, componentName)) return sourceFile;
  const imported = findImportedComponentFile(sourceFile, source, componentName);
  if (imported) return imported;
  return files.find((filePath) => {
    try {
      return componentDefinedIn(readText(filePath), componentName);
    } catch {
      return false;
    }
  }) || sourceFile;
}

function parseCompositionBlocks(workspacePath, files) {
  const compositions = [];
  for (const filePath of files) {
    const source = readText(filePath);
    if (!source.includes("<Composition")) continue;
    const constants = parseConstants(source);
    const regex = /<Composition\b([\s\S]*?)(?:\/>|>)/g;
    let match;
    while ((match = regex.exec(source))) {
      const block = match[1];
      const id = parseStringAttr(block, "id", "");
      if (!id) continue;
      const componentName = parseStringAttr(block, "component", "").replace(/[{}]/g, "").trim();
      const componentFile = findComponentFile(workspacePath, filePath, source, componentName, files);
      const durationInFrames = Math.max(1, Math.round(parseNumberAttr(block, "durationInFrames", constants, 300) || 300));
      const fps = Math.max(1, Math.round(parseNumberAttr(block, "fps", constants, 30) || 30));
      const width = Math.max(1, Math.round(parseNumberAttr(block, "width", constants, 1920) || 1920));
      const height = Math.max(1, Math.round(parseNumberAttr(block, "height", constants, 1080) || 1080));
      const defaultProps = parseDefaultProps(block);
      compositions.push({
        id,
        componentName: componentName || null,
        sourcePath: relativeToWorkspace(workspacePath, filePath),
        componentPath: relativeToWorkspace(workspacePath, componentFile),
        durationInFrames,
        fps,
        width,
        height,
        defaultProps,
        sequences: parseSequencesFromFile(workspacePath, componentFile, durationInFrames),
      });
    }
  }
  return compositions;
}

function parseSequencesFromFile(workspacePath, filePath, compositionDuration) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const source = readText(filePath);
  const constants = parseConstants(source);
  const sequences = [];
  const regex = /<Sequence\b([\s\S]*?)(?:\/>|>)/g;
  let match;
  let index = 0;
  while ((match = regex.exec(source))) {
    const block = match[1];
    const from = Math.max(0, Math.round(parseNumberAttr(block, "from", constants, 0) || 0));
    const duration = Math.max(1, Math.round(
      parseNumberAttr(block, "durationInFrames", constants, compositionDuration - from) ||
      parseNumberAttr(block, "duration", constants, compositionDuration - from) ||
      compositionDuration - from,
    ));
    const name = parseStringAttr(block, "name", "") || parseStringAttr(block, "layout", "") || `Sequence ${index + 1}`;
    sequences.push({
      id: `sequence-${index + 1}`,
      label: name,
      from,
      duration,
      sourcePath: relativeToWorkspace(workspacePath, filePath),
    });
    index += 1;
  }
  return sequences;
}

function parseTextSnippets(source) {
  const snippets = [];
  const regex = />([^<>{}\n][^<>{}]{2,120})</g;
  let match;
  while ((match = regex.exec(source)) && snippets.length < 8) {
    const text = match[1].replace(/\s+/g, " ").trim();
    const looksLikeCode =
      !text ||
      /^[);,.\s]+$/.test(text) ||
      /[=;{}()[\]?]/.test(text) ||
      /\b(const|let|return|frame|props|style|className)\b/.test(text);
    if (!looksLikeCode) snippets.push(text);
  }
  return snippets;
}

function collectEntryPoints(workspacePath, files, primaryEntry) {
  const candidates = new Map();
  const add = (relPath, source, confidence) => {
    if (!relPath) return;
    const prev = candidates.get(relPath);
    if (!prev || confidence > prev.confidence) {
      candidates.set(relPath, { path: relPath, source, confidence });
    }
  };
  for (const filePath of files) {
    const rel = relativeToWorkspace(workspacePath, filePath);
    const text = readText(filePath) || "";
    if (text.includes("registerRoot(")) add(rel, "registerRoot", 0.95);
    else if (/(^|[\\/])remotion\.config\.[tj]sx?$/.test(rel)) add(rel, "config", 0.7);
  }
  if (primaryEntry && !candidates.has(primaryEntry)) {
    add(primaryEntry, candidates.size ? "compositionUsage" : "registerRoot", 0.85);
  }
  return Array.from(candidates.values()).sort((a, b) => b.confidence - a.confidence);
}

module.exports = {
  resolveModule,
  attrRaw,
  attrExpression,
  parseConstants,
  evaluateNumber,
  parseStringAttr,
  parseNumberAttr,
  parseDefaultProps,
  findRemotionEntry,
  findImportedComponentFile,
  componentDefinedIn,
  findComponentFile,
  parseCompositionBlocks,
  parseSequencesFromFile,
  parseTextSnippets,
  collectEntryPoints,
};
