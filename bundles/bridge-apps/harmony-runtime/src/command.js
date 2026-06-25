const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { redactText } = require("./redact");

function tail(value, max = 10000) {
  const text = redactText(value || "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function writeLog(logPath, label, commandLine, result) {
  if (!logPath) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const body = [
    `# ${label}`,
    "",
    `$ ${commandLine}`,
    "",
    `exitCode: ${result.exitCode}`,
    "",
    "## stdout",
    result.stdout || "",
    "",
    "## stderr",
    result.stderr || "",
    "",
  ].join("\n");
  fs.writeFileSync(logPath, body, "utf8");
}

function runCommand(command, args = [], options = {}) {
  const startedAt = Date.now();
  const env = {
    ...process.env,
    ...(options.env || {}),
  };
  const isWindowsScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const quoteCmdArg = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const executable = isWindowsScript ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs = isWindowsScript
    ? ["/d", "/c", `call ${quoteCmdArg(command)} ${args.map(quoteCmdArg).join(" ")}`]
    : args.map(String);
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 60000,
    shell: false,
    windowsVerbatimArguments: isWindowsScript,
    maxBuffer: options.maxBuffer || 12 * 1024 * 1024,
  });
  const output = {
    command,
    args: args.map(String),
    commandLine: [command, ...args.map(String)].join(" "),
    cwd: options.cwd || process.cwd(),
    exitCode: typeof result.status === "number" ? result.status : (result.error ? 1 : 0),
    timedOut: result.error?.code === "ETIMEDOUT",
    durationMs: Date.now() - startedAt,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr || result.error?.message || ""),
  };
  writeLog(options.logPath, options.label || path.basename(command), output.commandLine, output);
  return output;
}

function fileExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

module.exports = {
  fileExists,
  runCommand,
};
