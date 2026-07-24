const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("renderDesignCase", input, "Rendered three real Design Case pages for direction approval.");
}

module.exports = { run };
