const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { detectToolchain } = require("./harmony-env");
const { runCommand } = require("./command");
const { diagnostic, redactValue } = require("./redact");
const { writeRuntimeState } = require("./runtime-state");
const { listTargets } = require("./device");

function boolString(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function rankEmulator(item = {}) {
  let rank = 0;
  const publicImage = boolString(item["os.isPublic"]);
  const api = String(item["os.apiVersion"] || "");
  const os = String(item["os.osVersion"] || "");
  const type = String(item.deviceType || "");
  if (publicImage) rank += 100;
  if (api.includes("24")) rank += 40;
  if (os.includes("6.1.1")) rank += 30;
  if (type === "phone") rank += 25;
  if (type === "foldable") rank += 8;
  if (type === "triplefold") rank += 4;
  if (boolString(item.isRunning)) rank += 10;
  if (!publicImage || /beta/i.test(os)) rank -= 80;
  return rank;
}

function normalizeEmulator(item = {}) {
  return {
    name: item.name,
    deviceType: item.deviceType || null,
    deviceModel: item.deviceModel || item.productModel || null,
    osVersion: item["os.osVersion"] || null,
    apiVersion: item["os.apiVersion"] || null,
    isPublic: boolString(item["os.isPublic"]),
    isRunning: boolString(item.isRunning),
    instancePath: item.instancePath || null,
    logPath: item.instancePath ? path.join(item.instancePath, "Log").replace(/\\/g, "/") : null,
    rank: rankEmulator(item),
  };
}

function selectedEmulator(emulators, name) {
  const list = Array.isArray(emulators) ? emulators : [];
  if (name) return list.find((item) => item.name === name) || { name };
  return list[0] || null;
}

function emulatorToStop(emulators, name, recommended) {
  const list = Array.isArray(emulators) ? emulators : [];
  if (name) return selectedEmulator(list, name);
  return list.find((item) => item.isRunning) || recommended || list[0] || null;
}

function emulatorTargets(targets) {
  return (Array.isArray(targets) ? targets : []).filter((target) => {
    const text = [target.id, target.serial, target.model, target.raw, target.kind].filter(Boolean).join(" ");
    return target.kind === "emulator" || /127\.0\.0\.1|localhost|:\d{4,5}|emulator|qemu|PHEMU|PCEMU/i.test(text);
  });
}

function readTail(filePath, maxBytes = 192 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size));
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function emulatorLogDiagnostics(emulator) {
  if (!emulator?.instancePath) return [];
  const logDir = path.join(emulator.instancePath, "Log");
  const files = [
    ["Emulator.log", /(critical|error|warning|fail|fatal|crash|exit|heartbeat|uuid|sn|cannot|can not|permission denied|OpenProcess)/i],
    ["qemu.log", /(critical|error|fail|fatal|crash|exit|heartbeat|permission denied|express_gpu|egl|opengl|watchdog)/i],
    ["crash_server.log", /(critical|error|warning|exit|heartbeat|crash|OpenProcess|failed)/i],
    ["kernel.log", /(panic|fatal|crash|error|failed|watchdog|express_gpu|shutdown|reboot|kill)/i],
  ];
  const diagnostics = [];
  for (const [fileName, pattern] of files) {
    const filePath = path.join(logDir, fileName);
    const tail = readTail(filePath);
    if (!tail) continue;
    const matches = tail
      .split(/\r?\n/)
      .filter((line) => pattern.test(line))
      .slice(-8);
    if (!matches.length) continue;
    diagnostics.push(diagnostic("warning", `Recent ${emulator.name} ${fileName}: ${matches.join(" | ")}`, {
      stage: "startEmulator",
      source: "emulatorLog",
      emulatorName: emulator.name,
      logFile: fileName,
    }));
  }
  return diagnostics;
}

