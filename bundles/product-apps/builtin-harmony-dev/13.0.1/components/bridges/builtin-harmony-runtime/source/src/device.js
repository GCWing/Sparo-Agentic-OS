const fs = require("node:fs");
const path = require("node:path");
const { detectToolchain } = require("./harmony-env");
const { runCommand } = require("./command");
const { diagnostic, redactValue } = require("./redact");
const { hierarchyDir, screenshotsDir, safeFilePart } = require("./paths");
const { readRuntimeState, writeRuntimeState } = require("./runtime-state");
const { projectIdentity } = require("./project");

function withTargetArgs(targetId, args) {
  return targetId ? ["-t", targetId, ...args] : args;
}

function boolString(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function parseEmulatorDetails(output) {
  try {
    const text = String(output || "");
    const start = text.indexOf("[");
    const jsonText = start >= 0 ? text.slice(start) : text;
    const items = JSON.parse(jsonText || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function resolveCaptureEmulator(input, emulatorPath, env, diagnostics) {
  const requested = input.emulatorName || input.name;
  if (requested) return requested;

  const runtimeState = input.workspacePath ? readRuntimeState(input.workspacePath) : {};
  const selected = runtimeState.selectedEmulator;
  if (selected?.name && selected.isRunning) return selected.name;

  if (!emulatorPath) return null;
  const result = runCommand(emulatorPath, ["-list", "-details"], {
    cwd: input.workspacePath,
    env,
    timeoutMs: 20000,
  });
  if (result.exitCode !== 0) {
    diagnostics.push(diagnostic("info", result.stderr || result.stdout || "Could not list running emulators for screenshot capture", {
      stage: "captureScreen",
      source: "emulator",
    }));
    return null;
  }
  const running = parseEmulatorDetails(result.stdout).find((item) => boolString(item.isRunning));
  return running?.name || null;
}

function parseTargets(output) {
  const text = String(output || "").trim();
  if (!text || text.includes("[Empty]")) return [];
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      const raw = line;
      const id = parts[0];
      const uart = /^COM\d+$/i.test(id) || /\bUART\b/i.test(raw);
      return {
        id,
        serial: id,
        state: /offline/i.test(line) ? "offline" : "online",
        model: parts.slice(1).join(" ") || null,
        raw,
        kind: uart ? "uart" : (/127\.0\.0\.1|localhost|:\d{4,5}|emulator|qemu|PHEMU|PCEMU/i.test(raw) ? "emulator" : "device"),
        usable: !uart,
      };
    });
}

function listTargets(input = {}) {
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  if (!hdc) {
    return { ok: false, targets: [], diagnostics: [diagnostic("warning", "hdc was not found", { stage: "listTargets" })] };
  }
  const result = runCommand(hdc, ["list", "targets", "-v"], {
    cwd: input.workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: input.timeoutMs || 15000,
  });
  const observedTargets = parseTargets(result.stdout || result.stderr);
  const targets = observedTargets.filter((target) => target.usable && target.state === "online");
  const diagnostics = targets.length
    ? []
    : [diagnostic("info", observedTargets.length
      ? "Only UART or non-deployable HDC endpoints were detected"
      : "No HDC target is online", { stage: "listTargets" })];
  const runtimeState = input.workspacePath ? writeRuntimeState(input.workspacePath, {
    targets,
    observedTargets,
    capabilities: {
      ...readRuntimeState(input.workspacePath).capabilities,
      hdcTarget: targets.length > 0,
    },
    diagnostics,
  }) : null;
  return redactValue({ ok: targets.length > 0, targets, observedTargets, diagnostics, runtimeState });
}

function latestArtifact(workspacePath) {
  const state = readRuntimeState(workspacePath);
  if (state.latestArtifact?.path && fs.existsSync(state.latestArtifact.path)) return state.latestArtifact;
  const matches = [];
  const stack = [workspacePath];
  const ignored = new Set([".git", "oh_modules", "node_modules", ".sparo_os"]);
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile() && /\.(app|hap)$/i.test(entry.name)) {
        const stat = fs.statSync(absolute);
        matches.push({ path: absolute, size: stat.size, createdAt: stat.mtimeMs, kind: path.extname(entry.name).slice(1).toLowerCase() });
      }
    }
  }
  return matches.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

