const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  DEFAULT_PRESENTATION_SYSTEM,
  TEXT_ROLES,
  clone,
  normalizePresentationSystem,
  presentationSystemPresets,
  resolveColor,
  resolveTypeRole,
  tokenNames,
} = require("./presentation-system");
const {
  createDesignPackage,
  defaultRecipeId,
  recipeById,
} = require("./design-package");
const {
  compileSlide,
  normalizeComposition,
} = require("./slide-compiler");
const {
  compileVisualPage,
  initialVisualDocument,
  migrateVisualDocument,
  updateVisualNode,
} = require("./visual-document");
const { renderContactSheet, renderSvg } = require("./render-runtime");
const {
  authoringContract,
  containsEmbeddedHtml,
  initialStructuredDocuments,
  normalizeStructuredDocuments,
  parseManuscriptMarkdown,
  parsePresentationMarkdown,
  serializeManuscript,
  serializeSpeakerScript,
  slideSections,
} = require("./manuscript-contract");

const APP_ID = "builtin-ppt-live";
const APP_VERSION = "151.0.10";
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY = 24;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const GEOMETRY_SNAP_TOLERANCE = 2.5;
const DECK_SCHEMA_VERSION = 6;
const PROJECT_SCHEMA_VERSION = 4;
const DESIGN_CASE_SCHEMA_VERSION = 2;
const REVIEW_SCHEMA_VERSION = 3;
const CONTROL_SCHEMA_VERSION = 1;
const PPT_DIRECTORY = "PPT";
const PPT_INDEX_SCHEMA_VERSION = 1;
const ELEMENT_TYPES = new Set(["text", "shape", "line", "image", "svg", "chart", "table", "group"]);
const REQUIRED_ALIGNMENT_CHECKS = Object.freeze([
  "core-claim-preservation",
  "evidence-and-source-fidelity",
  "appropriate-content-restructuring",
  "narrative-continuity",
  "speaker-script-alignment",
  "unsupported-claim-detection",
]);
const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function safeId(value, fallback = "default") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .slice(0, 128);
  return normalized || fallback;
}

function text(value, fallback = "", maxLength = 4000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function objectValue(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function assertKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${name} contains unsupported field '${key}'`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}

function stateTarget(controlFile, key) {
  return Object.freeze({ kind: "ppt-live-state", controlFile, key });
}

function isStateTarget(value) {
  return Boolean(value && typeof value === "object" && value.kind === "ppt-live-state");
}

function readFileJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

function readControl(controlFile, fallback = null) {
  return readFileJson(controlFile, fallback);
}

function writeControl(controlFile, value) {
  atomicWrite(controlFile, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJson(filePath, value) {
  if (isStateTarget(filePath)) {
    const control = readControl(filePath.controlFile, null);
    if (!control || control.schemaVersion !== CONTROL_SCHEMA_VERSION || !control.state) {
      throw new Error("PPT Live control file is missing or invalid");
    }
    control.state[filePath.key] = clone(value);
    control.revision = Number(control.revision || 0) + 1;
    control.updatedAt = nowIso();
    writeControl(filePath.controlFile, control);
    return;
  }
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonExists(filePath) {
  if (!isStateTarget(filePath)) return fs.existsSync(filePath);
  const control = readControl(filePath.controlFile, null);
  return Boolean(control?.state && Object.prototype.hasOwnProperty.call(control.state, filePath.key));
}

function deleteJson(filePath) {
  if (!isStateTarget(filePath)) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const control = readControl(filePath.controlFile, null);
  if (!control?.state || !Object.prototype.hasOwnProperty.call(control.state, filePath.key)) return;
  delete control.state[filePath.key];
  control.revision = Number(control.revision || 0) + 1;
  control.updatedAt = nowIso();
  writeControl(filePath.controlFile, control);
}

const PROJECT_STATE_TARGETS = Object.freeze({
  presentationSystem: "presentationSystem",
  deck: "deck",
  visualDocument: "visualDocument",
  designCase: "designCase",
});
const PROJECT_DOCUMENT_TARGETS = Object.freeze({
  manuscript: "manuscript",
  speakerScript: "speakerScript",
});

function recoverProjectState(paths) {
  if (!jsonExists(paths.stateTransaction)) return;
  const transaction = readJson(paths.stateTransaction, null);
  if (
    !transaction ||
    transaction.schemaVersion !== 1 ||
    (!transaction.values && !transaction.documents)
  ) {
    throw new Error("PPT Live state transaction journal is invalid");
  }
  for (const [key, content] of Object.entries(transaction.documents || {})) {
    const pathKey = PROJECT_DOCUMENT_TARGETS[key];
    if (!pathKey || typeof content !== "string") {
      throw new Error(`PPT Live state transaction contains unsupported document '${key}'`);
    }
    atomicWrite(paths[pathKey], content);
  }
  for (const [key, value] of Object.entries(transaction.values || {})) {
    if (key === "contentBlueprint") continue;
    const pathKey = PROJECT_STATE_TARGETS[key];
    if (!pathKey) throw new Error(`PPT Live state transaction contains unsupported target '${key}'`);
    writeJson(paths[pathKey], value);
  }
  deleteJson(paths.stateTransaction);
}

function writePresentationState(paths, documents, values) {
  const documentEntries = Object.entries(documents || {});
  const valueEntries = Object.entries(values || {});
  if (!documentEntries.length || !valueEntries.length) {
    throw new Error("PPT Live presentation transaction requires documents and project state");
  }
  for (const [key, content] of documentEntries) {
    if (!PROJECT_DOCUMENT_TARGETS[key] || typeof content !== "string") {
      throw new Error(`Unsupported PPT Live document transaction target '${key}'`);
    }
  }
  for (const [key] of valueEntries) {
    if (!PROJECT_STATE_TARGETS[key]) throw new Error(`Unsupported PPT Live state target '${key}'`);
  }
  writeJson(paths.stateTransaction, {
    schemaVersion: 1,
    status: "pending",
    documents,
    values: clone(values),
    createdAt: nowIso(),
  });
  for (const [key, content] of documentEntries) atomicWrite(paths[PROJECT_DOCUMENT_TARGETS[key]], content);
  for (const [key, value] of valueEntries) writeJson(paths[PROJECT_STATE_TARGETS[key]], value);
  deleteJson(paths.stateTransaction);
}

function writeProjectState(paths, values) {
  const entries = Object.entries(values || {});
  if (!entries.length) throw new Error("PPT Live state transaction requires at least one value");
  for (const [key] of entries) {
    if (!PROJECT_STATE_TARGETS[key]) throw new Error(`Unsupported PPT Live state target '${key}'`);
  }
  writeJson(paths.stateTransaction, {
    schemaVersion: 1,
    status: "pending",
    values: clone(values),
    createdAt: nowIso(),
  });
  for (const [key, value] of entries) writeJson(paths[PROJECT_STATE_TARGETS[key]], value);
  deleteJson(paths.stateTransaction);
}

function readJson(filePath, fallback) {
  if (isStateTarget(filePath)) {
    const control = readControl(filePath.controlFile, null);
    if (!control?.state || !Object.prototype.hasOwnProperty.call(control.state, filePath.key)) {
      return clone(fallback);
    }
    return clone(control.state[filePath.key]);
  }
  return readFileJson(filePath, fallback);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePresentationDirectoryName(value) {
  let normalized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 96);
  if (!normalized) normalized = "Untitled presentation";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
    normalized = `_${normalized}`;
  }
  return normalized;
}

function defaultPptIndex() {
  return {
    schemaVersion: PPT_INDEX_SCHEMA_VERSION,
    works: {},
    objects: {},
    updatedAt: nowIso(),
  };
}

function loadPptIndex(indexFile) {
  const index = readFileJson(indexFile, defaultPptIndex());
  if (!index || index.schemaVersion !== PPT_INDEX_SCHEMA_VERSION || typeof index.works !== "object" || Array.isArray(index.works)) {
    throw new Error("Workspace PPT index is invalid");
  }
  if (index.objects == null) index.objects = {};
  if (typeof index.objects !== "object" || Array.isArray(index.objects)) {
    throw new Error("Workspace PPT WorkObject index is invalid");
  }
  return index;
}

function relativeWorkspacePath(workspaceRoot, target) {
  return path.relative(workspaceRoot, target).split(path.sep).join("/");
}

function controlMatchesWork(controlFile, workId) {
  try {
    const control = readControl(controlFile, null);
    return Boolean(control && control.schemaVersion === CONTROL_SCHEMA_VERSION && control.workId === workId);
  } catch (_error) {
    return false;
  }
}

function controlMatchesWorkObject(controlFile, workObjectId) {
  try {
    const control = readControl(controlFile, null);
    return Boolean(
      control
      && control.schemaVersion === CONTROL_SCHEMA_VERSION
      && control.workObjectId === workObjectId
    );
  } catch (_error) {
    return false;
  }
}

function locatePresentationRoot(workspaceRoot, workId, workObjectId, indexFile) {
  const index = loadPptIndex(indexFile);
  const indexed = workObjectId ? index.objects[workObjectId] : index.works[workId];
  if (typeof indexed === "string" && indexed.trim()) {
    const candidate = path.resolve(workspaceRoot, indexed);
    const pptRoot = path.join(workspaceRoot, PPT_DIRECTORY);
    const matches = workObjectId
      ? controlMatchesWorkObject(path.join(candidate, ".ppt-live.json"), workObjectId)
      : controlMatchesWork(path.join(candidate, ".ppt-live.json"), workId);
    if (isInside(pptRoot, candidate) && matches) {
      return candidate;
    }
  }

  const pptRoot = path.join(workspaceRoot, PPT_DIRECTORY);
  if (!fs.existsSync(pptRoot)) return null;
  for (const entry of fs.readdirSync(pptRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(pptRoot, entry.name);
    const controlFile = path.join(candidate, ".ppt-live.json");
    if (workObjectId && controlMatchesWorkObject(controlFile, workObjectId)) return candidate;
    if (!workObjectId && controlMatchesWork(controlFile, workId)) return candidate;
  }
  if (workObjectId) return locatePresentationRoot(workspaceRoot, workId, null, indexFile);
  return null;
}

function uniquePresentationRoot(workspaceRoot, title) {
  const pptRoot = path.join(workspaceRoot, PPT_DIRECTORY);
  const baseName = safePresentationDirectoryName(title);
  let candidate = path.join(pptRoot, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(pptRoot, `${baseName} (${suffix})`);
    suffix += 1;
  }
  return candidate;
}

function projectPaths(trusted, options = {}) {
  if (!trusted.workspacePath || typeof trusted.workspacePath !== "string") {
    throw new Error("PPT Live requires a host-bound workspace root");
  }
  if (!trusted.workId || typeof trusted.workId !== "string") {
    throw new Error("PPT Live requires a host-bound Work id");
  }
  const workspaceRoot = path.resolve(trusted.workspacePath);
  const workId = safeId(trusted.workId, "work");
  const workObjectId = trusted.workObjectId
    ? safeId(trusted.workObjectId, "object")
    : null;
  const indexFile = path.join(workspaceRoot, ".sparo_os", "ppt-index.json");
  let root = locatePresentationRoot(workspaceRoot, workId, workObjectId, indexFile);
  if (!root && options.create === true) {
    root = uniquePresentationRoot(workspaceRoot, options.title || trusted.workTitle);
  }
  if (!root) {
    const identity = workObjectId || workId;
    const error = new Error(`PPT Live presentation '${identity}' is not initialized in this workspace`);
    error.code = "ppt_work_not_initialized";
    throw error;
  }
  if (!isInside(workspaceRoot, root)) {
    throw new Error("Resolved PPT Live project escaped the trusted workspace root");
  }
  const controlFile = path.join(root, ".ppt-live.json");
  if (workObjectId) {
    const control = readControl(controlFile, null);
    if (control?.workObjectId && control.workObjectId !== workObjectId) {
      throw new Error("Resolved PPT Live presentation belongs to another WorkObject");
    }
    if (!control?.workObjectId && control?.workId === workId) {
      control.workObjectId = workObjectId;
      control.updatedAt = nowIso();
      writeControl(controlFile, control);
      const index = loadPptIndex(indexFile);
      index.objects[workObjectId] = relativeWorkspacePath(workspaceRoot, root);
      index.updatedAt = nowIso();
      writeJson(indexFile, index);
    }
  }
  return {
    workspaceRoot,
    workId,
    workObjectId,
    root,
    indexFile,
    controlFile,
    assets: path.join(root, "assets"),
    render: path.join(root, "preview"),
    exports: root,
    manuscript: path.join(root, "内容.md"),
    speakerScript: path.join(root, "演讲稿.md"),
    designDocument: path.join(root, "设计说明.md"),
    project: stateTarget(controlFile, "project"),
    presentationSystem: stateTarget(controlFile, "presentationSystem"),
    presentationDesignPackage: stateTarget(controlFile, "presentationDesignPackage"),
    designCase: stateTarget(controlFile, "designCase"),
    deck: stateTarget(controlFile, "deck"),
    visualDocument: stateTarget(controlFile, "visualDocument"),
    assetsFile: stateTarget(controlFile, "assets"),
    historyFile: stateTarget(controlFile, "history"),
    stateTransaction: stateTarget(controlFile, "stateTransaction"),
    latestReview: stateTarget(controlFile, "latestReview"),
    manuscriptReview: stateTarget(controlFile, "manuscriptReview"),
  };
}

function initialDesignCase(deckId) {
  return {
    schemaVersion: DESIGN_CASE_SCHEMA_VERSION,
    deckId,
    revision: 0,
    status: "notRendered",
    caseId: null,
    manuscriptRevision: 0,
    manuscriptHash: "",
    systemRevision: 0,
    systemHash: "",
    sampleSlides: [],
    decision: null,
    updatedAt: nowIso(),
  };
}

function initialManuscript(deckId) {
  return serializeManuscript(initialStructuredDocuments(deckId).manuscript);
}

function initialSpeakerScript(deckId) {
  const documents = initialStructuredDocuments(deckId);
  return serializeSpeakerScript(documents.speakerScript, documents.manuscript);
}

function initialPresentationSystem() {
  return {
    ...clone(DEFAULT_PRESENTATION_SYSTEM),
    revision: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function initialDeck(deckId) {
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    deckId,
    revision: 0,
    title: "Untitled presentation",
    presentationSystemRevision: 0,
    presentationSystemHash: "",
    slides: [],
    selection: null,
    source: {
      manuscriptHash: "",
      speakerScriptHash: "",
    },
    lastIntent: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function syncPptIndex(paths) {
  const index = loadPptIndex(paths.indexFile);
  const control = readControl(paths.controlFile, null);
  if (!control || control.schemaVersion !== CONTROL_SCHEMA_VERSION || control.appId !== APP_ID) {
    throw new Error("PPT Live control file is missing or invalid");
  }
  index.schemaVersion = PPT_INDEX_SCHEMA_VERSION;
  const relativeRoot = relativeWorkspacePath(paths.workspaceRoot, paths.root);
  if (control.workId) index.works[control.workId] = relativeRoot;
  if (control.workObjectId) index.objects[control.workObjectId] = relativeRoot;
  index.updatedAt = nowIso();
  writeJson(paths.indexFile, index);
}

function designDocumentContent(paths) {
  const system = readJson(paths.presentationSystem, initialPresentationSystem());
  const designCase = readJson(paths.designCase, initialDesignCase(`deck-${safeId(paths.workId)}`));
  const palette = system.tokens?.color || {};
  const samples = (designCase.sampleSlides || [])
    .map((slide, index) => `${index + 1}. ${slide.title || slide.id || `Slide ${index + 1}`}`)
    .join("\n");
  return `# ${system.name || "Presentation design"}\n\n`
    + `- PresentationSystem revision: ${Number(system.revision || 0)}\n`
    + `- Design Case status: ${designCase.status || "notRendered"}\n`
    + `- Design Case revision: ${Number(designCase.revision || 0)}\n\n`
    + "## Color system\n\n"
    + `- Canvas: ${palette.canvas || ""}\n`
    + `- Surface: ${palette.surface || ""}\n`
    + `- Ink: ${palette.ink || ""}\n`
    + `- Primary: ${palette.primary || ""}\n`
    + `- Accent: ${palette.accent || ""}\n\n`
    + "## Design Case samples\n\n"
    + `${samples || "Not rendered yet."}\n`;
}

function syncHumanReadableDesign(paths) {
  atomicWrite(paths.designDocument, designDocumentContent(paths));
}

function syncControlMetadata(paths, presentationFile = undefined) {
  const control = readControl(paths.controlFile, null);
  if (!control?.state) throw new Error("PPT Live control file is missing or invalid");
  const deck = control.state.deck || initialDeck(`deck-${safeId(paths.workId)}`);
  const project = control.state.project || {};
  control.title = deck.title || control.title || "Untitled presentation";
  control.deckId = deck.deckId;
  control.deckRevision = Number(deck.revision || 0);
  control.deckSchemaVersion = String(DECK_SCHEMA_VERSION);
  if (presentationFile !== undefined) control.presentationFile = presentationFile;
  control.updatedAt = deck.updatedAt || project.updatedAt || nowIso();
  writeControl(paths.controlFile, control);
  syncPptIndex(paths);
}

function bindControlSession(paths, sessionId) {
  const normalized = text(sessionId, "", 200);
  if (!normalized) return;
  const control = readControl(paths.controlFile, null);
  if (!control) return;
  control.sessionRefs = Array.isArray(control.sessionRefs) ? control.sessionRefs : [];
  if (control.sessionRefs.includes(normalized)) return;
  control.sessionRefs.push(normalized);
  control.updatedAt = nowIso();
  writeControl(paths.controlFile, control);
}

function initializeProject(paths, input = {}, trusted = {}) {
  if (fs.existsSync(paths.controlFile)) {
    const control = readControl(paths.controlFile, null);
    if (paths.workObjectId) {
      if (control?.workObjectId && control.workObjectId !== paths.workObjectId) {
        throw new Error("PPT Live presentation directory belongs to another WorkObject");
      }
      if (!control?.workObjectId) {
        if (control?.workId !== paths.workId) {
          throw new Error("PPT Live presentation directory belongs to another Work");
        }
        control.workObjectId = paths.workObjectId;
        control.updatedAt = nowIso();
        writeControl(paths.controlFile, control);
        syncPptIndex(paths);
      }
    } else if (!controlMatchesWork(paths.controlFile, paths.workId)) {
      throw new Error("PPT Live presentation directory belongs to another Work");
    }
    ensureProject(paths);
    return;
  }
  fs.mkdirSync(paths.root, { recursive: true });
  fs.mkdirSync(paths.assets, { recursive: true });
  fs.mkdirSync(paths.render, { recursive: true });
  const deckId = `deck-${safeId(paths.workId)}`;
  const title = text(input.title || trusted.workTitle, "Untitled presentation", 200);
  const manuscriptContent = initialManuscript(deckId);
  const speakerContent = initialSpeakerScript(deckId);
  const presentationSystem = initialPresentationSystem();
  const systemHash = presentationSystemHash(presentationSystem);
  const designPackage = createDesignPackage(presentationSystem, systemHash);
  const deck = initialDeck(deckId);
  deck.title = title;
  deck.presentationSystemHash = systemHash;
  atomicWrite(paths.manuscript, manuscriptContent);
  atomicWrite(paths.speakerScript, speakerContent);
  const createdAt = nowIso();
  writeControl(paths.controlFile, {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    appId: APP_ID,
    appVersion: APP_VERSION,
    workId: paths.workId,
    workObjectId: paths.workObjectId,
    deckId,
    title,
    revision: 0,
    deckRevision: 0,
    deckSchemaVersion: String(DECK_SCHEMA_VERSION),
    presentationFile: null,
    contentFile: path.basename(paths.manuscript),
    speakerScriptFile: path.basename(paths.speakerScript),
    designFile: path.basename(paths.designDocument),
    assetsDirectory: path.basename(paths.assets),
    previewDirectory: path.basename(paths.render),
    sessionRefs: trusted.sessionId ? [trusted.sessionId] : [],
    createdAt,
    updatedAt: createdAt,
    state: {
      project: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      deckId,
      revision: 0,
      documents: {
        manuscript: { revision: 1, hash: sha256(manuscriptContent) },
        speakerScript: { revision: 1, hash: sha256(speakerContent) },
      },
      slideMap: [],
        updatedAt: createdAt,
      },
      presentationSystem,
      presentationDesignPackage: designPackage,
      designCase: initialDesignCase(deckId),
      deck,
      visualDocument: initialVisualDocument(deckId, designPackage),
      assets: { schemaVersion: 1, assets: [] },
      history: { schemaVersion: 2, undo: [] },
      latestReview: null,
      manuscriptReview: null,
    },
  });
  syncHumanReadableDesign(paths);
  syncPptIndex(paths);
}

