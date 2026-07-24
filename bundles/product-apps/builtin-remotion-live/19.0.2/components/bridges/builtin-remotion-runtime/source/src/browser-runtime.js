const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WINDOWS_MAX_PATH = 260;
const BROWSER_LINK_DIRECTORY = "sparo-remotion-browser-links";

function createWindowsBrowserLink(executablePath, options = {}) {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Remotion browser executable does not exist: ${executablePath}`);
  }
  const linkRoot = options.browserLinkRoot || path.join(os.tmpdir(), BROWSER_LINK_DIRECTORY);
  fs.mkdirSync(linkRoot, { recursive: true });
  const linkId = crypto.createHash("sha256")
    .update(executablePath.toLowerCase())
    .digest("hex")
    .slice(0, 24);
  const targetDirectory = path.dirname(executablePath);
  const executableName = path.basename(executablePath);

  // Chrome resolves ICU and other runtime files beside the launched executable.
  // A short junction preserves that layout; a \\?\ executable path does not.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${process.pid}-${attempt}`;
    const linkPath = path.join(linkRoot, `${linkId}${suffix}`);
    const linkedExecutable = path.join(linkPath, executableName);
    if (fs.existsSync(linkedExecutable)) return linkedExecutable;
    try {
      fs.symlinkSync(targetDirectory, linkPath, "junction");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (fs.existsSync(linkedExecutable)) return linkedExecutable;
  }

  throw new Error(`Failed to create a short Remotion browser path for: ${executablePath}`);
}

function toWindowsProcessPath(executablePath, options = {}) {
  const platform = options.platform || process.platform;
  if (typeof executablePath !== "string" || executablePath.length === 0 || platform !== "win32") {
    return executablePath;
  }

  const normalizedPath = path.win32.normalize(executablePath);
  if (!path.win32.isAbsolute(normalizedPath) || normalizedPath.length < WINDOWS_MAX_PATH) {
    return normalizedPath;
  }
  const createBrowserLink = options.createWindowsBrowserLink || createWindowsBrowserLink;
  return createBrowserLink(normalizedPath, options);
}

async function resolveBrowserExecutable(renderer, options = {}) {
  const platform = options.platform || process.platform;
  if (typeof options.browserExecutable === "string" && options.browserExecutable.length > 0) {
    return toWindowsProcessPath(options.browserExecutable, { ...options, platform });
  }
  if (typeof renderer.ensureBrowser !== "function") {
    return null;
  }

  const browserStatus = await renderer.ensureBrowser({
    chromeMode: options.chromeMode || "headless-shell",
    logLevel: options.logLevel || "warn",
  });
  if (!browserStatus || typeof browserStatus.path !== "string" || browserStatus.path.length === 0) {
    throw new Error("Remotion ensureBrowser() did not return a browser executable path.");
  }
  return toWindowsProcessPath(browserStatus.path, { ...options, platform });
}

async function openRemotionBrowser(renderer, options = {}) {
  const browserExecutable = await resolveBrowserExecutable(renderer, options);
  return renderer.openBrowser("chrome", {
    chromeMode: options.chromeMode || "headless-shell",
    logLevel: options.logLevel || "warn",
    ...(browserExecutable ? { browserExecutable } : {}),
  });
}

module.exports = {
  createWindowsBrowserLink,
  openRemotionBrowser,
  resolveBrowserExecutable,
  toWindowsProcessPath,
};
