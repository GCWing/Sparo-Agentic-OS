const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const appDir = __dirname;
let activeRequest = null;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
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

function getApiKey(input) {
  return String(input.apiKey || process.env.CURSOR_API_KEY || "").trim();
}

function workspacePathOf(request) {
  return request.workspacePath || request.workspace_path || process.cwd();
}

function runIdOf(request) {
  return request.runId || request.run_id || `${request.bridgeId || request.bridge_id || "cursor-sdk"}-${Date.now()}`;
}

function sdkInstalled() {
  try {
    require.resolve("@cursor/sdk/package.json", { paths: [appDir] });
    return true;
  } catch {
    return false;
  }
}

function installSdkIfNeeded(input) {
  if (sdkInstalled()) {
    return { installed: true, installedNow: false };
  }
  if (input.autoInstallDependencies === false) {
    return {
      installed: false,
      installedNow: false,
      message: "Install dependencies in this Bridge Component directory before running Cursor SDK actions.",
    };
  }

  emit({ type: "text.delta", text: "Installing Cursor SDK dependencies...\n" });
  const result = spawnSync("npm", ["install", "--silent", "--no-audit", "--no-fund"], {
    cwd: appDir,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return {
      installed: false,
      installedNow: false,
      message: (result.stderr || result.stdout || "npm install failed").trim(),
    };
  }
  return { installed: sdkInstalled(), installedNow: true };
}

async function loadSdk(input) {
  const dependency = installSdkIfNeeded(input);
  if (!dependency.installed) {
    throw new Error(dependency.message || "Cursor SDK dependency is not installed.");
  }
  return import("@cursor/sdk");
}

function runGit(cwd, args) {
  if (!cwd) return undefined;
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
}

function normalizeGitHubRemote(remote) {
  if (!remote) return undefined;
  const trimmed = remote.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^git@github\.com:(.+\/.+)$/);
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+\/.+)$/);
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+\/.+)$/);
  const repoPath = sshMatch?.[1] || sshUrlMatch?.[1] || httpsMatch?.[1];
  return repoPath ? `https://github.com/${repoPath}` : undefined;
}

function detectCloudRepository(workspacePath, input) {
  const explicit = normalizeGitHubRemote(input.repositoryUrl);
  const remote = explicit || normalizeGitHubRemote(runGit(workspacePath, ["config", "--get", "remote.origin.url"]));
  if (!remote) {
    throw new Error("Cloud mode requires repositoryUrl or a GitHub remote.origin.url in the workspace.");
  }
  const branch = input.startingRef || runGit(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? { url: remote, startingRef: branch } : { url: remote };
}

function modelSelection(input) {
  return { id: String(input.model || process.env.CURSOR_MODEL || "composer-2").trim() };
}

function summarizeEvent(event) {
  switch (event?.type) {
    case "assistant":
      for (const block of event.message?.content || []) {
        if (block.type === "text") {
          emit({ type: "text.delta", text: block.text });
        } else if (block.name) {
          emit({ type: "tool.started", name: block.name, input: block.input || {} });
        }
      }
      break;
    case "thinking":
      emit({ type: "thinking.delta", text: event.text || "" });
      break;
    case "tool_call":
      emit({
        type: event.status && String(event.status).toLowerCase().includes("complete")
          ? "tool.completed"
          : "tool.started",
        name: event.name || "tool",
        input: event.args || {},
        output: event.result || {},
      });
      break;
    case "status":
      emit({ type: "text.delta", text: `\n[${event.status}] ${event.message || ""}\n` });
      break;
    case "task":
      emit({ type: "text.delta", text: `\n${event.status || "task"} ${event.text || ""}\n` });
      break;
    default:
      break;
  }
}

function normalizeResult(result, agent, extra = {}) {
  const git = result?.git || result?._git;
  const branch = Array.isArray(git?.branches) ? git.branches[0] : undefined;
  return {
    status: result?.status || "completed",
    runId: result?.id || result?.runId,
    agentId: agent?.id || result?.agentId,
    durationMs: result?.durationMs || result?._durationMs,
    prUrl: branch?.prUrl || branch?.pullRequestUrl,
    branch: branch?.branch || branch?.name,
    repositoryUrl: branch?.repoUrl || branch?.repositoryUrl,
    ...extra,
  };
}

async function runAgent({ cloud }) {
  const request = activeRequest;
  const input = request.input || {};
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw new Error("prompt is required.");
  }
  if (input.dryRun === true) {
    emit({ type: "text.delta", text: `Dry run Cursor ${cloud ? "cloud" : "local"} capability\n` });
    return {
      status: "completed",
      runId: request.runId,
      mode: cloud ? "cloud" : "local",
      dryRun: true,
      prompt,
      workspacePath: workspacePathOf(request),
    };
  }

  const apiKey = getApiKey(input);
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required. Add it to the environment or pass apiKey in the action input.");
  }

  const { Agent } = await loadSdk(input);
  const workspacePath = workspacePathOf(request);
  const options = {
    apiKey,
    name: String(input.agentName || (cloud ? "Sparo Cursor Cloud Bridge" : "Sparo Cursor Local Bridge")),
    model: modelSelection(input),
  };

  const agent = await Agent.create(
    cloud
      ? {
          ...options,
          cloud: {
            repos: [detectCloudRepository(workspacePath, input)],
            autoCreatePR: input.autoCreatePR !== false,
          },
        }
      : {
          ...options,
          local: { cwd: workspacePath },
        },
  );

  const run = await agent.send(prompt, cloud ? undefined : { local: { force: input.force === true } });
  emit({ type: "text.delta", text: `Started Cursor ${cloud ? "cloud" : "local"} run ${run.id || ""}\n` });
  for await (const event of run.stream()) {
    summarizeEvent(event);
  }
  const result = await run.wait();
  await agent[Symbol.asyncDispose]?.().catch(() => undefined);
  return normalizeResult(result, agent, { mode: cloud ? "cloud" : "local" });
}