function launchEmulator(emulatorPath, name, input, env) {
  const child = spawn(emulatorPath, ["-start", name], {
    cwd: input.workspacePath,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.on("error", () => {});
  child.unref();
  return {
    command: emulatorPath,
    args: ["-start", name],
    commandLine: `${emulatorPath} -start ${name}`,
    cwd: input.workspacePath || process.cwd(),
    pid: child.pid || null,
    detached: true,
  };
}

function listEmulators(input = {}) {
  const toolchainResult = detectToolchain(input);
  const emulatorPath = toolchainResult.toolchain.emulator.path;
  if (!emulatorPath) {
    return { ok: false, emulators: [], diagnostics: [diagnostic("warning", "Emulator.exe was not found", { stage: "listEmulators" })] };
  }
  const result = runCommand(emulatorPath, ["-list", "-details"], {
    cwd: input.workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: input.timeoutMs || 20000,
  });
  let raw = [];
  try {
    const start = result.stdout.indexOf("[");
    const jsonText = start >= 0 ? result.stdout.slice(start) : result.stdout;
    raw = JSON.parse(jsonText || "[]");
  } catch {
    raw = [];
  }
  const emulators = raw.map(normalizeEmulator).sort((left, right) => right.rank - left.rank);
  const recommendedEmulator = emulators[0] || null;
  const diagnostics = [];
  if (!emulators.length) diagnostics.push(diagnostic("info", "No DevEco emulator instances were listed", { stage: "listEmulators" }));
  if (result.stderr) diagnostics.push(diagnostic("info", result.stderr, { stage: "listEmulators" }));
  if (input.workspacePath) writeRuntimeState(input.workspacePath, { emulators, recommendedEmulator, diagnostics });
  return redactValue({ ok: emulators.length > 0, emulators, recommendedEmulator, diagnostics });
}

async function startEmulator(input = {}) {
  const toolchainResult = detectToolchain(input);
  const emulatorPath = toolchainResult.toolchain.emulator.path;
  if (!emulatorPath) {
    return { ok: false, diagnostics: [diagnostic("warning", "Emulator.exe was not found", { stage: "startEmulator" })] };
  }
  const listed = listEmulators(input);
  const emulator = selectedEmulator(listed.emulators, input.name || listed.recommendedEmulator?.name);
  if (!emulator?.name) {
    return { ok: false, diagnostics: [diagnostic("warning", "No emulator name was supplied", { stage: "startEmulator" })] };
  }
  const diagnostics = [...(listed.diagnostics || [])];
  if (!emulator.isPublic || /beta/i.test(String(emulator.osVersion || ""))) {
    diagnostics.push(diagnostic("warning", `Selected emulator "${emulator.name}" is beta or non-public; a public HarmonyOS 6.1.1(24) image is usually safer for install/start validation.`, {
      stage: "startEmulator",
      emulatorName: emulator.name,
    }));
  }
  let started;
  try {
    started = launchEmulator(emulatorPath, emulator.name, input, toolchainResult.toolchain.env);
  } catch (error) {
    diagnostics.push(diagnostic("warning", error instanceof Error ? error.message : String(error), {
      stage: "startEmulator",
      emulatorName: emulator.name,
    }));
  }
  const waitMs = Number(input.waitMs || 60000);
  const deadline = Date.now() + waitMs;
  let targets = [];
  let observedTargets = [];
  while (started && Date.now() < deadline) {
    const targetResult = listTargets(input);
    observedTargets = targetResult.observedTargets || targetResult.targets || [];
    targets = emulatorTargets(targetResult.targets || []);
    if (targets.length) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!targets.length) {
    diagnostics.push(diagnostic("warning", "No emulator HDC target appeared before the wait timeout", {
      stage: "startEmulator",
      emulatorName: emulator.name,
    }));
    diagnostics.push(...emulatorLogDiagnostics(emulator));
  }
  const runtimeState = input.workspacePath ? writeRuntimeState(input.workspacePath, {
    selectedEmulator: emulator,
    targets,
    observedTargets,
    diagnostics,
  }) : null;
  return redactValue({
    ok: targets.length > 0,
    emulator,
    start: started || null,
    targets,
    observedTargets,
    diagnostics,
    runtimeState,
  });
}

async function stopEmulator(input = {}) {
  const toolchainResult = detectToolchain(input);
  const emulatorPath = toolchainResult.toolchain.emulator.path;
  if (!emulatorPath) {
    return { ok: false, diagnostics: [diagnostic("warning", "Emulator.exe was not found", { stage: "stopEmulator" })] };
  }
  const listed = listEmulators(input);
  const emulator = emulatorToStop(listed.emulators, input.name, listed.recommendedEmulator);
  if (!emulator?.name) {
    return { ok: false, diagnostics: [diagnostic("warning", "No emulator name was supplied", { stage: "stopEmulator" })] };
  }

  const diagnostics = [...(listed.diagnostics || [])];
  let stop = null;
  let refreshed = listed;
  let refreshedEmulator = (listed.emulators || []).find((item) => item.name === emulator.name) || emulator;

  if (!refreshedEmulator.isRunning) {
    diagnostics.push(diagnostic("info", `Selected emulator "${emulator.name}" is already stopped`, {
      stage: "stopEmulator",
      emulatorName: emulator.name,
    }));
  } else {
    stop = runCommand(emulatorPath, ["-stop", emulator.name], {
      cwd: input.workspacePath,
      env: toolchainResult.toolchain.env,
      timeoutMs: input.timeoutMs || 30000,
    });
    if (stop.exitCode !== 0) {
      diagnostics.push(diagnostic("warning", stop.stderr || stop.stdout || "Emulator stop command failed", {
        stage: "stopEmulator",
        emulatorName: emulator.name,
      }));
    }

    const waitMs = Number(input.waitMs || 30000);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      refreshed = listEmulators(input);
      refreshedEmulator = (refreshed.emulators || []).find((item) => item.name === emulator.name) || refreshedEmulator;
      if (!refreshedEmulator?.isRunning) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (refreshedEmulator?.isRunning) {
      diagnostics.push(diagnostic("warning", `Stop command completed, but emulator "${emulator.name}" is still reported as running`, {
        stage: "stopEmulator",
        emulatorName: emulator.name,
      }));
    }
  }

  const targetResult = listTargets(input);
  const targets = emulatorTargets(targetResult.targets || []);
  const observedTargets = targetResult.observedTargets || targetResult.targets || [];
  diagnostics.push(...(refreshed.diagnostics || []), ...(targetResult.diagnostics || []));
  const runtimeState = input.workspacePath ? writeRuntimeState(input.workspacePath, {
    selectedEmulator: refreshedEmulator,
    emulators: refreshed.emulators || [],
    recommendedEmulator: refreshed.recommendedEmulator || null,
    targets,
    observedTargets,
    diagnostics,
  }) : null;
  return redactValue({
    ok: Boolean(refreshedEmulator && !refreshedEmulator.isRunning),
    emulator: refreshedEmulator,
    stop,
    emulators: refreshed.emulators || [],
    recommendedEmulator: refreshed.recommendedEmulator || null,
    targets,
    observedTargets,
    diagnostics,
    runtimeState,
  });
}

module.exports = {
  listEmulators,
  startEmulator,
  stopEmulator,
};
