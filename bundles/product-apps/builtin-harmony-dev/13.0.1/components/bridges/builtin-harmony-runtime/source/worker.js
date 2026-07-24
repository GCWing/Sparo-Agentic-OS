const readline = require("node:readline");
const { emit } = require("./src/protocol");
const { normalizeWorkspace } = require("./src/paths");
const { detectProject } = require("./src/project");
const { detectToolchain } = require("./src/harmony-env");
const { listEmulators, startEmulator, stopEmulator } = require("./src/emulator");
const { assembleApp, buildProject, hotReload, runUnitTests } = require("./src/build");
const { captureScreen, dumpHierarchy, installApp, launchAbility, listTargets, readLogs, readScreenshot } = require("./src/device");
const { readDiagnostics } = require("./src/diagnostics");
const { readRuntimeState } = require("./src/runtime-state");
const { redactValue } = require("./src/redact");

async function dispatchAction(action, input) {
  switch (action) {
    case "detectProject": return detectProject(input);
    case "detectToolchain": return detectToolchain(input);
    case "listEmulators": return listEmulators(input);
    case "startEmulator": return startEmulator(input);
    case "stopEmulator": return stopEmulator(input);
    case "listTargets": return listTargets(input);
    case "runUnitTests": return runUnitTests(input);
    case "assembleApp": return assembleApp(input);
    case "buildProject": return buildProject(input);
    case "hotReload": return hotReload(input);
    case "installApp": return installApp(input);
    case "launchAbility": return launchAbility(input);
    case "captureScreen": return captureScreen(input);
    case "readScreenshot": return readScreenshot(input);
    case "dumpHierarchy": return dumpHierarchy(input);
    case "readLogs": return readLogs(input);
    case "readDiagnostics": return readDiagnostics(input);
    case "getRuntimeState": return { ok: true, runtimeState: readRuntimeState(input.workspacePath) };
    default: throw new Error(`Unsupported HarmonyOS Dev Runtime action: ${action}`);
  }
}

async function handleRequest(request) {
  const runId = request.runId || request.run_id || `harmony-${Date.now()}`;
  const bridgeId = request.bridgeId || request.bridge_id || "builtin-harmony-runtime";
  const emitEvent = (event) => emit({ bridgeId, runId, event });
  const workspacePath = request.workspacePath || request.workspace_path || null;
  const input = {
    ...(request.input && typeof request.input === "object" ? request.input : {}),
    workspacePath: workspacePath ? normalizeWorkspace(workspacePath) : null,
  };
  emitEvent({ type: "run.started", run_id: runId });
  try {
    const output = await dispatchAction(request.action, input);
    emitEvent({ type: "run.completed", output: redactValue(output) });
  } catch (error) {
    emitEvent({
      type: "run.failed",
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function main() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
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
    await handleRequest(request);
  }
  if (!sawRequest) {
    process.stderr.write("No Bridge worker request received on stdin\n");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`Bridge worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
