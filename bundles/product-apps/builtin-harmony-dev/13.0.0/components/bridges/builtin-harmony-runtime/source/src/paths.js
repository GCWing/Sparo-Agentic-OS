const fs = require("node:fs");
const path = require("node:path");

function workspacePathOf(requestOrInput) {
  const input = requestOrInput?.input || requestOrInput || {};
  return String(
    input.workspacePath ||
    input.workspace_path ||
    requestOrInput?.workspacePath ||
    requestOrInput?.workspace_path ||
    ""
  ).trim();
}

function normalizeWorkspace(workspacePath) {
  if (!workspacePath) throw new Error("workspacePath is required.");
  const resolved = path.resolve(workspacePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

function ensureRuntimeDir(workspacePath, child = "") {
  const dir = path.join(workspacePath, ".sparo_os", "harmony-dev", child);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runtimeStatePath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "runtime-state.json");
}

function runDir(workspacePath, runId) {
  return ensureRuntimeDir(workspacePath, path.join("runs", runId));
}

function artifactsDir(workspacePath) {
  return ensureRuntimeDir(workspacePath, "artifacts");
}

function screenshotsDir(workspacePath) {
  return ensureRuntimeDir(workspacePath, "screenshots");
}

function hierarchyDir(workspacePath) {
  return ensureRuntimeDir(workspacePath, "hierarchy");
}

function relativeToWorkspace(workspacePath, filePath) {
  return path.relative(workspacePath, filePath).replace(/\\/g, "/");
}

function safeFilePart(value) {
  return String(value || "run").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "run";
}

module.exports = {
  artifactsDir,
  ensureRuntimeDir,
  hierarchyDir,
  normalizeWorkspace,
  relativeToWorkspace,
  runDir,
  runtimeStatePath,
  safeFilePart,
  screenshotsDir,
  workspacePathOf,
};