function attachWorkObject(input = {}, trusted = {}) {
  if (!trusted.workspacePath || typeof trusted.workspacePath !== "string") {
    throw new Error("PPT Live requires a host-bound workspace root");
  }
  if (!trusted.workId || typeof trusted.workId !== "string") {
    throw new Error("PPT Live requires a host-bound Work id");
  }
  if (!trusted.workObjectId || typeof trusted.workObjectId !== "string") {
    throw new Error("PPT Live requires a host-bound WorkObject id to attach existing content");
  }
  const sourceWorkId = safeId(requiredText(input.sourceWorkId, "sourceWorkId", 128));
  const targetWorkId = safeId(trusted.workId, "work");
  const workObjectId = safeId(trusted.workObjectId, "object");
  if (sourceWorkId === targetWorkId) {
    throw new Error("PPT Live requires a different source Work when attaching a WorkObject");
  }

  const workspaceRoot = path.resolve(trusted.workspacePath);
  const indexFile = path.join(workspaceRoot, ".sparo_os", "ppt-index.json");
  const existingRoot = locatePresentationRoot(
    workspaceRoot,
    "__unbound_work__",
    workObjectId,
    indexFile,
  );
  if (existingRoot) {
    const paths = projectPaths(trusted);
    ensureProject(paths);
    bindControlSession(paths, trusted.sessionId);
    return inspect(paths, input);
  }

  const sourcePaths = projectPaths({ ...trusted, workId: sourceWorkId, workObjectId: null });
  ensureProject(sourcePaths);
  const control = readControl(sourcePaths.controlFile, null);
  if (!control || control.schemaVersion !== CONTROL_SCHEMA_VERSION || control.appId !== APP_ID) {
    throw new Error("PPT Live source presentation state is missing or invalid");
  }
  if (control.workObjectId && control.workObjectId !== workObjectId) {
    throw new Error("PPT Live source presentation belongs to another WorkObject");
  }
  control.workObjectId = workObjectId;
  control.updatedAt = nowIso();
  writeControl(sourcePaths.controlFile, control);
  syncPptIndex({ ...sourcePaths, workObjectId });

  const paths = projectPaths(trusted);
  ensureProject(paths);
  bindControlSession(paths, trusted.sessionId);
  return inspect(paths, input);
}

function ensureProject(paths) {
  const control = readControl(paths.controlFile, null);
  const identityMatches = paths.workObjectId
    ? control?.workObjectId === paths.workObjectId
    : control?.workId === paths.workId;
  if (!control || control.schemaVersion !== CONTROL_SCHEMA_VERSION || control.appId !== APP_ID || !identityMatches) {
    const identity = paths.workObjectId || paths.workId;
    const error = new Error(`PPT Live presentation '${identity}' is missing or invalid`);
    error.code = "ppt_work_state_missing";
    throw error;
  }
  for (const documentPath of [paths.manuscript, paths.speakerScript, paths.designDocument]) {
    if (!fs.existsSync(documentPath)) {
      const error = new Error(`PPT Live presentation document is missing: ${path.basename(documentPath)}`);
      error.code = "ppt_work_state_missing";
      throw error;
    }
  }
  for (const target of [
    paths.project,
    paths.presentationSystem,
    paths.presentationDesignPackage,
    paths.designCase,
    paths.deck,
    paths.visualDocument,
    paths.assetsFile,
    paths.historyFile,
  ]) {
    if (!jsonExists(target)) {
      const error = new Error(`PPT Live control state is missing: ${target.key}`);
      error.code = "ppt_work_state_missing";
      throw error;
    }
  }
  fs.mkdirSync(paths.assets, { recursive: true });
  fs.mkdirSync(paths.render, { recursive: true });
  recoverProjectState(paths);
  syncPptIndex(paths);
}

function syncDocumentMetadata(paths) {
  const project = readJson(paths.project, { documents: {} });
  let changed = project.schemaVersion !== PROJECT_SCHEMA_VERSION;
  project.schemaVersion = PROJECT_SCHEMA_VERSION;
  project.documents = project.documents || {};
  for (const [id, filePath] of [
    ["manuscript", paths.manuscript],
    ["speakerScript", paths.speakerScript],
  ]) {
    const content = fs.readFileSync(filePath, "utf8");
    const hash = sha256(content);
    const previous = project.documents[id] || { revision: 0, hash: "" };
    const next = {
      revision: previous.hash === hash
        ? Number(previous.revision || 1)
        : Number(previous.revision || 0) + 1,
      hash,
    };
    if (previous.revision !== next.revision || previous.hash !== next.hash) changed = true;
    project.documents[id] = next;
  }
  if (changed) {
    project.updatedAt = nowIso();
    writeJson(paths.project, project);
  }
  return project;
}

function assertExpectedRevision(actual, expected, subject) {
  const parsed = Number(expected);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${subject} expectedRevision must be a non-negative integer`);
  }
  if (parsed !== Number(actual)) {
    throw new Error(`${subject} revision conflict: expected ${parsed}, current ${actual}`);
  }
}

function assertBaselineRevision(actual, expected, subject) {
  const parsed = Number(expected);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${subject} expectedRevision must be a non-negative integer`);
  }
  if (parsed > Number(actual)) {
    throw new Error(`${subject} revision conflict: expected ${parsed}, current ${actual}`);
  }
  return parsed;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return value.trim();
}

function requiredNumber(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function normalizeElementStyle(value, name, presentationSystem) {
  if (value === undefined) return {};
  const style = { ...objectValue(value, `${name}.style`) };
  for (const rawTypographyField of ["size", "fontSize", "fontWeight", "fontFamily"]) {
    delete style[rawTypographyField];
  }
  assertKeys(style, new Set([
    "textRole", "colorToken", "fillToken", "strokeToken", "radiusRole", "opacity",
    "align", "valign", "strokeWidth", "dash", "padding",
  ]), `${name}.style`);
  const normalized = {};
  const colors = tokenNames(presentationSystem);
  for (const key of ["colorToken", "fillToken", "strokeToken"]) {
    if (style[key] === undefined) continue;
    if (!colors.has(style[key])) throw new Error(`${name}.style.${key} must reference a registered PresentationSystem token`);
    normalized[key] = style[key];
  }
  if (style.textRole !== undefined) {
    if (!TEXT_ROLES.includes(style.textRole)) throw new Error(`${name}.style.textRole is unsupported`);
    normalized.textRole = style.textRole;
  }
  if (style.align !== undefined) {
    if (!["left", "center", "right"].includes(style.align)) throw new Error(`${name}.style.align must be left, center, or right`);
    normalized.align = style.align;
  }
  if (style.valign !== undefined) {
    if (!["top", "middle", "bottom"].includes(style.valign)) throw new Error(`${name}.style.valign must be top, middle, or bottom`);
    normalized.valign = style.valign;
  }
  if (style.opacity !== undefined) normalized.opacity = requiredNumber(style.opacity, `${name}.style.opacity`, 0, 1);
  if (style.strokeWidth !== undefined) normalized.strokeWidth = requiredNumber(style.strokeWidth, `${name}.style.strokeWidth`, 0, 24);
  if (style.dash !== undefined) {
    if (!["solid", "dash", "dot"].includes(style.dash)) throw new Error(`${name}.style.dash must be solid, dash, or dot`);
    normalized.dash = style.dash;
  }
  if (style.radiusRole !== undefined) {
    if (!["none", "small", "medium"].includes(style.radiusRole)) throw new Error(`${name}.style.radiusRole is unsupported`);
    normalized.radiusRole = style.radiusRole;
  }
  if (style.padding !== undefined) normalized.padding = requiredNumber(style.padding, `${name}.style.padding`, 0, 100);
  return normalized;
}

function normalizeGroupLayout(value, name) {
  if (value === undefined) return { mode: "freeform" };
  const layout = objectValue(value, `${name}.layout`);
  assertKeys(layout, new Set(["mode", "gap", "padding", "columns", "align", "justify"]), `${name}.layout`);
  if (!["stack", "row", "grid", "overlay", "freeform"].includes(layout.mode)) throw new Error(`${name}.layout.mode is unsupported`);
  const normalized = { mode: layout.mode };
  if (layout.gap !== undefined) normalized.gap = requiredNumber(layout.gap, `${name}.layout.gap`, 0, 30);
  if (layout.padding !== undefined) normalized.padding = requiredNumber(layout.padding, `${name}.layout.padding`, 0, 30);
  if (layout.columns !== undefined) normalized.columns = requiredNumber(layout.columns, `${name}.layout.columns`, 1, 12);
  if (layout.align !== undefined) {
    if (!["start", "center", "end", "stretch"].includes(layout.align)) throw new Error(`${name}.layout.align is unsupported`);
    normalized.align = layout.align;
  }
  if (layout.justify !== undefined) {
    if (!["start", "center", "end", "space-between"].includes(layout.justify)) throw new Error(`${name}.layout.justify is unsupported`);
    normalized.justify = layout.justify;
  }
  return normalized;
}

function normalizeElement(value, index, presentationSystem, assets, parentName = "element") {
  const name = `${parentName} ${index + 1}`;
  const element = objectValue(value, name);
  assertKeys(element, new Set([
    "id", "type", "x", "y", "w", "h", "z", "text", "style", "shape",
    "assetId", "alt", "data", "rows", "children", "layout",
  ]), name);
  if (!ELEMENT_TYPES.has(element.type)) {
    throw new Error(`${name}.type must be text, shape, line, image, svg, chart, table, or group`);
  }
  const type = element.type;
  const rawId = requiredText(element.id, `${name}.id`, 128);
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(rawId)) {
    throw new Error(`${name}.id must use lowercase letters, numbers, underscores, or hyphens`);
  }
  const normalized = {
    id: rawId,
    type,
    x: requiredNumber(element.x, `${name}.x`, 0, 100),
    y: requiredNumber(element.y, `${name}.y`, 0, 100),
    w: requiredNumber(element.w, `${name}.w`, 0.1, 100),
    h: requiredNumber(element.h, `${name}.h`, 0.1, 100),
    z: element.z === undefined ? index : requiredNumber(element.z, `${name}.z`, -1000, 1000),
    style: normalizeElementStyle(element.style, name, presentationSystem),
  };
  const horizontalOverflow = normalized.x + normalized.w - 100;
  const verticalOverflow = normalized.y + normalized.h - 100;
  const canSnapHorizontally = 100 - normalized.x >= 0.1;
  const canSnapVertically = 100 - normalized.y >= 0.1;
  if (horizontalOverflow > 0 && horizontalOverflow <= GEOMETRY_SNAP_TOLERANCE && canSnapHorizontally) {
    normalized.w = 100 - normalized.x;
  }
  if (verticalOverflow > 0 && verticalOverflow <= GEOMETRY_SNAP_TOLERANCE && canSnapVertically) {
    normalized.h = 100 - normalized.y;
  }
  if (
    horizontalOverflow > GEOMETRY_SNAP_TOLERANCE ||
    verticalOverflow > GEOMETRY_SNAP_TOLERANCE ||
    (horizontalOverflow > 0 && !canSnapHorizontally) ||
    (verticalOverflow > 0 && !canSnapVertically)
  ) {
    throw new Error(
      `${name} '${rawId}' extends outside the slide canvas (x=${normalized.x}, y=${normalized.y}, w=${normalized.w}, h=${normalized.h})`,
    );
  }
  if (type === "text") {
    normalized.text = requiredText(element.text, `${name}.text`, 4000);
  } else if (type === "shape") {
    const shape = element.shape || "rect";
    if (!["rect", "roundRect", "ellipse"].includes(shape)) {
      throw new Error(`${name}.shape must be rect, roundRect, or ellipse`);
    }
    normalized.shape = shape;
    normalized.text = typeof element.text === "string" ? element.text.trim().slice(0, 1200) : "";
  } else if (type === "line") {
    normalized.text = "";
  } else if (type === "image" || type === "svg") {
    normalized.assetId = requiredText(element.assetId, `${name}.assetId`, 128);
    const asset = assets.get(normalized.assetId);
    if (!asset) throw new Error(`${name} references missing asset '${normalized.assetId}'`);
    normalized.type = asset.kind === "svg" ? "svg" : "image";
    normalized.alt = requiredText(element.alt, `${name}.alt`, 500);
  } else if (type === "chart") {
    normalized.text = requiredText(element.text, `${name}.text`, 500);
    if (!Array.isArray(element.data) || element.data.length < 2 || element.data.length > 24) {
      throw new Error(`${name}.data must contain between 2 and 24 points`);
    }
    normalized.data = element.data.map((point, pointIndex) => {
      const item = objectValue(point, `${name}.data[${pointIndex}]`);
      assertKeys(item, new Set(["label", "value"]), `${name}.data[${pointIndex}]`);
      if (typeof item.value !== "number" || !Number.isFinite(item.value)) {
        throw new Error(`${name}.data[${pointIndex}].value must be a finite number`);
      }
      return { label: requiredText(item.label, `${name}.data[${pointIndex}].label`, 120), value: item.value };
    });
  } else if (type === "table") {
    if (!Array.isArray(element.rows) || element.rows.length < 1 || element.rows.length > 20) {
      throw new Error(`${name}.rows must contain between 1 and 20 rows`);
    }
    normalized.rows = element.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 12) {
        throw new Error(`${name}.rows[${rowIndex}] must contain between 1 and 12 cells`);
      }
      return row.map((cell, cellIndex) => requiredText(cell, `${name}.rows[${rowIndex}][${cellIndex}]`, 500));
    });
    const columnCount = normalized.rows[0].length;
    if (normalized.rows.some((row) => row.length !== columnCount)) throw new Error(`${name}.rows must use a consistent column count`);
  } else if (type === "group") {
    if (!Array.isArray(element.children) || element.children.length < 1 || element.children.length > 40) {
      throw new Error(`${name}.children must contain between 1 and 40 elements`);
    }
    normalized.layout = normalizeGroupLayout(element.layout, name);
    normalized.children = element.children.map((child, childIndex) => normalizeElement(child, childIndex, presentationSystem, assets, `${name}.child`));
  }
  return normalized;
}

