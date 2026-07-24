const { callDeckEngine } = require("./ppt_bridge");

async function run(input) {
  return callDeckEngine("commitPresentationDocument", input, "Committed the structured presentation document as canonical Markdown.");
}

module.exports = { run };
