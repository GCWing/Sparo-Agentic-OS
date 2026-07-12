const fs = require("node:fs");
const path = require("node:path");
const { readText } = require("./util");
const { relativeToWorkspace } = require("./paths");

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
  return withRegisterRoot || explicit || null;
}

function collectEntryPoints(workspacePath, files, primaryEntry) {
  const candidates = new Map();
  const add = (relativePath, source, confidence) => {
    if (!relativePath) return;
    const previous = candidates.get(relativePath);
    if (!previous || confidence > previous.confidence) {
      candidates.set(relativePath, { path: relativePath, source, confidence });
    }
  };
  for (const filePath of files) {
    const relative = relativeToWorkspace(workspacePath, filePath);
    const source = readText(filePath) || "";
    if (source.includes("registerRoot(")) add(relative, "registerRoot", 0.95);
    else if (/(^|[\\/])remotion\.config\.[tj]sx?$/.test(relative)) add(relative, "config", 0.7);
  }
  if (primaryEntry && !candidates.has(primaryEntry)) add(primaryEntry, "explicit", 0.85);
  return Array.from(candidates.values()).sort((a, b) => b.confidence - a.confidence);
}

module.exports = {
  findRemotionEntry,
  collectEntryPoints,
};
