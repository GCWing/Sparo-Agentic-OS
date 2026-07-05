const fs = require("node:fs");
const path = require("node:path");
const { ensureRuntimeDir } = require("./paths");
const { safeFilePart, clampNumber, safeStat } = require("./util");
const { fileUri, fileDataUrl, pruneDirectoryFiles } = require("./media");
const { compositionForInput, detectProject } = require("./project");
const { runRemotion } = require("./remotion-cli");
const { DEFAULT_PREVIEW_SCALE, DEFAULT_STILL_SCALE, DEFAULT_PREVIEW_VIDEO_SCALE, DEFAULT_PREVIEW_CLIP_SECONDS, REMOTION_RENDER_TIMEOUT_MS, REMOTION_EXPORT_TIMEOUT_MS, PREVIEW_VIDEO_CACHE_LIMIT } = require("./constants");

function renderedFramePath(workspacePath, compositionId, frame, scale, buildId, kind = "preview") {
  const scalePart = String(scale).replace(/[^0-9.]+/g, "").replace(".", "p") || "1";
  const outputDir = ensureRuntimeDir(workspacePath, kind === "still" ? "stills" : "preview-frames");
  const outputPath = path.join(
    outputDir,
    `${safeFilePart(compositionId)}-frame-${frame}-scale-${scalePart}-${safeFilePart(buildId)}.png`,
  );
  return { outputDir, outputPath };
}

function renderedPreviewClipPath(workspacePath, compositionId, from, to, scale, buildId) {
  const scalePart = String(scale).replace(/[^0-9.]+/g, "").replace(".", "p") || "1";
  const outputDir = ensureRuntimeDir(workspacePath, "preview-videos");
  const outputPath = path.join(
    outputDir,
    `${safeFilePart(compositionId)}-frames-${from}-${to}-scale-${scalePart}-${safeFilePart(buildId)}.mp4`,
  );
  return { outputDir, outputPath };
}

function renderFrameWithRemotion(input = {}, options = {}) {
  const { workspacePath, manifest, composition, frame } = compositionForInput(input);
  const detection = detectProject(input);
  if (!detection.entryPoint) throw new Error("Cannot render frame because no Remotion entry point was detected.");

  const scale = clampNumber(
    input.scale,
    0.05,
    1,
    options.defaultScale ?? DEFAULT_PREVIEW_SCALE,
  );
  const { outputDir, outputPath } = renderedFramePath(
    workspacePath,
    composition.id,
    frame,
    scale,
    manifest.buildId,
    options.kind || "preview",
  );
  const useCache = input.force !== true && fs.existsSync(outputPath);
  let renderLog = null;

  if (!useCache) {
    fs.mkdirSync(outputDir, { recursive: true });
    const args = [
      "still",
      detection.entryPoint,
      composition.id,
      outputPath,
      "--frame",
      String(frame),
      "--scale",
      String(scale),
      "--overwrite",
    ];
    renderLog = runRemotion(workspacePath, args, {
      timeoutMs: options.timeoutMs || REMOTION_RENDER_TIMEOUT_MS,
    });
    pruneDirectoryFiles(outputDir);
  }

  const stat = safeStat(outputPath);
  if (!stat?.isFile()) {
    throw new Error(`Remotion did not produce an image: ${outputPath}`);
  }

  return {
    ok: true,
    renderer: "remotion-cli",
    cached: useCache,
    buildId: manifest.buildId,
    compositionId: composition.id,
    frame,
    scale,
    width: Math.max(1, Math.round((Number(composition.width) || 1920) * scale)),
    height: Math.max(1, Math.round((Number(composition.height) || 1080) * scale)),
    outputPath,
    outputUri: fileUri(outputPath),
    dataUrl: fileDataUrl(outputPath),
    bytes: stat.size,
    renderLog,
    diagnostics: [],
  };
}

function renderStill(input = {}) {
  return {
    status: "completed",
    kind: "remotion-still",
    ...renderFrameWithRemotion(input, {
      kind: "still",
      defaultScale: DEFAULT_STILL_SCALE,
      timeoutMs: REMOTION_RENDER_TIMEOUT_MS,
    }),
  };
}

function renderPreviewFrame(input = {}) {
  return {
    status: "completed",
    kind: "remotion-preview-frame",
    ...renderFrameWithRemotion(input, {
      kind: "preview",
      defaultScale: DEFAULT_PREVIEW_SCALE,
      timeoutMs: REMOTION_RENDER_TIMEOUT_MS,
    }),
  };
}

function renderPreviewClip(input = {}) {
  const { workspacePath, manifest, composition, frame } = compositionForInput(input);
  const detection = detectProject(input);
  if (!detection.entryPoint) throw new Error("Cannot render preview clip because no Remotion entry point was detected.");

  const scale = clampNumber(input.scale, 0.05, 1, DEFAULT_PREVIEW_VIDEO_SCALE);
  const seconds = clampNumber(input.durationSeconds, 2, 12, DEFAULT_PREVIEW_CLIP_SECONDS);
  const fps = Math.max(1, Number(composition.fps) || 30);
  const from = frame;
  const to = Math.max(from, Math.min(
    composition.durationInFrames - 1,
    from + Math.max(1, Math.round(seconds * fps)) - 1,
  ));
  const { outputDir, outputPath } = renderedPreviewClipPath(
    workspacePath,
    composition.id,
    from,
    to,
    scale,
    manifest.buildId,
  );
  const useCache = input.force !== true && fs.existsSync(outputPath);
  let renderLog = null;

  if (!useCache) {
    fs.mkdirSync(outputDir, { recursive: true });
    renderLog = runRemotion(workspacePath, [
      "render",
      detection.entryPoint,
      composition.id,
      outputPath,
      "--overwrite",
      "--scale",
      String(scale),
      `--frames=${from}-${to}`,
    ], {
      timeoutMs: input.timeoutMs || REMOTION_EXPORT_TIMEOUT_MS,
    });
    pruneDirectoryFiles(outputDir, PREVIEW_VIDEO_CACHE_LIMIT);
  }

  const stat = safeStat(outputPath);
  if (!stat?.isFile()) {
    throw new Error(`Remotion did not produce a preview clip: ${outputPath}`);
  }

  return {
    ok: true,
    status: "completed",
    kind: "remotion-preview-clip",
    renderer: "remotion-cli",
    cached: useCache,
    buildId: manifest.buildId,
    compositionId: composition.id,
    from,
    to,
    fps,
    scale,
    width: Math.max(1, Math.round((Number(composition.width) || 1920) * scale)),
    height: Math.max(1, Math.round((Number(composition.height) || 1080) * scale)),
    durationSeconds: (to - from + 1) / fps,
    outputPath,
    outputUri: fileUri(outputPath),
    dataUrl: fileDataUrl(outputPath),
    bytes: stat.size,
    renderLog,
    diagnostics: [],
  };
}

module.exports = {
  renderedFramePath,
  renderedPreviewClipPath,
  renderFrameWithRemotion,
  renderStill,
  renderPreviewFrame,
  renderPreviewClip,
};
