const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { ensureRuntimeDir, normalizeWorkspace, workspacePathOf } = require("./paths");
const { readJson, writeJsonAtomic, hashContent, safeFilePart, clampNumber, isProcessAlive } = require("./util");
const { compositionForInput } = require("./project");
const { resolveProjectModule } = require("./project-deps");
const { pinProjectBundle, unpinProjectBundle } = require("./project-runtime");

const EXPORT_HISTORY_LIMIT = 50;
const EXPORT_SPAWN_LEASE_MS = 30_000;
const CODEC_EXTENSIONS = new Map([
  ["h264", ".mp4"],
  ["h265", ".mp4"],
  ["vp8", ".webm"],
  ["vp9", ".webm"],
  ["prores", ".mov"],
  ["gif", ".gif"],
]);

function runsPath(workspacePath) {
  return path.join(ensureRuntimeDir(workspacePath), "runs.json");
}

function exportDirectory(workspacePath, runId) {
  return ensureRuntimeDir(workspacePath, path.join("exports", runId));
}

function runManifestPath(workspacePath, runId) {
  return path.join(exportDirectory(workspacePath, runId), "manifest.json");
}

function cancelRequestPath(workspacePath, runId) {
  return path.join(exportDirectory(workspacePath, runId), "cancel.requested.json");
}

function readRuns(workspacePath) {
  const index = readJson(runsPath(workspacePath), { runs: [] }) || { runs: [] };
  const runs = (Array.isArray(index.runs) ? index.runs : []).map((indexed) => {
    const manifestPath = indexed.manifestPath || runManifestPath(workspacePath, indexed.runId);
    let current = readJson(manifestPath, indexed) || indexed;
    if (current.cancelledAt && !["completed", "failed"].includes(current.status)) {
      current = { ...current, status: "cancelled", phase: "cancelled" };
      writeJsonAtomic(manifestPath, current);
    }
    const active = ["queued", "running", "cancelling"].includes(current.status);
    const spawnLeaseExpired = current.status === "queued"
      && !current.pid
      && Date.now() > Number(current.spawnDeadlineAt || (current.queuedAt || 0) + EXPORT_SPAWN_LEASE_MS);
    if (active && ((current.pid && !isProcessAlive(current.pid)) || spawnLeaseExpired)) {
      const cancelled = fs.existsSync(cancelRequestPath(workspacePath, current.runId));
      const recovered = {
        ...current,
        status: cancelled ? "cancelled" : "failed",
        ...(cancelled ? { cancelledAt: Date.now() } : {
          failedAt: Date.now(),
          error: spawnLeaseExpired
            ? "The export worker was not started before its spawn lease expired."
            : "The export worker stopped before producing a terminal result.",
        }),
      };
      writeJsonAtomic(manifestPath, recovered);
      return recovered;
    }
    return current;
  });
  return { runs };
}

function writeRuns(workspacePath, runs) {
  writeJsonAtomic(runsPath(workspacePath), { runs: runs.slice(0, EXPORT_HISTORY_LIMIT) });
}

function publishRun(workspacePath, run) {
  const manifestPath = run.manifestPath || runManifestPath(workspacePath, run.runId);
  const current = { ...run, manifestPath };
  writeJsonAtomic(manifestPath, current);
  const runs = [current, ...readRuns(workspacePath).runs.filter((item) => item.runId !== current.runId)];
  writeRuns(workspacePath, runs);
  return current;
}

function outputExtension(codec) {
  const extension = CODEC_EXTENSIONS.get(codec);
  if (!extension) throw new Error(`Unsupported Remotion export codec: ${codec}`);
  return extension;
}

