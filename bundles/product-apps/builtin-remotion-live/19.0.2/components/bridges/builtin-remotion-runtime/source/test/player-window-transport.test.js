const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const {
  PLAYER_BASELINE_REVISION,
  PLAYER_CONTROL_PROTOCOL_VERSION,
  PLAYER_HOST_RUNTIME_VERSION,
} = require("../src/constants");
const { writePlayerHostEntry } = require("../src/player-host");

test("generated Player host uses authenticated window messaging without MessagePort transfer", () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-transport-"));
  try {
    const entryPoint = path.join(workspacePath, "src", "index.ts");
    fs.mkdirSync(path.dirname(entryPoint), { recursive: true });
    fs.writeFileSync(entryPoint, "export {};\n", "utf8");

    const generatedPath = writePlayerHostEntry(workspacePath, {
      entryPoint: "src/index.ts",
      projectRevision: "project-revision",
      compositions: [{
        id: "TransportTest",
        descriptorRevision: "descriptor-revision",
        durationInFrames: 30,
        fps: 30,
        width: 1920,
        height: 1080,
        resolvedProps: {},
      }],
    }, "transport-test");
    const generated = fs.readFileSync(generatedPath, "utf8");

    assert.equal(PLAYER_CONTROL_PROTOCOL_VERSION, 4);
    assert.match(generated, /transport: "window-message"/);
    assert.match(generated, /connectionGeneration/);
    assert.match(generated, /connectionId: activeConnectionId/);
    assert.match(generated, new RegExp(`activeRevisionRef = useRef\\(${PLAYER_BASELINE_REVISION}\\)`));
    assert.match(generated, /Promise\.resolve\(player\.play\(\)\)\.catch\(reportPlayFailure\)/);
    assert.match(generated, /post\("commandFailed"/);
    assert.match(generated, /window\.parent\?\.postMessage/);
    assert.doesNotMatch(generated, /new MessageChannel/);
    assert.doesNotMatch(generated, /event\.ports/);

    const surfaceTransportPath = path.resolve(
      __dirname,
      "../../../../surfaces/builtin-remotion-live-surface/source/src/player-dom.js",
    );
    const surfaceTransport = fs.readFileSync(surfaceTransportPath, "utf8");
    assert.match(surfaceTransport, /transport: 'window-message'/);
    assert.match(surfaceTransport, /connectionGeneration/);
    assert.doesNotMatch(surfaceTransport, /new MessageChannel/);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test("connection lifecycle is independent from playback state revision ordering", async () => {
  const contractPath = path.resolve(
    __dirname,
    "../../../../surfaces/builtin-remotion-live-surface/source/src/player-state-contract.js",
  );
  const surfaceConstantsPath = path.join(path.dirname(contractPath), "constants.js");
  const [contract, surfaceConstants] = await Promise.all([
    import(pathToFileURL(contractPath).href),
    import(pathToFileURL(surfaceConstantsPath).href),
  ]);

  assert.equal(contract.PLAYER_BASELINE_REVISION, PLAYER_BASELINE_REVISION);
  assert.equal(surfaceConstants.PLAYER_HOST_RUNTIME_VERSION, PLAYER_HOST_RUNTIME_VERSION);
  assert.equal(surfaceConstants.PLAYER_CONTROL_PROTOCOL_VERSION, PLAYER_CONTROL_PROTOCOL_VERSION);
  assert.equal(contract.isStalePlayerStateMessage({ type: "channelReady", revision: -1 }, 4), false);
  assert.equal(contract.isStalePlayerStateMessage({ type: "ready", revision: -1 }, 4), false);
  assert.equal(contract.isStalePlayerStateMessage({ type: "error", revision: -1 }, 4), false);
  assert.equal(contract.isStalePlayerStateMessage({ type: "actualState", revision: 3 }, 4), true);
  assert.equal(contract.isStalePlayerStateMessage({ type: "actualState", revision: 4 }, 4), false);
  assert.equal(contract.isPlayerConnectionLifecycleMessage({ type: "ready" }), true);
  assert.equal(contract.isPlayerConnectionLifecycleMessage({ type: "actualState" }), false);
  assert.equal(contract.isPlayerRuntimeEvidenceMessage({ type: "ready" }), true);
  assert.equal(contract.isPlayerRuntimeEvidenceMessage({ type: "paused" }), true);
  assert.equal(contract.isPlayerRuntimeEvidenceMessage({ type: "commandFailed" }), true);
  assert.equal(contract.isPlayerRuntimeEvidenceMessage({ type: "channelReady" }), false);
});

test("surface reconnects a replaced frame and reconciles desired state on channel ready", () => {
  const surfaceRoot = path.resolve(
    __dirname,
    "../../../../surfaces/builtin-remotion-live-surface/source/src",
  );
  const protocol = fs.readFileSync(path.join(surfaceRoot, "player-protocol.js"), "utf8");
  const renderCore = fs.readFileSync(path.join(surfaceRoot, "render-core.js"), "utf8");

  const channelReadyIndex = protocol.indexOf("message.type === 'channelReady'");
  const staleStateIndex = protocol.indexOf("isStalePlayerStateMessage(message");
  assert.ok(channelReadyIndex >= 0 && channelReadyIndex < staleStateIndex);
  assert.match(protocol, /beginPlayerStateConnection\(message\);[\s\S]*flushPlayerCommand\(\);/);
  assert.match(protocol, /message\.type === 'commandFailed'/);
  assert.match(renderCore, /nextFrame !== previousFrame[\s\S]*resetPlayerChannelConnection\(\)/);
});
