const fs = require("node:fs");
const path = require("node:path");

function workspacePathOf(requestOrInput) {
  const input = requestOrInput?.input || requestOrInput || {};
  return String(
    input.workspacePath ||
    input.workspace_path ||
    requestOrInput?.workspacePath ||
    requestOrInput?.workspace_path ||
    "",
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

function relativeToWorkspace(workspacePath, absolutePath) {
  return path.relative(workspacePath, absolutePath).replace(/\\/g, "/");
}

function ensureRuntimeDir(workspacePath, child = "") {
  const dir = path.join(workspacePath, ".sparo_os", "remotion-live", child);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewServerStatePath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "preview-server.json");
}

function previewServerLogPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "logs"), "preview-server.log");
}

function previewServerLauncherPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), "preview-server-launcher.js");
}

function previewServerLauncherConfigPath(workspacePath, port) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), `preview-server-${port}.json`);
}

function playerHostStatePath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "player-host.json");
}

function playerHostRootDir(workspacePath) {
  return ensureRuntimeDir(workspacePath, "player-host");
}

function playerHostSourceDir(workspacePath) {
  return path.join(playerHostRootDir(workspacePath), "src");
}

function playerHostDistDir(workspacePath) {
  return path.join(playerHostRootDir(workspacePath), "dist");
}

function playerHostLogPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "logs"), "player-host.log");
}

function playerHostServerPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath, "bin"), "player-host-server.js");
}

module.exports = {
  workspacePathOf,
  normalizeWorkspace,
  relativeToWorkspace,
  ensureRuntimeDir,
  previewServerStatePath,
  previewServerLogPath,
  previewServerLauncherPath,
  previewServerLauncherConfigPath,
  playerHostStatePath,
  playerHostRootDir,
  playerHostSourceDir,
  playerHostDistDir,
  playerHostLogPath,
  playerHostServerPath,
};