async function health() {
  const request = activeRequest;
  const input = request.input || {};
  const dependency = input.autoInstallDependencies === true
    ? installSdkIfNeeded(input)
    : { installed: sdkInstalled(), installedNow: false };
  const apiKey = getApiKey(input);
  const workspacePath = workspacePathOf(request);
  const gitRemote = normalizeGitHubRemote(runGit(workspacePath, ["config", "--get", "remote.origin.url"]));
  const output = {
    node: process.version,
    appDir,
    workspacePath,
    sdkInstalled: dependency.installed,
    sdkInstalledNow: dependency.installedNow,
    hasApiKey: Boolean(apiKey),
    gitRemote,
    ready: dependency.installed && Boolean(apiKey),
  };

  if (apiKey && input.validateApiKey) {
    try {
      const { Cursor } = await loadSdk(input);
      const me = await Cursor.me({ apiKey });
      output.cursorUser = {
        name: me?.name || me?.displayName || me?.username,
        email: me?.email,
      };
      output.ready = true;
    } catch (error) {
      output.ready = false;
      output.apiKeyError = error instanceof Error ? error.message : String(error);
    }
  }
  return output;
}

async function setup() {
  const input = activeRequest.input || {};
  const dependency = installSdkIfNeeded({ ...input, autoInstallDependencies: true });
  return {
    sdkInstalled: dependency.installed,
    sdkInstalledNow: dependency.installedNow,
    ready: dependency.installed,
  };
}

function storedRunResponse(action) {
  const input = activeRequest.input || {};
  const runId = input.runId || input.run_id || runIdOf(activeRequest);
  return {
    runId,
    status: action === "cancel" ? "cancelled" : "notTracked",
    message: "Cursor SDK run persistence is managed by the Bridge Runtime. This sample worker exposes the lifecycle action contract.",
  };
}

async function main() {
  activeRequest = await readRequest();
  const runId = runIdOf(activeRequest);
  emit({ type: "run.started", run_id: runId });
  let output;
  switch (activeRequest.action) {
    case "health":
      output = await health();
      break;
    case "setup":
      output = await setup();
      break;
    case "start":
      output = await runAgent({ cloud: (activeRequest.input || {}).mode === "cloud" });
      break;
    case "status":
    case "resume":
    case "cancel":
    case "artifacts":
      output = storedRunResponse(activeRequest.action);
      break;
    default:
      throw new Error(`Unsupported Cursor SDK action: ${activeRequest.action}`);
  }
  emit({ type: "run.completed", output });
}

main().catch((error) => {
  emit({
    type: "run.failed",
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
  process.exitCode = 1;
});
