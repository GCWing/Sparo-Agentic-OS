import { normalizeRoute } from "./src/constants.js";
import {
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
  refreshFacts,
  runUnitTests,
  sendContext,
  setSelectedEmulator,
  startEmulator,
  stopEmulator
} from "./src/actions.js";
import { state } from "./src/state.js";
import { closestElement, runtime } from "./src/util.js";
import { fitScreenCanvas, render } from "./src/views.js";

function handleRouteEvent(payload = {}) {
  state.route = normalizeRoute(payload.route || state.route);
  state.tabId = payload.tabId || state.tabId;
  state.sessionId = payload.sessionId || state.sessionId;
  const nextWorkspace = payload.workspacePath || payload.workbench?.workspacePath || state.workspacePath;
  const workspaceChanged = nextWorkspace && nextWorkspace !== state.workspacePath;
  state.workspacePath = nextWorkspace || state.workspacePath;
  if (workspaceChanged) {
    state.project = null;
    state.toolchain = null;
    state.targets = [];
    state.emulators = [];
    state.recommendedEmulator = null;
    state.selectedEmulatorName = null;
    state.runtimeState = null;
    state.build = null;
    state.screen = null;
    state.hierarchy = null;
    state.selection = null;
    state.error = null;
  }
  render();
  if (workspaceChanged || (!state.project && state.workspacePath)) {
    void refreshFacts();
  }
}

document.addEventListener("click", (event) => {
  const node = closestElement(event.target, "[data-action]");
  if (!node) return;
  const action = node.dataset.action;
  if (action === "detect") void refreshFacts();
  if (action === "start-emulator") void startEmulator();
  if (action === "stop-emulator") void stopEmulator();
  if (action === "test") void runUnitTests();
  if (action === "build") void buildProject();
  if (action === "install") void installApp();
  if (action === "launch") void launchAbility();
  if (action === "build-run") void buildAndRun();
  if (action === "capture") void captureScreen();
  if (action === "inspect") void dumpHierarchy();
  if (action === "hot-reload") void hotReload();
  if (action === "send-context") void sendContext();
  if (action === "clear-selection") clearSelection();
});

document.addEventListener("change", (event) => {
  const node = closestElement(event.target, "[data-emulator-select]");
  if (!node) return;
  setSelectedEmulator(node.value);
});

document.addEventListener("pointerdown", beginSelection, true);
document.addEventListener("pointermove", moveSelection, true);
document.addEventListener("pointerup", endSelection, true);
window.addEventListener("resize", fitScreenCanvas);

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== "sparo:event") return;
  if (message.event === "localeChange") {
    state.locale = message.payload?.locale || state.locale;
    render();
  }
  if (message.event === "workbenchRouteChange") {
    handleRouteEvent(message.payload || {});
  }
});

runtime().onLocaleChange?.((locale) => {
  state.locale = locale || state.locale;
  render();
});

window.addEventListener("DOMContentLoaded", () => {
  render();
});
