const fs = require("node:fs");
const path = require("node:path");
const { detectToolchain } = require("./harmony-env");
const { runCommand } = require("./command");
const { diagnostic, redactValue } = require("./redact");
const { latestArtifact } = require("./device");
const { runDir } = require("./paths");
const { readRuntimeState, writeRuntimeState } = require("./runtime-state");

function makeRunId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function buildResult(workspacePath, runId, stage, commandResult, artifact = null, extraDiagnostics = []) {
  const ok = commandResult.exitCode === 0;
  const diagnostics = [...extraDiagnostics];
  if (!ok) {
    diagnostics.push(diagnostic("error", commandResult.stderr || commandResult.stdout || `${stage} failed`, { stage }));
  }
  const build = {
    runId,
    stage,
    status: ok ? "completed" : "failed",
    command: path.basename(commandResult.command || ""),
    exitCode: commandResult.exitCode,
    durationMs: commandResult.durationMs,
    artifact,
    diagnostics,
    logPath: commandResult.logPath || null,
    updatedAt: Date.now(),
  };
  const runtimeState = writeRuntimeState(workspacePath, { build, latestArtifact: artifact || readRuntimeState(workspacePath).latestArtifact, diagnostics });
  return redactValue({ ok, build, artifact, diagnostics, runtimeState });
}

function runHvigor(input, actionName, args, options = {}) {
  const workspacePath = input.workspacePath;
  const toolchainResult = detectToolchain(input);
  const hvigorw = toolchainResult.toolchain.hvigorw.path;
  const diagnostics = [];
  if (!hvigorw) {
    diagnostics.push(diagnostic("warning", "hvigorw was not found", { stage: actionName }));
    return { ok: false, diagnostics, runtimeState: writeRuntimeState(workspacePath, { diagnostics }) };
  }
  const runId = input.runId || makeRunId(actionName);
  const logPath = path.join(runDir(workspacePath, runId), `${actionName}.log`);
  const command = runCommand(hvigorw, args, {
    cwd: workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: options.timeoutMs || input.timeoutMs || 240000,
    logPath,
    label: actionName,
  });
  command.logPath = logPath;
  const artifact = options.findArtifact ? latestArtifact(workspacePath) : null;
  return buildResult(workspacePath, runId, actionName, command, artifact, diagnostics);
}

function runUnitTests(input = {}) {
  return runHvigor(input, "test", ["test", "--mode", "module", "-p", "module=entry", "--info", "--no-daemon"], { timeoutMs: input.timeoutMs || 180000 });
}

function assembleApp(input = {}) {
  return runHvigor(input, "assemble", ["assembleApp", "--incremental", "--parallel", "--info"], { timeoutMs: input.timeoutMs || 240000, findArtifact: true });
}

function buildProject(input = {}) {
  const workspacePath = input.workspacePath;
  const diagnostics = [];
  let test = null;
  if (input.includeTests) {
    test = runUnitTests(input);
    if (!test.ok) {
      const runtimeState = writeRuntimeState(workspacePath, { build: test.build, diagnostics: test.diagnostics });
      return redactValue({ ok: false, test, diagnostics: test.diagnostics, runtimeState });
    }
  }
  const assemble = assembleApp(input);
  const runtimeState = writeRuntimeState(workspacePath, {
    build: assemble.build,
    latestArtifact: assemble.artifact || latestArtifact(workspacePath),
    diagnostics: [...diagnostics, ...assemble.diagnostics],
  });
  return redactValue({ ok: assemble.ok, test, assemble, build: assemble.build, artifact: assemble.artifact, diagnostics: assemble.diagnostics, runtimeState });
}

function hotReload(input = {}) {
  const result = runHvigor(input, "hotReload", ["assembleApp", "--hot-reload-build", "--info"], { timeoutMs: input.timeoutMs || 180000, findArtifact: true });
  const capabilities = {
    ...readRuntimeState(input.workspacePath).capabilities,
    hotReload: result.ok ? "available" : "experimental",
  };
  const fallbackDiagnostic = result.ok ? [] : [diagnostic("info", "Hot Reload is optional; use Build & Run as the correctness path.", { stage: "hotReload" })];
  const runtimeState = writeRuntimeState(input.workspacePath, {
    build: result.build,
    capabilities,
    diagnostics: [...(result.diagnostics || []), ...fallbackDiagnostic],
  });
  return redactValue({ ...result, diagnostics: [...(result.diagnostics || []), ...fallbackDiagnostic], runtimeState });
}

module.exports = {
  assembleApp,
  buildProject,
  hotReload,
  runUnitTests,
};
