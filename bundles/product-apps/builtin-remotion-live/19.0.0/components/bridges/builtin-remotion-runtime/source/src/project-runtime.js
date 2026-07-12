const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ensureRuntimeDir, relativeToWorkspace } = require("./paths");
const { PROJECT_REVISION_EXTENSIONS, PROJECT_BUNDLE_CACHE_LIMIT } = require("./constants");
const { walkFiles, safeStat, readJson, writeJsonAtomic, stableJson } = require("./util");
const { requireProjectModule, resolvedPackageInfo } = require("./project-deps");
const { emitStatus } = require("./protocol");

const RUNTIME_SCHEMA_VERSION = 3;
const STALE_BUNDLE_PIN_MS = 24 * 60 * 60 * 1000;
const revisionFileCache = new Map();
const bundleFlights = new Map();
const manifestFlights = new Map();

const REVISION_FILENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.json",
]);

function isRevisionFile(filePath, projectRoot) {
  const relative = path.relative(projectRoot, filePath);
  const segments = relative.split(path.sep);
  if (segments[0] === "public") return true;
  if (REVISION_FILENAMES.has(path.basename(filePath).toLowerCase())) return true;
  return PROJECT_REVISION_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function digestFile(filePath, stat) {
  const cacheKey = path.resolve(filePath);
  const cached = revisionFileCache.get(cacheKey);
  if (
    stat.size >= 1024 * 1024
      && cached
      && cached.size === stat.size
      && cached.mtimeMs === stat.mtimeMs
      && cached.ctimeMs === stat.ctimeMs
  ) {
    return cached.digest;
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  revisionFileCache.set(cacheKey, { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, digest });
  return digest;
}

function computeSourceRevision(detection) {
  const projectRoot = path.resolve(detection.projectRoot);
  const files = walkFiles(projectRoot, {
    maxFiles: Number.POSITIVE_INFINITY,
    include: (filePath) => isRevisionFile(filePath, projectRoot),
  })
    .sort((a, b) => a.localeCompare(b));
  const hash = crypto.createHash("sha256");
  hash.update(`sparo-remotion-runtime:${RUNTIME_SCHEMA_VERSION}\n`);
  hash.update(`entry:${path.resolve(detection.entryFile)}\n`);
  hash.update(`remotion:${detection.remotionVersion || "unknown"}\n`);
  for (const filePath of files) {
    const stat = safeStat(filePath);
    if (!stat?.isFile()) continue;
    const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    hash.update(`${relative}\0${stat.size}\0${digestFile(filePath, stat)}\n`);
  }
  return hash.digest("hex").slice(0, 24);
}

function computeInputPropsRevision(inputProps = null) {
  return crypto.createHash("sha256")
    .update(`sparo-remotion-input:${RUNTIME_SCHEMA_VERSION}\n${stableJson(inputProps || {})}`)
    .digest("hex")
    .slice(0, 24);
}

function bundleRoot(workspacePath) {
  return ensureRuntimeDir(workspacePath, "bundles");
}

function bundleMarkerPath(bundlePath) {
  return path.join(bundlePath, ".sparo-bundle.json");
}

function bundlePinPath(bundlePath, ownerId) {
  const safeOwner = String(ownerId).replace(/[^a-z0-9._-]+/gi, "-");
  return path.join(bundlePath, `.sparo-pin-${safeOwner}.json`);
}

function pinProjectBundle(bundlePath, ownerId) {
  const pinPath = bundlePinPath(bundlePath, ownerId);
  writeJsonAtomic(pinPath, { ownerId, pinnedAt: Date.now() });
  return pinPath;
}

function unpinProjectBundle(pinPath) {
  if (pinPath) fs.rmSync(pinPath, { force: true });
}

function hasLiveBundlePin(bundlePath) {
  const now = Date.now();
  const pins = fs.readdirSync(bundlePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(".sparo-pin-"));
  let live = false;
  for (const pin of pins) {
    const pinPath = path.join(bundlePath, pin.name);
    const pinnedAt = Number(readJson(pinPath, null)?.pinnedAt) || safeStat(pinPath)?.mtimeMs || 0;
    if (now - pinnedAt <= STALE_BUNDLE_PIN_MS) live = true;
    else fs.rmSync(pinPath, { force: true });
  }
  return live;
}

function reusableBundle(bundlePath, sourceRevision, entryPoint) {
  const marker = readJson(bundleMarkerPath(bundlePath), null);
  return Boolean(
    marker?.sourceRevision === sourceRevision
      && marker?.entryPoint === entryPoint
      && fs.existsSync(path.join(bundlePath, "index.html")),
  );
}

function pruneBundleCache(workspacePath, activeBundlePath) {
  const root = bundleRoot(workspacePath);
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes(".building-"))
    .map((entry) => {
      const directory = path.join(root, entry.name);
      return { directory, mtimeMs: safeStat(directory)?.mtimeMs || 0 };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const retained = new Set([path.resolve(activeBundlePath)]);
  for (const item of directories) {
    if (hasLiveBundlePin(item.directory)) retained.add(path.resolve(item.directory));
  }
  for (const item of directories) {
    if (retained.size < PROJECT_BUNDLE_CACHE_LIMIT) retained.add(path.resolve(item.directory));
  }
  for (const item of directories) {
    if (!retained.has(path.resolve(item.directory))) {
      fs.rmSync(item.directory, { recursive: true, force: true });
    }
  }
}

async function ensureProjectBundle(detection, sourceRevision) {
  const workspacePath = detection.workspacePath;
  const entryPoint = relativeToWorkspace(workspacePath, detection.entryFile);
  const finalPath = path.join(bundleRoot(workspacePath), sourceRevision);
  if (reusableBundle(finalPath, sourceRevision, entryPoint)) return finalPath;

  const flightKey = `${workspacePath}:${sourceRevision}`;
  const existing = bundleFlights.get(flightKey);
  if (existing) return existing;

  const flight = (async () => {
    const { bundle } = requireProjectModule("@remotion/bundler", detection.projectRoot, workspacePath);
    if (typeof bundle !== "function") {
      throw new Error("The project @remotion/bundler package does not expose bundle().");
    }
    const temporaryPath = `${finalPath}.building-${process.pid}-${Date.now()}`;
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    emitStatus("Bundling the Remotion Root.", "bundling");
    try {
      await bundle({
        entryPoint: detection.entryFile,
        outDir: temporaryPath,
        rootDir: detection.projectRoot,
        publicDir: fs.existsSync(path.join(detection.projectRoot, "public"))
          ? path.join(detection.projectRoot, "public")
          : null,
        enableCaching: true,
        onProgress: (progress) => {
          const percent = Math.max(0, Math.min(100, Math.round(Number(progress) * 100)));
          emitStatus(`Bundling the Remotion Root (${percent}%).`, "bundling");
        },
      });
      writeJsonAtomic(bundleMarkerPath(temporaryPath), {
        schemaVersion: RUNTIME_SCHEMA_VERSION,
        sourceRevision,
        entryPoint,
        generatedAt: Date.now(),
      });
      fs.rmSync(finalPath, { recursive: true, force: true });
      fs.renameSync(temporaryPath, finalPath);
      pruneBundleCache(workspacePath, finalPath);
      return finalPath;
    } catch (error) {
      fs.rmSync(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  })().finally(() => bundleFlights.delete(flightKey));

  bundleFlights.set(flightKey, flight);
  return flight;
}

function jsonView(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonView(item, seen));
  if (value instanceof Map) return Object.fromEntries(Array.from(value.entries(), ([key, item]) => [String(key), jsonView(item, seen)]));
  if (value instanceof Set) return Array.from(value, (item) => jsonView(item, seen));
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) output[key] = jsonView(item, seen);
  seen.delete(value);
  return output;
}

function serializeProps(noReact, props) {
  return noReact.NoReactInternals.serializeJSONWithSpecialTypes({
    data: props || {},
    indent: undefined,
    staticBase: null,
  }).serializedString;
}

function normalizeComposition(config, noReact, workspacePath, entryFile, sourceRevision) {
  const resolvedProps = config.props || {};
  const defaultProps = config.defaultProps || {};
  const serializedDefaultProps = serializeProps(noReact, defaultProps);
  const serializedResolvedProps = serializeProps(noReact, resolvedProps);
  const width = Number(config.width);
  const height = Number(config.height);
  const fps = Number(config.fps);
  const durationInFrames = Math.max(1, Math.round(Number(config.durationInFrames)));
  const defaults = {
    codec: config.defaultCodec || null,
    outName: config.defaultOutName || null,
    videoImageFormat: config.defaultVideoImageFormat || null,
    pixelFormat: config.defaultPixelFormat || null,
    proResProfile: config.defaultProResProfile || null,
    sampleRate: config.defaultSampleRate || null,
  };
  const descriptorRevision = crypto.createHash("sha256").update(stableJson({
    sourceRevision,
    id: String(config.id),
    width,
    height,
    fps,
    durationInFrames,
    serializedDefaultProps,
    serializedResolvedProps,
    defaults,
  })).digest("hex").slice(0, 24);
  return {
    id: String(config.id),
    descriptorRevision,
    width,
    height,
    fps,
    durationInFrames,
    defaultProps: jsonView(defaultProps),
    resolvedProps: jsonView(resolvedProps),
    serializedDefaultProps,
    serializedResolvedProps,
    defaults,
    sourcePath: relativeToWorkspace(workspacePath, entryFile),
  };
}

function resolvedBuildId(sourceRevision, descriptorRevision) {
  return crypto.createHash("sha256")
    .update(`${sourceRevision}:${descriptorRevision}`)
    .digest("hex")
    .slice(0, 24);
}

async function resolveCompositionManifest(detection, input = {}) {
  const inputProps = input.inputProps && typeof input.inputProps === "object" ? input.inputProps : null;
  const sourceRevision = computeSourceRevision(detection);
  const inputPropsRevision = computeInputPropsRevision(inputProps);
  const flightKey = `${detection.workspacePath}:${sourceRevision}:${inputPropsRevision}`;
  const existingFlight = manifestFlights.get(flightKey);
  if (existingFlight && input.force !== true) return existingFlight;

  const materialize = async () => {
    const bundlePath = await ensureProjectBundle(detection, sourceRevision);
    const renderer = requireProjectModule("@remotion/renderer", detection.projectRoot, detection.workspacePath);
    const noReact = requireProjectModule("remotion/no-react", detection.projectRoot, detection.workspacePath);
    if (
      typeof renderer.getCompositions !== "function"
        || typeof renderer.selectComposition !== "function"
        || typeof renderer.openBrowser !== "function"
    ) {
      throw new Error("The project @remotion/renderer package must expose openBrowser(), getCompositions(), and selectComposition().");
    }

    emitStatus("Evaluating the registered Remotion compositions.", "resolving-metadata");
    const browser = await renderer.openBrowser("chrome", { logLevel: "warn" });
    const compositions = [];
    try {
      const baseCompositions = await renderer.getCompositions(bundlePath, {
        ...(inputProps ? { inputProps } : {}),
        puppeteerInstance: browser,
        logLevel: "warn",
        timeoutInMilliseconds: 60_000,
      });
      for (const base of baseCompositions) {
        const resolved = await renderer.selectComposition({
          serveUrl: bundlePath,
          id: base.id,
          ...(inputProps ? { inputProps } : {}),
          puppeteerInstance: browser,
          logLevel: "warn",
          timeoutInMilliseconds: 60_000,
        });
        compositions.push(normalizeComposition(
          resolved,
          noReact,
          detection.workspacePath,
          detection.entryFile,
          sourceRevision,
        ));
      }
    } finally {
      await browser.close({ silent: true });
    }

    const descriptorRevision = crypto.createHash("sha256")
      .update(compositions.map((composition) => composition.descriptorRevision).join(":"))
      .digest("hex")
      .slice(0, 24);
    const buildId = resolvedBuildId(sourceRevision, descriptorRevision);
    return {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      engine: "sparo-video-engine",
      sourceRevision,
      projectRevision: sourceRevision,
      inputPropsRevision,
      descriptorRevision,
      buildId,
      generatedAt: Date.now(),
      entryPoint: relativeToWorkspace(detection.workspacePath, detection.entryFile),
      projectRootRelative: relativeToWorkspace(detection.workspacePath, detection.projectRoot) || ".",
      bundlePath,
      compositions,
    };
  };
  const flight = (existingFlight && input.force === true
    ? existingFlight.catch(() => null).then(materialize)
    : materialize()
  ).finally(() => {
    if (manifestFlights.get(flightKey) === flight) manifestFlights.delete(flightKey);
  });
  manifestFlights.set(flightKey, flight);
  return flight;
}

function rendererVersion(detection) {
  return resolvedPackageInfo("@remotion/renderer", detection.projectRoot, detection.workspacePath)?.version || null;
}

function deserializeCompositionProps(composition, projectRoot, workspacePath) {
  if (!composition?.serializedResolvedProps) return composition?.resolvedProps || {};
  const noReact = requireProjectModule("remotion/no-react", projectRoot, workspacePath);
  return noReact.NoReactInternals.deserializeJSONWithSpecialTypes(composition.serializedResolvedProps);
}

function toRemotionVideoConfig(composition, projectRoot, workspacePath) {
  return {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
    defaultProps: composition.defaultProps || {},
    props: deserializeCompositionProps(composition, projectRoot, workspacePath),
    defaultCodec: composition.defaults?.codec || null,
    defaultOutName: composition.defaults?.outName || null,
    defaultVideoImageFormat: composition.defaults?.videoImageFormat || null,
    defaultPixelFormat: composition.defaults?.pixelFormat || null,
    defaultProResProfile: composition.defaults?.proResProfile || null,
    defaultSampleRate: composition.defaults?.sampleRate || null,
  };
}

module.exports = {
  RUNTIME_SCHEMA_VERSION,
  computeSourceRevision,
  computeInputPropsRevision,
  resolvedBuildId,
  ensureProjectBundle,
  resolveCompositionManifest,
  rendererVersion,
  deserializeCompositionProps,
  toRemotionVideoConfig,
  pinProjectBundle,
  unpinProjectBundle,
};
