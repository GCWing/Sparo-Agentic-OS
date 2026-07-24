const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("inspect", { ...input, audience: "agent" }, "Inspected presentation production state.");
}

module.exports = { run };
