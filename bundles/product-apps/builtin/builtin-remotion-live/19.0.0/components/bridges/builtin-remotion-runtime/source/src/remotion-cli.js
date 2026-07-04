const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { packageManager, packageInfo, dependencyVersion } = require("./util");
const { REMOTION_RENDER_TIMEOUT_MS } = require("./constants");

function remotionCommand(workspacePath) {
  const localCli = path.join(workspacePath, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (fs.existsSync(localCli)) {
    return {
      command: process.execPath,
      argsPrefix: [localCli],
      source: "local-cli-js",
      shell: false,
    };
  }

  const localName = process.platform === "win32" ? "remotion.cmd" : "remotion";
  const localBinary = path.join(workspacePath, "node_modules", ".bin", localName);
  if (fs.existsSync(localBinary)) {
    return {
      command: localBinary,
      argsPrefix: [],
      source: "local-bin",
      shell: process.platform === "win32",
    };
  }

  const manager = packageManager(workspacePath);
  if (manager === "pnpm") return { command: "pnpm", argsPrefix: ["exec", "remotion"], source: "pnpm" };
  if (manager === "yarn") return { command: "yarn", argsPrefix: ["remotion"], source: "yarn" };
  if (manager === "bun") return { command: "bunx", argsPrefix: ["remotion"], source: "bunx" };
  return { command: "npx", argsPrefix: ["remotion"], source: "npx" };
}

function detectRemotionRenderer(workspacePath) {
  const pkg = packageInfo(workspacePath);
  const command = remotionCommand(workspacePath);
  return {
    kind: "remotion-cli",
    available: Boolean(dependencyVersion(pkg, "remotion") || dependencyVersion(pkg, "@remotion/cli")),
    version: dependencyVersion(pkg, "remotion") || dependencyVersion(pkg, "@remotion/cli") || null,
    command: command.source,
  };
}

function remotionFailureMessage(command, args, result) {
  if (result.error) {
    return `Remotion command failed to start (${command.source}): ${result.error.message}`;
  }
  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  const tail = [stderr, stdout].filter(Boolean).join("\n").slice(-2200);
  return `Remotion command failed (${[command.command, ...command.argsPrefix, ...args].join(" ")}): ${tail || `exit ${result.status}`}`;
}

function runRemotion(workspacePath, args, options = {}) {
  const command = remotionCommand(workspacePath);
  const result = spawnSync(command.command, [...command.argsPrefix, ...args], {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: options.timeoutMs || REMOTION_RENDER_TIMEOUT_MS,
    windowsHide: true,
    shell: Boolean(command.shell),
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });

  if (result.error || result.status !== 0) {
    throw new Error(remotionFailureMessage(command, args, result));
  }

  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    command: command.source,
  };
}

module.exports = {
  remotionCommand,
  detectRemotionRenderer,
  remotionFailureMessage,
  runRemotion,
};
