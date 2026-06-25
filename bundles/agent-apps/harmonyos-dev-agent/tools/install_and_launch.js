const { callHarmonyRuntime } = require("./harmony_bridge");

async function run(input = {}, context) {
  const action = input.mode === "launch" ? "launchAbility" : "installApp";
  return callHarmonyRuntime(
    action,
    input,
    context,
    input.mode === "launch"
      ? "Launched the HarmonyOS ability through HDC."
      : "Installed the HarmonyOS artifact through HDC.",
  );
}

module.exports = { run };
