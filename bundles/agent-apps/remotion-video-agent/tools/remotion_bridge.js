const BRIDGE_ID = "builtin-remotion-runtime";
const CAPABILITY_ID = "sparo.videoEngine";

function normalizeInput(input = {}, context = {}) {
  const payload = { ...input };
  if (!payload.workspacePath && !payload.workspace_path && context.workspaceRoot) {
    payload.workspacePath = context.workspaceRoot;
  }
  if (!payload.compositionId && payload.composition) {
    payload.compositionId = payload.composition;
  }
  if (payload.selectedElement && !payload.selection) {
    payload.selection = payload.selectedElement;
    delete payload.selectedElement;
  }
  return payload;
}

function callVideoEngine(action, input, context, summary) {
  return {
    summary,
    bridgeCall: {
      bridgeId: BRIDGE_ID,
      capabilityId: CAPABILITY_ID,
      action,
      input: normalizeInput(input, context),
    },
  };
}

module.exports = {
  callVideoEngine,
};
