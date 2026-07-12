const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporaryPath, filePath);
    } catch {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

async function main() {
  const configPath = process.argv[2];
  const config = readJson(configPath, null);
  if (!config) throw new Error("Export job configuration is missing or invalid.");
  const renderer = require(config.rendererEntry);
  const noReact = require(config.noReactEntry);
  if (typeof renderer.renderMedia !== "function" || typeof renderer.makeCancelSignal !== "function") {
    throw new Error("The project @remotion/renderer package must expose renderMedia() and makeCancelSignal().");
  }

  let run = readJson(config.manifestPath, config.run) || config.run;
  const update = (patch) => {
    const terminal = new Set(["completed", "cancelled", "failed"]);
    if (terminal.has(run.status) && patch.status && !terminal.has(patch.status)) return;
    run = { ...run, ...patch };
    writeJsonAtomic(config.manifestPath, run);
  };
  const { cancel, cancelSignal } = renderer.makeCancelSignal();
  let cancellationSent = false;
  let forceCancellationTimer = null;
  const requestCancellationIfNeeded = () => {
    if (!cancellationSent && fs.existsSync(config.cancelPath)) {
      cancellationSent = true;
      update({ status: "cancelling", phase: "cancelling", cancelRequestedAt: Date.now() });
      cancel();
      forceCancellationTimer = setTimeout(() => {
        update({ status: "cancelled", phase: "cancelled", cancelledAt: Date.now(), forced: true });
        fs.rmSync(config.outputPath, { force: true });
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/PID", String(process.pid), "/T", "/F"], {
            detached: true,
            windowsHide: true,
            stdio: "ignore",
          });
          killer.unref();
        } else {
          try {
            process.kill(-process.pid, "SIGKILL");
          } catch {
            process.kill(process.pid, "SIGKILL");
          }
        }
      }, 5_000);
    }
  };
  const watchCancel = setInterval(requestCancellationIfNeeded, 150);
  watchCancel.unref?.();
  requestCancellationIfNeeded();

  const deserialize = noReact.NoReactInternals.deserializeJSONWithSpecialTypes;
  const resolvedProps = deserialize(config.composition.serializedResolvedProps);
  const composition = {
    id: config.composition.id,
    width: config.composition.width,
    height: config.composition.height,
    fps: config.composition.fps,
    durationInFrames: config.composition.durationInFrames,
    defaultProps: config.composition.defaultProps || {},
    props: resolvedProps,
    defaultCodec: config.composition.defaults?.codec || null,
    defaultOutName: config.composition.defaults?.outName || null,
    defaultVideoImageFormat: config.composition.defaults?.videoImageFormat || null,
    defaultPixelFormat: config.composition.defaults?.pixelFormat || null,
    defaultProResProfile: config.composition.defaults?.proResProfile || null,
    defaultSampleRate: config.composition.defaults?.sampleRate || null,
  };

  try {
    update({ status: "running", phase: "rendering", pid: process.pid, startedAt: run.startedAt || Date.now() });
    await renderer.renderMedia({
      serveUrl: config.bundlePath,
      composition,
      inputProps: resolvedProps,
      codec: config.codec,
      outputLocation: config.outputPath,
      frameRange: config.frameRange,
      scale: config.scale,
      overwrite: true,
      cancelSignal,
      logLevel: "warn",
      onProgress: (progress) => {
        requestCancellationIfNeeded();
        update({
          status: cancellationSent ? "cancelling" : "running",
          phase: cancellationSent ? "cancelling" : progress.stitchStage || "rendering",
          progress: Math.max(0, Math.min(100, Math.round((Number(progress.progress) || 0) * 100))),
          renderedFrames: Number(progress.renderedFrames) || 0,
          encodedFrames: Number(progress.encodedFrames) || 0,
          estimatedTimeMs: Number.isFinite(progress.renderEstimatedTime) ? progress.renderEstimatedTime : null,
          updatedAt: Date.now(),
        });
      },
    });
    if (fs.existsSync(config.cancelPath)) {
      fs.rmSync(config.outputPath, { force: true });
      update({ status: "cancelled", phase: "cancelled", cancelledAt: Date.now() });
      return;
    }
    const stat = fs.statSync(config.outputPath);
    update({
      status: "completed",
      phase: "completed",
      progress: 100,
      bytes: stat.size,
      completedAt: Date.now(),
    });
  } catch (error) {
    const cancelled = cancellationSent || fs.existsSync(config.cancelPath);
    if (cancelled) {
      fs.rmSync(config.outputPath, { force: true });
      update({ status: "cancelled", phase: "cancelled", cancelledAt: Date.now() });
    } else {
      fs.rmSync(config.outputPath, { force: true });
      update({
        status: "failed",
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
        failedAt: Date.now(),
      });
    }
  } finally {
    clearInterval(watchCancel);
    if (forceCancellationTimer) clearTimeout(forceCancellationTimer);
    if (config.bundlePinPath) fs.rmSync(config.bundlePinPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Export worker failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
