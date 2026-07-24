const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("reviewPresentationManuscript", input, input.mode === "prepare" ? "Prepared whole-manuscript review evidence." : "Committed whole-manuscript review findings.");
}

module.exports = { run };