function normalizeSlide(value, index, presentationSystem, designPackage, assets) {
  objectValue(value, `Slide ${index + 1}`);
  assertKeys(value, new Set([
    "id", "title", "claim", "pageRole", "visualMode", "visualPlan", "evidenceObject",
    "exportStrategy", "sourceNote", "notes", "elements", "recipeId", "layoutMode", "composition",
    "revision", "status", "designSystemRevision", "designSystemHash", "sourceHash",
    "createdAt", "updatedAt", "lastGoodPreviewRef", "lastError",
  ]), `Slide ${index + 1}`);
  const rawId = requiredText(value.id, `Slide ${index + 1}.id`, 128);
  const id = safeId(rawId, "");
  if (!id || id !== rawId) throw new Error(`Slide ${index + 1}.id must use lowercase letters, numbers, underscores, or hyphens`);
  const title = requiredText(value.title, `Slide '${id}'.title`, 240);
  if (!["native", "diagram", "chart", "media", "custom-vector"].includes(value.visualMode)) {
    throw new Error(`Slide '${id}'.visualMode is required and unsupported`);
  }
  if (!["native", "native-shapes", "native-chart", "svg", "image"].includes(value.exportStrategy)) {
    throw new Error(`Slide '${id}'.exportStrategy is required and unsupported`);
  }
  const pageRole = requiredText(value.pageRole, `Slide '${id}'.pageRole`, 80);
  if (!presentationSystem.archetypes.some((archetype) => archetype.id === pageRole)) {
    throw new Error(`Slide '${id}'.pageRole '${pageRole}' is not registered in PresentationSystem`);
  }
  const slide = {
    id,
    title,
    claim: requiredText(value.claim, `Slide '${id}'.claim`, 600),
    pageRole,
    visualMode: value.visualMode,
    visualPlan: requiredText(value.visualPlan, `Slide '${id}'.visualPlan`, 1200),
    evidenceObject: requiredText(value.evidenceObject, `Slide '${id}'.evidenceObject`, 500),
    exportStrategy: value.exportStrategy,
    sourceNote: text(value.sourceNote, "", 500),
    notes: text(value.notes, "", 8000),
  };
  const layoutMode = value.layoutMode || (value.composition ? "recipe" : "custom");
  if (!["recipe", "custom"].includes(layoutMode)) throw new Error(`Slide '${id}'.layoutMode must be recipe or custom`);
  slide.layoutMode = layoutMode;
  if (layoutMode === "recipe") {
    const recipeId = text(value.recipeId, defaultRecipeId(designPackage, pageRole), 80);
    const recipe = recipeById(designPackage, recipeId);
    if (!recipe || recipe.legacy) throw new Error(`Slide '${id}'.recipeId '${recipeId}' is unavailable`);
    slide.recipeId = recipeId;
    slide.composition = normalizeComposition(value.composition, recipeId, pageRole, designPackage, presentationSystem, assets);
    slide.elements = [];
  } else {
    slide.recipeId = "legacy-freeform";
    if (!Array.isArray(value.elements) || value.elements.length < 1 || value.elements.length > 80) {
      throw new Error(`Slide '${id}'.elements must contain between 1 and 80 authored elements`);
    }
    slide.elements = value.elements.map((element, elementIndex) => (
      normalizeElement(element, elementIndex, presentationSystem, assets, `Slide '${id}' element`)
    ));
  }
  if (!slide.elements.some((element) => element.type !== "line")) {
    if (layoutMode === "custom") throw new Error(`Slide '${id}' must contain at least one visible element`);
  }
  const flattened = layoutMode === "recipe"
    ? slide.composition.slots
    : slide.elements.flatMap(function flatten(element) {
      return element.type === "group" ? [element, ...element.children.flatMap(flatten)] : [element];
    });
  const elementIds = flattened.map((element) => element.id);
  if (new Set(elementIds).size !== elementIds.length) throw new Error(`Slide '${id}' contains duplicate element ids`);
  const elementTypes = new Set(flattened.map((element) => element.type));
  if (slide.exportStrategy === "svg" && !elementTypes.has("svg")) throw new Error(`Slide '${id}' exportStrategy svg requires an svg element`);
  if (slide.exportStrategy === "image" && !elementTypes.has("image")) throw new Error(`Slide '${id}' exportStrategy image requires an image element`);
  if (slide.exportStrategy === "native-chart" && !elementTypes.has("chart")) throw new Error(`Slide '${id}' exportStrategy native-chart requires a chart element`);
  if (slide.exportStrategy === "native-shapes" && !elementTypes.has("shape") && !elementTypes.has("line")) {
    throw new Error(`Slide '${id}' exportStrategy native-shapes requires a shape or line element`);
  }
  if (slide.visualMode === "chart" && !["chart", "svg", "image"].some((type) => elementTypes.has(type))) {
    throw new Error(`Slide '${id}' visualMode chart requires a native chart or grounded chart asset`);
  }
  if (slide.visualMode === "media" && !elementTypes.has("image")) throw new Error(`Slide '${id}' visualMode media requires an image element`);
  if (slide.visualMode === "custom-vector" && !elementTypes.has("svg")) throw new Error(`Slide '${id}' visualMode custom-vector requires an svg element`);
  if (slide.visualMode === "diagram" && !elementTypes.has("svg") && !elementTypes.has("shape") && !elementTypes.has("line")) {
    throw new Error(`Slide '${id}' visualMode diagram requires svg, shape, or line elements`);
  }
  return slide;
}

function normalizeSlides(values, presentationSystem, designPackage, assets) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("VisualDeck requires at least one slide");
  }
  if (values.length > 60) throw new Error("VisualDeck supports at most 60 slides");
  const slides = values.map((slide, index) => normalizeSlide(slide, index, presentationSystem, designPackage, assets));
  const ids = new Set();
  for (const slide of slides) {
    if (ids.has(slide.id)) throw new Error(`Duplicate slide id '${slide.id}'`);
    ids.add(slide.id);
  }
  return slides;
}

function buildManuscriptState(manuscript, speakerScript, project) {
  const parsed = parsePresentationMarkdown(manuscript, speakerScript);
  const speakerById = new Map(parsed.speakerScript.slides.map((slide) => [slide.slideId, slide]));
  return {
    schemaVersion: parsed.manuscript.schemaVersion,
    deckId: project.deckId,
    status: "committed",
    revision: project.documents.manuscript.revision,
    contentHash: project.documents.manuscript.hash,
    speakerScriptRevision: project.documents.speakerScript.revision,
    speakerScriptHash: project.documents.speakerScript.hash,
    language: parsed.manuscript.language,
    title: parsed.manuscript.title,
    creativeBrief: parsed.manuscript.creativeBrief,
    narrative: parsed.manuscript.narrative,
    slides: parsed.manuscript.slides.map((slide, index) => ({
      slideId: slide.slideId,
      position: index + 1,
      title: slide.title,
      coreClaim: slide.coreClaim,
      visibleCopy: slide.visibleCopy,
      evidenceAndSources: slide.evidenceAndSources,
      visualDirection: slide.visualDirection,
      speakingObjective: slide.speakingObjective,
      sectionHash: manuscriptSlideHash(manuscript, index),
      speakerScript: speakerById.get(slide.slideId) || null,
    })),
  };
}

function loadAssets(paths) {
  const registry = readJson(paths.assetsFile, { schemaVersion: 1, assets: [] });
  const assets = Array.isArray(registry.assets) ? registry.assets : [];
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function saveAssets(paths, assets) {
  writeJson(paths.assetsFile, { schemaVersion: 1, assets: [...assets.values()] });
}

function updateSlideMap(paths, deck, manuscript, speakerScript) {
  const project = readJson(paths.project, { documents: {} });
  const manuscriptSections = slideSections(manuscript);
  const speakerSections = slideSections(speakerScript);
  project.slideMap = deck.slides.map((slide, index) => ({
    slideId: slide.id,
    position: index + 1,
    title: slide.title,
    manuscriptHeading: manuscriptSections[index]?.title || null,
    speakerHeading: speakerSections[index]?.title || null,
  }));
  project.updatedAt = nowIso();
  writeJson(paths.project, project);
}

function solveGroupChildren(group) {
  const children = group.children || [];
  const layout = group.layout || { mode: "freeform" };
  if (layout.mode === "freeform" || layout.mode === "overlay" || !children.length) return children;
  const padding = Number(layout.padding || 0);
  const gap = Number(layout.gap || 0);
  const innerW = Math.max(0.1, 100 - padding * 2);
  const innerH = Math.max(0.1, 100 - padding * 2);
  if (layout.mode === "stack") {
    const height = Math.max(0.1, (innerH - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding, y: padding + index * (height + gap), w: innerW, h: height }));
  }
  if (layout.mode === "row") {
    const width = Math.max(0.1, (innerW - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding + index * (width + gap), y: padding, w: width, h: innerH }));
  }
  const columns = Math.min(children.length, Math.max(1, Math.round(layout.columns || Math.ceil(Math.sqrt(children.length)))));
  const rows = Math.ceil(children.length / columns);
  const width = Math.max(0.1, (innerW - gap * (columns - 1)) / columns);
  const height = Math.max(0.1, (innerH - gap * (rows - 1)) / rows);
  return children.map((child, index) => ({
    ...child,
    x: padding + (index % columns) * (width + gap),
    y: padding + Math.floor(index / columns) * (height + gap),
    w: width,
    h: height,
  }));
}

function presentationSystemContent(value) {
  const { revision, createdAt, updatedAt, contentHash, ...content } = value || {};
  return normalizePresentationSystem(content);
}

function presentationSystemHash(value) {
  return sha256(JSON.stringify(presentationSystemContent(value)));
}