function installApp(input = {}) {
  const workspacePath = input.workspacePath;
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  const targets = listTargets(input).targets;
  const target = input.targetId || targets[0]?.id;
  const artifact = input.artifactPath ? { path: input.artifactPath } : latestArtifact(workspacePath);
  const diagnostics = [];
  if (!hdc) diagnostics.push(diagnostic("warning", "hdc was not found", { stage: "installApp" }));
  if (!target) diagnostics.push(diagnostic("warning", "Install needs an online HDC target", { stage: "installApp" }));
  if (!artifact?.path || !fs.existsSync(artifact.path)) diagnostics.push(diagnostic("warning", "No app or HAP artifact was found", { stage: "installApp" }));
  if (diagnostics.length) return { ok: false, diagnostics, targets, artifact };
  const run = runCommand(hdc, withTargetArgs(target, ["install", "-r", artifact.path]), {
    cwd: workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: input.timeoutMs || 120000,
  });
  const ok = run.exitCode === 0;
  if (!ok) diagnostics.push(diagnostic("error", run.stderr || run.stdout || "hdc install failed", { stage: "installApp" }));
  const installState = {
    status: ok ? "completed" : "failed",
    targetId: target,
    artifact,
    updatedAt: Date.now(),
    diagnostics,
  };
  const runtimeState = writeRuntimeState(workspacePath, { install: installState, latestArtifact: artifact, diagnostics });
  return redactValue({ ok, install: installState, diagnostics, runtimeState });
}

function launchAbility(input = {}) {
  const workspacePath = input.workspacePath;
  const project = projectIdentity(workspacePath);
  const module = (project.modules || [])[0] || {};
  const ability = input.abilityName || module.mainElement || module.abilities?.[0]?.name;
  const bundleName = input.bundleName || project.bundleName || project.app?.bundleName;
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  const targets = listTargets(input).targets;
  const target = input.targetId || targets[0]?.id;
  const diagnostics = [];
  if (!hdc) diagnostics.push(diagnostic("warning", "hdc was not found", { stage: "launchAbility" }));
  if (!target) diagnostics.push(diagnostic("warning", "Launch needs an online HDC target", { stage: "launchAbility" }));
  if (!bundleName || !ability) diagnostics.push(diagnostic("warning", "Bundle name or ability name was not detected", { stage: "launchAbility" }));
  if (diagnostics.length) return { ok: false, diagnostics, targets, project };
  const launch = runCommand(hdc, withTargetArgs(target, ["shell", "aa", "start", "-a", ability, "-b", bundleName]), {
    cwd: workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: input.timeoutMs || 90000,
  });
  const dump = runCommand(hdc, withTargetArgs(target, ["shell", "bm", "dump", "-n", bundleName]), {
    cwd: workspacePath,
    env: toolchainResult.toolchain.env,
    timeoutMs: 30000,
  });
  const ok = launch.exitCode === 0;
  const capabilities = {
    ...readRuntimeState(workspacePath).capabilities,
    abilityLaunch: ok ? "available" : "unavailable",
    bundleDump: dump.exitCode === 0 ? "available" : "unavailable",
  };
  if (!ok) diagnostics.push(diagnostic("error", launch.stderr || launch.stdout || "aa start failed", { stage: "launchAbility" }));
  const runtime = {
    status: ok ? "running" : "failed",
    targetId: target,
    bundleName,
    abilityName: ability,
    bundleDumpAvailable: dump.exitCode === 0,
    updatedAt: Date.now(),
    diagnostics,
  };
  const runtimeState = writeRuntimeState(workspacePath, { runtime, capabilities, diagnostics });
  return redactValue({ ok, runtime, launch, bundleDump: dump.exitCode === 0 ? dump.stdout : null, diagnostics, runtimeState });
}

function readImageFile(filePath) {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const dimensions = imageDimensions(data, ext);
  return {
    dataUrl: `data:${mime};base64,${data.toString("base64")}`,
    size: data.length,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function imageDimensions(data, ext) {
  if (ext === "png" && data.length >= 24 && data.toString("ascii", 1, 4) === "PNG") {
    return {
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }
  if ((ext === "jpg" || ext === "jpeg") && data.length > 4) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) break;
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          width: data.readUInt16BE(offset + 7),
          height: data.readUInt16BE(offset + 5),
        };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForStableFile(filePath, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const intervalMs = options.intervalMs || 160;
  const minBytes = options.minBytes || 32;
  const stableReads = options.stableReads || 2;
  const deadline = Date.now() + timeoutMs;
  let previousSize = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size >= minBytes && stat.size === previousSize) {
        stableCount += 1;
        if (stableCount >= stableReads) return { path: filePath, size: stat.size, stable: true };
      } else {
        stableCount = 0;
        previousSize = stat.size;
      }
    }
    sleepSync(intervalMs);
  }

  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { path: filePath, size: stat.size, stable: false };
}

function listScreenshotFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((file) => /\.(png|jpe?g)$/i.test(file))
      .map((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        return { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size };
      });
  } catch {
    return [];
  }
}

