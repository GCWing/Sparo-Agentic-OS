const fs = require("node:fs");
const path = require("node:path");
const { runCommand, fileExists } = require("./command");

const DEFAULT_DEVECO_ROOTS = [
  "D:\\software\\DevEco Studio",
  "C:\\Program Files\\Huawei\\DevEco Studio",
  "C:\\Program Files\\DevEco Studio",
];

function firstExisting(candidates) {
  return candidates.find(fileExists) || null;
}

function pathExists(candidate) {
  try {
    return Boolean(candidate && fs.existsSync(candidate));
  } catch {
    return false;
  }
}

function firstExistingPath(candidates) {
  return candidates.find(pathExists) || null;
}

function resolveOnPath(name) {
  const result = runCommand(process.platform === "win32" ? "where.exe" : "which", [name], { timeoutMs: 6000 });
  if (result.exitCode !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function detectToolchain(input = {}) {
  const workspacePath = input.workspacePath;
  const roots = [
    input.devEcoRoot,
    process.env.DEVECO_STUDIO_HOME,
    ...DEFAULT_DEVECO_ROOTS,
  ].filter(Boolean);
  const sdkRoot = input.devEcoSdkHome || process.env.DEVECO_SDK_HOME || firstExistingPath(roots.map((root) => path.join(root, "sdk")));
  const devEcoRoot = roots.find((root) => fs.existsSync(root)) || (sdkRoot ? path.dirname(sdkRoot) : null);
  const hvigorw = firstExisting([
    input.hvigorwPath,
    process.env.HVIGORW,
    ...roots.map((root) => path.join(root, "tools", "hvigor", "bin", process.platform === "win32" ? "hvigorw.bat" : "hvigorw")),
    workspacePath ? path.join(workspacePath, "hvigorw.bat") : null,
    workspacePath ? path.join(workspacePath, "hvigorw") : null,
    resolveOnPath("hvigorw"),
  ].filter(Boolean));
  const hdc = firstExisting([
    input.hdcPath,
    process.env.HDC_PATH,
    sdkRoot ? path.join(sdkRoot, "default", "openharmony", "toolchains", process.platform === "win32" ? "hdc.exe" : "hdc") : null,
    sdkRoot ? path.join(sdkRoot, "openharmony", "toolchains", process.platform === "win32" ? "hdc.exe" : "hdc") : null,
    resolveOnPath("hdc"),
  ].filter(Boolean));
  const emulator = firstExisting([
    input.emulatorPath,
    ...roots.map((root) => path.join(root, "tools", "emulator", process.platform === "win32" ? "Emulator.exe" : "Emulator")),
    resolveOnPath(process.platform === "win32" ? "Emulator.exe" : "Emulator"),
  ].filter(Boolean));
  const ohpm = firstExisting([
    input.ohpmPath,
    ...roots.map((root) => path.join(root, "tools", "ohpm", "bin", process.platform === "win32" ? "ohpm.bat" : "ohpm")),
    resolveOnPath("ohpm"),
  ].filter(Boolean));
  const java = firstExisting([
    input.javaPath,
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : null,
    ...roots.map((root) => path.join(root, "jbr", "bin", process.platform === "win32" ? "java.exe" : "java")),
    resolveOnPath("java"),
  ].filter(Boolean));

  const env = {
    ...process.env,
    ...(sdkRoot ? { DEVECO_SDK_HOME: sdkRoot } : {}),
    ...(java ? { JAVA_HOME: path.dirname(path.dirname(java)) } : {}),
  };
  const toolchain = {
    devEcoRoot,
    sdkRoot,
    hvigorw: { path: hvigorw, available: Boolean(hvigorw) },
    hdc: { path: hdc, available: Boolean(hdc) },
    emulator: { path: emulator, available: Boolean(emulator) },
    ohpm: { path: ohpm, available: Boolean(ohpm) },
    java: { path: java, available: Boolean(java) },
  };
  Object.defineProperty(toolchain, "env", {
    value: env,
    enumerable: false,
  });
  const diagnostics = [];
  for (const [name, item] of Object.entries(toolchain)) {
    if (item && typeof item === "object" && "available" in item && !item.available) {
      diagnostics.push({ severity: "warning", message: `${name} was not found`, stage: "toolchain" });
    }
  }
  if (hvigorw) {
    const version = runCommand(hvigorw, ["--version"], { cwd: workspacePath, env, timeoutMs: 15000 });
    toolchain.hvigorw.version = (version.stdout || version.stderr).trim().split(/\r?\n/)[0] || null;
  }
  if (ohpm) {
    const version = runCommand(ohpm, ["--version"], { cwd: workspacePath, env, timeoutMs: 15000 });
    toolchain.ohpm.version = (version.stdout || version.stderr).trim().split(/\r?\n/)[0] || null;
  }
  return {
    ok: diagnostics.length === 0,
    toolchain,
    diagnostics,
  };
}

module.exports = {
  detectToolchain,
};
