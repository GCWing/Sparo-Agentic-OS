import { callBackend } from "./backend.js";
import { projectSummary, recommendedEmulator, selectedEmulator, targetState } from "./model.js";
import { buildSelection, selectionSummary } from "./preview/selection-overlay.js";
import { render } from "./views.js";
import { state } from "./state.js";
import { asArray, normalizeBox, runtime, stagePointFromEvent, t } from "./util.js";

function setBusy(label) {
  state.loading = Boolean(label);
  state.action = label || null;
  if (label) state.status = label;
  render();
}

function syncSelectedEmulator() {
  const selected = state.selectedEmulatorName
    ? selectedEmulator(state.emulators, state.selectedEmulatorName)
    : null;
  if (selected?.name) {
    state.selectedEmulatorName = selected.name;
    return selected;
  }
  const running = asArray(state.emulators).find((emulator) => emulator?.isRunning);
  if (running?.name) {
    state.selectedEmulatorName = running.name;
    return running;
  }
  const recommended = state.recommendedEmulator || recommendedEmulator(state.emulators);
  state.selectedEmulatorName = recommended?.name || null;
  return recommended;
}

function applyOutput(output = {}) {
  if (output.project) state.project = output.project;
  if (output.toolchain) state.toolchain = output.toolchain;
  if (Array.isArray(output.emulators)) state.emulators = output.emulators;
  if (output.recommendedEmulator) state.recommendedEmulator = output.recommendedEmulator;
  if (output.emulator?.name) state.selectedEmulatorName = output.emulator.name;
  if (Array.isArray(output.targets)) state.targets = output.targets;
  if (output.runtimeState) state.runtimeState = output.runtimeState;
  if (output.runtimeState?.selectedEmulator?.name) state.selectedEmulatorName = output.runtimeState.selectedEmulator.name;
  if (output.build) state.build = output.build;
  if (output.screen) state.screen = output.screen;
  if (output.hierarchy) state.hierarchy = output.hierarchy;
  if (Array.isArray(output.diagnostics)) state.diagnostics = output.diagnostics;
  syncSelectedEmulator();
  state.error = null;
}

function activeScreen() {
  return state.screen || state.runtimeState?.screen || null;
}

function hasUsableScreenData(screen) {
  const dataUrl = String(screen?.dataUrl || "");
  const comma = dataUrl.indexOf(",");
  return dataUrl.startsWith("data:image/")
    && comma > 0
    && dataUrl.length > comma + 256
    && Number(screen?.width) > 0
    && Number(screen?.height) > 0
    && Number(screen?.size) > 0;
}

async function hydrateScreenImage() {
  const screen = activeScreen();
  if (!screen?.path || hasUsableScreenData(screen)) return;
  if (state.hydratingScreenPath === screen.path) return;
  state.hydratingScreenPath = screen.path;
  try {
    const output = await callBackend("readScreenshot", {
      path: screen.path,
      screen
    }, { timeoutMs: 30000 });
    if (output?.screen) {
      state.screen = { ...screen, ...output.screen };
      if (state.runtimeState?.screen?.path === screen.path) {
        state.runtimeState = {
          ...state.runtimeState,
          screen: { ...state.runtimeState.screen, ...output.screen }
        };
      }
      render();
    }
  } catch {
    // Keep the stale screen metadata visible; the next capture can replace it.
  } finally {
    state.hydratingScreenPath = null;
  }
}

async function guarded(label, fn) {
  setBusy(label);
  try {
    const output = await fn();
    applyOutput(output || {});
    void hydrateScreenImage();
    return output;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    setBusy(null);
    render();
  }
}

async function refreshFacts() {
  if (!state.workspacePath) {
    state.project = null;
    state.toolchain = null;
    state.targets = [];
    render();
    return;
  }
  await guarded(t("detecting"), async () => {
    const [project, toolchain, targets, emulators, runtimeState] = await Promise.all([
      callBackend("detectProject"),
      callBackend("detectToolchain"),
      callBackend("listTargets"),
      callBackend("listEmulators"),
      callBackend("getRuntimeState")
    ]);
    return {
      project: project?.project || project,
      toolchain: toolchain?.toolchain || toolchain,
      targets: asArray(targets?.targets),
      emulators: asArray(emulators?.emulators),
      recommendedEmulator: emulators?.recommendedEmulator || recommendedEmulator(emulators?.emulators),
      runtimeState: targets?.runtimeState || project?.runtimeState || emulators?.runtimeState || runtimeState?.runtimeState || runtimeState,
      diagnostics: [
        ...asArray(project?.diagnostics),
        ...asArray(toolchain?.diagnostics),
        ...asArray(targets?.diagnostics),
        ...asArray(emulators?.diagnostics)
      ]
    };
  });
}

async function startEmulator() {
  const emulator = syncSelectedEmulator();
  if (!emulator?.name) return;
  await guarded(t("waitingTarget"), () => callBackend("startEmulator", { name: emulator.name }, { timeoutMs: 180000 }));
  await refreshFacts();
}

