import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browser, expect, $ } from '@wdio/globals';

import { callProductAppRuntimeBackend } from '../helpers/product-app-runtime-helper';

describe('Product App runtime', () => {
  const workspacePath = process.env.E2E_TEST_WORKSPACE || process.cwd();
  const remotionFixturePath = process.env.E2E_REMOTION_WORKSPACE
    || 'D:\\workspace\\Sparo_OS_WorkSpace\\Sparo_OS_Remotion\\Promotional_video\\sparo-os-promo';
  const realRemotionIt = fs.existsSync(remotionFixturePath) ? it : it.skip;

  before(async () => {
    await browser.pause(3000);
  });

  async function openProductAppById(appId: string, targetWorkspacePath = workspacePath): Promise<void> {
    await browser.execute(async (id, path) => {
      const { openProductAppRuntime } = await import('/src/app/scenes/apps/product-app-runtime/productAppRuntimeService.ts');
      await openProductAppRuntime(id, {
        workspacePath: path,
        locale: 'en-US',
      });
    }, appId, targetWorkspacePath);
  }

  async function stopRemotionPreview(targetWorkspacePath: string): Promise<void> {
    try {
      await callProductAppRuntimeBackend(
        'builtin-remotion-live',
        'remotionRuntime.stopPlayerPreviewHost',
        { workspacePath: targetWorkspacePath },
        targetWorkspacePath,
      );
    } catch {
      // Cleanup is best-effort because this path may run after a failed launch attempt.
    }
  }

  async function runRuntimeRehearsal(
    productAppId: string,
    steps: Array<Record<string, unknown>>,
  ): Promise<any> {
    const scenarioId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await browser.executeAsync((
      runtimeProductAppId,
      id,
      rehearsalSteps,
      done: (value: { ok: boolean; result?: unknown; error?: string }) => void,
    ) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        `iframe[data-product-app-id="${runtimeProductAppId}"]`,
      );
      if (!frame?.contentWindow) {
        done({ ok: false, error: `Runtime iframe was not found: ${runtimeProductAppId}` });
        return;
      }
      const runtimeSurfaceId = frame.dataset.appId;
      if (!runtimeSurfaceId) {
        done({ ok: false, error: `Runtime surface identity was not found: ${runtimeProductAppId}` });
        return;
      }
      let timeout = 0;
      const finish = (value: { ok: boolean; result?: unknown; error?: string }) => {
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        done(value);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data?.method !== 'sparo/user-path-rehearsal') return;
        if (data.params?.appId !== runtimeSurfaceId || data.params?.requestId !== id) return;
        // WebView2 can expose a different WindowProxy object for the same
        // nested opaque frame. runtimeSurfaceId + requestId bind this response
        // to the exact rehearsal request without relying on proxy identity.
        finish({ ok: true, result: data.params.result });
      };
      window.addEventListener('message', onMessage);
      timeout = window.setTimeout(() => {
        finish({
          ok: false,
          error: `Runtime rehearsal timed out: ${id} (surface=${runtimeSurfaceId})`,
        });
      }, 15000);
      frame.contentWindow.postMessage({
        type: 'sparo:event',
        event: 'runtimeUserPathRehearsal',
        payload: {
          requestId: id,
          scenarios: [{ id, kind: 'user-path', steps: rehearsalSteps }],
        },
      }, '*');
    }, productAppId, scenarioId, steps) as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok) throw new Error(response.error || 'Runtime rehearsal failed');
    return response.result;
  }

  async function readRemotionRuntimeState(): Promise<Record<string, string>> {
    const result = await runRuntimeRehearsal('builtin-remotion-live', [{
      id: 'root-state',
      action: 'observe',
      target: 'css:#remotionLiveRoot',
    }]);
    const step = result?.scenarios?.[0]?.steps?.[0];
    if (step?.status !== 'passed') throw new Error(step?.detail || 'Remotion root state was unavailable');
    return step.attributes ?? {};
  }

  async function openWorkspaceHomeSurface(): Promise<void> {
    await browser.execute(async () => {
      const { openWorkspaceHome } = await import('/src/app/navigation/workspaceNavigation.ts');
      await openWorkspaceHome();
    });
  }

  async function ensureWorkDockExpanded(): Promise<void> {
    const dock = await $('[data-testid="work-dock"]');
    await dock.waitForExist({ timeout: 15000 });

    const currentClassName = await dock.getAttribute('class');
    if (currentClassName?.includes('work-dock--expanded')) {
      return;
    }

    const topBarWorkList = await $('[data-testid="unified-top-bar-work-list"]');
    if (await topBarWorkList.isExisting()) {
      await topBarWorkList.waitForClickable({ timeout: 15000 });
      await topBarWorkList.click();
    } else {
      const dockTrigger = await $('[data-testid="work-dock-trigger"]');
      await dockTrigger.waitForClickable({ timeout: 15000 });
      await dockTrigger.click();
    }

    await browser.waitUntil(
      async () => {
        const className = await dock.getAttribute('class');
        return className?.includes('work-dock--expanded') ?? false;
      },
      {
        timeout: 15000,
        timeoutMsg: 'Work Dock did not expand',
      },
    );
  }

  async function selectNewWorkExecutor(label: string): Promise<void> {
    const agentSelect = await $('#new-work-agent-select');
    await agentSelect.waitForDisplayed({ timeout: 15000 });
    await agentSelect.click();

    const searchInput = await $('.select__search-input');
    await searchInput.waitForDisplayed({ timeout: 15000 });
    await searchInput.setValue(label);

    await browser.waitUntil(
      async () => browser.execute((needle) => Array.from(
        document.querySelectorAll<HTMLElement>('.select__option'),
      ).some((option) => option.textContent?.includes(needle)), label),
      {
        timeout: 15000,
        timeoutMsg: `New Work executor option "${label}" did not appear`,
      },
    );

    await browser.execute((needle) => {
      const option = Array.from(document.querySelectorAll<HTMLElement>('.select__option'))
        .find((item) => item.textContent?.includes(needle));
      option?.click();
    }, label);
  }

  it('opens immersive Product Apps on the primary runtime surface', async () => {
    await openProductAppById('builtin-spark-board');

    const hostSurfaceScene = await $('[data-testid="product-app-host-surface-scene"]');
    await hostSurfaceScene.waitForDisplayed({ timeout: 30000 });

    await browser.waitUntil(
      async () => browser.execute(() => Boolean(
        document.querySelector('iframe[data-product-app-id="builtin-spark-board"]'),
      )),
      {
        timeout: 30000,
        timeoutMsg: 'Spark Board Product App iframe did not render',
      },
    );

    expect(await hostSurfaceScene.isDisplayed()).toBe(true);
  });

  it('opens sidecar Product Apps as Flow Chat plus a runtime-owned aux panel', async () => {
    await openProductAppById('builtin-remotion-live');

    const sessionScene = await $('[data-testid="session-scene"]');
    await sessionScene.waitForDisplayed({ timeout: 30000 });

    const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-remotion-live"]');
    await previewPanel.waitForDisplayed({ timeout: 30000 });

    const chatInput = await $('[data-testid="chat-input-container"], .composer-shell');
    await chatInput.waitForDisplayed({ timeout: 30000 });

    const profile = await browser.execute(() => {
      const scene = document.querySelector('[data-testid="session-scene"]');
      return scene?.getAttribute('data-agent');
    });

    expect(profile).toBe('product-app-runtime');
    expect(await previewPanel.isDisplayed()).toBe(true);
    expect(await chatInput.isDisplayed()).toBe(true);
  });

  it('creates Remotion Live from the Work Dock as a Product App runtime, not a builder chat', async () => {
    await openWorkspaceHomeSurface();
    await ensureWorkDockExpanded();

    const newWork = await $('[data-testid="work-dock-new-work"]');
    await newWork.waitForClickable({ timeout: 15000 });
    await newWork.click();

    const dialog = await $('[data-testid="new-work-dialog"]');
    await dialog.waitForDisplayed({ timeout: 15000 });

    await selectNewWorkExecutor('Remotion Live');

    const confirm = await $('[data-testid="new-work-confirm"]');
    await confirm.waitForClickable({ timeout: 15000 });
    await confirm.click();

    const sessionScene = await $('[data-testid="session-scene"]');
    await sessionScene.waitForDisplayed({ timeout: 30000 });

    const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-remotion-live"]');
    await previewPanel.waitForDisplayed({ timeout: 30000 });

    const profile = await browser.execute(() => {
      const scene = document.querySelector('[data-testid="session-scene"]');
      return scene?.getAttribute('data-agent');
    });
    const workRecord = await browser.execute(async () => {
      const { useWorkStore } = await import('/src/app/agentic-os/work/data/workStore.ts');
      const matches = useWorkStore.getState().works
        .filter(work =>
          work.primarySurface.kind === 'application_surface' &&
          work.primarySurface.productAppId === 'builtin-remotion-live'
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      const work = matches[0];
      return work
        ? {
            kind: work.kind,
            assignmentKind: work.assignment?.kind,
            primarySurfaceKind: work.primarySurface.kind,
            productAppId: work.primarySurface.kind === 'application_surface' ? work.primarySurface.productAppId : null,
            surfaceId: work.primarySurface.kind === 'application_surface' ? work.primarySurface.surfaceId : null,
            subjectKind: work.subject.kind,
            subjectAppKind: work.subject.kind === 'app' ? work.subject.app.kind : null,
            subjectAppId: work.subject.kind === 'app' ? work.subject.app.appId : null,
            subjectAppVersion: work.subject.kind === 'app' ? work.subject.app.appVersion : null,
            componentLockDigest: work.subject.kind === 'app' ? work.subject.app.componentLockDigest : null,
          }
        : null;
    });

    expect(profile).toBe('product-app-runtime');
    expect(await previewPanel.isDisplayed()).toBe(true);
    expect(workRecord).toEqual({
      kind: 'app_workflow',
      assignmentKind: 'application',
      primarySurfaceKind: 'application_surface',
      productAppId: 'builtin-remotion-live',
      surfaceId: 'primary',
      subjectKind: 'app',
      subjectAppKind: 'product_app',
      subjectAppId: 'builtin-remotion-live',
      subjectAppVersion: '19.0.0',
      componentLockDigest: workRecord?.componentLockDigest,
    });
    expect(workRecord?.componentLockDigest).toContain('sha256:');
  });

  realRemotionIt('controls the real Remotion Player through the Product App sandbox', async () => {
    const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparo-remotion-player-'));
    await openProductAppById('builtin-remotion-live', remotionFixturePath);

    try {
      const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-remotion-live"]');
      await previewPanel.waitForDisplayed({ timeout: 30000 });

      const surfaceFrame = await $('iframe[data-product-app-id="builtin-remotion-live"]');
      await surfaceFrame.waitForDisplayed({ timeout: 30000 });
      const sandbox = await surfaceFrame.getAttribute('sandbox');
      expect(sandbox ?? '').not.toContain('allow-same-origin');
      const iframeAllow = await surfaceFrame.getAttribute('allow');
      expect(iframeAllow ?? '').toContain('autoplay');
      expect(iframeAllow ?? '').toContain('fullscreen');

      let bootState: Record<string, string> = {};
      try {
        await browser.waitUntil(
          async () => {
            bootState = await readRemotionRuntimeState();
            return Boolean(bootState['data-error']) || (
              bootState['data-preview-phase'] === 'ready' &&
              bootState['data-frame-state'] === 'committed'
            );
          },
          {
            timeout: 90000,
            interval: 250,
            timeoutMsg: 'Remotion Live did not finish booting the real Player',
          },
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason}; last runtime state=${JSON.stringify(bootState)}`);
      }
      if (bootState['data-error']) {
        throw new Error(
          `Remotion Live surface failed during ${bootState['data-project-phase'] || 'unknown'} ` +
          `(detection=${bootState['data-detection-status'] || 'unknown'}): ${bootState['data-error']}`,
        );
      }

      const previewStatusResult = await callProductAppRuntimeBackend(
        'builtin-remotion-live',
        'remotionRuntime.getPlayerPreviewHostStatus',
        { workspacePath: remotionFixturePath },
        remotionFixturePath,
      );
      const previewStatus = (previewStatusResult as any).bridgeResult?.output ??
        (previewStatusResult as any).bridgeResult ??
        previewStatusResult;

      const compositionResult = await callProductAppRuntimeBackend(
        'builtin-remotion-live',
        'remotionRuntime.compileProject',
        { workspacePath: remotionFixturePath },
        remotionFixturePath,
      );
      const compositionOutput = (compositionResult as any).bridgeResult?.output ??
        (compositionResult as any).bridgeResult ??
        compositionResult;
      const manifest = compositionOutput?.manifest ?? compositionOutput;
      const compositionOptions = Array.from(manifest?.compositions ?? [])
        .map((composition: any) => composition.id || '');

      const playerUrl = (previewStatus as any).url as string;
      const playerResponse = await fetch(playerUrl);
      const playerHtml = await playerResponse.text();

      expect(playerUrl).toContain('http://127.0.0.1:');
      expect(playerResponse.ok).toBe(true);
      expect(playerHtml.toLowerCase()).toContain('remotion');
      expect(compositionOptions.join('|')).toContain('SparoOSPromo-16x9');

      const initialFrame = Number(bootState['data-actual-frame']);
      const initialScreenshot = path.join(screenshotDir, 'initial.png');
      await surfaceFrame.saveScreenshot(initialScreenshot);

      const playResult = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'play', action: 'click', target: 'toggle-play',
      }]);
      expect(playResult?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');
      await browser.waitUntil(
        async () => {
          const current = await readRemotionRuntimeState();
          return current['data-actual-playing'] === 'true' &&
            Number(current['data-actual-frame']) > initialFrame + 1;
        },
        { timeout: 10000, interval: 100, timeoutMsg: 'Play did not advance the actual Player frame' },
      );

      const pauseResult = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'pause', action: 'click', target: 'toggle-play',
      }]);
      expect(pauseResult?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');
      let pausedState: Record<string, string> = {};
      await browser.waitUntil(
        async () => {
          pausedState = await readRemotionRuntimeState();
          return pausedState['data-actual-playing'] === 'false' &&
            pausedState['data-preview-phase'] === 'ready' &&
            pausedState['data-frame-state'] === 'committed';
        },
        { timeout: 5000, interval: 100, timeoutMsg: 'Pause did not settle the actual Player state' },
      );
      const pausedFrame = Number(pausedState['data-actual-frame']);
      await browser.pause(500);
      expect(Number((await readRemotionRuntimeState())['data-actual-frame'])).toBe(pausedFrame);

      const selectedComposition = Array.from(manifest?.compositions ?? [])
        .find((composition: any) => composition.id === 'SparoOSPromo-16x9') as any;
      const maxFrame = Math.max(0, Number(selectedComposition?.durationInFrames || 1) - 1);
      const seekTarget = Math.min(Math.max(pausedFrame + 45, 45), maxFrame);
      const seekResult = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'seek',
        action: 'type',
        target: 'css:input[type="range"][data-action="frame-range"]',
        value: String(seekTarget),
      }]);
      expect(seekResult?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');
      await browser.waitUntil(
        async () => {
          const current = await readRemotionRuntimeState();
          return Number(current['data-actual-frame']) === seekTarget &&
            current['data-preview-phase'] === 'ready' &&
            current['data-frame-state'] === 'committed';
        },
        { timeout: 10000, interval: 100, timeoutMsg: 'Seek did not commit the requested Player frame' },
      );
      const seekScreenshot = path.join(screenshotDir, 'seek.png');
      await surfaceFrame.saveScreenshot(seekScreenshot);
      expect(fs.readFileSync(seekScreenshot).equals(fs.readFileSync(initialScreenshot))).toBe(false);

      const inspectOn = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'inspect-on', action: 'click', target: 'toggle-inspect',
      }]);
      expect(inspectOn?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');
      await browser.waitUntil(
        async () => (await readRemotionRuntimeState())['data-inspect-mode'] === 'true',
        { timeout: 3000, interval: 50, timeoutMsg: 'Inspect mode did not activate' },
      );
      const captureOn = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'capture-on', action: 'observe', target: 'css:.rl-select-capture',
      }]);
      expect(captureOn?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');

      const inspectOff = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'inspect-off', action: 'click', target: 'toggle-inspect',
      }]);
      expect(inspectOff?.scenarios?.[0]?.steps?.[0]?.status).toBe('passed');
      await browser.waitUntil(
        async () => (await readRemotionRuntimeState())['data-inspect-mode'] === 'false',
        { timeout: 3000, interval: 50, timeoutMsg: 'Inspect mode did not deactivate' },
      );
      const captureOff = await runRuntimeRehearsal('builtin-remotion-live', [{
        id: 'capture-off', action: 'observe', target: 'css:.rl-select-capture',
      }]);
      expect(captureOff?.scenarios?.[0]?.steps?.[0]?.status).toBe('failed');
    } finally {
      fs.rmSync(screenshotDir, { recursive: true, force: true });
      await stopRemotionPreview(remotionFixturePath);
    }
  });
});
