const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeWorkspace, workspacePathOf, relativeToWorkspace, ensureRuntimeDir } = require("./paths");
const { packageInfo, sourceFiles, dependencyVersion, packageManager, safeStat, readJson, writeJsonAtomic, walkFiles } = require("./util");
const { detectRemotionRenderer } = require("./remotion-cli");
const { findRemotionEntry, collectEntryPoints } = require("./source-parse");
const { ASSET_EXTENSIONS, SOURCE_EXTENSIONS } = require("./constants");
const { hasProjectModule, resolvedPackageInfo } = require("./project-deps");
const {
  RUNTIME_SCHEMA_VERSION,
  computeInputPropsRevision,
  computeSourceRevision,
  resolveCompositionManifest,
  rendererVersion,
} = require("./project-runtime");

function isWithinPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function nearestPackageRoot(filePath, workspacePath) {
  const workspaceRoot = path.resolve(workspacePath);
  let current = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? path.resolve(filePath)
    : path.dirname(path.resolve(filePath));

  while (isWithinPath(workspaceRoot, current)) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return workspaceRoot;
}

function packageRootForEntry(entryFile, workspacePath) {
  return entryFile ? nearestPackageRoot(entryFile, workspacePath) : workspacePath;
}

function resolveRequestedEntry(workspacePath, entryPoint) {
  const workspaceRoot = fs.realpathSync(workspacePath);
  const candidate = path.resolve(workspaceRoot, String(entryPoint));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Remotion entry point is not a file: ${entryPoint}`);
  }
  const canonical = fs.realpathSync(candidate);
  if (!isWithinPath(workspaceRoot, canonical)) {
    throw new Error(`Remotion entry point must stay inside the workspace: ${entryPoint}`);
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(canonical).toLowerCase())) {
    throw new Error(`Unsupported Remotion entry point extension: ${entryPoint}`);
  }
  return canonical;
}

function detectProject(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const files = sourceFiles(workspacePath);
  const entryFile = input.entryPoint
    ? resolveRequestedEntry(workspacePath, input.entryPoint)
    : findRemotionEntry(workspacePath, files);
  const projectRoot = packageRootForEntry(entryFile, workspacePath);
  const projectFiles = sourceFiles(projectRoot);
  const pkg = packageInfo(projectRoot);
  const entryPoint = entryFile ? relativeToWorkspace(workspacePath, entryFile) : null;
  const resolvedRemotionPackage = resolvedPackageInfo("remotion", projectRoot, workspacePath);
  const hasRemotionDependency = Boolean(dependencyVersion(pkg, "remotion") || resolvedRemotionPackage?.version);
  const entryPoints = collectEntryPoints(workspacePath, projectFiles, entryPoint);
  const runnableEntryPoints = entryPoints.filter((entry) => entry.source !== "config");
  const requiredModules = ["remotion", "@remotion/bundler", "@remotion/renderer"];
  const missingDependencies = requiredModules.filter((request) => !hasProjectModule(request, projectRoot, workspacePath));
  const hasNodeModules = missingDependencies.length === 0;

  const diagnostics = [];
  if (!entryPoint) diagnostics.push({ level: "error", source: "detectProject", message: "No Remotion entry point found." });
  if (!hasRemotionDependency) diagnostics.push({ level: "warning", source: "package.json", message: "Package does not declare a remotion dependency." });
  if (entryPoint && hasRemotionDependency && !hasNodeModules) diagnostics.push({ level: "warning", source: "node_modules", message: "Dependencies are not installed (node_modules is missing)." });

  const hasRemotionSignal = hasRemotionDependency || entryPoints.length > 0;
  let status;
  if (!hasRemotionSignal && !entryPoint) {
    status = "notFound";
  } else if (!entryPoint || (hasRemotionDependency && !hasNodeModules)) {
    status = "broken";
  } else if (runnableEntryPoints.length > 1 && !input.entryPoint) {
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
    ok: Boolean(entryPoint && hasRemotionDependency && missingDependencies.length === 0),
    status,
    confidence,
    workspacePath,
    projectRoot,
    entryFile,
    projectRootRelative: relativeToWorkspace(workspacePath, projectRoot) || ".",
    projectName: pkg.name || path.basename(workspacePath),
    packageManager: packageManager(projectRoot, workspacePath),
    entryPoint,
    selectedEntryPoint: entryPoint,
    entryPoints,
    rootFile: entryPoint,
    remotionVersion: dependencyVersion(pkg, "remotion") || resolvedRemotionPackage?.version || null,
    renderer: detectRemotionRenderer(projectRoot, workspacePath),
    hasNodeModules,
    missingDependencies,
    sourceFileCount: projectFiles.length,
    diagnostics,
    errorSummary,
  };
}

async function buildManifest(input = {}, detection = detectProject(input)) {
  if (!detection.ok || !detection.entryFile) {
    throw new Error(detection.errorSummary || "No runnable Remotion project was detected.");
  }
  return resolveCompositionManifest(detection, input);
}

async function compileProject(input = {}) {
  const detection = detectProject(input);
  const workspacePath = detection.workspacePath;
  const manifest = await buildManifest(input, detection);
  const assets = indexAssetsForDetection(detection).assets;
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
  writeJsonAtomic(path.join(ensureRuntimeDir(workspacePath), "engine-state.json"), output);
  return output;
}

async function getCompositionManifest(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const statePath = path.join(ensureRuntimeDir(workspacePath), "engine-state.json");
  const state = readJson(statePath, null);
  const project = detectProject(input);
  if (!project.entryFile) throw new Error(project.errorSummary || "No runnable Remotion project was detected.");
  const inputProps = input.inputProps && typeof input.inputProps === "object" ? input.inputProps : null;
  const currentRevision = computeSourceRevision(project);
  const currentInputPropsRevision = computeInputPropsRevision(inputProps);
  if (
    input.force !== true
      && state?.manifest?.schemaVersion === RUNTIME_SCHEMA_VERSION
      && state.manifest.sourceRevision === currentRevision
      && state.manifest.inputPropsRevision === currentInputPropsRevision
  ) {
    return { ok: true, manifest: state.manifest, project };
  }
  const manifest = await resolveCompositionManifest(project, input);
  writeJsonAtomic(statePath, {
    ...(state && typeof state === "object" ? state : {}),
    ok: manifest.compositions.length > 0,
    buildId: manifest.buildId,
    project,
    renderer: project.renderer,
    manifest,
    diagnostics: project.diagnostics || [],
  });
  return { ok: true, manifest, project };
}

async function getFrameDescriptor(input = {}) {
  const { manifest, composition, frame } = await compositionForInput(input);
  return {
    ok: true,
    compositionId: composition.id,
    frame,
    timeSeconds: frame / composition.fps,
    projectRevision: manifest.projectRevision || manifest.sourceRevision,
    descriptorRevision: composition.descriptorRevision || manifest.descriptorRevision,
    frameState: "descriptor-only",
    composition,
    sequences: [],
    activeSequences: [],
    layers: [],
    contextSource: "project-descriptor",
    diagnostics: [],
  };
}

function indexAssetsForDetection(detection) {
  const workspacePath = detection.workspacePath;
  const assets = walkFiles(detection.projectRoot || workspacePath, {
    maxFiles: 8000,
    include: (filePath) => ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
  })
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

function indexAssets(input = {}) {
  return indexAssetsForDetection(detectProject(input));
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

async function compositionForInput(input = {}) {
  const workspacePath = normalizeWorkspace(workspacePathOf(input));
  const statePath = path.join(ensureRuntimeDir(workspacePath), "engine-state.json");
  const state = readJson(statePath, null);
  const manifest = state?.manifest;
  if (manifest?.schemaVersion !== RUNTIME_SCHEMA_VERSION || !manifest.sourceRevision || !manifest.inputPropsRevision) {
    throw new Error("No resolved Remotion snapshot is available. Compile the project before running a snapshot-bound operation.");
  }

  const project = detectProject({
    ...input,
    entryPoint: input.entryPoint || manifest.entryPoint,
  });
  if (!project.ok || !project.entryFile) {
    throw new Error(project.errorSummary || "The resolved Remotion snapshot no longer has a runnable project entry point.");
  }
  const inputProps = input.inputProps && typeof input.inputProps === "object" ? input.inputProps : null;
  const currentProjectRevision = computeSourceRevision(project);
  if (currentProjectRevision !== manifest.sourceRevision) {
    throw new Error(
      `Stale Remotion source snapshot. snapshot=${manifest.sourceRevision}, current=${currentProjectRevision}. Compile the project again.`,
    );
  }
  const currentInputPropsRevision = computeInputPropsRevision(inputProps);
  if (currentInputPropsRevision !== manifest.inputPropsRevision) {
    throw new Error(
      `Stale Remotion input snapshot. snapshot=${manifest.inputPropsRevision}, current=${currentInputPropsRevision}. Compile the project again with the intended input props.`,
    );
  }

  const projectRoot = project.projectRoot || workspacePath;
  const compositionId = String(input.compositionId || "").trim() || manifest.compositions[0]?.id;
  const composition = manifest.compositions.find((item) => item.id === compositionId);
  if (!composition) throw new Error(`Composition not found: ${compositionId || "(none)"}`);
  const projectRevision = manifest.projectRevision || manifest.sourceRevision;
  const descriptorRevision = composition.descriptorRevision || manifest.descriptorRevision;
  const expectedProjectRevision = String(input.expectedProjectRevision || "").trim();
  const expectedDescriptorRevision = String(input.expectedDescriptorRevision || "").trim();
  if (!expectedProjectRevision || !expectedDescriptorRevision) {
    throw new Error("expectedProjectRevision and expectedDescriptorRevision are required for a snapshot-bound Remotion operation.");
  }
  if (expectedProjectRevision !== projectRevision || expectedDescriptorRevision !== descriptorRevision) {
    throw new Error(
      `Stale Remotion snapshot. expected=${expectedProjectRevision}/${expectedDescriptorRevision}, current=${projectRevision}/${descriptorRevision}`,
    );
  }
  const frame = Math.max(0, Math.min(Math.round(Number(input.frame) || 0), composition.durationInFrames - 1));
  return {
    workspacePath,
    projectRoot,
    manifest,
    composition,
    frame,
    rendererVersion: rendererVersion(project),
  };
}

module.exports = {
  detectProject,
  buildManifest,
  compileProject,
  getCompositionManifest,
  getFrameDescriptor,
  indexAssets,
  gitChanges,
  readDiagnostics,
  compositionForInput,
};