function findCreatedScreenshot(dir, before, startedAt) {
  const previous = new Map(before.map((item) => [item.path, `${item.mtimeMs}:${item.size}`]));
  return listScreenshotFiles(dir)
    .filter((item) => previous.get(item.path) !== `${item.mtimeMs}:${item.size}` || item.mtimeMs >= startedAt - 1000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] || null;
}

function assertWorkspaceScreenshot(workspacePath, filePath) {
  const base = path.resolve(screenshotsDir(workspacePath));
  const resolved = path.resolve(filePath || "");
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Screenshot path is outside the HarmonyOS Dev screenshot directory.");
  }
  return resolved;
}

function readScreenshot(input = {}) {
  const workspacePath = input.workspacePath;
  const diagnostics = [];
  const requestedPath = assertWorkspaceScreenshot(workspacePath, input.path || input.screen?.path);
  const stable = waitForStableFile(requestedPath, { timeoutMs: input.timeoutMs || 12000 });
  if (!stable?.path || !stable.stable || stable.size <= 0) {
    diagnostics.push(diagnostic("warning", "Screenshot file is not ready", {
      stage: "readScreenshot",
      path: requestedPath,
    }));
    return { ok: false, diagnostics };
  }
  const image = readImageFile(requestedPath);
  const screen = {
    ...(input.screen || {}),
    id: input.screen?.id || `screen-${Date.now()}`,
    path: requestedPath,
    uri: requestedPath,
    dataUrl: image.dataUrl,
    width: image.width || input.screen?.width || null,
    height: image.height || input.screen?.height || null,
    source: input.screen?.source || "cached-file",
    sourceName: input.screen?.sourceName || null,
    timestamp: input.screen?.timestamp || Date.now(),
    size: image.size,
  };
  return redactValue({ ok: true, screen, diagnostics });
}

function captureScreen(input = {}) {
  const workspacePath = input.workspacePath;
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  const emulator = toolchainResult.toolchain.emulator.path;
  const id = `screen-${Date.now()}`;
  const captureDir = screenshotsDir(workspacePath);
  let outPath = path.join(captureDir, `${safeFilePart(id)}.png`);
  const diagnostics = [];
  let result = null;
  let source = "unavailable";
  let sourceName = null;
  const emulatorName = resolveCaptureEmulator(input, emulator, toolchainResult.toolchain.env, diagnostics);
  if (emulatorName && emulator) {
    const before = listScreenshotFiles(captureDir);
    const startedAt = Date.now();
    result = runCommand(emulator, ["-instance", emulatorName, "-screenshot", "-screenshotPath", captureDir], {
      cwd: workspacePath,
      env: toolchainResult.toolchain.env,
      timeoutMs: input.timeoutMs || 60000,
    });
    const captured = findCreatedScreenshot(captureDir, before, startedAt);
    const stable = captured?.path ? waitForStableFile(captured.path, { timeoutMs: 15000 }) : null;
    if (result.exitCode === 0 && stable?.path && stable.stable && stable.size > 0) {
      outPath = stable.path;
      source = "emulator";
      sourceName = emulatorName;
    } else {
      diagnostics.push(diagnostic("warning", result.stderr || result.stdout || "Emulator screenshot command did not produce a file", {
        stage: "captureScreen",
        source: "emulator",
        emulatorName,
      }));
    }
  }
  if (source === "unavailable" && hdc) {
    const targetResult = listTargets(input);
    diagnostics.push(...(targetResult.diagnostics || []));
    const targets = targetResult.targets;
    const target = input.targetId || targets[0]?.id;
    if (target) {
      const remote = `/data/local/tmp/${id}.png`;
      const snap = runCommand(hdc, withTargetArgs(target, ["shell", "snapshot_display", "-f", remote]), {
        cwd: workspacePath,
        env: toolchainResult.toolchain.env,
        timeoutMs: 45000,
      });
      const recv = snap.exitCode === 0
        ? runCommand(hdc, withTargetArgs(target, ["file", "recv", remote, outPath]), {
          cwd: workspacePath,
          env: toolchainResult.toolchain.env,
          timeoutMs: 45000,
        })
        : snap;
      result = recv;
      const stable = recv.exitCode === 0 ? waitForStableFile(outPath, { timeoutMs: 8000 }) : null;
      if (recv.exitCode === 0 && stable?.path && stable.stable && stable.size > 0) {
        source = "target-shell";
        sourceName = target;
      } else {
        diagnostics.push(diagnostic("warning", recv.stderr || recv.stdout || "Target screenshot command did not produce a file", {
          stage: "captureScreen",
          source: "target-shell",
          targetId: target,
        }));
      }
    }
  }
  if (source === "unavailable" && !result) {
    diagnostics.push(diagnostic("warning", "Screenshot needs a running emulator or an online HDC target", { stage: "captureScreen" }));
  }
  const image = source === "unavailable" ? null : readImageFile(outPath);
  const screen = source === "unavailable" ? null : {
    id,
    path: outPath,
    uri: outPath,
    dataUrl: image.dataUrl,
    width: input.width || image.width || null,
    height: input.height || image.height || null,
    source,
    sourceName,
    timestamp: Date.now(),
    size: image.size,
  };
  const capabilities = {
    ...readRuntimeState(workspacePath).capabilities,
    screenshot: source,
  };
  const runtimeState = writeRuntimeState(workspacePath, { screen, capabilities, diagnostics });
  return redactValue({ ok: Boolean(screen), screen, diagnostics, runtimeState });
}

