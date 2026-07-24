const fs = require("node:fs");
const { AsyncLocalStorage } = require("node:async_hooks");

const requestContext = new AsyncLocalStorage();

function emit(event) {
  const line = `${JSON.stringify(event)}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

function emitStatus(message, phase = "running") {
  emitRunEvent({ type: "run.status", status: "running", phase, message });
}

function emitRunEvent(event) {
  const context = requestContext.getStore();
  if (!context?.runId || !context?.bridgeId) {
    throw new Error("Bridge runtime event emitted outside a request context.");
  }
  emit({ bridgeId: context.bridgeId, runId: context.runId, event });
}

function runWithRequestContext(context, callback) {
  return requestContext.run(context, callback);
}

module.exports = {
  emitRunEvent,
  emitStatus,
  runWithRequestContext,
};
