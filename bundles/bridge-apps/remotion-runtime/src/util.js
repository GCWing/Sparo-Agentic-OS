const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { IGNORED_DIRS, SOURCE_EXTENSIONS } = require("./constants");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailFile(filePath, maxBytes = 6000) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function tailPreviewLogs(state) {
  return [
    tailFile(state?.logPath),
    tailFile(state?.stdoutLogPath),
    tailFile(state?.stderrLogPath),
  ].filter(Boolean).join("\n");
}

function tailPlayerHostLogs(state) {
  return [
    tailFile(state?.logPath),
    tailFile(state?.stderrLogPath),
  ].filter(Boolean).join("\n");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsString(value) {
  return JSON.stringify(String(value).replace(/\\/g, "/"));
}

function relativeImport(fromDir, toFile) {
  let specifier = path.relative(fromDir, toFile).replace(/\\/g, "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function sideEffectImportsForSource(entryDir, sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return "";
  const source = readText(sourcePath);
  const imports = [];
  const sideEffectImportPattern = /(^|\n)\s*import\s+["']([^"']+)["']\s*;?/g;
  for (const match of source.matchAll(sideEffectImportPattern)) {
    const specifier = match[2];
    if (!specifier) continue;
    const resolvedSpecifier = specifier.startsWith(".")
      ? relativeImport(entryDir, path.resolve(path.dirname(sourcePath), specifier))
      : specifier;
    imports.push(`import ${jsString(resolvedSpecifier)};`);
  }
  return imports.join("\n");
}

function isProcessAlive(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) return false;
  try {
    process.kill(normalized, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcessTree(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) return;
  try {
    if (process.platform === "win32") {
      const killed = spawnSync("taskkill", ["/PID", String(normalized), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      if (killed.status !== 0) {
        spawnSync("powershell", [
          "-NoProfile",
          "-Command",
          `Stop-Process -Id ${normalized} -Force -ErrorAction SilentlyContinue`,
        ], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      return;
    }
    try {
      process.kill(-normalized, "SIGTERM");
    } catch {
      process.kill(normalized, "SIGTERM");
    }
  } catch {
    // Best-effort cleanup; status polling will surface if the process stays alive.
  }
}

function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not allocate a preview server port."));
      });
    });
  });
}

async function httpStatus(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return { reachable: true, statusCode: response.status };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await httpStatus(url, 1500);
    if (last.reachable) return last;
    await sleep(500);
  }
  return last || { reachable: false, error: "Timed out waiting for preview server." };
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function walkFiles(root, options = {}) {
  const maxFiles = options.maxFiles || 5000;
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}

function sourceFiles(workspacePath) {
  return walkFiles(workspacePath)
    .filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .filter((filePath) => (safeStat(filePath)?.size || 0) < 750_000);
}

function packageManager(workspacePath) {
  if (fs.existsSync(path.join(workspacePath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(workspacePath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(workspacePath, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(workspacePath, "package-lock.json"))) return "npm";
  return "npm";
}

function packageInfo(workspacePath) {
  return readJson(path.join(workspacePath, "package.json"), {}) || {};
}

function dependencyVersion(pkg, name) {
  return (
    pkg.dependencies?.[name] ||
    pkg.devDependencies?.[name] ||
    pkg.peerDependencies?.[name] ||
    ""
  );
}

function hashContent(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeFilePart(value) {
  return String(value || "composition").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "composition";
}

module.exports = {
  sleep,
  tailFile,
  tailPreviewLogs,
  tailPlayerHostLogs,
  psQuote,
  jsString,
  relativeImport,
  sideEffectImportsForSource,
  isProcessAlive,
  terminateProcessTree,
  findFreePort,
  httpStatus,
  waitForHttp,
  readJson,
  writeJson,
  readText,
  safeStat,
  walkFiles,
  sourceFiles,
  packageManager,
  packageInfo,
  dependencyVersion,
  hashContent,
  clampNumber,
  safeFilePart,
};
