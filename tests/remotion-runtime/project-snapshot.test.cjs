const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runtimeRoot = path.resolve(
  __dirname,
  "../../bundles/product-apps/builtin-remotion-live/19.0.0/components/bridges/builtin-remotion-runtime/source/src",
);
const surfaceRoot = path.resolve(
  __dirname,
  "../../bundles/product-apps/builtin-remotion-live/19.0.0/components/surfaces/builtin-remotion-live-surface/source/src",
);
const {
  computeInputPropsRevision,
  computeSourceRevision,
  resolvedBuildId,
  resolveCompositionManifest,
} = require(path.join(runtimeRoot, "project-runtime.js"));
const {
  playerHostBundleId,
  ensurePlayerHostServerScript,
  playerHostWebpackEntries,
  writePlayerHostEntry,
} = require(path.join(runtimeRoot, "player-host.js"));
const {
  compileProject,
  compositionForInput,
  detectProject,
  getCompositionManifest,
} = require(path.join(runtimeRoot, "project.js"));
const { cancelExport, getExportStatus, runsPath } = require(path.join(runtimeRoot, "export.js"));
const { emitStatus, runWithRequestContext } = require(path.join(runtimeRoot, "protocol.js"));
const { findFreePort, waitForHttp } = require(path.join(runtimeRoot, "util.js"));

function writeFixturePackage(projectRoot, packageName, source, extra = {}) {
  const packageRoot = path.join(projectRoot, "node_modules", ...packageName.split("/"));
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: packageName, version: "1.0.0", main: "index.js" }),
  );
  fs.writeFileSync(path.join(packageRoot, "index.js"), source);
  for (const [relativePath, content] of Object.entries(extra)) {
    fs.writeFileSync(path.join(packageRoot, relativePath), content);
  }
}