async function stopEmulator() {
  const emulator = syncSelectedEmulator();
  if (!emulator?.name) return;
  await guarded(t("stopEmulator"), () => callBackend("stopEmulator", { name: emulator.name }, { timeoutMs: 60000 }));
  await refreshFacts();
}

async function runUnitTests() {
  await guarded(t("test"), () => callBackend("runUnitTests", {}, { timeoutMs: 180000 }));
}

async function buildProject() {
  await guarded(t("build"), () => callBackend("buildProject", { includeTests: false }, { timeoutMs: 240000 }));
}

async function hotReload() {
  await guarded(t("hotReload"), () => callBackend("hotReload", {}, { timeoutMs: 180000 }));
}

async function installApp() {
  if (!targetState(state.targets).target) {
    state.error = t("installNeedsTarget");
    render();
    return null;
  }
  return guarded(t("install"), () => callBackend("installApp", {}, { timeoutMs: 120000 }));
}

async function launchAbility() {
  if (!targetState(state.targets).target) {
    state.error = t("launchNeedsTarget");
    render();
    return null;
  }
  return guarded(t("launch"), () => callBackend("launchAbility", {}, { timeoutMs: 90000 }));
}

async function buildAndRun() {
  await guarded(t("buildRun"), () => callBackend("buildProject", { includeTests: false }, { timeoutMs: 240000 }));
  if (!state.error) await installApp();
  if (!state.error) await launchAbility();
  if (!state.error) await captureScreen();
  if (!state.error) await dumpHierarchy();
}

async function captureScreen() {
  const target = targetState(state.targets).target;
  const emulator = selectedEmulator(state.emulators, state.selectedEmulatorName) || state.recommendedEmulator || recommendedEmulator(state.emulators);
  await guarded(t("capture"), () => callBackend("captureScreen", {
    targetId: target?.id,
    emulatorName: emulator?.isRunning ? emulator.name : undefined
  }, { timeoutMs: 90000 }));
}

async function dumpHierarchy() {
  const target = targetState(state.targets).target;
  await guarded(t("inspect"), () => callBackend("dumpHierarchy", {
    targetId: target?.id
  }, { timeoutMs: 90000 }));
}

async function readDiagnostics() {
  await guarded(t("diagnostics"), () => callBackend("readDiagnostics"));
}

async function sendContext() {
  const host = runtime();
  const project = projectSummary(state.project);
  const context = {
    workspacePath: state.workspacePath,
    route: state.route,
    project: state.project,
    target: targetState(state.targets).target,
    emulator: selectedEmulator(state.emulators, state.selectedEmulatorName),
    app: {
      bundleName: project.bundleName,
      moduleName: project.moduleName,
      abilityName: project.abilityName
    },
    build: state.build || state.runtimeState?.build || null,
    runtime: state.runtimeState,
    screen: state.screen || state.runtimeState?.screen || null,
    hierarchy: state.hierarchy || state.runtimeState?.hierarchy || null,
    selection: state.selection,
    diagnostics: state.diagnostics
  };
  const prompt = `${t("askPrompt")}\n\nHarmonyOS context: ${selectionSummary(state.selection)}\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  await host.host?.fillChatInput?.(prompt);
}

function setSelectionFromBox(kind, box) {
  state.selection = buildSelection(kind, box);
  render();
}

function beginSelection(event) {
  if (!event.target?.closest?.("[data-select-stage]")) return;
  if (event.button !== 0) return;
  const point = stagePointFromEvent(event);
  if (!point) return;
  state.selectionDragging = true;
  state.selectionDraft = { startX: point.x, startY: point.y, x: point.x, y: point.y, width: 0, height: 0, moved: false };
  render();
}

function moveSelection(event) {
  if (!state.selectionDragging || !state.selectionDraft) return;
  const point = stagePointFromEvent(event);
  if (!point) return;
  const draft = state.selectionDraft;
  draft.x = Math.min(draft.startX, point.x);
  draft.y = Math.min(draft.startY, point.y);
  draft.width = Math.abs(point.x - draft.startX);
  draft.height = Math.abs(point.y - draft.startY);
  draft.moved = draft.width > 1 || draft.height > 1;
  render();
}

function endSelection() {
  if (!state.selectionDragging) return;
  const draft = state.selectionDraft;
  state.selectionDragging = false;
  state.selectionDraft = null;
  if (!draft) {
    render();
    return;
  }
  if (draft.moved) {
    setSelectionFromBox("region", draft);
  } else {
    setSelectionFromBox("point", normalizeBox({ x: draft.startX - 1, y: draft.startY - 1, width: 2, height: 2 }));
  }
}

function clearSelection() {
  state.selection = null;
  state.selectionDraft = null;
  state.selectionDragging = false;
  render();
}

function setSelectedEmulator(name) {
  state.selectedEmulatorName = name || null;
  syncSelectedEmulator();
  render();
}

export {
  beginSelection,
  buildAndRun,
  buildProject,
  captureScreen,
  clearSelection,
  dumpHierarchy,
  endSelection,
  hotReload,
  installApp,
  launchAbility,
  moveSelection,
  readDiagnostics,
  refreshFacts,
  runUnitTests,
  sendContext,
  setSelectedEmulator,
  startEmulator,
  stopEmulator
};
