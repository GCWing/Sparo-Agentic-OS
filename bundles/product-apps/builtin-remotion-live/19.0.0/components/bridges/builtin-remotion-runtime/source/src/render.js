const fs = require("node:fs");
const path = require("node:path");
const { safeFilePart, clampNumber, safeStat } = require("./util");
const { compositionForInput } = require("./project");
const { requireProjectModule } = require("./project-deps");
const { deserializeCompositionProps, toRemotionVideoConfig, pinProjectBundle, unpinProjectBundle } = require("./project-runtime");
const { artifactDirectory, describeArtifact, pruneArtifactCache } = require("./artifacts");
const { DEFAULT_STILL_SCALE, REMOTION_RENDER_TIMEOUT_MS } = require("./constants");

function renderedFramePath(workspacePath, compositionId, frame, scale, buildId) {
  const scalePart = String(scale).replace(/[^0-9.]+/g, "").replace(".", "p") || "1";
  const outputDir = artifactDirectory(workspacePath, "stills");
  const outputPath = path.join(
    outputDir,
    `${safeFilePart(compositionId)}-frame-${frame}-scale-${scalePart}-${safeFilePart(buildId)}.png`,
  );
  return { outputDir, outputPath };
}

async function renderStill(input = {}) {
  const { workspacePath, projectRoot, manifest, composition, frame, rendererVersion } = await compositionForInput(input);
  const scale = clampNumber(input.scale, 0.05, 1, DEFAULT_STILL_SCALE);
  const { outputDir, outputPath } = renderedFramePath(
    workspacePath,
    composition.id,
    frame,
    scale,
    manifest.buildId,
  );
  const useCache = input.force !== true && fs.existsSync(outputPath);
  let contentType = "image/png";

  if (!useCache) {
    fs.mkdirSync(outputDir, { recursive: true });
    const renderer = requireProjectModule("@remotion/renderer", projectRoot, workspacePath);
    if (typeof renderer.renderStill !== "function") {
      throw new Error("The project @remotion/renderer package does not expose renderStill().");
    }
    const bundlePinPath = pinProjectBundle(
      manifest.bundlePath,
      `still-${process.pid}-${composition.id}-${frame}-${Date.now()}`,
    );
    try {
      const result = await renderer.renderStill({
        serveUrl: manifest.bundlePath,
        composition: toRemotionVideoConfig(composition, projectRoot, workspacePath),
        inputProps: deserializeCompositionProps(composition, projectRoot, workspacePath),
        output: outputPath,
        frame,
        scale,
        imageFormat: "png",
        overwrite: true,
        logLevel: "warn",
        timeoutInMilliseconds: REMOTION_RENDER_TIMEOUT_MS,
      });
      contentType = result?.contentType || contentType;
    } catch (error) {
      fs.rmSync(outputPath, { force: true });
      throw error;
    } finally {
      unpinProjectBundle(bundlePinPath);
    }
  }

  const stat = safeStat(outputPath);
  if (!stat?.isFile()) throw new Error(`Remotion did not produce an image: ${outputPath}`);
  pruneArtifactCache(workspacePath, outputPath);

  return {
    status: "completed",
    kind: "remotion-still",
    ok: true,
    renderer: "@remotion/renderer",
    rendererVersion,
    cached: useCache,
    sourceRevision: manifest.sourceRevision,
    projectRevision: manifest.projectRevision || manifest.sourceRevision,
    descriptorRevision: composition.descriptorRevision || manifest.descriptorRevision,
    compositionId: composition.id,
    frame,
    scale,
    width: Math.max(1, Math.round(Number(composition.width) * scale)),
    height: Math.max(1, Math.round(Number(composition.height) * scale)),
    contentType,
    ...describeArtifact(workspacePath, outputPath),
    diagnostics: [],
  };
}

module.exports = {
  renderStill,
};