async function waitUntil(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

test("imported binary changes invalidate the project revision", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-revision-"));
  try {
    const entryFile = path.join(projectRoot, "index.tsx");
    const imageFile = path.join(projectRoot, "logo.png");
    fs.writeFileSync(entryFile, 'import "./logo.png";\n');
    fs.writeFileSync(imageFile, Buffer.from([1, 2, 3]));
    const detection = { projectRoot, workspacePath: projectRoot, entryFile, remotionVersion: "test" };
    const before = computeSourceRevision(detection);
    fs.writeFileSync(imageFile, Buffer.from([1, 2, 4]));
    const after = computeSourceRevision(detection);
    assert.notEqual(after, before);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("dynamic descriptor changes invalidate the resolved build and Player bundle", () => {
  const sourceRevision = "same-source";
  const firstBuild = resolvedBuildId(sourceRevision, "descriptor-a");
  const secondBuild = resolvedBuildId(sourceRevision, "descriptor-b");
  assert.notEqual(firstBuild, secondBuild);
  assert.notEqual(
    playerHostBundleId({ buildId: firstBuild, entryPoint: "src/index.ts" }),
    playerHostBundleId({ buildId: secondBuild, entryPoint: "src/index.ts" }),
  );
});

test("snapshot-bound operations keep resolved calculateMetadata output until an explicit compile refresh", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-dynamic-metadata-"));
  const metadataEnvironmentKey = `SPARO_REMOTION_TEST_METADATA_${process.pid}_${Date.now()}`;
  try {
    fs.writeFileSync(path.join(projectRoot, "index.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: {
          remotion: "1.0.0",
          "@remotion/bundler": "1.0.0",
          "@remotion/renderer": "1.0.0",
        },
      }),
    );
    writeFixturePackage(
      projectRoot,
      "@remotion/bundler",
      `const fs = require("node:fs");\nconst path = require("node:path");\nexports.bundle = async ({outDir}) => { fs.mkdirSync(outDir, {recursive: true}); fs.writeFileSync(path.join(outDir, "index.html"), "ok"); };\n`,
    );
    writeFixturePackage(
      projectRoot,
      "@remotion/renderer",
      `const metadata = () => JSON.parse(process.env[${JSON.stringify(metadataEnvironmentKey)}]);
exports.openBrowser = async () => ({close: async () => {}});
exports.getCompositions = async () => [{id: "Main"}];
exports.selectComposition = async ({inputProps}) => ({
  id: "Main", width: 1920, height: 1080, fps: 30, durationInFrames: 90,
  defaultProps: {videoId: "stable"}, props: {videoId: "stable", variant: inputProps?.variant || null},
  defaultCodec: metadata().codec, defaultOutName: metadata().outName,
});\n`,
    );
    writeFixturePackage(
      projectRoot,
      "remotion",
      "module.exports = {};\n",
      {
        "no-react.js": `exports.NoReactInternals = {
  serializeJSONWithSpecialTypes: ({data}) => ({serializedString: JSON.stringify(data)}),
  deserializeJSONWithSpecialTypes: (value) => JSON.parse(value),
};\n`,
      },
    );

    process.env[metadataEnvironmentKey] = JSON.stringify({ codec: "h264", outName: "first" });
    const detection = detectProject({ workspacePath: projectRoot, entryPoint: "index.ts" });
    assert.equal(detection.ok, true);
    const initialOutput = await runWithRequestContext(
      { bridgeId: "test-bridge", runId: "dynamic-metadata-initial" },
      () => compileProject({ workspacePath: projectRoot, entryPoint: "index.ts" }),
    );
    const initial = initialOutput.manifest;

    process.env[metadataEnvironmentKey] = JSON.stringify({ codec: "vp9", outName: "second" });
    const cached = await getCompositionManifest({ workspacePath: projectRoot, entryPoint: "index.ts" });
    assert.equal(cached.manifest.compositions[0].defaults.codec, "h264");
    assert.equal(cached.manifest.descriptorRevision, initial.descriptorRevision);
    const selected = initial.compositions[0];
    const snapshot = await compositionForInput({
      workspacePath: projectRoot,
      entryPoint: "index.ts",
      compositionId: selected.id,
      expectedProjectRevision: initial.projectRevision,
      expectedDescriptorRevision: selected.descriptorRevision,
      force: true,
    });
    assert.equal(snapshot.composition.defaults.codec, "h264");
    assert.equal(snapshot.composition.defaults.outName, "first");

    const refreshedOutput = await runWithRequestContext(
      { bridgeId: "test-bridge", runId: "dynamic-metadata-refresh" },
      () => compileProject({ workspacePath: projectRoot, entryPoint: "index.ts", force: true }),
    );
    const refreshed = refreshedOutput.manifest;
    assert.equal(refreshed.projectRevision, initial.projectRevision);
    assert.notEqual(refreshed.descriptorRevision, initial.descriptorRevision);
    assert.notEqual(refreshed.buildId, initial.buildId);
    assert.equal(refreshed.compositions[0].defaults.codec, "vp9");

    const [variantA, variantB] = await Promise.all([
      runWithRequestContext(
        { bridgeId: "test-bridge", runId: "dynamic-metadata-variant-a" },
        () => resolveCompositionManifest(detection, { inputProps: { variant: "a" } }),
      ),
      runWithRequestContext(
        { bridgeId: "test-bridge", runId: "dynamic-metadata-variant-b" },
        () => resolveCompositionManifest(detection, { inputProps: { variant: "b" } }),
      ),
    ]);
    assert.equal(variantA.sourceRevision, variantB.sourceRevision);
    assert.equal(variantA.bundlePath, variantB.bundlePath);
    assert.notEqual(variantA.inputPropsRevision, variantB.inputPropsRevision);
    assert.notEqual(variantA.descriptorRevision, variantB.descriptorRevision);
    assert.equal(variantA.inputPropsRevision, computeInputPropsRevision({ variant: "a" }));
  } finally {
    delete process.env[metadataEnvironmentKey];
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Player host executes the side-effectful registerRoot entry before its generated host", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-player-entry-"));
  try {
    fs.writeFileSync(
      path.join(workspacePath, "package.json"),
      JSON.stringify({ private: true, sideEffects: ["*.css"] }),
    );
    const projectEntryPath = path.join(workspacePath, "src", "index.ts");
    fs.mkdirSync(path.dirname(projectEntryPath), { recursive: true });
    fs.writeFileSync(projectEntryPath, 'import {registerRoot} from "remotion";\nregisterRoot(() => null);\n');
    const manifest = {
      entryPoint: "src/index.ts",
      projectRevision: "project-revision",
      compositions: [{
        id: "Main",
        descriptorRevision: "descriptor-revision",
        durationInFrames: 30,
        fps: 30,
        width: 1920,
        height: 1080,
        resolvedProps: {},
      }],
    };
    const hostEntryPath = writePlayerHostEntry(workspacePath, manifest, "ordered-entry-test");
    assert.deepEqual(
      playerHostWebpackEntries(workspacePath, manifest, hostEntryPath),
      [projectEntryPath, hostEntryPath],
    );
    const hostEntrySource = fs.readFileSync(hostEntryPath, "utf8");
    assert.doesNotMatch(
      hostEntrySource,
      /import\s+["'][^"']*src\/index\.ts["']/,
      "the host must not rely on a tree-shakeable side-effect import",
    );
    assert.doesNotMatch(
      hostEntrySource,
      /event\.source\s*!==\s*window\.parent/,
      "opaque WebView frames must not authenticate a connection through unstable WindowProxy identity",
    );
    assert.match(hostEntrySource, /message\.channelNonce\s*!==\s*channelNonce/);
    assert.match(hostEntrySource, /event\.ports\?\.\[0\]/);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("opaque Player bootstrap is bound to navigation capabilities instead of WindowProxy identity", () => {
  const parentSource = fs.readFileSync(path.join(surfaceRoot, "player-dom.js"), "utf8");
  const bootstrapHandler = parentSource.slice(
    parentSource.indexOf("function handlePlayerBootstrap"),
    parentSource.indexOf("function handlePortMessage"),
  );
  assert.doesNotMatch(parentSource, /event\.source\s*!==\s*node\.contentWindow/);
  assert.match(parentSource, /message\.instanceId\s*!==\s*identity\.instanceId/);
  assert.match(parentSource, /message\.channelNonce\s*!==\s*identity\.nonce/);
  assert.match(parentSource, /new MessageChannel\(\)/);
  assert.match(bootstrapHandler, /activatePlayerHandshake\(["']bootstrap-ready["']\)/);
  assert.doesNotMatch(
    bootstrapHandler,
    /clearTimeout\(state\.playerHandshakeTimer\)/,
    "bootstrap pulses must not invalidate an in-flight transferred port",
  );
  assert.match(parentSource, /readinessHandshakeSignals\.has\(signal\)/);
  assert.match(parentSource, /activatePlayerHandshake\(["']frame-load["']\)/);
  const renderSource = fs.readFileSync(path.join(surfaceRoot, "render-core.js"), "utf8");
  assert.match(renderSource, /addEventListener\(["']load["']/);
  assert.match(renderSource, /notifyPlayerFrameLoaded\(nextFrame\)/);
});

test("Player media server streams a 100 MiB asset through HEAD, Range, and If-Range", async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-range-"));
  const distDir = path.join(workspacePath, "dist");
  const publicDir = path.join(workspacePath, "public");
  const artifactsDir = path.join(workspacePath, "artifacts");
  const logPath = path.join(workspacePath, "player-host.log");
  let child = null;
  try {
    fs.mkdirSync(distDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "ok");
    const mediaPath = path.join(publicDir, "large.mp4");
    const mediaSize = 100 * 1024 * 1024;
    const descriptor = fs.openSync(mediaPath, "w");
    try {
      fs.writeSync(descriptor, Buffer.from([0x5a]), 0, 1, mediaSize - 1);
    } finally {
      fs.closeSync(descriptor);
    }

    const serverPath = ensurePlayerHostServerScript(workspacePath);
    const port = await findFreePort();
    child = spawn(process.execPath, [
      serverPath,
      distDir,
      String(port),
      logPath,
      publicDir,
      artifactsDir,
      String(process.pid),
    ], { stdio: "ignore", windowsHide: true });
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForHttp(`${baseUrl}/health`, 10_000);
    assert.equal(health.reachable, true);

    const head = await fetch(`${baseUrl}/large.mp4`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal(Number(head.headers.get("content-length")), mediaSize);
    assert.equal(head.headers.get("content-type"), "video/mp4");
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const range = await fetch(`${baseUrl}/large.mp4`, { headers: { range: "bytes=128-255" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 128-255/${mediaSize}`);
    assert.equal((await range.arrayBuffer()).byteLength, 128);

    const staleIfRange = await fetch(`${baseUrl}/large.mp4`, {
      headers: { range: "bytes=128-255", "if-range": '"stale-etag"' },
    });
    assert.equal(staleIfRange.status, 200);
    assert.equal(Number(staleIfRange.headers.get("content-length")), mediaSize);
    await staleIfRange.body?.cancel();
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
    }
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("an explicit entry point cannot escape the workspace", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-entry-"));
  try {
    const workspacePath = path.join(parent, "workspace");
    fs.mkdirSync(workspacePath);
    fs.writeFileSync(path.join(parent, "outside.ts"), "export {};\n");
    assert.throws(
      () => detectProject({ workspacePath, entryPoint: "../outside.ts" }),
      /must stay inside the workspace/,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a queued export without a worker fails after its spawn lease", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-export-"));
  try {
    const runId = "export-orphaned";
    const manifestPath = path.join(
      workspacePath,
      ".sparo_os",
      "remotion-live",
      "exports",
      runId,
      "manifest.json",
    );
    const run = {
      runId,
      status: "queued",
      phase: "queued",
      queuedAt: Date.now() - 60_000,
      spawnDeadlineAt: Date.now() - 1,
      manifestPath,
    };
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(run));
    fs.writeFileSync(runsPath(workspacePath), JSON.stringify({ runs: [run] }));
    const result = getExportStatus({ workspacePath, runId });
    assert.equal(result.ok, true);
    assert.equal(result.run.status, "failed");
    assert.match(result.run.error, /spawn lease expired/);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("export cancellation reaches a terminal state and removes output and bundle pins", async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-export-cancel-"));
  const runId = "export-cancelled";
  const exportDir = path.join(workspacePath, ".sparo_os", "remotion-live", "exports", runId);
  const manifestPath = path.join(exportDir, "manifest.json");
  const configPath = path.join(exportDir, "job.json");
  const cancelPath = path.join(exportDir, "cancel.requested.json");
  const outputPath = path.join(exportDir, "output.mp4");
  const bundlePinPath = path.join(exportDir, ".bundle-pin");
  const rendererPath = path.join(exportDir, "renderer.js");
  const noReactPath = path.join(exportDir, "no-react.js");
  let child = null;
  try {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(rendererPath, `
let cancelled = false;
exports.makeCancelSignal = () => ({cancel: () => { cancelled = true; }, cancelSignal: {}});
exports.renderMedia = async ({outputLocation, onProgress}) => {
  for (let frame = 0; frame < 400; frame += 1) {
    if (cancelled) throw new Error("cancelled");
    onProgress({progress: frame / 400, renderedFrames: frame, encodedFrames: frame});
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  require("node:fs").writeFileSync(outputLocation, "completed");
};
`);
    fs.writeFileSync(noReactPath, `exports.NoReactInternals = {deserializeJSONWithSpecialTypes: JSON.parse};\n`);
    fs.writeFileSync(bundlePinPath, "pinned");
    const run = {
      runId,
      status: "running",
      phase: "rendering",
      manifestPath,
      outputPath,
      queuedAt: Date.now(),
      startedAt: Date.now(),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(run));
    fs.writeFileSync(runsPath(workspacePath), JSON.stringify({ runs: [run] }));
    fs.writeFileSync(configPath, JSON.stringify({
      run,
      manifestPath,
      cancelPath,
      outputPath,
      bundlePath: exportDir,
      bundlePinPath,
      rendererEntry: rendererPath,
      noReactEntry: noReactPath,
      composition: {
        id: "Main",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 400,
        defaultProps: {},
        serializedResolvedProps: "{}",
        defaults: {},
      },
      frameRange: [0, 399],
      codec: "h264",
      scale: 1,
    }));

    child = spawn(process.execPath, [path.join(runtimeRoot, "export-job-worker.js"), configPath], {
      stdio: "ignore",
      windowsHide: true,
    });
    await waitUntil(() => {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, "utf8")).renderedFrames > 0;
      } catch {
        return false;
      }
    });
    const cancellation = cancelExport({ workspacePath, runId });
    assert.equal(cancellation.ok, true);
    assert.equal(cancellation.run.status, "cancelling");
    await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Export worker did not exit after cancellation.")), 10_000)),
    ]);
    child = null;

    const terminal = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(terminal.status, "cancelled");
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.existsSync(bundlePinPath), false);
  } finally {
    if (child && child.exitCode === null) child.kill();
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("runtime phases never leak into the Bridge run status enum", () => {
  const originalWrite = fs.writeSync;
  let envelope = null;
  fs.writeSync = (_fd, value) => {
    envelope = JSON.parse(String(value));
    return Buffer.byteLength(String(value));
  };
  try {
    runWithRequestContext({ bridgeId: "test-bridge", runId: "test-run" }, () => {
      emitStatus("Resolving metadata", "resolving-metadata");
    });
  } finally {
    fs.writeSync = originalWrite;
  }
  assert.equal(envelope.event.status, "running");
  assert.equal(envelope.event.phase, "resolving-metadata");
});
