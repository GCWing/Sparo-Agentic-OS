const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("worker uses the host workspace and emits correlated daemon envelopes", (t) => {
  const safeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "excel-worker-safe-"));
  const payloadWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "excel-worker-payload-"));
  t.after(() => fs.rmSync(safeWorkspace, { recursive: true, force: true }));
  t.after(() => fs.rmSync(payloadWorkspace, { recursive: true, force: true }));

  const workerPath = path.join(__dirname, "..", "worker.js");
  const request = {
    bridgeId: "builtin-excel-runtime",
    runId: "worker-contract-run",
    action: "createWorkbook",
    workspacePath: safeWorkspace,
    input: {
      workspacePath: payloadWorkspace,
      title: "Host-bound workbook",
      __trustedConsumerKind: "agentComponent",
    },
    consumer: { kind: "productAppRuntime", id: "surface-test" },
  };
  const stdout = execFileSync(process.execPath, [workerPath], {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
  });
  const frames = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));

  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.equal(frame.bridgeId, request.bridgeId);
    assert.equal(frame.runId, request.runId);
    assert.ok(frame.event && typeof frame.event.type === "string");
  }
  assert.equal(frames[0].event.type, "run.started");
  assert.equal(frames[1].event.type, "run.completed");
  assert.equal(frames[1].event.output.meta.title, "Host-bound workbook");
  assert.equal(fs.existsSync(path.join(safeWorkspace, ".sparo_os", "excel-live")), true);
  assert.equal(fs.existsSync(path.join(payloadWorkspace, ".sparo_os", "excel-live")), false);
});
