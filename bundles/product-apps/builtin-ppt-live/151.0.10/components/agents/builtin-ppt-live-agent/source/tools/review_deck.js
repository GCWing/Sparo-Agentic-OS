const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("reviewDeck", input, input.mode === "prepare" ? "Prepared whole-deck content and visual review evidence." : "Committed whole-deck review findings and coverage.");
}

module.exports = { run };
