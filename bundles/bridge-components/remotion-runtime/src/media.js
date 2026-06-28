const fs = require("node:fs");
const path = require("node:path");
const { safeStat } = require("./util");
const { PREVIEW_CACHE_LIMIT } = require("./constants");

function mimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return "image/png";
}

function fileDataUrl(filePath) {
  const data = fs.readFileSync(filePath);
  return `data:${mimeForPath(filePath)};base64,${data.toString("base64")}`;
}

function fileUri(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${resolved.replace(/^\/+/, "")}`;
}

function pruneDirectoryFiles(dir, maxFiles = PREVIEW_CACHE_LIMIT) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      return { filePath, mtimeMs: safeStat(filePath)?.mtimeMs || 0 };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(maxFiles)) {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {
      // Best-effort cache pruning only.
    }
  }
}

module.exports = {
  mimeForPath,
  fileDataUrl,
  fileUri,
  pruneDirectoryFiles,
};
