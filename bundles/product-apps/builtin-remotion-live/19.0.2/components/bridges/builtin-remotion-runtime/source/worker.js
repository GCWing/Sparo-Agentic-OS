const readline = require("node:readline");
const { emitRunEvent, runWithRequestContext } = require("./src/protocol");
const { detectProject, compileProject, getCompositionManifest, getFrameDescriptor, indexAssets, readDiagnostics } = require("./src/project");
const { renderStill } = require("./src/render");
const { ensurePlayerPreviewHost, getPlayerPreviewHostStatus, stopPlayerPreviewHost } = require("./src/player-host");
const { startExport, getExportStatus, cancelExport } = require("./src/export");

async function dispatchAction(action, input) {
  switch (action) {
    case "detectProject": return detectProject(input);
    case "compileProject": return compileProject(input);
    case "getCompositionManifest": return getCompositionManifest(input);
    case "getFrameDescriptor": return getFrameDescriptor(input);
    case "ensurePlayerPreviewHost": return ensurePlayerPreviewHost(input);
    case "getPlayerPreviewHostStatus": return getPlayerPreviewHostStatus(input);
    case "stopPlayerPreviewHost": return stopPlayerPreviewHost(input);
    case "renderStill": return renderStill(input);
    case "startExport": return startExport(input);
    case "getExportStatus": return getExportStatus(input);
    case "cancelExport": return cancelExport(input);
    case "indexAssets": return indexAssets(input);
    case "readDiagnostics": return readDiagnostics(input);
    default: throw new Error(`Unsupported Sparo Video Engine action: ${action}`);
  }
}

async function handleRequest(request) {
  const runId = request.runId || request.run_id || `remotion-${Date.now()}`;
  const bridgeId = request.bridgeId || request.bridge_id || "builtin-remotion-runtime";
  const topLevelWorkspacePath = request.workspacePath || request.workspace_path || null;
  const input = {
    ...(request.input && typeof request.input === "object" ? request.input : {}),
    ...(topLevelWorkspacePath ? { workspacePath: topLevelWorkspacePath } : {}),
  };
  return runWithRequestContext({ bridgeId, runId }, async () => {
    emitRunEvent({ type: "run.started", run_id: runId });
    try {
      const output = await dispatchAction(request.action, input);
      emitRunEvent({ type: "run.completed", output });
    } catch (error) {
      emitRunEvent({
        type: "run.failed",
        error: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}

async function main() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const activeRequests = new Set();
  let sawRequest = false;
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    sawRequest = true;
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`Invalid Bridge worker request: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      return;
    }
    const active = handleRequest(request).finally(() => activeRequests.delete(active));
    activeRequests.add(active);
  }
  if (!sawRequest) {
    process.stderr.write("No Bridge worker request received on stdin\n");
    process.exitCode = 1;
  }
  await Promise.allSettled(activeRequests);
}

main().catch((error) => {
  process.stderr.write(`Bridge worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
