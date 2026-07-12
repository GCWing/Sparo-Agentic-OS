const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const APP_ROOT = path.resolve(__dirname, "../../../../..");
const AGENT_ROOT = path.join(
  APP_ROOT,
  "components",
  "agents",
  "excel-live-agent"
);
const BRIDGE_ROOT = path.join(
  APP_ROOT,
  "components",
  "bridges",
  "builtin-excel-runtime"
);
const SURFACE_ROOT = path.join(
  APP_ROOT,
  "components",
  "surfaces",
  "builtin-excel-live-surface"
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walkFiles(root, predicate = () => true) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath, predicate));
    } else if (predicate(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(actual, expected, message) {
  assert.deepEqual(sortedUnique(actual), sortedUnique(expected), message);
}

function assertPathInside(root, candidate, message) {
  const relative = path.relative(root, candidate);
  assert.ok(
    relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    message
  );
}

function topLevelFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Engine action ${name} must have a top-level function`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function loadSurfaceMessages() {
  const i18nPath = path.join(SURFACE_ROOT, "source", "src", "i18n.js");
  const executable = fs
    .readFileSync(i18nPath, "utf8")
    .replace(/^import .*$/m, "const state = {};")
    .replace(
      /export\s*\{\s*MESSAGES\s*,\s*t\s*\};/,
      "globalThis.__EXCEL_LIVE_MESSAGES__ = MESSAGES;"
    );
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox, { filename: i18nPath });
  return sandbox.__EXCEL_LIVE_MESSAGES__;
}

function loadCommonJsModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const module = { exports: {} };
  const execute = new Function("require", "module", "exports", source);
  execute(require, module, module.exports);
  return module.exports;
}

test("Excel Live package contract consistency", async (t) => {
  const app = readJson(path.join(APP_ROOT, "app.json"));
  const agentComponent = readJson(path.join(AGENT_ROOT, "component.json"));
  const agentManifest = readJson(path.join(AGENT_ROOT, "source", "manifest.json"));
  const bridgeComponent = readJson(path.join(BRIDGE_ROOT, "component.json"));
  const bridgeManifest = readJson(path.join(BRIDGE_ROOT, "source", "manifest.json"));
  const surfaceComponent = readJson(path.join(SURFACE_ROOT, "component.json"));
  const engineSource = fs.readFileSync(
    path.join(BRIDGE_ROOT, "source", "src", "engine.js"),
    "utf8"
  );
  const engineActions = require("../src/engine").actions;
  const bridgeCapability = bridgeManifest.capabilities.find(
    (capability) => capability.id === "sparo.excelEngine"
  );

  await t.test("all package JSON parses and declared entries exist", () => {
    const jsonFiles = walkFiles(APP_ROOT, (filePath) => filePath.endsWith(".json"));
    assert.ok(jsonFiles.length > 0, "Excel Live package must contain JSON manifests");
    for (const filePath of jsonFiles) {
      assert.doesNotThrow(
        () => readJson(filePath),
        `Invalid JSON: ${path.relative(APP_ROOT, filePath)}`
      );
    }

    const bridgeEntry = path.resolve(
      BRIDGE_ROOT,
      "source",
      bridgeManifest.runtime.entry
    );
    assertPathInside(
      path.join(BRIDGE_ROOT, "source"),
      bridgeEntry,
      "Bridge entry must stay inside its source directory"
    );
    assert.ok(fs.existsSync(bridgeEntry), "Bridge runtime entry must exist");

    const surfaceManifest = readJson(
      path.join(SURFACE_ROOT, "source", "source_manifest.json")
    );
    for (const entry of [
      surfaceManifest.uiEntry,
      surfaceManifest.workerEntry,
      ...(surfaceManifest.styleEntries || []),
    ]) {
      const entryPath = path.resolve(SURFACE_ROOT, "source", entry);
      assertPathInside(
        path.join(SURFACE_ROOT, "source"),
        entryPath,
        `Surface entry ${entry} must stay inside its source directory`
      );
      assert.ok(fs.existsSync(entryPath), `Surface entry must exist: ${entry}`);
    }
  });

  await t.test("app component references match private component contracts", () => {
    const privateComponents = new Map([
      [agentComponent.id, agentComponent],
      [bridgeComponent.id, bridgeComponent],
      [surfaceComponent.id, surfaceComponent],
    ]);

    for (const reference of app.components.filter(
      (component) => component.source === "private"
    )) {
      const component = privateComponents.get(reference.componentId);
      assert.ok(component, `Missing private component ${reference.componentId}`);
      assert.equal(component.kind, reference.kind);
      assert.equal(component.ownerApp?.appId, app.id);
      assert.equal(component.ownerApp?.appVersion, app.version);
      assert.ok(component.usedByApps?.includes(app.id));
      const capabilityIds = component.capabilities.map((capability) => capability.id);
      for (const capabilityId of reference.capabilities || []) {
        assert.ok(
          capabilityIds.includes(capabilityId),
          `${reference.componentId} does not declare capability ${capabilityId}`
        );
      }
    }

    const referencedIds = new Set(app.components.map((component) => component.componentId));
    for (const component of privateComponents.values()) {
      for (const dependency of component.dependencies || []) {
        assert.ok(
          referencedIds.has(dependency.componentId),
          `${component.id} depends on component absent from app.json: ${dependency.componentId}`
        );
      }
    }
  });

  await t.test("bridge action declarations stay aligned with the engine", () => {
    assert.ok(bridgeCapability, "sparo.excelEngine capability must exist");
    const componentCapability = bridgeComponent.capabilities.find(
      (capability) => capability.id === bridgeCapability.id
    );
    const runtimeTool = bridgeManifest.tools.find(
      (tool) => tool.capabilityId === bridgeCapability.id
    );
    assert.ok(componentCapability, "Bridge component capability must exist");
    assert.ok(runtimeTool, "Bridge runtime tool must exist");

    assertSameSet(
      componentCapability.actions,
      bridgeCapability.actions,
      "component.json and manifest capability actions must match"
    );
    assertSameSet(
      bridgeManifest.actions.map((action) => action.name),
      bridgeCapability.actions,
      "manifest action definitions and capability actions must match"
    );
    assertSameSet(
      runtimeTool.actions,
      bridgeCapability.actions,
      "runtime tool and capability actions must match"
    );

    for (const action of bridgeCapability.actions) {
      assert.equal(
        typeof engineActions[action],
        "function",
        `Declared bridge action is missing from engine: ${action}`
      );
    }

    const surfaceActions = new Set();
    for (const filePath of walkFiles(
      path.join(SURFACE_ROOT, "source"),
      (candidate) => candidate.endsWith(".js")
    )) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const match of source.matchAll(/\bcallExcel\(\s*["']([^"']+)["']/g)) {
        surfaceActions.add(match[1]);
      }
    }
    for (const action of surfaceActions) {
      assert.ok(
        bridgeCapability.actions.includes(action),
        `Surface calls undeclared bridge action: ${action}`
      );
      assert.equal(typeof engineActions[action], "function");
    }
  });

  await t.test("agent tools match manifest, bridge actions, and revision guards", () => {
    const toolsDirectory = path.join(AGENT_ROOT, "source", "tools");
    const toolDefinitions = walkFiles(
      toolsDirectory,
      (filePath) => filePath.endsWith(".tool.json")
    ).map((filePath) => ({ filePath, manifest: readJson(filePath) }));
    const toolNames = toolDefinitions.map(({ manifest }) => manifest.name);
    assert.equal(
      new Set(toolNames).size,
      toolNames.length,
      "Agent tool names must be unique"
    );

    const runtimePrefix = `agentcomponent__${agentManifest.id}__`;
    const selectedRuntimeTools = agentManifest.tools
      .filter((name) => name.startsWith(runtimePrefix))
      .map((name) => name.slice(runtimePrefix.length));
    assertSameSet(
      selectedRuntimeTools,
      toolNames,
      "Agent manifest runtime tools must match .tool.json definitions"
    );

    const mutatingActions = new Set([
      "openWorkbook",
      "createWorkbook",
      "proposePatch",
      "acceptProposal",
      "rejectProposal",
      "undo",
      "redo",
      "saveWorkbook",
      "switchSheet",
    ]);

    for (const { filePath, manifest } of toolDefinitions) {
      const entryPath = path.resolve(AGENT_ROOT, "source", manifest.entry);
      assertPathInside(
        path.join(AGENT_ROOT, "source"),
        entryPath,
        `${manifest.name} entry must stay inside the agent source directory`
      );
      assert.ok(fs.existsSync(entryPath), `${manifest.name} entry must exist`);

      const properties = manifest.inputSchema?.properties || {};
      assert.equal(
        Object.hasOwn(properties, "workspacePath") ||
          Object.hasOwn(properties, "workspace_path"),
        false,
        `${manifest.name} must not expose the host-owned workspace path`
      );

      const entrySource = fs.readFileSync(entryPath, "utf8");
      const actionMatch = entrySource.match(
        /callExcelEngine\(\s*["']([^"']+)["']/
      );
      assert.ok(
        actionMatch,
        `${path.relative(APP_ROOT, filePath)} must call a static Excel Engine action`
      );
      const action = actionMatch[1];
      assert.ok(
        bridgeCapability.actions.includes(action),
        `${manifest.name} calls undeclared bridge action ${action}`
      );
      assert.equal(
        typeof engineActions[action],
        "function",
        `${manifest.name} calls missing engine action ${action}`
      );

      if (mutatingActions.has(action)) {
        assert.equal(
          manifest.readonly,
          false,
          `${manifest.name} persists workbook or proposal state and cannot be readonly`
        );
      }

      const actionSource = topLevelFunctionSource(engineSource, action);
      const required = new Set(manifest.inputSchema?.required || []);
      if (actionSource.includes("assertExpectedRevision")) {
        assert.ok(
          required.has("expectedRevision") && properties.expectedRevision,
          `${manifest.name} must require expectedRevision because ${action} enforces it`
        );
      }
      if (actionSource.includes("[PROPOSAL_ID_REQUIRED]")) {
        assert.ok(
          required.has("proposalId") && properties.proposalId,
          `${manifest.name} must require proposalId because ${action} enforces it`
        );
      }
    }

    const toolNameSet = new Set(toolNames);
    for (const serviceAction of agentManifest.serviceActions || []) {
      for (const runtimeTool of (serviceAction.toolPolicy || []).filter((name) =>
        name.startsWith(runtimePrefix)
      )) {
        assert.ok(
          toolNameSet.has(runtimeTool.slice(runtimePrefix.length)),
          `${serviceAction.name} references missing tool ${runtimeTool}`
        );
      }
    }
  });

  await t.test("agent paths stay workspace-relative and CSV cannot bypass safe export", (t) => {
    const bridgeHelpers = loadCommonJsModule(
      path.join(AGENT_ROOT, "source", "tools", "excel_bridge.js")
    );
    assert.deepEqual(
      bridgeHelpers.normalizeInput(
        {
          workspacePath: "C:/model-owned",
          workspace_path: "C:/also-model-owned",
          workbook_id: "wb_1",
          path: "reports/book.xlsx",
        },
        { workspaceRoot: "D:/trusted-workspace" }
      ),
      {
        workbookId: "wb_1",
        path: "reports/book.xlsx",
        workspacePath: "D:/trusted-workspace",
      }
    );
    assert.throws(
      () => bridgeHelpers.normalizeInput({}, {}),
      /host-bound workspace root/
    );
    for (const unsafePath of [
      "C:/outside/book.xlsx",
      "/outside/book.xlsx",
      "../outside/book.xlsx",
      "nested/../../outside/book.xlsx",
      "..\\outside\\book.xlsx",
      "book.xlsx\0suffix",
    ]) {
      assert.throws(
        () =>
          bridgeHelpers.normalizeInput(
            { path: unsafePath },
            { workspaceRoot: "D:/trusted-workspace" }
          ),
        /workspace-relative|active workspace/,
        unsafePath
      );
    }

    const workspacePath = fs.mkdtempSync(
      path.join(os.tmpdir(), "excel-contract-csv-bypass-")
    );
    t.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
    const engine = require("../src/engine");
    const created = engine.dispatch("createWorkbook", { workspacePath });
    assert.throws(
      () =>
        engine.dispatch("saveWorkbook", {
          workspacePath,
          workbookId: created.meta.workbookId,
          expectedRevision: created.meta.revision,
          path: path.join(workspacePath, "unsafe.csv"),
          exportCopy: true,
        }),
      /CSV_EXPORT_ACTION_REQUIRED/
    );
    assert.equal(fs.existsSync(path.join(workspacePath, "unsafe.csv")), false);
  });

  await t.test("surface translations have locale parity and cover static keys", () => {
    const messages = loadSurfaceMessages();
    assert.ok(messages?.["en-US"] && messages?.["zh-CN"]);
    const englishKeys = Object.keys(messages["en-US"]);
    const chineseKeys = Object.keys(messages["zh-CN"]);
    assertSameSet(
      englishKeys,
      chineseKeys,
      "Excel Live surface locales must have identical key sets"
    );

    const usedKeys = new Set();
    for (const filePath of walkFiles(
      path.join(SURFACE_ROOT, "source"),
      (candidate) => candidate.endsWith(".js")
    )) {
      const source = fs.readFileSync(filePath, "utf8");
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        usedKeys.add(match[1]);
      }
    }
    for (const key of usedKeys) {
      assert.ok(
        Object.hasOwn(messages["en-US"], key),
        `Static surface translation key is missing: ${key}`
      );
    }
  });
});
