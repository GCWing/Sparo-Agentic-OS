const fs = require("node:fs");
const { redactValue } = require("./redact");
const { runtimeStatePath } = require("./paths");

function readRuntimeState(workspacePath) {
  try {
    return JSON.parse(fs.readFileSync(runtimeStatePath(workspacePath), "utf8"));
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: Date.now(),
      capabilities: {
        hdcTarget: false,
        bundleDump: "unknown",
        abilityLaunch: "unknown",
        screenshot: "unknown",
        hierarchyDump: "unknown",
        hilog: "unknown",
        hotReload: "unknown",
      },
      diagnostics: [],
    };
  }
}

function writeRuntimeState(workspacePath, patch) {
  const next = redactValue({
    ...readRuntimeState(workspacePath),
    ...patch,
    updatedAt: Date.now(),
  });
  fs.writeFileSync(runtimeStatePath(workspacePath), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

module.exports = {
  readRuntimeState,
  writeRuntimeState,
};
