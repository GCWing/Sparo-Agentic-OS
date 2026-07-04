const { runCommand } = require("./command");
const { detectProject } = require("./project");
const { detectToolchain } = require("./harmony-env");
const { listEmulators } = require("./emulator");
const { listTargets, readLogs } = require("./device");
const { readRuntimeState } = require("./runtime-state");
const { redactValue } = require("./redact");

function readDiagnostics(input = {}) {
  const project = detectProject(input);
  const toolchain = detectToolchain(input);
  const targets = listTargets(input);
  const emulators = listEmulators(input);
  const runtimeState = readRuntimeState(input.workspacePath);
  const git = runCommand("git", ["status", "--short"], {
    cwd: input.workspacePath,
    timeoutMs: 10000,
  });
  const diagnostics = [
    ...(project.diagnostics || []),
    ...(toolchain.diagnostics || []),
    ...(targets.diagnostics || []),
    ...(emulators.diagnostics || []),
    ...(runtimeState.diagnostics || []),
  ];
  return redactValue({
    ok: true,
    project: project.project,
    toolchain: toolchain.toolchain,
    targets: targets.targets,
    emulators: emulators.emulators,
    recommendedEmulator: emulators.recommendedEmulator,
    runtimeState,
    sourceControl: {
      exitCode: git.exitCode,
      statusShort: git.stdout,
    },
    diagnostics,
  });
}

module.exports = {
  readDiagnostics,
  readLogs,
};
