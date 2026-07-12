const { emit } = require("./src/protocol");
const { dispatch } = require("./src/engine");

/**
 * Persistent daemon loop for the Sparo Excel Engine.
 *
 * Hosts that still send a single JSON blob and close stdin keep working:
 * we process that one request and exit when stdin ends with no more lines.
 * Daemon hosts send one NDJSON request per line and keep the process alive
 * so workbook sessions stay warm across edits / agent tool calls.
 */
function handleRequest(request) {
  const action = request.action;
  const rawInput = request.input && typeof request.input === "object" && !Array.isArray(request.input)
    ? request.input
    : {};
  const consumer = request.consumer && typeof request.consumer === "object"
    ? request.consumer
    : {};
  const input = {
    ...rawInput,
    // The host envelope owns these values. A bridge action payload must not
    // replace the workspace or consumer authority selected by the host.
    workspacePath: request.workspacePath || request.workspace_path || null,
    __trustedConsumerKind: consumer.kind || null,
  };
  const runId = request.runId || request.run_id || `excel-${Date.now()}`;
  const bridgeId = request.bridgeId || request.bridge_id || "builtin-excel-runtime";
  const emitEvent = (event) => emit({ bridgeId, runId, event });
  emitEvent({ type: "run.started", run_id: runId });
  try {
    const output = dispatch(action, input);
    emitEvent({ type: "run.completed", output });
  } catch (error) {
    emitEvent({
      type: "run.failed",
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function main() {
  let buffer = "";
  let sawRequest = false;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      sawRequest = true;
      let request;
      try {
        request = JSON.parse(line);
      } catch (error) {
        process.stderr.write(
          `Invalid Bridge worker request: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      }
      handleRequest(request);
    }
  });
  process.stdin.on("end", () => {
    const leftover = buffer.trim();
    if (leftover) {
      try {
        sawRequest = true;
        handleRequest(JSON.parse(leftover));
      } catch (error) {
        process.stderr.write(
          `Invalid Bridge worker request: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
        return;
      }
    }
    // One-shot hosts close stdin after a single request; exit cleanly.
    if (!sawRequest) {
      process.stderr.write("No Bridge worker request received on stdin\n");
      process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
  });
  process.stdin.on("error", (error) => {
    process.stderr.write(
      `Bridge worker stdin failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}

main();
