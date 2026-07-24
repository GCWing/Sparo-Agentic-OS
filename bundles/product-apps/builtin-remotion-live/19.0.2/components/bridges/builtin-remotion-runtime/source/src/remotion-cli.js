const fs = require("node:fs");
const path = require("node:path");
const { packageManager, packageInfo, dependencyVersion } = require("./util");
const { resolveProjectModule, resolvedPackageInfo } = require("./project-deps");

function remotionCommand(workspacePath, projectRoot = workspacePath) {
  let localCli = null;
  try {
    localCli = resolveProjectModule("@remotion/cli/remotion-cli.js", projectRoot, workspacePath);
  } catch {
    const packageInfo = resolvedPackageInfo("@remotion/cli", projectRoot, workspacePath);
    if (packageInfo) {
      try {
        const packagePath = resolveProjectModule("@remotion/cli/package.json", projectRoot, workspacePath);
        const candidate = path.join(path.dirname(packagePath), "remotion-cli.js");
        if (fs.existsSync(candidate)) localCli = candidate;
      } catch {
        localCli = null;
      }
    }
  }
  if (localCli && fs.existsSync(localCli)) {
    return {
      command: process.execPath,
      argsPrefix: [localCli],
      source: "local-cli-js",
      shell: false,
    };
  }

  const localName = process.platform === "win32" ? "remotion.cmd" : "remotion";
  const localBinary = path.join(projectRoot, "node_modules", ".bin", localName);
  if (fs.existsSync(localBinary)) {
    return {
      command: localBinary,
      argsPrefix: [],
      source: "local-bin",
      shell: process.platform === "win32",
    };
  }

  const manager = packageManager(projectRoot, workspacePath);
  if (manager === "pnpm") return { command: "pnpm", argsPrefix: ["exec", "remotion"], source: "pnpm" };
  if (manager === "yarn") return { command: "yarn", argsPrefix: ["remotion"], source: "yarn" };
  if (manager === "bun") return { command: "bunx", argsPrefix: ["remotion"], source: "bunx" };
  return { command: "npx", argsPrefix: ["remotion"], source: "npx" };
}

function detectRemotionRenderer(projectRoot, workspacePath = projectRoot) {
  const pkg = packageInfo(projectRoot);
  const command = remotionCommand(workspacePath, projectRoot);
  const rendererPackage = resolvedPackageInfo("@remotion/renderer", projectRoot, workspacePath);
  const remotionPackage = resolvedPackageInfo("remotion", projectRoot, workspacePath);
  return {
    kind: "remotion-renderer",
    available: Boolean(rendererPackage),
    version: rendererPackage?.version || remotionPackage?.version || dependencyVersion(pkg, "remotion") || null,
    command: command.source,
  };
}

module.exports = {
  remotionCommand,
  detectRemotionRenderer,
};
