const fs = require("node:fs");
const path = require("node:path");
const { ensureRuntimeDir, normalizeWorkspace, workspacePathOf } = require("./paths");
const { readJson, writeJson, hashContent, safeFilePart, clampNumber } = require("./util");
const { getCompositionManifest, detectProject } = require("./project");
const { runRemotion } = require("./remotion-cli");
const { fileUri } = require("./media");
const { REMOTION_EXPORT_TIMEOUT_MS } = require("./constants");

function runsPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "runs.json");
}

function readRuns(workspacePath) {
  return readJson(runsPath(workspacePath), { runs: [] }) || { runs: [] };
}

function writeRuns(workspacePath, runs) {
  writeJson(runsPath(workspacePath), { runs });
}

function startExport(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const detection = detectProject(input);
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  if (!detection.entryPoint) throw new Error("Cannot export because no Remotion entry point was detected.");
  const [fromRaw, toRaw] = Array.isArray(input.frameRange) ? input.frameRange : [0, composition.durationInFrames - 1];
  const fromValue = Number(fromRaw);
  const toValue = Number(toRaw);
  const from = Math.round(Math.max(0, Number.isFinite(fromValue) ? fromValue : 0));
  const to = Math.max(from, Math.round(Math.min(
    composition.durationInFrames - 1,
    Number.isFinite(toValue) ? toValue : composition.durationInFrames - 1,
  )));
  const runId = `export-${hashContent(`${composition.id}:${from}:${to}:${Date.now()}`)}`;
  const outputDir = ensureRuntimeDir(workspacePath, path.join("exports", runId));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeFilePart(composition.id)}.mp4`);
  const args = [
    "render",
    detection.entryPoint,
    composition.id,
    outputPath,
    "--overwrite",
  ];
  if (Number.isFinite(Number(input.scale))) {
    args.push("--scale", String(clampNumber(input.scale, 0.05, 1, 1)));
  }
  if (Array.isArray(input.frameRange)) {
    args.push(`--frames=${from}-${to}`);
  }
  const renderLog = runRemotion(workspacePath, args, { timeoutMs: REMOTION_EXPORT_TIMEOUT_MS });
  const run = {
    runId,
    kind: "remotion-video",
    status: "completed",
    compositionId: composition.id,
    frameRange: [from, to],
    outputPath,
    outputUri: fileUri(outputPath),
    renderLog,
    completedAt: Date.now(),
  };
  const runs = [run, ...readRuns(workspacePath).runs.filter((item) => item.runId !== runId)].slice(0, 50);
  writeRuns(workspacePath, runs);
  writeJson(path.join(outputDir, "manifest.json"), run);
  return { ok: true, ...run, manifestPath: path.join(outputDir, "manifest.json") };
}

function getExportStatus(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || input.exportId || "").trim();
  const runs = readRuns(workspacePath).runs;
  if (!runId) return { ok: true, runs };
  const run = runs.find((item) => item.runId === runId);
  return { ok: Boolean(run), run: run || null };
}

function cancelExport(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || input.exportId || "").trim();
  if (!runId) return { ok: false, status: "not_found" };
  const state = readRuns(workspacePath);
  const runs = state.runs.map((run) => run.runId === runId ? { ...run, status: "cancelled", cancelledAt: Date.now() } : run);
  writeRuns(workspacePath, runs);
  return { ok: true, run: runs.find((run) => run.runId === runId) || null };
}

module.exports = {
  runsPath,
  readRuns,
  writeRuns,
  startExport,
  getExportStatus,
  cancelExport,
};
