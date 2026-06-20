const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeWorkspace, workspacePathOf, relativeToWorkspace, ensureRuntimeDir } = require("./paths");
const { packageInfo, sourceFiles, dependencyVersion, readText, packageManager, hashContent, safeStat, readJson, writeJson, walkFiles } = require("./util");
const { detectRemotionRenderer } = require("./remotion-cli");
const { findRemotionEntry, collectEntryPoints, parseCompositionBlocks, parseTextSnippets } = require("./source-parse");
const { ASSET_EXTENSIONS } = require("./constants");
const { emitStatus } = require("./protocol");

function detectProject(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const pkg = packageInfo(workspacePath);
  const files = sourceFiles(workspacePath);
  const entryFile = input.entryPoint
    ? path.resolve(workspacePath, input.entryPoint)
    : findRemotionEntry(workspacePath, files);
  const entryPoint = entryFile ? relativeToWorkspace(workspacePath, entryFile) : null;
  const hasRemotionDependency = Boolean(dependencyVersion(pkg, "remotion"));
  const hasCompositions = files.some((filePath) => readText(filePath).includes("<Composition"));
  const entryPoints = collectEntryPoints(workspacePath, files, entryPoint);
  const hasNodeModules = fs.existsSync(path.join(workspacePath, "node_modules"));
  const missingDependencies = hasRemotionDependency ? [] : ["remotion"];

  const diagnostics = [];
  if (!entryPoint) diagnostics.push({ level: "error", source: "detectProject", message: "No Remotion entry point found." });
  if (!hasRemotionDependency) diagnostics.push({ level: "warning", source: "package.json", message: "Package does not declare a remotion dependency." });
  if (!hasCompositions) diagnostics.push({ level: "warning", source: "source", message: "No <Composition> declarations found." });
  if (entryPoint && hasRemotionDependency && !hasNodeModules) diagnostics.push({ level: "warning", source: "node_modules", message: "Dependencies are not installed (node_modules is missing)." });

  const hasRemotionSignal = hasRemotionDependency || hasCompositions || entryPoints.length > 0;
  let status;
  if (!hasRemotionSignal && !entryPoint) {
    status = "notFound";
  } else if (!entryPoint || (hasRemotionDependency && !hasNodeModules)) {
    status = "broken";
  } else if (entryPoints.length > 1 && !input.entryPoint) {
    status = "ambiguous";
  } else {
    status = "matched";
  }
  const confidence = status === "matched" ? 0.9
    : status === "ambiguous" ? 0.6
    : status === "broken" ? 0.3
    : 0;
  const errorSummary = status === "broken"
    ? (!entryPoint
        ? "Recognized Remotion sources but no usable entry point."
        : "Remotion dependencies are not installed. Install dependencies to preview.")
    : status === "notFound"
    ? "This workspace does not look like a Remotion project."
    : null;

  return {
    ok: Boolean(entryPoint && (hasRemotionDependency || hasCompositions)),
    status,
    confidence,
    workspacePath,
    projectName: pkg.name || path.basename(workspacePath),
    packageManager: packageManager(workspacePath),
    entryPoint,
    selectedEntryPoint: entryPoint,
    entryPoints,
    rootFile: entryPoint,
    remotionVersion: dependencyVersion(pkg, "remotion") || null,
    renderer: detectRemotionRenderer(workspacePath),
    hasNodeModules,
    missingDependencies,
    sourceFileCount: files.length,
    diagnostics,
    errorSummary,
  };
}

function buildManifest(input = {}) {
  const detection = detectProject(input);
  const workspacePath = detection.workspacePath;
  const files = sourceFiles(workspacePath);
  const compositions = parseCompositionBlocks(workspacePath, files);
  return {
    schemaVersion: 1,
    engine: "sparo-video-engine",
    buildId: hashContent(JSON.stringify({
      workspacePath,
      entryPoint: detection.entryPoint,
      files: files.map((filePath) => `${relativeToWorkspace(workspacePath, filePath)}:${safeStat(filePath)?.mtimeMs || 0}`),
    })),
    generatedAt: Date.now(),
    compositions,
  };
}

function compileProject(input = {}) {
  emitStatus("Compiling Remotion project with Sparo Video Engine.");
  const detection = detectProject(input);
  const workspacePath = detection.workspacePath;
  const manifest = buildManifest(input);
  const assets = indexAssets(input).assets;
  const diagnostics = [
    ...detection.diagnostics,
    ...(manifest.compositions.length ? [] : [{ level: "error", source: "compileProject", message: "No compositions were found." }]),
  ];
  const changes = gitChanges(workspacePath);
  const output = {
    ok: manifest.compositions.length > 0,
    buildId: manifest.buildId,
    project: detection,
    renderer: detection.renderer,
    manifest,
    assets,
    diagnostics,
    changes,
  };
  writeJson(path.join(ensureRuntimeDir(workspacePath), "engine-state.json"), output);
  return output;
}

