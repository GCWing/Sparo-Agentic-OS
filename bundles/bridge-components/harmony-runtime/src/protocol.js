const fs = require("node:fs");

function emit(event) {
  const line = `${JSON.stringify(event)}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

function emitStatus(message, status = "running") {
  emit({ type: "run.status", status, message });
}

function readRequest() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(input.trim() || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

module.exports = {
  emit,
  emitStatus,
  readRequest,
};
