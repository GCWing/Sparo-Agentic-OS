const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("bridge declarations expose the structured manuscript action", () => {
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const component = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "component.json"), "utf8"));
  assert.ok(sourceManifest.capabilities[0].actions.includes("commitPresentationDocument"));
  assert.ok(sourceManifest.capabilities[0].actions.includes("initializeWork"));
  assert.ok(sourceManifest.actions.some((action) => action.name === "commitPresentationDocument"));
  assert.ok(sourceManifest.tools[0].actions.includes("commitPresentationDocument"));
  assert.ok(component.capabilities[0].actions.includes("commitPresentationDocument"));
});

test("worker emits the standard completed bridge envelope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-ppt-worker-"));
  const request = {
    bridgeId: "builtin-ppt-runtime",
    runId: "run-1",
    action: "inspect",
    input: {},
    workspacePath: root,
    consumer: {
      kind: "agentComponent",
      workId: "work-1",
      workTitle: "Worker protocol presentation",
      runtimeInstanceId: "runtime-1",
      sessionId: "session-1",
    },
  };
  const initialize = { ...request, runId: "run-initialize", action: "initializeWork", input: { title: "Worker protocol presentation" } };
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "worker.js")], {
    input: `${JSON.stringify(initialize)}\n${JSON.stringify(request)}\n`,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(events[0].event.type, "run.started");
  assert.equal(events[1].event.type, "run.completed");
  assert.equal(events[2].event.type, "run.started");
  assert.equal(events[3].event.type, "run.completed");
  assert.equal(events[3].event.output.deck.revision, 0);
});

test("worker preserves aggregate manuscript contract diagnostics in the failed envelope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-ppt-worker-invalid-"));
  const request = {
    bridgeId: "builtin-ppt-runtime",
    runId: "run-invalid-document",
    action: "commitPresentationDocument",
    input: {
      expectedManuscriptRevision: 1,
      expectedSpeakerScriptRevision: 1,
      manuscript: {
        title: "",
        slides: [{
          slideId: "slide-one",
          title: "",
          coreClaim: "",
          visibleCopy: [],
          evidenceAndSources: [],
          visualDirection: {},
          speakingObjective: "",
        }],
      },
      speakerScript: { slides: [] },
      intent: "Exercise the structured failure envelope",
    },
    workspacePath: root,
    consumer: {
      kind: "agentComponent",
      workId: "work-1",
      workTitle: "Invalid document presentation",
      runtimeInstanceId: "runtime-1",
      sessionId: "session-1",
    },
  };
  const initialize = { ...request, runId: "run-initialize", action: "initializeWork", input: { title: "Invalid document presentation" } };
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "worker.js")], {
    input: `${JSON.stringify(initialize)}\n${JSON.stringify(request)}\n`,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const events = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(events[0].event.type, "run.started");
  assert.equal(events[3].event.type, "run.failed");
  assert.equal(events[3].event.error.code, "manuscript_contract_invalid");
  assert.equal(events[3].event.error.contractVersion, 4);
  assert.ok(events[3].event.error.violations.length >= 12);
  assert.ok(events[3].event.error.violations.some((item) => item.path === "speakerScript.slides"));
});