function hexLuminance(value) {
  const channels = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(left, right) {
  if (left === "transparent" || right === "transparent") return 21;
  const a = hexLuminance(left);
  const b = hexLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function diagnosticId(rule) {
  const identity = {
    level: String(rule?.level || ""),
    code: String(rule?.code || ""),
    artifact: String(rule?.artifact || ""),
    message: String(rule?.message || ""),
    slideIds: [...new Set((rule?.slideIds || []).map(String))].sort(),
    elementIds: [...new Set((rule?.elementIds || []).map(String))].sort(),
  };
  return `diagnostic-${sha256(JSON.stringify(identity)).slice(0, 20)}`;
}

function ruleViolationsFor(deck, manuscriptState, presentationSystemState, manuscriptContent, speakerScript, assets, visualDocument = null) {
  const rules = [];
  const presentationSystem = presentationSystemContent(presentationSystemState);
  const systemHash = presentationSystemHash(presentationSystemState);
  const push = (code, artifact, message, slideIds = [], elementIds = []) => {
    const rule = { level: "error", code, artifact, message, slideIds, elementIds };
    rules.push({ ...rule, id: diagnosticId(rule), kind: "RuleViolation" });
  };

  if (containsEmbeddedHtml(manuscriptContent)) {
    push("manuscript_embedded_html", "manuscript", "Manuscript must be pure Markdown without embedded HTML.");
  }
  if (containsEmbeddedHtml(speakerScript)) {
    push("speaker_embedded_html", "speakerScript", "Speaker script must be pure Markdown without embedded HTML.");
  }
  if (deck.presentationSystemRevision !== presentationSystemState.revision || deck.presentationSystemHash !== systemHash) {
    push(
      "presentation_system_binding_stale",
      "presentationSystem",
      "VisualDeck has not been committed against the current PresentationSystem revision.",
    );
  }

  const manuscriptById = new Map((manuscriptState.slides || []).map((item) => [item.slideId, item]));
  for (const slide of deck.slides || []) {
    const source = manuscriptById.get(slide.id);
    if (!source) {
      push(
        "visual_page_source_missing",
        "manuscript",
        `Visual page '${slide.id}' is not bound to a current Manuscript section.`,
        [slide.id],
      );
      continue;
    }
    if (
      (slide.sourceRevision !== undefined && slide.sourceRevision !== manuscriptState.revision) ||
      slide.sourceHash !== source.sectionHash
    ) {
      push(
        "visual_page_source_stale",
        "manuscript",
        `Visual page '${slide.id}' was authored from an older Manuscript section and must be redesigned by AI.`,
        [slide.id],
      );
    }
  }

  for (let slideIndex = 0; slideIndex < deck.slides.length; slideIndex += 1) {
    const slide = deck.slides[slideIndex];
    const renderTree = visualDocument?.pages?.find((page) => page.slideId === slide.id)?.renderTree;
    if (!renderTree) {
      push(
        "visual_document_page_missing",
        "visualDocument",
        `Slide ${slideIndex + 1} has no committed VisualDocument page.`,
        [slide.id],
      );
      continue;
    }
    if (!Array.isArray(renderTree.nodes) || renderTree.nodes.length === 0) {
      push("blank_slide", "visualDocument", `Slide ${slideIndex + 1} has no visual objects.`, [slide.id]);
      continue;
    }
    for (const node of renderTree.nodes) {
      if ((node.type === "image" || node.type === "svg") && !assets.has(node.assetId)) {
        push(
          "missing_asset",
          "visualDocument",
          `Slide ${slideIndex + 1} references missing asset '${node.assetId}'.`,
          [slide.id],
          [node.id],
        );
      }
      const tokens = node.style?.tokens || {};
      if (node.type === "text" || (node.type === "shape" && node.text)) {
        const role = resolveTypeRole(presentationSystem, tokens.textRole || "body");
        if (tokens.textRole === "body" && role.size < presentationSystem.quality.minBodySize) {
          push(
            "body_text_too_small",
            "visualDocument",
            `Slide ${slideIndex + 1} uses body text below the declared PresentationSystem minimum.`,
            [slide.id],
            [node.id],
          );
        }
        const foreground = resolveColor(presentationSystem, tokens.color || "ink");
        const background = resolveColor(presentationSystem, tokens.fill || "canvas");
        const requiredContrast = role.size >= 24 || (role.size >= 18 && role.weight >= 700)
          ? Math.min(3, presentationSystem.quality.minContrastRatio)
          : presentationSystem.quality.minContrastRatio;
        if (contrastRatio(foreground, background) < requiredContrast) {
          push(
            "insufficient_contrast",
            "visualDocument",
            `Slide ${slideIndex + 1} element '${node.id}' violates the declared token contrast minimum.`,
            [slide.id],
            [node.id],
          );
        }
      }
    }
    if (
      presentationSystem.quality.requireSourceForEvidence
      && ["evidence", "comparison"].includes(slide.pageRole)
      && !slide.sourceNote
    ) {
      push(
        "evidence_source_missing",
        "visualDocument",
        `Slide ${slideIndex + 1} is an evidence page without the required source note.`,
        [slide.id],
      );
    }
  }
  return rules;
}

function designUsageFor(deck, presentationSystemState, designPackage) {
  const presentationSystem = presentationSystemContent(presentationSystemState);
  const designHash = presentationSystemHash(presentationSystemState);
  const tokenUsage = Object.fromEntries([...tokenNames(presentationSystem)].map((token) => [token, 0]));
  const recipeUsage = {};
  const componentUsage = {};
  for (const slide of deck.slides || []) {
    const renderTree = compileSlide(slide, presentationSystem, designPackage, designHash);
    recipeUsage[renderTree.recipeId] = (recipeUsage[renderTree.recipeId] || 0) + 1;
    for (const node of renderTree.nodes) {
      componentUsage[node.type] = (componentUsage[node.type] || 0) + 1;
      for (const token of [node.style.tokens.color, node.style.tokens.fill, node.style.tokens.stroke]) {
        if (token in tokenUsage) tokenUsage[token] += 1;
      }
    }
  }
  const declaredTokens = Object.keys(tokenUsage).filter((token) => token !== "transparent");
  const usedTokens = declaredTokens.filter((token) => tokenUsage[token] > 0);
  return {
    compilerVersion: designPackage.compilerVersion,
    designHash,
    tokenUsage,
    tokenCoverage: declaredTokens.length ? usedTokens.length / declaredTokens.length : 0,
    usedTokenCount: usedTokens.length,
    declaredTokenCount: declaredTokens.length,
    recipeUsage,
    componentUsage,
    legacySlideCount: (deck.slides || []).filter((slide) => slide.layoutMode !== "recipe").length,
  };
}

function compactHistory(history) {
  return (history.undo || []).slice(-8).reverse().map((entry) => ({
    kind: entry.kind,
    revision: entry.revision,
    intent: entry.intent,
    createdAt: entry.createdAt,
  }));
}

function loadPresentationSystem(paths) {
  const stored = readJson(paths.presentationSystem, initialPresentationSystem());
  const content = presentationSystemContent(stored);
  return {
    ...content,
    revision: Number(stored.revision || 0),
    createdAt: stored.createdAt || nowIso(),
    updatedAt: stored.updatedAt || nowIso(),
  };
}

function slideLifecycle(slide, presentationSystem, sourceHash = "") {
  const timestamp = nowIso();
  return {
    ...slide,
    revision: Math.max(1, Number(slide.revision || 1)),
    status: ["planned", "generating", "previewReady", "reviewing", "needsFix", "approved", "stale", "failed"]
      .includes(slide.status) ? slide.status : "previewReady",
    designSystemRevision: Number(slide.designSystemRevision ?? presentationSystem.revision ?? 0),
    designSystemHash: slide.designSystemHash || presentationSystemHash(presentationSystem),
    sourceHash: slide.sourceHash || sourceHash,
    createdAt: slide.createdAt || timestamp,
    updatedAt: slide.updatedAt || timestamp,
    lastGoodPreviewRef: slide.lastGoodPreviewRef || null,
    lastError: slide.lastError || null,
  };
}

function migrateDeck(deck, presentationSystem, sourceHash = "") {
  const schemaVersion = Number(deck.schemaVersion || 0);
  if (schemaVersion !== DECK_SCHEMA_VERSION) {
    throw new Error(
      `VisualDeck schema ${deck.schemaVersion ?? "unknown"} is unsupported; start a new PPT Live session with schema ${DECK_SCHEMA_VERSION}`,
    );
  }
  const migrated = clone(deck);
  migrated.schemaVersion = DECK_SCHEMA_VERSION;
  migrated.slides = (migrated.slides || []).map((slide) => slideLifecycle({
    ...slide,
    layoutMode: slide.layoutMode || "custom",
    recipeId: slide.recipeId || "legacy-freeform",
  }, presentationSystem, sourceHash));
  return migrated;
}

function loadDeck(paths, deckId, presentationSystem = loadPresentationSystem(paths)) {
  const stored = readJson(paths.deck, initialDeck(deckId));
  const migrated = migrateDeck(stored, presentationSystem);
  return migrated;
}

function loadVisualDocument(paths, deckId, designPackage) {
  return migrateVisualDocument(
    readJson(paths.visualDocument, initialVisualDocument(deckId, designPackage)),
    deckId,
    designPackage,
  );
}

function syncVisualDocument(paths, deck, presentationSystem, designPackage, systemHash, options = {}) {
  const current = loadVisualDocument(paths, deck.deckId, designPackage);
  const pagesById = new Map((current.pages || []).map((page) => [page.slideId, page]));
  let changed = current.designHash !== systemHash ||
    current.designPackageRevision !== designPackage.revision ||
    current.pages.length !== deck.slides.length;
  const pages = deck.slides.map((slide) => {
    const existing = pagesById.get(slide.id) || null;
    const needsCompile = !existing ||
      existing.slideRevision !== slide.revision ||
      existing.designHash !== systemHash ||
      existing.designPackageRevision !== designPackage.revision;
    if (!needsCompile) return existing;
    changed = true;
    const baseTree = compileSlide(slide, presentationSystem, designPackage, systemHash);
    return compileVisualPage(slide, baseTree, existing, { safeArea: presentationSystem.layout.safeArea });
  });
  if (!changed) return current;
  const next = {
    ...current,
    revision: Number(current.revision || 0) + 1,
    designPackageId: designPackage.packageId,
    designPackageRevision: designPackage.revision,
    designHash: systemHash,
    pages,
    updatedAt: nowIso(),
  };
  if (options.persist !== false) writeJson(paths.visualDocument, next);
  return next;
}

function manuscriptSlideHash(manuscript, index) {
  const section = slideSections(manuscript)[index];
  return section ? sha256(`${section.position}:${section.title}:${section.content}`) : "";
}

function compactDesignCase(designCase) {
  if (!designCase || typeof designCase !== "object") return designCase;
  return {
    ...designCase,
    sampleSlides: (designCase.sampleSlides || []).map((sample) => {
      const { renderTree, ...metadata } = sample;
      return {
        ...metadata,
        nodeCount: Array.isArray(renderTree?.nodes) ? renderTree.nodes.length : 0,
      };
    }),
  };
}

function compactCommittedSlide(slide) {
  return {
    id: slide.id,
    title: slide.title,
    claim: slide.claim,
    pageRole: slide.pageRole,
    recipeId: slide.recipeId,
    visualMode: slide.visualMode,
    revision: slide.revision,
    status: slide.status,
    sourceRevision: slide.sourceRevision,
    visualRevision: slide.visualRevision,
    userOverrideCount: slide.userOverrideCount,
    visualConflicts: slide.visualConflicts,
    nodeCount: Array.isArray(slide.renderTree?.nodes) ? slide.renderTree.nodes.length : 0,
    updatedAt: slide.updatedAt,
  };
}

function inspect(paths, input = {}) {
  ensureProject(paths);
  const project = syncDocumentMetadata(paths);
  const presentationSystem = loadPresentationSystem(paths);
  const systemHash = presentationSystemHash(presentationSystem);
  const designPackage = createDesignPackage(presentationSystem, systemHash);
  const storedDesignPackage = readJson(paths.presentationDesignPackage, null);
  if (
    !storedDesignPackage ||
    storedDesignPackage.contentHash !== designPackage.contentHash ||
    storedDesignPackage.compilerVersion !== designPackage.compilerVersion ||
    storedDesignPackage.revision !== designPackage.revision
  ) {
    writeJson(paths.presentationDesignPackage, designPackage);
  }
  const deck = loadDeck(paths, project.deckId, presentationSystem);
  const visualDocument = syncVisualDocument(paths, deck, presentationSystem, designPackage, systemHash);
  const visualPages = new Map(visualDocument.pages.map((page) => [page.slideId, page]));
  const history = readJson(paths.historyFile, { undo: [] });
  const manuscript = fs.readFileSync(paths.manuscript, "utf8");
  const speakerScript = fs.readFileSync(paths.speakerScript, "utf8");
  const assets = loadAssets(paths);
  const latestReview = readJson(paths.latestReview, null);
  const manuscriptReview = readJson(paths.manuscriptReview, null);
  const manuscriptState = buildManuscriptState(manuscript, speakerScript, project);
  const designCase = readJson(paths.designCase, initialDesignCase(project.deckId));
  updateSlideMap(paths, deck, manuscript, speakerScript);
  deck.source = {
    manuscriptHash: project.documents.manuscript.hash,
    speakerScriptHash: project.documents.speakerScript.hash,
  };
  const renderedSlides = deck.slides.map((slide) => {
    const visualPage = visualPages.get(slide.id);
    if (!visualPage?.renderTree) {
      throw new Error(`Slide '${slide.id}' has no persisted VisualDocument page`);
    }
    const manuscriptSection = manuscriptState.slides.find((item) => item.slideId === slide.id);
    const stale = slide.designSystemRevision !== presentationSystem.revision ||
      slide.designSystemHash !== systemHash ||
      (slide.sourceRevision !== undefined && slide.sourceRevision !== manuscriptState.revision) ||
      slide.sourceHash !== manuscriptSection?.sectionHash;
    const status = stale ? "stale" : slide.status;
    return {
      ...slide,
      status,
      visualRevision: Number(visualPage?.revision || 0),
      userOverrideCount: Object.keys(visualPage?.userOverrides || {}).length,
      visualConflicts: visualPage?.conflicts || [],
      renderTree: clone(visualPage.renderTree),
    };
  });
  const productionProgress = manuscriptState.slides.map((item, index) => {
    const slide = renderedSlides.find((candidate) => candidate.id === item.slideId);
    const source = {
      slideId: item.slideId,
      position: index + 1,
      manuscriptSectionHash: item.sectionHash,
    };
    return slide
      ? {
        ...source,
        status: slide.status,
        slideRevision: Number(slide.revision || 0),
        sourceRevision: slide.sourceRevision,
        updatedAt: slide.updatedAt,
      }
      : { ...source, status: "pending", slideRevision: 0 };
  });
  const ruleViolations = ruleViolationsFor(deck, manuscriptState, presentationSystem, manuscript, speakerScript, assets, visualDocument);
  const snapshot = {
    project: {
      deckId: deck.deckId,
      root: paths.root,
      presentationDesignPackagePath: paths.controlFile,
      assets: [...assets.values()],
      visualDocumentPath: paths.controlFile,
      assetProviders: [
        { id: "workspace-image", capabilities: ["workspace-image"] },
        { id: "authored-svg", capabilities: ["authored-svg"] },
      ],
    },
    documents: {
      manuscript: {
        path: paths.manuscript,
        revision: project.documents.manuscript.revision,
        contentHash: project.documents.manuscript.hash,
      },
      speakerScript: {
        path: paths.speakerScript,
        revision: project.documents.speakerScript.revision,
        contentHash: project.documents.speakerScript.hash,
      },
    },
    authoringContract: authoringContract(),
    manuscript: manuscriptState,
    productionProgress,
    designCase,
    manuscriptReview,
    reviewCapabilityProfile: {
      declarationRequired: true,
      supportedModes: ["multimodal", "text-only"],
      textOnlyDesignCaseRequiresUserDecision: true,
    },
    presentationSystem: {
      ...presentationSystem,
      contentHash: presentationSystemHash(presentationSystem),
    },
    presentationSystemPresets: presentationSystemPresets(),
    presentationDesignPackage: designPackage,
    visualDocument: {
      schemaVersion: visualDocument.schemaVersion,
      revision: visualDocument.revision,
      designPackageId: visualDocument.designPackageId,
      designPackageRevision: visualDocument.designPackageRevision,
      designHash: visualDocument.designHash,
      pageCount: visualDocument.pages.length,
      pages: visualDocument.pages.map((page) => ({
        slideId: page.slideId,
        revision: page.revision,
        slideRevision: page.slideRevision,
        userOverrideCount: Object.keys(page.userOverrides || {}).length,
        conflictCount: (page.conflicts || []).length,
      })),
    },
    presentationDesignUsage: designUsageFor(deck, presentationSystem, designPackage),
    deck: {
      ...deck,
      slides: renderedSlides,
      slideCount: renderedSlides.length,
      manuscriptSlideCount: manuscriptState.slides.length,
      completedSlideCount: renderedSlides.filter((slide) => ["previewReady", "approved", "needsFix"].includes(slide.status)).length,
    },
    history: compactHistory(history),
    canUndo: Boolean(history.undo && history.undo.length),
    latestReview,
    ruleViolations,
  };
  if (input.audience !== "agent") return snapshot;
  return {
    ...snapshot,
    designCase: compactDesignCase(snapshot.designCase),
    deck: {
      ...snapshot.deck,
      slides: snapshot.deck.slides.map((slide) => {
        const { renderTree, ...authored } = slide;
        if (!input.slideId || slide.id !== input.slideId) {
          return {
            id: authored.id,
            title: authored.title,
            claim: authored.claim,
            pageRole: authored.pageRole,
            recipeId: authored.recipeId,
            visualMode: authored.visualMode,
            revision: authored.revision,
            status: authored.status,
          };
        }
        return authored;
      }),
    },
  };
}

function documentDefinition(paths, documentId) {
  if (documentId === "manuscript") {
    return { id: "manuscript", path: paths.manuscript };
  }
  if (documentId === "speakerScript" || documentId === "speaker-script") {
    return { id: "speakerScript", path: paths.speakerScript };
  }
  throw new Error("documentId must be 'manuscript' or 'speakerScript'");
}

function getDocument(paths, input) {
  ensureProject(paths);
  const project = syncDocumentMetadata(paths);
  const document = documentDefinition(paths, input.documentId);
  return {
    document: {
      id: document.id,
      path: document.path,
      revision: project.documents[document.id].revision,
      contentHash: project.documents[document.id].hash,
      content: fs.readFileSync(document.path, "utf8"),
    },
  };
}

function commitDocument(paths, input) {
  ensureProject(paths);
  const project = syncDocumentMetadata(paths);
  const document = documentDefinition(paths, input.documentId);
  assertExpectedRevision(
    project.documents[document.id].revision,
    input.expectedRevision,
    document.id,
  );
  if (typeof input.content !== "string") throw new Error("content must be a string");
  if (Buffer.byteLength(input.content, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("Managed presentation documents may not exceed 2 MiB");
  }
  if (containsEmbeddedHtml(input.content)) {
    throw new Error("Managed presentation documents must be pure Markdown without embedded HTML");
  }
  atomicWrite(document.path, input.content);
  const nextProject = syncDocumentMetadata(paths);
  return {
    document: {
      id: document.id,
      path: document.path,
      revision: nextProject.documents[document.id].revision,
      contentHash: nextProject.documents[document.id].hash,
    },
  };
}

function commitSpeakerScript(paths, input) {
  ensureProject(paths);
  parsePresentationMarkdown(
    fs.readFileSync(paths.manuscript, "utf8"),
    typeof input.content === "string" ? input.content : "",
  );
  return commitDocument(paths, {
    documentId: "speakerScript",
    expectedRevision: input.expectedRevision,
    content: input.content,
  });
}

function commitPresentationManuscript(paths, input) {
  ensureProject(paths);
  const project = syncDocumentMetadata(paths);
  assertExpectedRevision(project.documents.manuscript.revision, input.expectedManuscriptRevision, "manuscript");
  assertExpectedRevision(project.documents.speakerScript.revision, input.expectedSpeakerScriptRevision, "speakerScript");
  if (typeof input.manuscript !== "string" || typeof input.speakerScript !== "string") {
    throw new Error("commitPresentationManuscript requires complete manuscript and speakerScript Markdown strings");
  }
  for (const [name, content] of [["manuscript", input.manuscript], ["speakerScript", input.speakerScript]]) {
    if (!content.trim()) throw new Error(`${name} must not be empty`);
    if (Buffer.byteLength(content, "utf8") > MAX_DOCUMENT_BYTES) throw new Error(`${name} may not exceed 2 MiB`);
    if (containsEmbeddedHtml(content)) throw new Error(`${name} must be pure Markdown without embedded HTML`);
  }
  const parsedDocuments = parsePresentationMarkdown(input.manuscript, input.speakerScript);
  const nextManuscriptRevision = project.documents.manuscript.hash === sha256(input.manuscript)
    ? project.documents.manuscript.revision
    : project.documents.manuscript.revision + 1;
  const nextManuscriptHash = sha256(input.manuscript);
  const presentationSystem = loadPresentationSystem(paths);
  const systemHash = presentationSystemHash(presentationSystem);
  const designPackage = createDesignPackage(presentationSystem, systemHash);
  const currentDeck = loadDeck(paths, project.deckId, presentationSystem);
  const currentVisualDocument = loadVisualDocument(paths, project.deckId, designPackage);
  const nextDeck = {
    ...currentDeck,
    revision: currentDeck.revision + 1,
    title: parsedDocuments.manuscript.title,
    presentationSystemRevision: presentationSystem.revision,
    presentationSystemHash: systemHash,
    slides: [],
    selection: { slideId: parsedDocuments.manuscript.slides[0].slideId },
    source: { manuscriptHash: nextManuscriptHash, speakerScriptHash: sha256(input.speakerScript) },
    lastIntent: text(input.intent, "Commit complete presentation manuscript", 500),
    updatedAt: nowIso(),
  };
  const nextVisualDocument = {
    ...currentVisualDocument,
    revision: Number(currentVisualDocument.revision || 0) + 1,
    designPackageId: designPackage.packageId,
    designPackageRevision: designPackage.revision,
    designHash: systemHash,
    pages: [],
    updatedAt: nowIso(),
  };
  writePresentationState(
    paths,
    { manuscript: input.manuscript, speakerScript: input.speakerScript },
    {
      deck: nextDeck,
      visualDocument: nextVisualDocument,
      designCase: {
        ...initialDesignCase(project.deckId),
        manuscriptRevision: nextManuscriptRevision,
        manuscriptHash: nextManuscriptHash,
        systemRevision: presentationSystem.revision,
        systemHash,
      },
    },
  );
  for (const reviewPath of [paths.manuscriptReview, paths.latestReview]) {
    deleteJson(reviewPath);
  }
  const snapshot = inspect(paths);
  return {
    manuscript: snapshot.manuscript,
    productionProgress: snapshot.productionProgress,
    documents: snapshot.documents,
    deck: snapshot.deck,
    designCase: snapshot.designCase,
    manuscriptReview: snapshot.manuscriptReview,
    latestReview: snapshot.latestReview,
    ruleViolations: snapshot.ruleViolations,
  };
}

function commitPresentationDocument(paths, input) {
  ensureProject(paths);
  const project = syncDocumentMetadata(paths);
  const documents = normalizeStructuredDocuments(input.manuscript, input.speakerScript, project.deckId);
  return commitPresentationManuscript(paths, {
    expectedManuscriptRevision: input.expectedManuscriptRevision,
    expectedSpeakerScriptRevision: input.expectedSpeakerScriptRevision,
    manuscript: serializeManuscript(documents.manuscript),
    speakerScript: serializeSpeakerScript(documents.speakerScript, documents.manuscript),
    intent: input.intent,
  });
}

function normalizeReviewFindings(value) {
  if (!Array.isArray(value)) throw new Error("findings must be an array");
  return value.map((finding, index) => {
    const item = objectValue(finding, `finding ${index + 1}`);
    const severity = requiredText(item.severity, `finding ${index + 1}.severity`, 40);
    if (!["critical", "major", "minor", "note"].includes(severity)) throw new Error(`finding ${index + 1}.severity is unsupported`);
    const rootCauseLayer = requiredText(item.rootCauseLayer, `finding ${index + 1}.rootCauseLayer`, 80);
    if (!["manuscript", "presentation-system", "asset-strategy", "recipe-family", "page"].includes(rootCauseLayer)) {
      throw new Error(`finding ${index + 1}.rootCauseLayer is unsupported`);
    }
    return {
      id: text(item.id, `finding-${index + 1}`, 128),
      severity,
      scope: requiredText(item.scope, `finding ${index + 1}.scope`, 500),
      evidence: requiredText(item.evidence, `finding ${index + 1}.evidence`, 1200),
      judgment: requiredText(item.judgment, `finding ${index + 1}.judgment`, 1200),
      rootCauseLayer,
      revisionStrategy: requiredText(item.revisionStrategy, `finding ${index + 1}.revisionStrategy`, 1200),
    };
  });
}

function reviewPresentationManuscript(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  if (input.mode === "prepare") {
    const review = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      reviewId: `manuscript-review-${snapshot.manuscript.revision}-${Date.now()}`,
      kind: "manuscript",
      status: "awaitingAiReview",
      manuscriptRevision: snapshot.documents.manuscript.revision,
      manuscriptHash: snapshot.documents.manuscript.contentHash,
      speakerScriptRevision: snapshot.documents.speakerScript.revision,
      speakerScriptHash: snapshot.documents.speakerScript.contentHash,
      ruleViolations: snapshot.ruleViolations.filter((item) => item.artifact === "manuscript" || item.artifact === "speakerScript"),
      bundle: {
        manuscript: fs.readFileSync(paths.manuscript, "utf8"),
        speakerScript: fs.readFileSync(paths.speakerScript, "utf8"),
        parsedManuscript: snapshot.manuscript,
      },
      createdAt: nowIso(),
    };
    writeJson(paths.manuscriptReview, review);
    return review;
  }
  if (input.mode !== "commit") throw new Error("reviewPresentationManuscript mode must be prepare or commit");
  const prepared = readJson(paths.manuscriptReview, null);
  if (!prepared || prepared.reviewId !== input.reviewId || prepared.status !== "awaitingAiReview") {
    throw new Error("reviewPresentationManuscript commit requires the current prepared reviewId");
  }
  if (
    prepared.manuscriptRevision !== snapshot.documents.manuscript.revision ||
    prepared.manuscriptHash !== snapshot.documents.manuscript.contentHash ||
    prepared.speakerScriptRevision !== snapshot.documents.speakerScript.revision ||
    prepared.speakerScriptHash !== snapshot.documents.speakerScript.contentHash
  ) {
    throw new Error("The manuscript or speaker script changed after review preparation");
  }
  const findings = normalizeReviewFindings(input.findings || []);
  if (!["passed", "needs_revision"].includes(input.decision)) throw new Error("decision must be passed or needs_revision");
  const status = prepared.ruleViolations.length || input.decision === "needs_revision" ? "needsRevision" : "passed";
  const review = { ...prepared, status, decision: input.decision, findings, bundle: undefined, completedAt: nowIso() };
  writeJson(paths.manuscriptReview, review);
  return review;
}

function expandSemanticSvg(svg, presentationSystem) {
  return String(svg).replace(/\{\{([a-z]+(?:\.\d+)?)\}\}/g, (_, token) => {
    if (!tokenNames(presentationSystem).has(token)) throw new Error(`SVG references unknown semantic token '${token}'`);
    return resolveColor(presentationSystem, token);
  });
}

function assetDataUri(paths, asset, presentationSystem = loadPresentationSystem(paths)) {
  const filePath = path.join(paths.assets, asset.filename);
  if (!isInside(paths.assets, filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Visual asset '${asset.id}' is missing from storage`);
  }
  const raw = fs.readFileSync(filePath);
  const content = asset.mimeType === "image/svg+xml" && asset.themeBinding === "semantic"
    ? Buffer.from(expandSemanticSvg(raw.toString("utf8"), presentationSystemContent(presentationSystem)), "utf8")
    : raw;
  return `data:${asset.mimeType};base64,${content.toString("base64")}`;
}

function assertSafeSvg(svg) {
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(svg)) throw new Error("svg must contain one complete <svg> document");
  if (/<!DOCTYPE|<script|<foreignObject|<iframe|<object|<embed|<link|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|data:text\/html)|url\(\s*["']?\s*(?:https?:|javascript:)/i.test(svg)) {
    throw new Error("svg contains executable or external content");
  }
}

function svgDimensions(svg) {
  const root = String(svg).match(/^\s*<svg\b([^>]*)>/i)?.[1] || "";
  const viewBox = root.match(/\bviewBox\s*=\s*["']\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*["']/i);
  const width = Number(root.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i)?.[1]);
  const height = Number(root.match(/\bheight\s*=\s*["']\s*([\d.]+)/i)?.[1]);
  const resolvedWidth = viewBox ? Number(viewBox[3]) : width;
  const resolvedHeight = viewBox ? Number(viewBox[4]) : height;
  if (!(resolvedWidth > 0) || !(resolvedHeight > 0)) throw new Error("SVG requires a positive viewBox or numeric width and height");
  return { width: resolvedWidth, height: resolvedHeight };
}

function sniffImage(content) {
  if (content.length >= 24 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", extension: ".png", width: content.readUInt32BE(16), height: content.readUInt32BE(20) };
  }
  if (content.length >= 12 && content.subarray(0, 4).toString() === "RIFF" && content.subarray(8, 12).toString() === "WEBP") {
    const type = content.subarray(12, 16).toString();
    if (type === "VP8X" && content.length >= 30) {
      return {
        mimeType: "image/webp",
        extension: ".webp",
        width: 1 + content.readUIntLE(24, 3),
        height: 1 + content.readUIntLE(27, 3),
      };
    }
    return { mimeType: "image/webp", extension: ".webp", width: 0, height: 0 };
  }
  if (content.length >= 4 && content[0] === 0xff && content[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 8 < content.length) {
      if (content[cursor] !== 0xff) { cursor += 1; continue; }
      const marker = content[cursor + 1];
      const length = content.readUInt16BE(cursor + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: "image/jpeg", extension: ".jpg", width: content.readUInt16BE(cursor + 7), height: content.readUInt16BE(cursor + 5) };
      }
      cursor += Math.max(2, length + 2);
    }
    return { mimeType: "image/jpeg", extension: ".jpg", width: 0, height: 0 };
  }
  const utf8 = content.toString("utf8");
  if (/^\s*<svg\b/i.test(utf8)) {
    const dimensions = svgDimensions(utf8);
    return { mimeType: "image/svg+xml", extension: ".svg", ...dimensions };
  }
  throw new Error("workspace-image supports valid PNG, JPEG, WebP, or SVG content");
}

function createVisualAsset(paths, input) {
  ensureProject(paths);
  const provider = input.provider;
  if (provider !== "authored-svg" && provider !== "workspace-image") {
    throw new Error("provider must be 'authored-svg' or 'workspace-image'");
  }
  const id = requiredText(input.id, "asset id", 128);
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(id)) {
    throw new Error("asset id must use lowercase letters, numbers, underscores, or hyphens");
  }
  const title = requiredText(input.title, "asset title", 240);
  const alt = requiredText(input.alt, "asset alt", 500);
  const assets = loadAssets(paths);
  if (assets.has(id)) throw new Error(`Visual asset '${id}' already exists`);

  let extension;
  let mimeType;
  let content;
  let source;
  let dimensions;
  let themeBinding = "fixed";
  if (provider === "authored-svg") {
    if (typeof input.svg !== "string") throw new Error("authored-svg provider requires svg source");
    assertSafeSvg(input.svg);
    dimensions = svgDimensions(input.svg);
    const semanticTokens = [...input.svg.matchAll(/\{\{([a-z]+(?:\.\d+)?)\}\}/g)].map((match) => match[1]);
    const registeredTokens = tokenNames(presentationSystemContent(loadPresentationSystem(paths)));
    semanticTokens.forEach((token) => {
      if (!registeredTokens.has(token)) throw new Error(`SVG references unknown semantic token '${token}'`);
    });
    themeBinding = semanticTokens.length ? "semantic" : "fixed";
    content = Buffer.from(input.svg, "utf8");
    extension = ".svg";
    mimeType = "image/svg+xml";
    source = "agent-authored-svg";
  } else {
    const requestedPath = requiredText(input.sourcePath, "sourcePath", 2000);
    const sourcePath = fs.realpathSync(path.resolve(paths.workspaceRoot, requestedPath));
    const workspaceRoot = fs.realpathSync(paths.workspaceRoot);
    if (!isInside(workspaceRoot, sourcePath)) throw new Error("sourcePath must stay inside the current workspace");
    if (isInside(path.join(workspaceRoot, ".sparo_os"), sourcePath)) {
      throw new Error("sourcePath must not import PPT Live private runtime state");
    }
    if (!fs.statSync(sourcePath).isFile()) throw new Error("sourcePath must reference an image file");
    content = fs.readFileSync(sourcePath);
    const sniffed = sniffImage(content);
    extension = sniffed.extension;
    mimeType = sniffed.mimeType;
    dimensions = { width: sniffed.width, height: sniffed.height };
    if (mimeType === "image/svg+xml") assertSafeSvg(content.toString("utf8"));
    source = path.relative(workspaceRoot, sourcePath).replace(/\\/g, "/");
  }
  if (content.length === 0 || content.length > MAX_ASSET_BYTES) {
    throw new Error("Visual assets must be between 1 byte and 12 MiB");
  }
  const filename = `${id}${extension}`;
  atomicWrite(path.join(paths.assets, filename), content);
  const asset = {
    id,
    title,
    alt,
    providerId: provider,
    kind: mimeType === "image/svg+xml" ? "svg" : "raster",
    mimeType,
    filename,
    bytes: content.length,
    width: dimensions.width,
    height: dimensions.height,
    contentHash: sha256(content),
    source,
    themeBinding,
    previewRef: path.join(paths.assets, filename),
    createdAt: nowIso(),
  };
  assets.set(id, asset);
  saveAssets(paths, assets);
  return { asset };
}

function getVisualAsset(paths, input) {
  ensureProject(paths);
  const id = safeId(requiredText(input.assetId, "assetId", 128), "");
  const asset = loadAssets(paths).get(id);
  if (!asset) throw new Error(`Visual asset '${id}' was not found`);
  return { asset: { ...asset, dataUri: assetDataUri(paths, asset, loadPresentationSystem(paths)) } };
}

function prepareVisualAssets(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  assertExpectedRevision(snapshot.manuscript.revision, input.expectedManuscriptRevision, "Manuscript");
  assertExpectedRevision(snapshot.presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
  if (
    snapshot.designCase?.status !== "approved" ||
    snapshot.designCase.manuscriptRevision !== snapshot.manuscript.revision ||
    snapshot.designCase.manuscriptHash !== snapshot.manuscript.contentHash ||
    snapshot.designCase.systemRevision !== snapshot.presentationSystem.revision ||
    snapshot.designCase.systemHash !== snapshot.presentationSystem.contentHash
  ) {
    throw new Error("Visual assets may be prepared only after the current Design Case is approved");
  }
  if (!Array.isArray(input.assets) || input.assets.length > 40) throw new Error("assets must be an array of at most 40 items");
  const existing = loadAssets(paths);
  const results = input.assets.map((assetInput) => {
    if (existing.has(assetInput.id)) return { asset: existing.get(assetInput.id), status: "existing" };
    const result = createVisualAsset(paths, assetInput);
    existing.set(result.asset.id, result.asset);
    return { ...result, status: "created" };
  });
  return {
    manuscriptRevision: snapshot.manuscript.revision,
    systemRevision: snapshot.presentationSystem.revision,
    preparedCount: results.length,
    assets: results,
  };
}

function pushHistory(paths, kind, state, intent) {
  const history = readJson(paths.historyFile, { schemaVersion: 2, undo: [] });
  history.schemaVersion = 2;
  history.undo = Array.isArray(history.undo) ? history.undo : [];
  history.undo.push({
    kind,
    revision: state.revision,
    intent: text(intent, "Presentation change", 500),
    createdAt: nowIso(),
    snapshot: clone(state),
  });
  history.undo = history.undo.slice(-MAX_HISTORY);
  writeJson(paths.historyFile, history);
}

function commitDeck(paths, current, next, intent) {
  next.revision = Number(current.revision || 0) + 1;
  next.updatedAt = nowIso();
  next.schemaVersion = DECK_SCHEMA_VERSION;
  next.lastIntent = text(intent, "Visual presentation change", 500);
  const controlBeforeCommit = readControl(paths.controlFile, null);
  if (!controlBeforeCommit) throw new Error("PPT Live control file is missing or invalid");
  try {
    pushHistory(paths, "visualDeck", current, intent);
    writeJson(paths.deck, next);
    return inspect(paths);
  } catch (error) {
    try {
      writeControl(paths.controlFile, controlBeforeCommit);
    } catch (rollbackError) {
      const failure = new Error(
        `VisualDeck commit failed and rollback could not restore the previous state: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
      failure.code = "ppt_commit_rollback_failed";
      failure.cause = error;
      throw failure;
    }
    throw error;
  }
}

function setPresentationSystem(paths, input) {
  ensureProject(paths);
  const current = loadPresentationSystem(paths);
  const currentDeck = loadDeck(paths, `deck-${paths.workId}`, current);
  assertExpectedRevision(current.revision, input.expectedRevision, "PresentationSystem");
  if (input.expectedDeckRevision !== undefined) {
    assertExpectedRevision(currentDeck.revision, input.expectedDeckRevision, "VisualDeck");
  }
  const content = normalizePresentationSystem(input.presentationSystem);
  const currentHash = presentationSystemHash(current);
  const currentPackage = createDesignPackage(current, currentHash);
  const currentVisualDocument = syncVisualDocument(paths, currentDeck, current, currentPackage, currentHash);
  pushHistory(paths, "presentationState", {
    revision: currentDeck.revision,
    deck: currentDeck,
    presentationSystem: current,
    visualDocument: currentVisualDocument,
  }, input.intent);
  const next = {
    ...content,
    revision: current.revision + 1,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };
  const nextHash = presentationSystemHash(next);
  const nextDeck = {
    ...clone(currentDeck),
    revision: currentDeck.revision + 1,
    presentationSystemRevision: next.revision,
    presentationSystemHash: nextHash,
    slides: currentDeck.slides.map((slide) => ({
      ...slide,
      designSystemRevision: next.revision,
      designSystemHash: nextHash,
      status: ["generating", "failed"].includes(slide.status) ? slide.status : "previewReady",
      updatedAt: nowIso(),
    })),
    updatedAt: nowIso(),
    lastIntent: text(input.intent, "Presentation system change", 500),
  };
  const nextPackage = createDesignPackage(next, nextHash);
  const nextVisualDocument = syncVisualDocument(
    paths,
    nextDeck,
    next,
    nextPackage,
    nextHash,
    { persist: false },
  );
  writeProjectState(paths, {
    presentationSystem: next,
    deck: nextDeck,
    visualDocument: nextVisualDocument,
  });
  const project = syncDocumentMetadata(paths);
  writeJson(paths.designCase, {
    ...initialDesignCase(currentDeck.deckId),
    manuscriptRevision: project.documents.manuscript.revision,
    manuscriptHash: project.documents.manuscript.hash,
    systemRevision: next.revision,
    systemHash: nextHash,
    status: "notRendered",
  });
  deleteJson(paths.latestReview);
  return inspectResult(inspect(paths));
}

async function renderDesignCase(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  assertExpectedRevision(snapshot.manuscript.revision, input.expectedManuscriptRevision, "Manuscript");
  assertExpectedRevision(snapshot.presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
  if (
    snapshot.manuscriptReview?.status !== "passed" ||
    snapshot.manuscriptReview.manuscriptRevision !== snapshot.manuscript.revision ||
    snapshot.manuscriptReview.manuscriptHash !== snapshot.manuscript.contentHash
  ) {
    throw new Error("Design Case requires a passed current manuscript review");
  }
  if (!Array.isArray(input.slides) || input.slides.length !== 3) {
    throw new Error("Design Case requires exactly three real manuscript slides");
  }
  const ids = input.slides.map((slide) => slide?.id);
  if (new Set(ids).size !== 3) throw new Error("Design Case sample slide ids must be unique");
  const manuscriptIds = new Set(snapshot.manuscript.slides.map((slide) => slide.slideId));
  const system = presentationSystemContent(snapshot.presentationSystem);
  const designPackage = snapshot.presentationDesignPackage;
  const systemHash = snapshot.presentationSystem.contentHash;
  const assets = loadAssets(paths);
  const normalizedSlides = input.slides.map((raw, index) => {
    if (!manuscriptIds.has(raw?.id)) throw new Error(`Design Case slide '${raw?.id}' is not present in the current Manuscript`);
    return normalizeSlide({ ...raw, layoutMode: "recipe" }, index, system, designPackage, assets);
  });
  const caseId = `design-case-${snapshot.manuscript.revision}-${snapshot.presentationSystem.revision}-${Date.now()}`;
  const caseRoot = path.join(paths.render, caseId);
  fs.mkdirSync(caseRoot, { recursive: true });
  const sampleSlides = [];
  for (let index = 0; index < normalizedSlides.length; index += 1) {
    const slide = normalizedSlides[index];
    const tree = compileSlide(slide, system, designPackage, systemHash);
    const body = [...tree.nodes].sort((left, right) => Number(left.z || 0) - Number(right.z || 0))
      .map((node) => renderCompiledNodeSvg(paths, node, assets)).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${tree.canvas.background}"/>${body}</svg>`;
    const baseName = `case-${index + 1}-${slide.id}`;
    const svgRef = path.join(caseRoot, `${baseName}.svg`);
    const previewRef = path.join(caseRoot, `${baseName}.png`);
    atomicWrite(svgRef, svg);
    const rendered = await renderSvg(svg, 1600);
    atomicWrite(previewRef, rendered.png);
    sampleSlides.push({
      slideId: slide.id,
      title: slide.title,
      pageRole: slide.pageRole,
      recipeId: slide.recipeId,
      previewRef,
      svgRef,
      renderTree: tree,
    });
  }
  const designCase = {
    schemaVersion: DESIGN_CASE_SCHEMA_VERSION,
    deckId: snapshot.deck.deckId,
    revision: Number(snapshot.designCase?.revision || 0) + 1,
    status: "awaitingDecision",
    caseId,
    manuscriptRevision: snapshot.manuscript.revision,
    manuscriptHash: snapshot.manuscript.contentHash,
    systemRevision: snapshot.presentationSystem.revision,
    systemHash,
    density: snapshot.presentationSystem.layout.density,
    colorDirection: snapshot.presentationSystem.direction,
    sampleSlides,
    decision: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJson(paths.designCase, designCase);
  return compactDesignCase(designCase);
}

function decideDesignCase(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  const designCase = snapshot.designCase;
  if (
    !designCase ||
    designCase.schemaVersion !== DESIGN_CASE_SCHEMA_VERSION ||
    designCase.caseId !== input.caseId ||
    designCase.status !== "awaitingDecision" ||
    designCase.manuscriptRevision !== snapshot.manuscript.revision ||
    designCase.manuscriptHash !== snapshot.manuscript.contentHash ||
    designCase.systemRevision !== snapshot.presentationSystem.revision ||
    designCase.systemHash !== snapshot.presentationSystem.contentHash
  ) {
    throw new Error("Design Case decision requires the current awaiting caseId");
  }
  if (!["approved", "revise"].includes(input.decision)) throw new Error("Design Case decision must be approved or revise");
  if (!["user", "ai"].includes(input.actor)) throw new Error("Design Case actor must be user or ai");
  if (!["multimodal", "text-only"].includes(input.reviewCapability)) {
    throw new Error("reviewCapability must be multimodal or text-only");
  }
  if (input.actor === "ai" && input.reviewCapability !== "multimodal") {
    throw new Error("Text-only AI cannot approve or reject a Design Case; explicit user decision is required");
  }
  const next = {
    ...designCase,
    status: input.decision === "approved" ? "approved" : "revisionRequested",
    decision: {
      outcome: input.decision,
      actor: input.actor,
      reviewCapability: input.reviewCapability,
      feedback: text(input.feedback, "", 2000),
      decidedAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
  writeJson(paths.designCase, next);
  return next;
}

function mutationResult(snapshot, events = []) {
  return {
    deck: {
      deckId: snapshot.deck.deckId,
      revision: snapshot.deck.revision,
      slideCount: snapshot.deck.slideCount,
      manuscriptSlideCount: snapshot.deck.manuscriptSlideCount,
      completedSlideCount: snapshot.deck.completedSlideCount,
    },
    presentationSystem: {
      revision: snapshot.presentationSystem.revision,
      contentHash: snapshot.presentationSystem.contentHash,
      name: snapshot.presentationSystem.name,
    },
    events,
    ruleViolations: snapshot.ruleViolations,
  };
}

function commitSingleSlide(paths, input) {
  ensureProject(paths);
  const presentationSystem = loadPresentationSystem(paths);
  const current = loadDeck(paths, `deck-${paths.workId}`, presentationSystem);
  const designCase = readJson(paths.designCase, initialDesignCase(current.deckId));
  const project = syncDocumentMetadata(paths);
  const manuscript = fs.readFileSync(paths.manuscript, "utf8");
  const speakerScript = fs.readFileSync(paths.speakerScript, "utf8");
  const manuscriptState = buildManuscriptState(manuscript, speakerScript, project);
  const baselineDeckRevision = assertBaselineRevision(current.revision, input.expectedDeckRevision, "VisualDeck");
  assertExpectedRevision(presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
  assertExpectedRevision(manuscriptState.revision, input.expectedManuscriptRevision, "Manuscript");
  assertExpectedRevision(designCase.revision, input.expectedDesignCaseRevision, "DesignCase");
  if (
    designCase.status !== "approved" ||
    designCase.manuscriptRevision !== manuscriptState.revision ||
    designCase.manuscriptHash !== manuscriptState.contentHash ||
    designCase.systemRevision !== presentationSystem.revision ||
    designCase.systemHash !== presentationSystemHash(presentationSystem)
  ) {
    throw new Error("generateSlideVisual requires the approved current Design Case");
  }
  const systemHash = presentationSystemHash(presentationSystem);
  const designPackage = createDesignPackage(presentationSystem, systemHash);
  const rawSlide = objectValue(input.slide, "slide");
  const slideId = safeId(rawSlide.id, "");
  const manuscriptIndex = manuscriptState.slides.findIndex((item) => item.slideId === slideId);
  if (manuscriptIndex < 0) throw new Error(`Slide '${slideId}' is not present in the current Manuscript`);
  const committedIds = new Set(current.slides.map((slide) => slide.id));
  const missingPrevious = manuscriptState.slides.slice(0, manuscriptIndex).find((item) => !committedIds.has(item.slideId));
  if (missingPrevious) throw new Error(`Generate '${missingPrevious.slideId}' before '${slideId}' to preserve manuscript order`);
  const sourceHash = manuscriptSlideHash(manuscript, manuscriptIndex);
  const existingIndex = current.slides.findIndex((slide) => slide.id === slideId);
  const existing = existingIndex >= 0 ? current.slides[existingIndex] : null;
  assertExpectedRevision(existing?.revision || 0, input.expectedSlideRevision, `Slide '${slideId}'`);
  if ((rawSlide.layoutMode || "recipe") !== "recipe") throw new Error("generateSlideVisual accepts recipe-bound slides only");
  const normalized = normalizeSlide({ ...rawSlide, layoutMode: "recipe" }, manuscriptIndex, presentationSystem, designPackage, loadAssets(paths));
  const slide = slideLifecycle({
    ...normalized,
    revision: Number(existing?.revision || 0) + 1,
    status: "previewReady",
    designSystemRevision: presentationSystem.revision,
    designSystemHash: systemHash,
    sourceRevision: manuscriptState.revision,
    sourceHash,
    createdAt: existing?.createdAt,
    updatedAt: nowIso(),
    lastGoodPreviewRef: existing?.lastGoodPreviewRef || null,
    lastError: null,
  }, presentationSystem, sourceHash);
  const next = clone(current);
  if (existingIndex >= 0) next.slides[existingIndex] = slide;
  else next.slides.push(slide);
  next.slides.sort((left, right) => manuscriptState.slides.findIndex((item) => item.slideId === left.id) - manuscriptState.slides.findIndex((item) => item.slideId === right.id));
  next.selection = next.selection || { slideId };
  const snapshot = commitDeck(paths, current, next, input.intent);
  const committed = snapshot.deck.slides.find((candidate) => candidate.id === slideId);
  return {
    ...mutationResult(snapshot, [{
      type: "slide.preview.ready",
      slideId,
      slideRevision: slide.revision,
      recipeId: slide.recipeId,
      deckRevisionBeforeCommit: current.revision,
      rebasedFromDeckRevision: baselineDeckRevision < current.revision ? baselineDeckRevision : null,
    }]),
    slide: compactCommittedSlide(committed),
  };
}

function inspectResult(snapshot) {
  return {
    deck: snapshot.deck,
    presentationSystem: snapshot.presentationSystem,
    presentationSystemPresets: snapshot.presentationSystemPresets,
    presentationDesignPackage: snapshot.presentationDesignPackage,
    visualDocument: snapshot.visualDocument,
    documents: snapshot.documents,
    manuscript: snapshot.manuscript,
    productionProgress: snapshot.productionProgress,
    designCase: snapshot.designCase,
    manuscriptReview: snapshot.manuscriptReview,
    reviewCapabilityProfile: snapshot.reviewCapabilityProfile,
    history: snapshot.history,
    canUndo: snapshot.canUndo,
    latestReview: snapshot.latestReview,
    ruleViolations: snapshot.ruleViolations,
  };
}

function editVisual(paths, input) {
  ensureProject(paths);
  const current = loadDeck(paths, `deck-${paths.workId}`);
  assertExpectedRevision(current.revision, input.expectedRevision, "VisualDeck");
  const operation = input.operation;
  if (operation === "setSelection") {
    const slideId = safeId(input.slideId, "");
    if (!current.slides.some((slide) => slide.id === slideId)) {
      throw new Error(`Slide '${slideId}' was not found`);
    }
    current.selection = { slideId };
    current.updatedAt = nowIso();
    writeJson(paths.deck, current);
    return inspectResult(inspect(paths));
  }

  const next = clone(current);
  const presentationSystem = loadPresentationSystem(paths);
  const systemHash = presentationSystemHash(presentationSystem);
  const designPackage = createDesignPackage(presentationSystem, systemHash);
  if (
    current.presentationSystemRevision !== presentationSystem.revision ||
    current.presentationSystemHash !== presentationSystemHash(presentationSystem)
  ) {
    throw new Error("VisualDeck is bound to an older PresentationSystem; recommit the current PresentationSystem before focused edits");
  }
  if (operation === "updateNode") {
    const slideId = safeId(input.slideId, "");
    const nodeId = safeId(input.nodeId, "");
    const slideIndex = next.slides.findIndex((slide) => slide.id === slideId);
    if (slideIndex < 0) throw new Error(`Slide '${slideId}' was not found`);
    assertExpectedRevision(next.slides[slideIndex].revision, input.expectedSlideRevision, `Slide '${slideId}'`);
    const visualDocument = syncVisualDocument(paths, current, presentationSystem, designPackage, systemHash);
    const pageIndex = visualDocument.pages.findIndex((page) => page.slideId === slideId);
    if (pageIndex < 0) throw new Error(`VisualDocument page '${slideId}' was not found`);
    if (input.expectedVisualRevision !== undefined) {
      assertExpectedRevision(visualDocument.pages[pageIndex].revision, input.expectedVisualRevision, `Visual page '${slideId}'`);
    }
    const edited = updateVisualNode(
      visualDocument.pages[pageIndex],
      nodeId,
      input.nodePatch,
      { safeArea: presentationSystem.layout.safeArea },
    );
    const editedNode = edited.node;
    next.revision = Number(current.revision || 0) + 1;
    next.updatedAt = nowIso();
    next.lastIntent = text(input.intent, "Visual node edit", 500);
    const nextVisualDocument = {
      ...visualDocument,
      revision: Number(visualDocument.revision || 0) + 1,
      pages: visualDocument.pages.map((page, index) => index === pageIndex ? edited.page : page),
      updatedAt: nowIso(),
    };
    pushHistory(paths, "visualState", {
      revision: current.revision,
      deck: current,
      presentationSystem,
      visualDocument,
    }, input.intent);
    writeProjectState(paths, { deck: next, visualDocument: nextVisualDocument });
    return {
      ...inspectResult(inspect(paths)),
      editedNode,
    };
  }
  throw new Error("operation must be updateNode or setSelection");
}

function undo(paths, input) {
  ensureProject(paths);
  const current = loadDeck(paths, `deck-${paths.workId}`);
  const presentationSystem = loadPresentationSystem(paths);
  assertExpectedRevision(current.revision, input.expectedDeckRevision, "VisualDeck");
  assertExpectedRevision(presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
  const history = readJson(paths.historyFile, { schemaVersion: 2, undo: [] });
  if (!Array.isArray(history.undo) || history.undo.length === 0) {
    throw new Error("No visual presentation change is available to undo");
  }
  const entry = history.undo.pop();
  writeJson(paths.historyFile, history);
  if (entry.kind === "presentationState") {
    const restoredSystem = clone(entry.snapshot.presentationSystem);
    restoredSystem.revision = presentationSystem.revision + 1;
    restoredSystem.updatedAt = nowIso();
    const restoredHash = presentationSystemHash(restoredSystem);
    const restoredDeck = clone(entry.snapshot.deck);
    restoredDeck.revision = current.revision + 1;
    restoredDeck.presentationSystemRevision = restoredSystem.revision;
    restoredDeck.presentationSystemHash = restoredHash;
    restoredDeck.slides = restoredDeck.slides.map((slide) => ({
      ...slide,
      designSystemRevision: restoredSystem.revision,
      designSystemHash: restoredHash,
      status: ["generating", "failed"].includes(slide.status) ? slide.status : "previewReady",
      updatedAt: nowIso(),
    }));
    restoredDeck.updatedAt = nowIso();
    restoredDeck.lastIntent = `Undo: ${text(entry.intent, "presentation system change", 400)}`;
    const currentVisualDocument = readJson(paths.visualDocument, initialVisualDocument(current.deckId));
    const restoredVisualDocument = clone(entry.snapshot.visualDocument);
    restoredVisualDocument.revision = Number(currentVisualDocument.revision || 0) + 1;
    restoredVisualDocument.updatedAt = nowIso();
    writeProjectState(paths, {
      presentationSystem: restoredSystem,
      deck: restoredDeck,
      visualDocument: restoredVisualDocument,
    });
  } else if (entry.kind === "visualState") {
    const restoredDeck = clone(entry.snapshot.deck);
    restoredDeck.revision = current.revision + 1;
    restoredDeck.updatedAt = nowIso();
    restoredDeck.lastIntent = `Undo: ${text(entry.intent, "visual edit", 400)}`;
    const currentVisualDocument = readJson(paths.visualDocument, initialVisualDocument(current.deckId));
    const restoredVisualDocument = clone(entry.snapshot.visualDocument);
    restoredVisualDocument.revision = Number(currentVisualDocument.revision || 0) + 1;
    restoredVisualDocument.updatedAt = nowIso();
    writeProjectState(paths, { deck: restoredDeck, visualDocument: restoredVisualDocument });
  } else if (entry.kind === "presentationSystem") {
    const restored = clone(entry.snapshot);
    restored.revision = presentationSystem.revision + 1;
    restored.updatedAt = nowIso();
    writeJson(paths.presentationSystem, restored);
  } else if (entry.kind === "visualDeck") {
    const restored = clone(entry.snapshot);
    restored.revision = current.revision + 1;
    restored.updatedAt = nowIso();
    restored.lastIntent = `Undo: ${text(entry.intent, "visual change", 400)}`;
    writeJson(paths.deck, restored);
  } else {
    throw new Error("The latest history entry has an unsupported kind");
  }
  return inspectResult(inspect(paths));
}

function speakerSections(content) {
  return slideSections(content);
}

function deckWithSpeakerNotes(deck, speakerScript) {
  const sections = speakerSections(speakerScript);
  return {
    ...clone(deck),
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      notes: sections[index]?.content || slide.notes || "",
    })),
  };
}

function safeFilename(value, fallback) {
  const normalized = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return normalized || fallback;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgBox(element, parent) {
  return {
    x: parent.x + parent.w * element.x / 100,
    y: parent.y + parent.h * element.y / 100,
    w: parent.w * element.w / 100,
    h: parent.h * element.h / 100,
  };
}

function renderElementSvg(paths, element, assets, presentationSystem, parent = { x: 0, y: 0, w: 1600, h: 900 }) {
  const box = svgBox(element, parent);
  const style = element.style || {};
  const typeRole = resolveTypeRole(presentationSystem, style.textRole || (element.type === "shape" ? "label" : "body"));
  const color = resolveColor(presentationSystem, style.colorToken || "ink");
  const background = resolveColor(presentationSystem, style.fillToken || "surface", "#FFFFFF");
  const stroke = resolveColor(presentationSystem, style.strokeToken || presentationSystem.shape.borderToken);
  const fontSize = typeRole.size * 900 / 540;
  if (element.type === "group") {
    return solveGroupChildren(element).map((child) => renderElementSvg(paths, child, assets, presentationSystem, box)).join("");
  }
  if (element.type === "shape") {
    const radius = element.shape === "ellipse"
      ? Math.min(box.w, box.h) / 2
      : presentationSystem.shape.radius[style.radiusRole || (element.shape === "roundRect" ? "small" : "none")] * 1600 / 100;
    const shape = element.shape === "ellipse"
      ? `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="${background}" stroke="${stroke}" stroke-width="${style.strokeWidth ?? presentationSystem.shape.strokeWidth}"/>`
      : `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${radius}" fill="${background}" stroke="${stroke}" stroke-width="${style.strokeWidth ?? presentationSystem.shape.strokeWidth}"/>`;
    const label = element.text
      ? `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" fill="${color}" font-family="${escapeXml(typeRole.familyName)}" font-size="${fontSize}" font-weight="${typeRole.weight}" text-anchor="middle" dominant-baseline="middle">${escapeXml(element.text)}</text>`
      : "";
    return shape + label;
  }
  if (element.type === "line") {
    return `<line x1="${box.x}" y1="${box.y}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="${resolveColor(presentationSystem, style.strokeToken || "primary")}" stroke-width="${boundedNumber(style.strokeWidth, presentationSystem.shape.strokeWidth, 0.25, 24)}"/>`;
  }
  if (element.type === "image" || element.type === "svg") {
    const asset = assets.get(element.assetId);
    const dataUri = assetDataUri(paths, asset, presentationSystem);
    const fit = presentationSystem.media.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
    return `<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="${fit}" href="${escapeXml(dataUri)}"/>`;
  }
  if (element.type === "chart") {
    const max = Math.max(1, ...element.data.map((point) => Math.abs(point.value)));
    const gap = 12;
    const barWidth = Math.max(8, (box.w - gap * (element.data.length + 1)) / element.data.length);
    return element.data.map((point, index) => {
      const height = Math.max(4, box.h * 0.68 * Math.abs(point.value) / max);
      const x = box.x + gap + index * (barWidth + gap);
      const y = box.y + box.h - 28 - height;
      const seriesToken = presentationSystem.chart.seriesTokens[index % presentationSystem.chart.seriesTokens.length];
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${resolveColor(presentationSystem, seriesToken)}"/><text x="${x + barWidth / 2}" y="${box.y + box.h - 8}" fill="${color}" font-family="${escapeXml(typeRole.familyName)}" font-size="14" text-anchor="middle">${escapeXml(point.label)}</text>`;
    }).join("");
  }
  if (element.type === "table") {
    const rowHeight = box.h / element.rows.length;
    const columnWidth = box.w / element.rows[0].length;
    return element.rows.map((row, rowIndex) => row.map((cell, columnIndex) => {
      const x = box.x + columnIndex * columnWidth;
      const y = box.y + rowIndex * rowHeight;
      return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${rowIndex === 0 ? resolveColor(presentationSystem, "surface") : "transparent"}" stroke="${resolveColor(presentationSystem, "border")}"/><text x="${x + 10}" y="${y + rowHeight / 2}" fill="${color}" font-family="${escapeXml(typeRole.familyName)}" font-size="${Math.min(fontSize, 22)}" dominant-baseline="middle">${escapeXml(cell)}</text>`;
    }).join("")).join("");
  }
  const lines = String(element.text || "").split("\n");
  const anchor = style.align === "center" ? "middle" : style.align === "right" ? "end" : "start";
  const x = style.align === "center" ? box.x + box.w / 2 : style.align === "right" ? box.x + box.w : box.x;
  return `<text x="${x}" y="${box.y + fontSize}" fill="${color}" font-family="${escapeXml(typeRole.familyName)}" font-size="${fontSize}" font-weight="${typeRole.weight}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * typeRole.lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function compiledBox(node) {
  return {
    x: 1600 * node.box.x / 100,
    y: 900 * node.box.y / 100,
    w: 1600 * node.box.w / 100,
    h: 900 * node.box.h / 100,
  };
}

function renderCompiledNodeSvg(paths, node, assets) {
  const box = compiledBox(node);
  const style = node.style || {};
  const fontSize = Number(style.fontSize || 18) * 900 / 540;
  const strokeDash = style.dash === "dash" ? "8 6" : style.dash === "dot" ? "2 5" : "none";
  if (node.type === "shape") {
    const radius = node.shape === "ellipse" ? Math.min(box.w, box.h) / 2 : Number(style.radius || 0) * 16;
    const shape = node.shape === "ellipse"
      ? `<ellipse cx="${box.x + box.w / 2}" cy="${box.y + box.h / 2}" rx="${box.w / 2}" ry="${box.h / 2}" fill="${style.fill}" fill-opacity="${style.opacity}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`
      : `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${radius}" fill="${style.fill}" fill-opacity="${style.opacity}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`;
    const label = node.text
      ? `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" fill="${style.color}" font-family="${escapeXml(style.fontFamily)}" font-size="${fontSize}" font-weight="${style.fontWeight}" text-anchor="middle" dominant-baseline="middle">${escapeXml(node.text)}</text>`
      : "";
    return shape + label;
  }
  if (node.type === "line") {
    return `<line x1="${box.x}" y1="${box.y}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-dasharray="${strokeDash}"/>`;
  }
  if (node.type === "image" || node.type === "svg") {
    const asset = assets.get(node.assetId);
    const dataUri = assetDataUri(paths, asset, loadPresentationSystem(paths));
    const fit = node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
    return `<image x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="${fit}" href="${escapeXml(dataUri)}"/>`;
  }
  if (node.type === "chart") {
    const max = Math.max(1, ...node.data.map((point) => Math.abs(point.value)));
    const gap = 12;
    const barWidth = Math.max(8, (box.w - gap * (node.data.length + 1)) / node.data.length);
    return node.data.map((point, index) => {
      const height = Math.max(4, box.h * 0.68 * Math.abs(point.value) / max);
      const x = box.x + gap + index * (barWidth + gap);
      const y = box.y + box.h - 28 - height;
      const color = node.seriesColors[index % node.seriesColors.length];
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" fill="${color}"/><text x="${x + barWidth / 2}" y="${box.y + box.h - 8}" fill="${style.color}" font-family="${escapeXml(style.fontFamily)}" font-size="14" text-anchor="middle">${escapeXml(point.label)}</text>`;
    }).join("");
  }
  if (node.type === "table") {
    const rowHeight = box.h / node.rows.length;
    const columnWidth = box.w / node.rows[0].length;
    return node.rows.map((row, rowIndex) => row.map((cell, columnIndex) => {
      const x = box.x + columnIndex * columnWidth;
      const y = box.y + rowIndex * rowHeight;
      return `<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${rowIndex === 0 ? style.fill : "transparent"}" stroke="${style.stroke}"/><text x="${x + 10}" y="${y + rowHeight / 2}" fill="${style.color}" font-family="${escapeXml(style.fontFamily)}" font-size="${Math.min(fontSize, 22)}" dominant-baseline="middle">${escapeXml(cell)}</text>`;
    }).join("")).join("");
  }
  const lines = String(node.text || "").split("\n");
  const anchor = style.align === "center" ? "middle" : style.align === "right" ? "end" : "start";
  const x = style.align === "center" ? box.x + box.w / 2 : style.align === "right" ? box.x + box.w : box.x;
  const y = style.valign === "middle" ? box.y + box.h / 2 - (lines.length - 1) * fontSize * style.lineHeight / 2 : box.y + fontSize;
  return `<text x="${x}" y="${y}" fill="${style.color}" fill-opacity="${style.opacity}" font-family="${escapeXml(style.fontFamily)}" font-size="${fontSize}" font-weight="${style.fontWeight}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fontSize * style.lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function rgbFromHex(value) {
  return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

async function reviewDeck(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  if (input.mode === "prepare") {
    assertExpectedRevision(snapshot.deck.revision, input.expectedDeckRevision, "VisualDeck");
    assertExpectedRevision(snapshot.presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
    assertExpectedRevision(snapshot.manuscript.revision, input.expectedManuscriptRevision, "Manuscript");
    if (
      snapshot.designCase?.status !== "approved" ||
      snapshot.designCase.manuscriptRevision !== snapshot.manuscript.revision ||
      snapshot.designCase.manuscriptHash !== snapshot.manuscript.contentHash ||
      snapshot.designCase.systemRevision !== snapshot.presentationSystem.revision ||
      snapshot.designCase.systemHash !== snapshot.presentationSystem.contentHash
    ) {
      throw new Error("Deck review requires an approved Design Case for the current Manuscript");
    }
    if (snapshot.deck.slides.length !== snapshot.manuscript.slides.length) {
      throw new Error("Deck review requires every current Manuscript page to be generated");
    }
    const assets = loadAssets(paths);
    const reviewId = `deck-review-${snapshot.deck.revision}-${snapshot.presentationSystem.revision}-${Date.now()}`;
    const reviewRoot = path.join(paths.render, reviewId);
    fs.mkdirSync(reviewRoot, { recursive: true });
    const slidePreviews = [];
    const pages = [];
    for (let index = 0; index < snapshot.deck.slides.length; index += 1) {
      const slide = snapshot.deck.slides[index];
      if (!slide.renderTree) throw new Error(`Slide '${slide.id}' has no committed render tree`);
      const nodes = [...slide.renderTree.nodes].sort((left, right) => Number(left.z || 0) - Number(right.z || 0));
      const body = nodes.map((node) => renderCompiledNodeSvg(paths, node, assets)).join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${slide.renderTree.canvas.background}"/>${body}</svg>`;
      const baseName = `slide-${String(index + 1).padStart(2, "0")}`;
      const svgRef = path.join(reviewRoot, `${baseName}.svg`);
      const previewRef = path.join(reviewRoot, `${baseName}.png`);
      atomicWrite(svgRef, svg);
      const rendered = await renderSvg(svg, 1600);
      atomicWrite(previewRef, rendered.png);
      slidePreviews.push({ slideId: slide.id, title: slide.title, previewRef, svgRef, png: rendered.png });
      pages.push({
        position: index + 1,
        slideId: slide.id,
        title: slide.title,
        claim: slide.claim,
        pageRole: slide.pageRole,
        recipeId: slide.recipeId,
        visualMode: slide.visualMode,
        evidenceObject: slide.evidenceObject,
        sourceNote: slide.sourceNote,
        readingOrder: nodes.map((node) => node.id),
        renderTree: slide.renderTree,
        svgRef,
        previewRef,
      });
    }
    const contact = await renderContactSheet(slidePreviews, { background: resolveColor(presentationSystemContent(snapshot.presentationSystem), "border") });
    const contactSheetRef = path.join(reviewRoot, "contact-sheet.png");
    atomicWrite(contactSheetRef, contact.png);
    const bundle = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      reviewId,
      kind: "deck",
      deckRevision: snapshot.deck.revision,
      systemRevision: snapshot.presentationSystem.revision,
      systemHash: snapshot.presentationSystem.contentHash,
      manuscriptRevision: snapshot.manuscript.revision,
      manuscriptHash: snapshot.manuscript.contentHash,
      speakerScriptRevision: snapshot.manuscript.speakerScriptRevision,
      speakerScriptHash: snapshot.manuscript.speakerScriptHash,
      designCaseRevision: snapshot.designCase.revision,
      ruleViolations: snapshot.ruleViolations,
      manuscript: snapshot.manuscript,
      sourceDocuments: {
        manuscript: fs.readFileSync(paths.manuscript, "utf8"),
        speakerScript: fs.readFileSync(paths.speakerScript, "utf8"),
      },
      alignmentReview: {
        mode: "ai-semantic-comparison",
        compare: ["manuscript", "visual-pages"],
        requiredJudgments: REQUIRED_ALIGNMENT_CHECKS,
      },
      presentationSystem: snapshot.presentationSystem,
      designUsage: snapshot.presentationDesignUsage,
      assets: [...assets.values()],
      pages,
      slidePreviews: slidePreviews.map(({ png, ...preview }) => preview),
      contactSheetRef,
      generatedAt: nowIso(),
    };
    const bundlePath = path.join(reviewRoot, "visual-inspection-bundle.json");
    writeJson(bundlePath, bundle);
    const prepared = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      reviewId,
      kind: "deck",
      status: "awaitingAiReview",
      deckRevision: bundle.deckRevision,
      systemRevision: bundle.systemRevision,
      systemHash: bundle.systemHash,
      manuscriptRevision: bundle.manuscriptRevision,
      manuscriptHash: bundle.manuscriptHash,
      speakerScriptRevision: bundle.speakerScriptRevision,
      speakerScriptHash: bundle.speakerScriptHash,
      designCaseRevision: bundle.designCaseRevision,
      slideCount: pages.length,
      slidePreviews: bundle.slidePreviews,
      contactSheetRef,
      bundlePath,
      ruleViolations: bundle.ruleViolations,
      createdAt: nowIso(),
    };
    writeJson(paths.latestReview, prepared);
    return { ...prepared, visualInspectionBundle: bundle };
  }
  if (input.mode !== "commit") throw new Error("reviewDeck mode must be prepare or commit");
  const prepared = readJson(paths.latestReview, null);
  if (!prepared || prepared.reviewId !== input.reviewId || prepared.status !== "awaitingAiReview") {
    throw new Error("reviewDeck commit requires the current prepared reviewId");
  }
  if (
    prepared.deckRevision !== snapshot.deck.revision ||
    prepared.systemRevision !== snapshot.presentationSystem.revision ||
    prepared.manuscriptRevision !== snapshot.manuscript.revision ||
    prepared.manuscriptHash !== snapshot.manuscript.contentHash ||
    prepared.speakerScriptRevision !== snapshot.manuscript.speakerScriptRevision ||
    prepared.speakerScriptHash !== snapshot.manuscript.speakerScriptHash
  ) {
    throw new Error("Deck, system, Manuscript, or speaker script changed after review preparation");
  }
  const coverage = objectValue(input.reviewCoverage, "reviewCoverage");
  if (!["multimodal", "text-only"].includes(coverage.mode)) throw new Error("reviewCoverage.mode must be multimodal or text-only");
  const inspectedSlideIds = Array.isArray(coverage.inspectedSlideIds) ? coverage.inspectedSlideIds.map(String) : [];
  const expectedIds = snapshot.deck.slides.map((slide) => slide.id);
  if (new Set(inspectedSlideIds).size !== expectedIds.length || expectedIds.some((id) => !inspectedSlideIds.includes(id))) {
    throw new Error("reviewCoverage.inspectedSlideIds must contain every current slide exactly once");
  }
  const evidenceMode = coverage.mode === "multimodal" ? "rendered-pixels" : "visual-inspection-bundle";
  if (coverage.evidenceMode !== evidenceMode) throw new Error(`reviewCoverage.evidenceMode must be '${evidenceMode}'`);
  const alignment = objectValue(input.alignmentCoverage, "alignmentCoverage");
  const alignedSlideIds = Array.isArray(alignment.inspectedManuscriptSlideIds)
    ? alignment.inspectedManuscriptSlideIds.map(String)
    : [];
  const manuscriptSlideIds = snapshot.manuscript.slides.map((slide) => slide.slideId);
  if (
    new Set(alignedSlideIds).size !== manuscriptSlideIds.length ||
    manuscriptSlideIds.some((id) => !alignedSlideIds.includes(id))
  ) {
    throw new Error("alignmentCoverage.inspectedManuscriptSlideIds must contain every current Manuscript slide exactly once");
  }
  const alignmentChecks = Array.isArray(alignment.checks) ? [...new Set(alignment.checks.map(String))] : [];
  if (
    alignmentChecks.some((check) => !REQUIRED_ALIGNMENT_CHECKS.includes(check)) ||
    REQUIRED_ALIGNMENT_CHECKS.some((check) => !alignmentChecks.includes(check))
  ) {
    throw new Error("alignmentCoverage.checks must contain every required Manuscript-to-visual alignment judgment");
  }
  const findings = normalizeReviewFindings(input.findings || []);
  if (!["passed", "needs_revision"].includes(input.decision)) throw new Error("decision must be passed or needs_revision");
  if (input.decision === "passed" && findings.some((finding) => finding.severity === "critical" || finding.severity === "major")) {
    throw new Error("A passed review cannot retain critical or major ReviewFindings");
  }
  const status = prepared.ruleViolations.length ? "blocked"
    : input.decision === "passed" ? "passed" : "needsRevision";
  const review = {
    ...prepared,
    status,
    decision: input.decision,
    findings,
    alignmentCoverage: {
      inspectedManuscriptSlideIds: alignedSlideIds,
      checks: alignmentChecks,
      summary: requiredText(alignment.summary, "alignmentCoverage.summary", 2000),
    },
    reviewCoverage: {
      mode: coverage.mode,
      evidenceMode,
      inspectedSlideIds,
      limitations: text(coverage.limitations, coverage.mode === "text-only" ? "No direct pixel inspection was performed." : "", 1000),
    },
    completedAt: nowIso(),
  };
  writeJson(paths.latestReview, review);
  return review;
}

function hydrateDeckAssets(paths, deck, presentationSystem) {
  const assets = loadAssets(paths);
  const flatten = (element, parent = { x: 0, y: 0, w: 100, h: 100 }, inheritedZ = 0) => {
    const projected = {
      ...element,
      x: parent.x + parent.w * element.x / 100,
      y: parent.y + parent.h * element.y / 100,
      w: parent.w * element.w / 100,
      h: parent.h * element.h / 100,
      z: inheritedZ + Number(element.z || 0),
    };
    if (element.type === "group") {
      return solveGroupChildren(element).flatMap((child) => flatten(child, projected, projected.z));
    }
    return [projected];
  };
  const hydrate = (element) => {
    if (element.type !== "image" && element.type !== "svg") return element;
    const asset = assets.get(element.assetId);
    return { ...element, assetData: assetDataUri(paths, asset, presentationSystem), assetMimeType: asset.mimeType };
  };
  return {
    ...deck,
    presentationSystem: presentationSystemContent(presentationSystem),
    slides: deck.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.flatMap((element) => flatten(element)).map(hydrate),
      renderTree: slide.renderTree
        ? { ...slide.renderTree, nodes: slide.renderTree.nodes.map(hydrate) }
        : slide.renderTree,
    })),
  };
}

