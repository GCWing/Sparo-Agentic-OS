import { normalizeRoute } from "./constants.js";

const state = {
  locale: navigator.language || "en-US",
  route: normalizeRoute(document.documentElement.dataset.route || "/preview"),
  tabId: null,
  sessionId: null,
  workspacePath: null,
  loading: false,
  status: "idle",
  error: null,
  project: null,
  toolchain: null,
  emulators: [],
  recommendedEmulator: null,
  selectedEmulatorName: null,
  targets: [],
  runtimeState: null,
  build: null,
  screen: null,
  hierarchy: null,
  diagnostics: [],
  selection: null,
  selectionDraft: null,
  selectionDragging: false,
  hydratingScreenPath: null,
  action: null
};

export { state };
