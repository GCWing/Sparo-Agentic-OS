const BRIDGE_ID = "builtin-excel-runtime";
const CAPABILITY_ID = "sparo.excelEngine";

function normalizeWorkspaceRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error("Excel Agent file paths must be non-empty workspace-relative paths");
  }
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(
      "Excel Agent file paths must stay inside the active workspace; absolute paths and parent traversal are not allowed"
    );
  }
  return normalized;
}

function normalizeInput(input = {}, context = {}) {
  const payload = { ...input };
  // The model must never choose or override the storage root. Bind every
  // Excel operation to the workspace supplied by the trusted tool runtime.
  delete payload.workspacePath;
  delete payload.workspace_path;
  if (!context.workspaceRoot || typeof context.workspaceRoot !== "string") {
    throw new Error("Excel Live requires a host-bound workspace root");
  }
  payload.workspacePath = context.workspaceRoot;
  if (payload.path != null) {
    payload.path = normalizeWorkspaceRelativePath(payload.path);
  }
  if (!payload.workbookId && payload.workbook_id) {
    payload.workbookId = payload.workbook_id;
    delete payload.workbook_id;
  }
  if (!payload.sheetId && payload.sheet_id) {
    payload.sheetId = payload.sheet_id;
    delete payload.sheet_id;
  }
  if (!payload.sheetName && payload.sheet_name) {
    payload.sheetName = payload.sheet_name;
    delete payload.sheet_name;
  }
  if (!payload.proposalId && payload.proposal_id) {
    payload.proposalId = payload.proposal_id;
    delete payload.proposal_id;
  }
  if (payload.expectedRevision == null && payload.expected_revision != null) {
    payload.expectedRevision = payload.expected_revision;
    delete payload.expected_revision;
  }
  if (!payload.cellRefs && Array.isArray(payload.cell_refs)) {
    payload.cellRefs = payload.cell_refs;
    delete payload.cell_refs;
  }
  if (!payload.maxCells && payload.max_cells != null) {
    payload.maxCells = payload.max_cells;
    delete payload.max_cells;
  }
  if (payload.range && !payload.a1) {
    payload.a1 = payload.range;
    delete payload.range;
  }
  return payload;
}

function callExcelEngine(action, input, context, summary) {
  return {
    summary,
    bridgeCall: {
      bridgeId: BRIDGE_ID,
      capabilityId: CAPABILITY_ID,
      action,
      // Live grid edits already persist under
      // <workspace>/.sparo_os/excel-live/<workbookId>/workbook.json.
      // Always pass workbookId from spreadsheet-focus when available.
      input: normalizeInput(input, context),
    },
  };
}

module.exports = {
  callExcelEngine,
  normalizeInput,
  normalizeWorkspaceRelativePath,
};
