import type { Options } from '@wdio/types';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DRIVER_HOST = '127.0.0.1';
const DRIVER_PORT = Number(process.env.SPARO_E2E_WEBDRIVER_PORT || 4445);
const DEV_SERVER_HOST = '127.0.0.1';
const DEV_SERVER_PORT = 5722;
const APP_START_TIMEOUT_MS = Number(process.env.SPARO_E2E_APP_START_TIMEOUT_MS || 120000);

let sparoApp: ChildProcess | null = null;
let devServerProcess: ChildProcess | null = null;
let ownsDevServer = false;

function projectRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

type BrowserLogEntry = {
  level: string;
  message: string;
  timestamp: number;
};

function executableCandidates(buildType: 'debug' | 'release'): string[] {
  const root = projectRoot();
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `bitfun-desktop${suffix}`;

  if (process.platform === 'darwin') {
    return [
      path.join(root, 'target', buildType, binaryName),
      path.join(root, 'target', buildType, 'Sparo OS.app', 'Contents', 'MacOS', 'Sparo OS'),
    ];
  }

  return [path.join(root, 'target', buildType, binaryName)];
}

function e2eAppMode(): string {
  return process.env.SPARO_E2E_APP_MODE?.toLowerCase() || '';
}

function isDevAppMode(): boolean {
  return e2eAppMode() === 'dev';
}

export function getApplicationPath(): string {
  const forcedPath = process.env.SPARO_E2E_APP_PATH;
  const forcedMode = e2eAppMode();

  if (forcedPath) {
    return forcedPath;
  }

  if (forcedMode === 'debug') {
    return executableCandidates('debug')[0];
  }

  if (forcedMode === 'dev') {
    throw new Error('Dev mode runs through pnpm desktop:dev:raw and does not use a fixed application path.');
  }

  if (forcedMode === 'release') {
    throw new Error('Release mode is disabled for E2E. Use the debug desktop build instead.');
  }

  const debugMatch = executableCandidates('debug').find(candidate => fs.existsSync(candidate));
  if (debugMatch) {
    return debugMatch;
  }

  throw new Error(
    `Debug desktop build not found. Expected one of: ${executableCandidates('debug').join(', ')}`
  );
}

async function waitForDevServerIfNeeded(appPath: string): Promise<void> {
  if (!appPath.includes(`${path.sep}debug${path.sep}`)) {
    return;
  }

  const running = await isPortOpen(DEV_SERVER_PORT, [DEV_SERVER_HOST, '::1']);

  if (running) {
    console.log(`Dev server is already running on port ${DEV_SERVER_PORT}`);
    return;
  }

  await startDevServer();
}

async function fetchDriverStatus(): Promise<boolean> {
  try {
    const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/status`);
    if (!response.ok) {
      return false;
    }
    const body = await response.json() as { value?: { ready?: boolean } };
    return body.value?.ready === true;
  } catch {
    return false;
  }
}

async function createProbeSession(): Promise<string> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`Failed to create probe session: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { value?: { sessionId?: string } };
  const sessionId = body.value?.sessionId;
  if (!sessionId) {
    throw new Error('Probe session did not return a session id');
  }
  return sessionId;
}

async function deleteProbeSession(sessionId: string): Promise<void> {
  await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}`, {
    method: 'DELETE',
  }).catch(() => undefined);
}

async function probeDocumentReady(sessionId: string): Promise<boolean> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}/execute/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script: `() => {
        const root = document.getElementById('root');
        const appLayout = document.querySelector(
          '[data-testid="app-layout"], .bitfun-app-layout, .sparo-app-layout'
        );
        const mainContent = document.querySelector(
          '[data-testid="app-main-content"], .bitfun-app-main-workspace, .sparo-app-main-workspace'
        );
        const shell = document.querySelector(
          [
            '.bitfun-nav-panel',
            '.bitfun-scene-bar',
            '.bitfun-nav-bar',
            '.bitfun-scene-viewport',
            '.welcome-scene',
            '[data-testid="chat-input-container"]',
            '.composer-shell',
            '.flow-chat-container',
            '[class*="header"]',
            '[class*="Header"]',
          ].join(', ')
        );
        const splashVisible = Boolean(document.querySelector('.splash-screen'));
        const tauriReady =
          typeof window.__TAURI__ !== 'undefined' ||
          typeof window.__TAURI_INTERNALS__ !== 'undefined';

        return Boolean(
          document?.body &&
          root &&
          root.childElementCount > 0 &&
          appLayout &&
          mainContent &&
          shell &&
          tauriReady &&
          !splashVisible
        );
      }`,
      args: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Document ready probe failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as { value?: boolean };
  return body.value === true;
}

async function waitForEmbeddedDriverReady(timeoutMs: number = 30000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await fetchDriverStatus()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Embedded WebDriver did not become ready within ${timeoutMs}ms`);
}

