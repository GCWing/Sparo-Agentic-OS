const fs = require("node:fs");
const path = require("node:path");

function projectModuleSearchPaths(projectRoot, workspacePath) {
  return Array.from(new Set([
    projectRoot,
    workspacePath,
    process.cwd(),
  ].filter(Boolean).map((candidate) => path.resolve(candidate))));
}

function resolveProjectModule(request, projectRoot, workspacePath) {
  return require.resolve(request, {
    paths: projectModuleSearchPaths(projectRoot, workspacePath),
  });
}

function requireProjectModule(request, projectRoot, workspacePath) {
  return require(resolveProjectModule(request, projectRoot, workspacePath));
}

function resolvedPackageInfo(name, projectRoot, workspacePath) {
  try {
    const packagePath = resolveProjectModule(`${name}/package.json`, projectRoot, workspacePath);
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return null;
  }
}

function hasProjectModule(request, projectRoot, workspacePath) {
  try {
    resolveProjectModule(request, projectRoot, workspacePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  projectModuleSearchPaths,
  resolveProjectModule,
  requireProjectModule,
  resolvedPackageInfo,
  hasProjectModule,
};
