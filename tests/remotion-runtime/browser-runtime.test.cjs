const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createWindowsBrowserLink,
  openRemotionBrowser,
  resolveBrowserExecutable,
  toWindowsProcessPath,
} = require("../../bundles/product-apps/builtin-remotion-live/19.0.2/components/bridges/builtin-remotion-runtime/source/src/browser-runtime");

function longDrivePath() {
  return path.win32.join("C:\\runtime", "nested".repeat(40), "chrome-headless-shell.exe");
}

test("Windows long browser paths use a short browser link", () => {
  const executablePath = longDrivePath();
  const linkedPath = "C:\\short\\browser\\chrome-headless-shell.exe";
  assert.ok(executablePath.length >= 260);
  assert.equal(toWindowsProcessPath(executablePath, {
    platform: "win32",
    createWindowsBrowserLink: (receivedPath) => {
      assert.equal(receivedPath, executablePath);
      return linkedPath;
    },
  }), linkedPath);
});

test("short and non-Windows paths remain stable", () => {
  assert.equal(toWindowsProcessPath("C:\\chrome\\chrome.exe", { platform: "win32" }), "C:\\chrome\\chrome.exe");
  assert.equal(toWindowsProcessPath("/opt/chrome/chrome", { platform: "linux" }), "/opt/chrome/chrome");
});

test("Remotion browser launch receives the resolved Windows process path", async () => {
  const executablePath = longDrivePath();
  const linkedPath = "C:\\short\\browser\\chrome-headless-shell.exe";
  const calls = [];
  const browser = { close: async () => {} };
  const renderer = {
    ensureBrowser: async (options) => {
      calls.push(["ensureBrowser", options]);
      return { type: "local-puppeteer-browser", path: executablePath };
    },
    openBrowser: async (browserName, options) => {
      calls.push(["openBrowser", browserName, options]);
      return browser;
    },
  };

  const result = await openRemotionBrowser(renderer, {
    platform: "win32",
    logLevel: "warn",
    createWindowsBrowserLink: () => linkedPath,
  });

  assert.equal(result, browser);
  assert.deepEqual(calls, [
    ["ensureBrowser", { chromeMode: "headless-shell", logLevel: "warn" }],
    ["openBrowser", "chrome", {
      chromeMode: "headless-shell",
      logLevel: "warn",
      browserExecutable: linkedPath,
    }],
  ]);
});

test("render operations can resolve the same explicit browser executable", async () => {
  const executablePath = longDrivePath();
  const linkedPath = "C:\\short\\browser\\chrome-headless-shell.exe";
  const resolved = await resolveBrowserExecutable({
    ensureBrowser: async () => ({ type: "local-puppeteer-browser", path: executablePath }),
  }, {
    platform: "win32",
    createWindowsBrowserLink: () => linkedPath,
  });

  assert.equal(resolved, linkedPath);
});

test("Windows browser links preserve access to adjacent browser resources", {
  skip: process.platform !== "win32",
}, (t) => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-target-"));
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-remotion-links-"));
  const targetDirectory = path.join(targetRoot, "nested".repeat(36));
  const executablePath = path.join(targetDirectory, "chrome-headless-shell.exe");
  const resourcePath = path.join(targetDirectory, "icudtl.dat");
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(executablePath, "browser", "utf8");
  fs.writeFileSync(resourcePath, "resource", "utf8");
  t.after(() => {
    const linkedDirectories = fs.readdirSync(linkRoot).map((entry) => path.join(linkRoot, entry));
    for (const linkedDirectory of linkedDirectories) fs.unlinkSync(linkedDirectory);
    fs.rmdirSync(linkRoot);
    fs.rmSync(targetRoot, { recursive: true, force: true });
  });

  assert.ok(executablePath.length >= 260);
  const linkedExecutable = createWindowsBrowserLink(executablePath, { browserLinkRoot: linkRoot });
  assert.ok(linkedExecutable.length < 260);
  assert.equal(fs.readFileSync(linkedExecutable, "utf8"), "browser");
  assert.equal(fs.readFileSync(path.join(path.dirname(linkedExecutable), "icudtl.dat"), "utf8"), "resource");
});

test("older renderer packages without ensureBrowser keep their existing launch behavior", async () => {
  const calls = [];
  await openRemotionBrowser({
    openBrowser: async (browserName, options) => {
      calls.push([browserName, options]);
      return { close: async () => {} };
    },
  }, { platform: "win32" });

  assert.deepEqual(calls, [["chrome", { chromeMode: "headless-shell", logLevel: "warn" }]]);
});
