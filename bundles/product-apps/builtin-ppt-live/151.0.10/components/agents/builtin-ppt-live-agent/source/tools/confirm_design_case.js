const BRIDGE_ID = "builtin-ppt-runtime";
const CAPABILITY_ID = "sparo.pptDeck";

async function run(input) {
  return {
    summary: "The user reviewed the three-page Design Case and recorded a direction decision.",
    awaitUserInput: {
      mode: "mergeIntoBridgeInput",
      timeoutMs: 600000,
    },
    bridgeCall: {
      bridgeId: BRIDGE_ID,
      capabilityId: CAPABILITY_ID,
      action: "decideDesignCase",
      input: { caseId: input.caseId },
    },
  };
}

module.exports = { run };
