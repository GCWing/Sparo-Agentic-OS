const BRIDGE_ID = "builtin-harmony-runtime";
const CAPABILITY_ID = "sparo.harmonyDev";

function normalizeInput(input = {}, context = {}) {
  const payload = { ...input };
  if (!payload.workspacePath && !payload.workspace_path && context.workspaceRoot) {
    payload.workspacePath = context.workspaceRoot;
  }
  return payload;
}

function callHarmonyRuntime(action, input, context, summary) {
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
  callHarmonyRuntime,
};
