const BRIDGE_ID = "builtin-ppt-runtime";
const CAPABILITY_ID = "sparo.pptDeck";

function normalizeInput(input = {}) {
  const payload = { ...input };
  delete payload.workspacePath;
  delete payload.workspace_path;
  delete payload.workId;
  delete payload.work_id;
  delete payload.runtimeInstanceId;
  delete payload.runtime_instance_id;
  delete payload.sessionId;
  delete payload.session_id;
  return payload;
}

function callDeckEngine(action, input, summary) {
  return {
    summary,
    bridgeCall: {
      bridgeId: BRIDGE_ID,
      capabilityId: CAPABILITY_ID,
      action,
      input: normalizeInput(input),
    },
  };
}

module.exports = { callDeckEngine, normalizeInput };
