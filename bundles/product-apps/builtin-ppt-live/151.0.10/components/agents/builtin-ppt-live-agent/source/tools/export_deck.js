const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("export", input, "Exported the current committed presentation.");
}

module.exports = { run };