function getCompositionManifest(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const statePath = path.join(ensureRuntimeDir(workspacePath), "engine-state.json");
  const state = readJson(statePath, null);
  if (state?.manifest) return { ok: true, manifest: state.manifest, project: state.project };
  return { ok: true, manifest: buildManifest(input), project: detectProject(input) };
}

function colorForIndex(index) {
  return ["#5dc6ff", "#f4c542", "#8de16d", "#ff7a90", "#b99cff", "#63dbc6"][index % 6];
}

function visualElementsForComposition(workspacePath, composition) {
  const componentPath = composition?.componentPath ? path.join(workspacePath, composition.componentPath) : null;
  if (!componentPath || !fs.existsSync(componentPath)) return [];
  const source = readText(componentPath);
  const snippets = parseTextSnippets(source);
  const tagMatches = [...source.matchAll(/<(Img|Video|OffthreadVideo|Audio|svg|canvas|AbsoluteFill|div|h1|h2|p|span)\b/g)]
    .map((match) => match[1])
    .slice(0, 12);
  const tags = tagMatches.length ? tagMatches : ["Composition"];
  return tags.map((tag, index) => ({
    id: `element-${index + 1}`,
    type: tag,
    label: snippets[index] || tag,
    sourceHint: composition.componentPath || null,
    componentPath: composition.componentPath || null,
    x: 8 + (index % 3) * 8,
    y: 10 + index * 6,
    width: Math.max(18, 78 - (index % 4) * 10),
    height: tag === "Audio" ? 8 : Math.max(10, 26 - (index % 3) * 4),
    color: colorForIndex(index),
    opacity: tag === "Audio" ? 0.42 : 0.78,
  }));
}

function evaluateFrame(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  const frame = Math.max(0, Math.min(Number(input.frame) || 0, composition.durationInFrames - 1));
  const activeSequences = composition.sequences.filter((sequence) => {
    const from = Number(sequence.from) || 0;
    const duration = Number(sequence.duration) || composition.durationInFrames;
    return frame >= from && frame < from + duration;
  });
  const visualElements = visualElementsForComposition(workspacePath, composition);
  const sequenceLayers = activeSequences.map((sequence, index) => ({
    id: sequence.id,
    type: "Sequence",
    label: sequence.label,
    sourceHint: composition.componentPath || null,
    componentPath: composition.componentPath || null,
    from: sequence.from,
    duration: sequence.duration,
    x: 6 + index * 4,
    y: 8 + index * 8,
    width: Math.max(20, 86 - index * 9),
    height: 13,
    color: colorForIndex(index),
    opacity: 0.62,
  }));
  const layers = sequenceLayers.length ? sequenceLayers : visualElements;
  return {
    ok: true,
    compositionId: composition.id,
    frame,
    timeSeconds: frame / composition.fps,
    composition,
    sequences: composition.sequences,
    activeSequences,
    layers,
    diagnostics: [],
  };
}

function indexAssets(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const files = walkFiles(workspacePath, { maxFiles: 8000 });
  const assets = files
    .map((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const type = ASSET_EXTENSIONS.get(ext);
      if (!type) return null;
      const stat = safeStat(filePath);
      return {
        type,
        name: path.basename(filePath),
        path: relativeToWorkspace(workspacePath, filePath),
        bytes: stat?.size || 0,
      };
    })
    .filter(Boolean)
    .slice(0, 500);
  return { ok: true, assets, truncated: assets.length >= 500 };
}

function gitChanges(workspacePath) {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "changed",
      path: line.slice(3).trim(),
    }));
}

function readDiagnostics(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const state = readJson(path.join(ensureRuntimeDir(workspacePath), "engine-state.json"), null);
  return {
    ok: true,
    diagnostics: state?.diagnostics || detectProject(input).diagnostics,
    changes: gitChanges(workspacePath),
  };
}

function compositionForInput(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const manifest = getCompositionManifest(input).manifest;
  const compositionId = String(input.compositionId || input.composition || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  const frame = Math.max(0, Math.min(Math.round(Number(input.frame) || 0), composition.durationInFrames - 1));
  return { workspacePath, manifest, composition, frame };
}

module.exports = {
  detectProject,
  buildManifest,
  compileProject,
  getCompositionManifest,
  colorForIndex,
  visualElementsForComposition,
  evaluateFrame,
  indexAssets,
  gitChanges,
  readDiagnostics,
  compositionForInput,
};
