const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("undo", input, "Restored the previous visual presentation revision.");
}

module.exports = { run };