async function waitForWebviewDocumentReady(timeoutMs: number = 30000): Promise<void> {
  const startedAt = Date.now();
  let lastError = 'Sparo OS app shell is not ready';

  while (Date.now() - startedAt < timeoutMs) {
    let sessionId: string | null = null;

    try {
      sessionId = await createProbeSession();
      const ready = await probeDocumentReady(sessionId);
      if (ready) {
        await deleteProbeSession(sessionId);
        return;
      }
      lastError = 'Sparo OS app shell is not ready';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      if (sessionId) {
        await deleteProbeSession(sessionId);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`Webview document did not become ready within ${timeoutMs}ms: ${lastError}`);
}

async function fetchSessionLogs(
  sessionId: string,
  logType: string,
): Promise<BrowserLogEntry[]> {
  const response = await fetch(`http://${DRIVER_HOST}:${DRIVER_PORT}/session/${sessionId}/se/log`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: logType }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch logs: ${response.status} ${body}`);
  }

  const payload = await response.json() as { value?: BrowserLogEntry[] };
  return payload.value ?? [];
}

function stopSparoApp(): void {
  if (!sparoApp) {
    return;
  }

  if (process.platform === 'win32' && sparoApp.pid) {
    spawn('taskkill', ['/pid', String(sparoApp.pid), '/T', '/F'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } else {
    sparoApp.kill();
  }
  sparoApp = null;
}

function stopDevServer(): void {
  if (!devServerProcess || !ownsDevServer) {
    return;
  }

  devServerProcess.kill();
  devServerProcess = null;
  ownsDevServer = false;
}

async function isPortOpen(port: number, hosts: string[]): Promise<boolean> {
  return Promise.any(hosts.map(host => {
    return new Promise<boolean>((resolve, reject) => {
      const client = new net.Socket();
      client.setTimeout(2000);
      client.connect(port, host, () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', error => {
        client.destroy();
        reject(error);
      });
      client.on('timeout', () => {
        client.destroy();
        reject(new Error(`Timeout connecting to ${host}:${port}`));
      });
    });
  })).then(() => true).catch(() => false);
}

async function waitForPort(port: number, hosts: string[], timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port, hosts)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Port ${port} did not become ready within ${timeoutMs}ms`);
}

async function startDevServer(): Promise<void> {
  if (devServerProcess) {
    await waitForPort(DEV_SERVER_PORT, [DEV_SERVER_HOST, '::1'], 60000);
    return;
  }

  console.log(`Starting dev server on http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`);

  const spawnOptions = {
    cwd: projectRoot(),
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    env: {
      ...process.env,
      TAURI_DEV_HOST: DEV_SERVER_HOST,
    },
  };

  if (process.platform === 'win32') {
    const commandLine = [
      'pnpm',
      '--dir',
      'src/web-ui',
      'exec',
      'vite',
      '--force',
      '--host',
      DEV_SERVER_HOST,
      '--port',
      String(DEV_SERVER_PORT),
    ].join(' ');

    devServerProcess = spawn(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', commandLine],
      spawnOptions,
    );
  } else {
    devServerProcess = spawn(
      'pnpm',
      [
        '--dir',
        'src/web-ui',
        'exec',
        'vite',
        '--force',
        '--host',
        DEV_SERVER_HOST,
        '--port',
        String(DEV_SERVER_PORT),
      ],
      spawnOptions,
    );
  }
  ownsDevServer = true;

  devServerProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[dev-server] ${data.toString().trim()}`);
  });

  devServerProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[dev-server] ${data.toString().trim()}`);
  });

  devServerProcess.on('exit', (code, signal) => {
    console.log(`[dev-server] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    devServerProcess = null;
    ownsDevServer = false;
  });

  try {
    await waitForPort(DEV_SERVER_PORT, [DEV_SERVER_HOST, '::1'], 60000);
  } catch (error) {
    stopDevServer();
    throw error;
  }
}

async function startSparoApp(): Promise<void> {
  if (isDevAppMode()) {
    stopSparoApp();

    console.log(`Starting Sparo OS dev mode with embedded WebDriver on port ${DRIVER_PORT}`);
    const env = {
      ...process.env,
      CI: 'true',
      SPARO_WEBDRIVER_PORT: String(DRIVER_PORT),
      SPARO_WEBDRIVER_LABEL: 'main',
    };

    if (process.platform === 'win32') {
      sparoApp = spawn(
        process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
        ['/d', '/s', '/c', 'pnpm run desktop:dev:raw'],
        {
          cwd: projectRoot(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        },
      );
    } else {
      sparoApp = spawn('pnpm', ['run', 'desktop:dev:raw'], {
        cwd: projectRoot(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
    }

    sparoApp.stdout?.on('data', (data: Buffer) => {
      console.log(`[sparo-app-dev] ${data.toString().trim()}`);
    });

    sparoApp.stderr?.on('data', (data: Buffer) => {
      console.error(`[sparo-app-dev] ${data.toString().trim()}`);
    });

    sparoApp.on('exit', (code, signal) => {
      console.log(`[sparo-app-dev] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
    });

    await waitForEmbeddedDriverReady(APP_START_TIMEOUT_MS);
    await waitForWebviewDocumentReady(APP_START_TIMEOUT_MS);
    console.log(`Embedded WebDriver is ready on http://${DRIVER_HOST}:${DRIVER_PORT}`);
    return;
  }

  const appPath = getApplicationPath();

  if (!fs.existsSync(appPath)) {
    console.error(`Application not found at: ${appPath}`);
    console.error('Please build the debug application first with:');
    console.error('cargo build -p bitfun-desktop');
    throw new Error('Application not built');
  }

  await waitForDevServerIfNeeded(appPath);

  stopSparoApp();

  console.log(`Starting Sparo OS with embedded WebDriver on port ${DRIVER_PORT}`);
  console.log(`Application: ${appPath}`);

  sparoApp = spawn(appPath, [], {
    cwd: projectRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SPARO_WEBDRIVER_PORT: String(DRIVER_PORT),
      SPARO_WEBDRIVER_LABEL: 'main',
    },
  });

  sparoApp.stdout?.on('data', (data: Buffer) => {
    console.log(`[sparo-app] ${data.toString().trim()}`);
  });

  sparoApp.stderr?.on('data', (data: Buffer) => {
    console.error(`[sparo-app] ${data.toString().trim()}`);
  });

  sparoApp.on('exit', (code, signal) => {
    console.log(`[sparo-app] exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
  });

  await waitForEmbeddedDriverReady(APP_START_TIMEOUT_MS);
  await waitForWebviewDocumentReady(APP_START_TIMEOUT_MS);
  console.log(`Embedded WebDriver is ready on http://${DRIVER_HOST}:${DRIVER_PORT}`);
}

function sharedAfterTest(): Options.Testrunner['afterTest'] {
  return async function afterTest(test, _context, { error, passed }) {
    const isRealFailure = !passed && !!error;
    if (!isRealFailure) {
      return;
    }

    if (process.platform === 'linux') {
      console.warn('Skipping failure screenshot on linux');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotName = `failure-${test.title.replace(/\s+/g, '_')}-${timestamp}.png`;

    try {
      const screenshotPath = path.resolve(__dirname, '..', 'reports', 'screenshots', screenshotName);
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await browser.saveScreenshot(screenshotPath);
      console.log(`Screenshot saved: ${screenshotName}`);
    } catch (screenshotError) {
      console.error('Failed to save screenshot:', screenshotError);
    }
  };
}

export function createEmbeddedConfig(specs: string[], label: string): Options.Testrunner {
  return {
    runner: 'local',
    autoCompileOpts: {
      autoCompile: true,
      tsNodeOpts: {
        transpileOnly: true,
        project: path.resolve(__dirname, '..', 'tsconfig.json'),
      },
    },

    specs,
    exclude: [],

    maxInstances: 1,
    capabilities: [{
      maxInstances: 1,
      browserName: 'bitfun',
      'bitfun:embedded': true,
    } as any],

    logLevel: 'info',
    bail: 0,
    baseUrl: '',
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,

    services: [],
    hostname: DRIVER_HOST,
    port: DRIVER_PORT,
    path: '/',

    framework: 'mocha',
    reporters: ['spec'],

    mochaOpts: {
      ui: 'bdd',
      timeout: 120000,
      retries: 0,
    },

    onPrepare: async function onPrepare() {
      console.log(`Preparing ${label} E2E test run...`);
      if (isDevAppMode()) {
        console.log('application: dev mode via pnpm desktop:dev:raw');
        return;
      }

      const appPath = getApplicationPath();

      if (!fs.existsSync(appPath)) {
        console.error(`Application not found at: ${appPath}`);
        console.error('Please build the debug application first with:');
        console.error('cargo build -p bitfun-desktop');
        throw new Error('Application not built');
      }

      console.log(`application: ${appPath}`);
      await waitForDevServerIfNeeded(appPath);
    },

    beforeSession: async function beforeSession() {
      await startSparoApp();
    },

    before: async function before() {
      const browserWithLogs = browser as WebdriverIO.Browser & {
        getLogs?: (logType: string) => Promise<BrowserLogEntry[]>;
      };

      if (typeof browserWithLogs.getLogs !== 'function') {
        browser.addCommand('getLogs', async function (this: WebdriverIO.Browser, logType: string) {
          return fetchSessionLogs(this.sessionId, logType);
        });
      }
    },

    afterSession: function afterSession() {
      console.log('Stopping Sparo OS app...');
      stopSparoApp();
    },

    afterTest: sharedAfterTest(),

    onComplete: function onComplete() {
      console.log(`${label} E2E test run completed`);
      stopSparoApp();
      stopDevServer();
    },
  };
}
