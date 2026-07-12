const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ensureRuntimeDir, playerHostStatePath } = require("./paths");
const { ARTIFACT_CACHE_MAX_BYTES } = require("./constants");
const { readJson, safeStat, walkFiles } = require("./util");

function artifactRoot(workspacePath) {
  return ensureRuntimeDir(workspacePath, "artifacts");
}

function artifactDirectory(workspacePath, kind) {
  const directory = path.join(artifactRoot(workspacePath), kind);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function artifactRelativeUrl(workspacePath, filePath) {
  const root = artifactRoot(workspacePath);
  const absolute = path.resolve(filePath);
  if (!isInside(absolute, root)) throw new Error(`Artifact is outside the runtime artifact root: ${absolute}`);
  const encoded = path.relative(root, absolute).split(path.sep).map(encodeURIComponent).join("/");
  return `/artifacts/${encoded}`;
}

function artifactUrl(workspacePath, relativeUrl) {
  const state = readJson(playerHostStatePath(workspacePath), null);
  if (state?.ready !== true || state?.status !== "ready") return null;
  const baseUrl = String(state?.baseUrl || state?.url || "").replace(/\/$/, "");
  return baseUrl ? `${baseUrl}${relativeUrl}` : null;
}

function contentHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 24);
}

function pruneArtifactCache(workspacePath, activePath, maxBytes = ARTIFACT_CACHE_MAX_BYTES) {
  const root = artifactRoot(workspacePath);
  const active = path.resolve(activePath);
  const entries = walkFiles(root, { maxFiles: 10_000 })
    .map((filePath) => ({ filePath: path.resolve(filePath), stat: safeStat(filePath) }))
    .filter((entry) => entry.stat?.isFile())
    .sort((a, b) => (b.stat.mtimeMs || 0) - (a.stat.mtimeMs || 0));
  let total = entries.reduce((sum, entry) => sum + entry.stat.size, 0);
  for (const entry of entries.reverse()) {
    if (total <= maxBytes) break;
    if (entry.filePath === active) continue;
    try {
      fs.unlinkSync(entry.filePath);
      total -= entry.stat.size;
    } catch {
      // Cache pruning is best effort. The active artifact is never removed.
    }
  }
}

function describeArtifact(workspacePath, filePath) {
  const stat = safeStat(filePath);
  if (!stat?.isFile()) throw new Error(`Artifact does not exist: ${filePath}`);
  const relativeUrl = artifactRelativeUrl(workspacePath, filePath);
  return {
    artifactPath: filePath,
    artifactRelativeUrl: relativeUrl,
    artifactUrl: artifactUrl(workspacePath, relativeUrl),
    contentHash: contentHash(filePath),
    bytes: stat.size,
  };
}

module.exports = {
  artifactRoot,
  artifactDirectory,
  artifactRelativeUrl,
  artifactUrl,
  contentHash,
  pruneArtifactCache,
  describeArtifact,
};
