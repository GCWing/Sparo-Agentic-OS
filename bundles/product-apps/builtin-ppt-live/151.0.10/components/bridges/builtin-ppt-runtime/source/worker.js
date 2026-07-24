const { emit } = require("./src/protocol");
const { dispatch } = require("./src/engine");

async function handleRequest(request) {
  const consumer = request.consumer && typeof request.consumer === "object"
    ? request.consumer
    : {};
  const runId = request.runId || request.run_id || `ppt-${Date.now()}`;
  const bridgeId = request.bridgeId || request.bridge_id || "builtin-ppt-runtime";
  const input = request.input && typeof request.input === "object" && !Array.isArray(request.input)
    ? request.input
    : {};
  const trusted = {
    workspacePath: request.workspacePath || request.workspace_path || null,
    workId: consumer.workId || consumer.work_id || null,
    workTitle: consumer.workTitle || consumer.work_title || null,
    runtimeInstanceId: consumer.runtimeInstanceId || consumer.runtime_instance_id || null,
    sessionId: consumer.sessionId || consumer.session_id || null,
    consumerKind: consumer.kind || null,
  };

  emit({ bridgeId, runId, event: { type: "run.started", run_id: runId } });
  try {
    const output = await dispatch(request.action, input, trusted);
    if (output?.artifact && typeof output.artifact === "object") {
      emit({ bridgeId, runId, event: { type: "artifact.created", artifact: output.artifact } });
    }
    emit({ bridgeId, runId, event: { type: "run.completed", output } });
  } catch (error) {
    // Failed generation is non-mutating: the previous committed preview remains authoritative.
    const failure = {
      message: error instanceof Error ? error.message : String(error),
    };
    if (error && typeof error === "object") {
      if (typeof error.code === "string") failure.code = error.code;
      if (Number.isInteger(error.contractVersion)) failure.contractVersion = error.contractVersion;
      if (Array.isArray(error.violations)) failure.violations = error.violations;
    }
    emit({
      bridgeId,
      runId,
      event: {
        type: "run.failed",
        error: failure,
      },
    });
  }
}

function main() {
  let buffer = "";
  let queue = Promise.resolve();
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
        process.stderr.write(`Invalid Bridge worker request: ${error.message}\n`);
        process.exitCode = 1;
        continue;
      }
      queue = queue.then(() => handleRequest(request));
    }
  });
  process.stdin.on("end", async () => {
    const leftover = buffer.trim();
    if (leftover) {
      sawRequest = true;
      try {
        const request = JSON.parse(leftover);
        queue = queue.then(() => handleRequest(request));
      } catch (error) {
        process.stderr.write(`Invalid Bridge worker request: ${error.message}\n`);
        process.exitCode = 1;
      }
    }
    await queue;
    if (!sawRequest) {
      process.stderr.write("No Bridge worker request received on stdin\n");
      process.exitCode = 1;
    }
    process.exit(process.exitCode || 0);
  });
  process.stdin.on("error", (error) => {
    process.stderr.write(`Bridge worker stdin failed: ${error.message}\n`);
    process.exit(1);
  });
}

main();