function dumpHierarchy(input = {}) {
  const workspacePath = input.workspacePath;
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  const targets = listTargets(input).targets;
  const target = input.targetId || targets[0]?.id;
  const id = `hierarchy-${Date.now()}`;
  const outPath = path.join(hierarchyDir(workspacePath), `${safeFilePart(id)}.json`);
  const diagnostics = [];
  let hierarchy = null;
  if (hdc && target) {
    const remote = `/data/local/tmp/${id}.json`;
    const dump = runCommand(hdc, withTargetArgs(target, ["shell", "uitest", "dumpLayout", remote]), {
      cwd: workspacePath,
      env: toolchainResult.toolchain.env,
      timeoutMs: 45000,
    });
    const recv = dump.exitCode === 0
      ? runCommand(hdc, withTargetArgs(target, ["file", "recv", remote, outPath]), {
        cwd: workspacePath,
        env: toolchainResult.toolchain.env,
        timeoutMs: 45000,
      })
      : dump;
    if (recv.exitCode === 0 && fs.existsSync(outPath)) {
      try {
        hierarchy = JSON.parse(fs.readFileSync(outPath, "utf8"));
      } catch {
        hierarchy = { nodes: [], parseError: true };
      }
    } else {
      diagnostics.push(diagnostic("warning", recv.stderr || recv.stdout || "UI hierarchy dump probe is unavailable", { stage: "dumpHierarchy" }));
    }
  } else {
    diagnostics.push(diagnostic("warning", "UI hierarchy needs an online HDC target", { stage: "dumpHierarchy" }));
  }
  const hierarchyState = hierarchy ? {
    id,
    path: outPath,
    timestamp: Date.now(),
    root: hierarchy.root || hierarchy,
    nodes: hierarchy.nodes || hierarchy.children || [],
  } : null;
  const capabilities = {
    ...readRuntimeState(workspacePath).capabilities,
    hierarchyDump: hierarchyState ? "available" : "unavailable",
  };
  const runtimeState = writeRuntimeState(workspacePath, { hierarchy: hierarchyState, capabilities, diagnostics });
  return redactValue({ ok: Boolean(hierarchyState), hierarchy: hierarchyState, diagnostics, runtimeState });
}

function readLogs(input = {}) {
  const workspacePath = input.workspacePath;
  const toolchainResult = detectToolchain(input);
  const hdc = toolchainResult.toolchain.hdc.path;
  const targets = listTargets(input).targets;
  const target = input.targetId || targets[0]?.id;
  const diagnostics = [];
  let logs = "";
  if (hdc && target) {
    const result = runCommand(hdc, withTargetArgs(target, ["shell", "hilog", "-r", "-n", String(input.lines || 200)]), {
      cwd: workspacePath,
      env: toolchainResult.toolchain.env,
      timeoutMs: 30000,
    });
    logs = result.stdout || result.stderr || "";
    if (result.exitCode !== 0) diagnostics.push(diagnostic("warning", logs || "hilog probe failed", { stage: "readLogs" }));
  } else {
    diagnostics.push(diagnostic("info", "Logs need an online HDC target", { stage: "readLogs" }));
  }
  const capabilities = {
    ...readRuntimeState(workspacePath).capabilities,
    hilog: logs ? "available" : "unavailable",
  };
  const runtimeState = writeRuntimeState(workspacePath, { logs: logs.slice(-10000), capabilities, diagnostics });
  return redactValue({ ok: Boolean(logs), logs: logs.slice(-10000), diagnostics, runtimeState });
}

module.exports = {
  captureScreen,
  dumpHierarchy,
  installApp,
  latestArtifact,
  launchAbility,
  listTargets,
  readScreenshot,
  readLogs,
};
