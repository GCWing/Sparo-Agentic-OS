const { emit, readRequest } = require("./src/protocol");
const { detectProject, compileProject, getCompositionManifest, evaluateFrame, indexAssets, readDiagnostics } = require("./src/project");
const { renderPreviewFrame, renderPreviewClip, renderStill } = require("./src/render");
const { ensurePlayerPreviewHost, getPlayerPreviewHostStatus, stopPlayerPreviewHost } = require("./src/player-host");
const { ensurePreviewServer, getPreviewServerStatus, stopPreviewServer } = require("./src/preview-server");
const { startExport, getExportStatus, cancelExport } = require("./src/export");

async function main() {
  const request = await readRequest();
  const action = request.action;
  const input = request.input || {};
  emit({ type: "run.started", run_id: request.runId || request.run_id || `remotion-${Date.now()}` });

  let output;
  switch (action) {
    case "detectProject":
      output = detectProject(input);
      break;
    case "compileProject":
      output = compileProject(input);
      break;
    case "getCompositionManifest":
      output = getCompositionManifest(input);
      break;
    case "getFrameContext":
    case "evaluateFrame":
      output = evaluateFrame(input);
      break;
    case "renderPreviewFrame":
      output = renderPreviewFrame(input);
      break;
    case "renderPreviewClip":
      output = renderPreviewClip(input);
      break;
    case "ensurePlayerPreviewHost":
      output = await ensurePlayerPreviewHost(input);
      break;
    case "getPlayerPreviewHostStatus":
      output = await getPlayerPreviewHostStatus(input);
      break;
    case "stopPlayerPreviewHost":
      output = await stopPlayerPreviewHost(input);
      break;
    case "ensurePreviewServer":
      output = await ensurePreviewServer(input);
      break;
    case "getPreviewServerStatus":
      output = await getPreviewServerStatus(input);
      break;
    case "stopPreviewServer":
      output = await stopPreviewServer(input);
      break;
    case "renderStill":
      output = renderStill(input);
      break;
    case "startExport":
      output = startExport(input);
      break;
    case "getExportStatus":
      output = getExportStatus(input);
      break;
    case "cancelExport":
      output = cancelExport(input);
      break;
    case "indexAssets":
      output = indexAssets(input);
      break;
    case "readDiagnostics":
      output = readDiagnostics(input);
      break;
    default:
      throw new Error(`Unsupported Sparo Video Engine action: ${action}`);
  }

  emit({ type: "run.completed", output });
}

main().catch((error) => {
  emit({
    type: "run.failed",
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
  process.exitCode = 1;
});
