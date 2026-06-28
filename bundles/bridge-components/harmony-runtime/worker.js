const { emit, readRequest } = require("./src/protocol");
const { workspacePathOf, normalizeWorkspace } = require("./src/paths");
const { detectProject } = require("./src/project");
const { detectToolchain } = require("./src/harmony-env");
const { listEmulators, startEmulator, stopEmulator } = require("./src/emulator");
const { assembleApp, buildProject, hotReload, runUnitTests } = require("./src/build");
const { captureScreen, dumpHierarchy, installApp, launchAbility, listTargets, readLogs, readScreenshot } = require("./src/device");
const { readDiagnostics } = require("./src/diagnostics");
const { readRuntimeState } = require("./src/runtime-state");
const { redactValue } = require("./src/redact");

async function main() {
  const request = await readRequest();
  const action = request.action;
  const input = {
    ...(request.input || {}),
  };
  if (!input.workspacePath) input.workspacePath = workspacePathOf(request);
  if (input.workspacePath) input.workspacePath = normalizeWorkspace(input.workspacePath);

  emit({ type: "run.started", run_id: request.runId || request.run_id || `harmony-${Date.now()}` });

  let output;
  switch (action) {
    case "detectProject":
      output = detectProject(input);
      break;
    case "detectToolchain":
      output = detectToolchain(input);
      break;
    case "listEmulators":
      output = listEmulators(input);
      break;
    case "startEmulator":
      output = await startEmulator(input);
      break;
    case "stopEmulator":
      output = await stopEmulator(input);
      break;
    case "listTargets":
      output = listTargets(input);
      break;
    case "runUnitTests":
      output = runUnitTests(input);
      break;
    case "assembleApp":
      output = assembleApp(input);
      break;
    case "buildProject":
      output = buildProject(input);
      break;
    case "hotReload":
      output = hotReload(input);
      break;
    case "installApp":
      output = installApp(input);
      break;
    case "launchAbility":
      output = launchAbility(input);
      break;
    case "captureScreen":
      output = captureScreen(input);
      break;
    case "readScreenshot":
      output = readScreenshot(input);
      break;
    case "dumpHierarchy":
      output = dumpHierarchy(input);
      break;
    case "readLogs":
      output = readLogs(input);
      break;
    case "readDiagnostics":
      output = readDiagnostics(input);
      break;
    case "getRuntimeState":
      output = { ok: true, runtimeState: readRuntimeState(input.workspacePath) };
      break;
    default:
      throw new Error(`Unsupported HarmonyOS Dev Runtime action: ${action}`);
  }

  emit({ type: "run.completed", output: redactValue(output) });
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