async function startExport(input = {}) {
  const { workspacePath, projectRoot, manifest, composition } = await compositionForInput(input);
  const [fromRaw, toRaw] = Array.isArray(input.frameRange) ? input.frameRange : [0, composition.durationInFrames - 1];
  const fromValue = Number(fromRaw);
  const toValue = Number(toRaw);
  const from = Math.round(Math.max(0, Number.isFinite(fromValue) ? fromValue : 0));
  const to = Math.max(from, Math.round(Math.min(
    composition.durationInFrames - 1,
    Number.isFinite(toValue) ? toValue : composition.durationInFrames - 1,
  )));
  const codec = String(input.codec || composition.defaults?.codec || "h264").toLowerCase();
  const extension = outputExtension(codec);
  const runId = `export-${hashContent(`${manifest.sourceRevision}:${composition.id}:${from}:${to}:${Date.now()}:${Math.random()}`)}`;
  const outputDir = exportDirectory(workspacePath, runId);
  const requestedName = String(input.outputName || composition.defaults?.outName || composition.id).replace(/\.[^.]+$/, "");
  const outputPath = path.join(outputDir, `${safeFilePart(requestedName)}${extension}`);
  const manifestPath = runManifestPath(workspacePath, runId);
  const logPath = path.join(outputDir, "export.log");
  const configPath = path.join(outputDir, "job.json");
  const scale = clampNumber(input.scale, 0.05, 4, 1);
  fs.mkdirSync(outputDir, { recursive: true });
  const bundlePinPath = pinProjectBundle(manifest.bundlePath, runId);

  let run;
  try {
    run = publishRun(workspacePath, {
      runId,
      kind: "remotion-video",
      status: "queued",
      progress: 0,
      phase: "queued",
      compositionId: composition.id,
      sourceRevision: manifest.sourceRevision,
      projectRevision: manifest.projectRevision || manifest.sourceRevision,
      descriptorRevision: composition.descriptorRevision || manifest.descriptorRevision,
      frameRange: [from, to],
      codec,
      scale,
      outputPath,
      manifestPath,
      logPath,
      queuedAt: Date.now(),
      spawnDeadlineAt: Date.now() + EXPORT_SPAWN_LEASE_MS,
    });
    writeJsonAtomic(configPath, {
      run,
      workspacePath,
      projectRoot,
      bundlePath: manifest.bundlePath,
      composition,
      outputPath,
      frameRange: [from, to],
      codec,
      scale,
      manifestPath,
      cancelPath: cancelRequestPath(workspacePath, runId),
      rendererEntry: resolveProjectModule("@remotion/renderer", projectRoot, workspacePath),
      noReactEntry: resolveProjectModule("remotion/no-react", projectRoot, workspacePath),
      bundlePinPath,
    });
  } catch (error) {
    unpinProjectBundle(bundlePinPath);
    if (!run) throw error;
    run = publishRun(workspacePath, {
      ...run,
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt: Date.now(),
    });
    return { ok: false, run };
  }
  const workerPath = path.join(__dirname, "export-job-worker.js");
  let output;
  try {
    output = fs.openSync(logPath, "a");
  } catch (error) {
    unpinProjectBundle(bundlePinPath);
    run = publishRun(workspacePath, {
      ...run,
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt: Date.now(),
    });
    return { ok: false, run };
  }
  let child;
  try {
    child = spawn(process.execPath, [workerPath, configPath], {
      cwd: projectRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
      env: {
        ...process.env,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    child.unref();
  } catch (error) {
    fs.closeSync(output);
    unpinProjectBundle(bundlePinPath);
    run = publishRun(workspacePath, {
      ...run,
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt: Date.now(),
    });
    return { ok: false, run };
  }
  fs.closeSync(output);

  run = publishRun(workspacePath, {
    ...run,
    status: "running",
    phase: "rendering",
    pid: child.pid,
    startedAt: Date.now(),
  });
  return { ok: true, run };
}

function getExportStatus(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || "").trim();
  const runs = readRuns(workspacePath).runs;
  writeRuns(workspacePath, runs);
  if (!runId) return { ok: false, run: null, error: "runId is required." };
  const run = runs.find((item) => item.runId === runId);
  return { ok: Boolean(run), run: run || null };
}

function cancelExport(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const runId = String(input.runId || "").trim();
  if (!runId) return { ok: false, status: "not_found" };
  const run = readRuns(workspacePath).runs.find((item) => item.runId === runId);
  if (!run) return { ok: false, status: "not_found" };
  if (["completed", "cancelled", "failed"].includes(run.status)) return { ok: true, run };

  writeJsonAtomic(cancelRequestPath(workspacePath, runId), { runId, requestedAt: Date.now() });
  const cancelling = { ...run, status: "cancelling", phase: "cancelling", cancelRequestedAt: Date.now() };
  writeJsonAtomic(run.manifestPath || runManifestPath(workspacePath, runId), cancelling);

  return { ok: true, run: cancelling };
}

module.exports = {
  runsPath,
  readRuns,
  writeRuns,
  startExport,
  getExportStatus,
  cancelExport,
};