function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Exported PPTX is not a valid ZIP package");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Exported PPTX has an invalid central directory");
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    entries.push(buffer.subarray(cursor + 46, cursor + 46 + filenameLength).toString("utf8"));
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function validatePptx(buffer, deck) {
  if (buffer.length < 10_000 || buffer.subarray(0, 2).toString() !== "PK") {
    throw new Error("Exported PPTX is empty or malformed");
  }
  const entries = zipEntries(buffer);
  for (const required of ["[Content_Types].xml", "ppt/presentation.xml"]) {
    if (!entries.includes(required)) throw new Error(`Exported PPTX is missing ${required}`);
  }
  const slideCount = entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  if (slideCount !== deck.slides.length) {
    throw new Error(`Exported PPTX contains ${slideCount} slides, expected ${deck.slides.length}`);
  }
  const expectedNotes = deck.slides.filter((slide) => slide.notes).length;
  const notesCount = entries.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length;
  if (notesCount < expectedNotes) throw new Error(`Exported PPTX contains ${notesCount} notes pages, expected at least ${expectedNotes}`);
  const expectedMedia = deck.slides.reduce((count, slide) => count + (slide.renderTree?.nodes || slide.elements || [])
    .filter((element) => element.type === "image" || element.type === "svg").length, 0);
  const mediaCount = entries.filter((name) => /^ppt\/media\//.test(name)).length;
  if (mediaCount < expectedMedia) throw new Error(`Exported PPTX contains ${mediaCount} media files, expected at least ${expectedMedia}`);
  return { status: "passed", slideCount, notesCount, mediaCount, packageEntries: entries.length };
}

async function exportDeck(paths, input) {
  ensureProject(paths);
  const snapshot = inspect(paths);
  if (!snapshot.deck.slides.length) throw new Error("Create at least one slide before exporting");
  assertExpectedRevision(snapshot.deck.revision, input.expectedDeckRevision, "VisualDeck");
  assertExpectedRevision(snapshot.presentationSystem.revision, input.expectedSystemRevision, "PresentationSystem");
  const review = snapshot.latestReview;
  if (!review || review.reviewId !== input.reviewId) throw new Error("Export requires the latest explicit reviewId");
  if (
    review.status !== "passed" ||
    review.deckRevision !== snapshot.deck.revision ||
    review.systemRevision !== snapshot.presentationSystem.revision ||
    review.systemHash !== snapshot.presentationSystem.contentHash ||
    review.manuscriptRevision !== snapshot.manuscript.revision ||
    review.manuscriptHash !== snapshot.manuscript.contentHash ||
    review.speakerScriptRevision !== snapshot.manuscript.speakerScriptRevision ||
    review.speakerScriptHash !== snapshot.manuscript.speakerScriptHash
  ) {
    throw new Error("The latest presentation review is not passed for the current Manuscript, VisualDeck, and PresentationSystem revisions");
  }
  if (!review.reviewCoverage || !["multimodal", "text-only"].includes(review.reviewCoverage.mode)) {
    throw new Error("Export requires explicit deck-wide ReviewCoverage");
  }
  if (snapshot.ruleViolations.length) {
    throw new Error("Export is blocked by deterministic RuleViolations");
  }
  const speakerScript = fs.readFileSync(paths.speakerScript, "utf8");
  const deck = hydrateDeckAssets(paths, deckWithSpeakerNotes(snapshot.deck, speakerScript), snapshot.presentationSystem);
  const format = input.format || "pptx";
  if (format !== "pptx") throw new Error("PPT Live exports only validated PowerPoint files");
  const baseName = safeFilename(input.filename || deck.title, "presentation")
    .replace(/\.pptx$/i, "");
  const modulePath = path.join(
    __dirname,
    "vendor",
    "ppt-export.bundle.mjs",
  );
  const { exportPptxFromDeck } = await import(pathToFileURL(modulePath).href);
  const result = await exportPptxFromDeck(deck);
  const outputPath = path.join(paths.exports, `${baseName}.pptx`);
  const buffer = Buffer.from(result.base64, "base64");
  const validation = validatePptx(buffer, deck);
  atomicWrite(outputPath, buffer);
  syncControlMetadata(paths, path.basename(outputPath));
  const bytes = buffer.length;
  const mimeType = result.mimeType;
  return {
    artifact: {
      path: outputPath,
      filename: path.basename(outputPath),
      title: path.basename(outputPath),
      format,
      mimeType,
      bytes,
      deckRevision: snapshot.deck.revision,
      systemRevision: snapshot.presentationSystem.revision,
      reviewId: review.reviewId,
      createdAt: nowIso(),
      validation,
    },
    review,
    ruleViolations: snapshot.ruleViolations,
  };
}

async function dispatch(action, input = {}, trusted = {}) {
  if (action === "attachWorkObject") {
    return attachWorkObject(input, trusted);
  }
  const paths = projectPaths(trusted, {
    create: action === "initializeWork",
    title: input.title || trusted.workTitle,
  });
  if (action === "initializeWork") {
    initializeProject(paths, input, trusted);
    return inspect(paths, input);
  }
  bindControlSession(paths, trusted.sessionId);
  let result;
  switch (action) {
    case "inspect":
      result = inspect(paths, input);
      break;
    case "getDocument":
      result = getDocument(paths, input);
      break;
    case "commitPresentationDocument":
      result = commitPresentationDocument(paths, input);
      break;
    case "commitPresentationManuscript":
      result = commitPresentationManuscript(paths, input);
      break;
    case "commitSpeakerScript":
      result = commitSpeakerScript(paths, input);
      break;
    case "reviewPresentationManuscript":
      result = reviewPresentationManuscript(paths, input);
      break;
    case "getAsset":
      result = getVisualAsset(paths, input);
      break;
    case "setPresentationSystem":
      result = setPresentationSystem(paths, input);
      break;
    case "renderDesignCase":
      result = await renderDesignCase(paths, input);
      break;
    case "decideDesignCase":
      result = decideDesignCase(paths, input);
      break;
    case "prepareVisualAssets":
      result = prepareVisualAssets(paths, input);
      break;
    case "generateSlideVisual":
      result = commitSingleSlide(paths, input);
      break;
    case "editVisual":
      result = editVisual(paths, input);
      break;
    case "undo":
      result = undo(paths, input);
      break;
    case "reviewDeck":
      result = await reviewDeck(paths, input);
      break;
    case "export":
      result = await exportDeck(paths, input);
      break;
    default:
      throw new Error(`Unsupported PPT Deck action: ${action}`);
  }
  if (!new Set(["inspect", "getDocument", "getAsset"]).has(action)) {
    syncHumanReadableDesign(paths);
    syncControlMetadata(paths);
  }
  return result;
}

module.exports = {
  DEFAULT_PRESENTATION_SYSTEM,
  compileSlide,
  dispatch,
  presentationSystemHash,
  projectPaths,
  slideSections,
  normalizePresentationSystem,
  normalizeSlides,
  validatePptx,
};
