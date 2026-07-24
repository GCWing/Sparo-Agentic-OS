const fs = require("node:fs");

function emit(payload) {
  const line = `${JSON.stringify(payload)}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

module.exports = { emit };
