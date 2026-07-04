import fs from 'node:fs';
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

  realRemotionIt('starts a real Remotion Player preview runtime for the fixture project', async () => {
    await openProductAppById('builtin-remotion-live', remotionFixturePath);

    try {
      const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-remotion-live"]');
      await previewPanel.waitForDisplayed({ timeout: 30000 });

      await browser.waitUntil(
        async () => {
          const result = await callProductAppRuntimeBackend(
            'builtin-remotion-live',
            'remotionRuntime.getPlayerPreviewHostStatus',
            { workspacePath: remotionFixturePath },
            remotionFixturePath,
          );
          const output = (result as any).bridgeResult?.output ?? (result as any).bridgeResult ?? result;
          return output?.ready && typeof output?.url === 'string' && output.url.startsWith('http://127.0.0.1:')
            ? output
            : null;
        },
        {
          timeout: 90000,
          interval: 1000,
          timeoutMsg: 'Remotion Player preview host did not become ready',
        },
      );

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
      const manifest = compositionOutput?.manifest ?? compositionOutput?.compositionManifest ?? compositionOutput;
      const compositionOptions = Array.from(manifest?.compositions ?? [])
        .map((composition: any) => composition.id || '');

      const playerUrl = (previewStatus as any).url as string;
      const playerResponse = await fetch(playerUrl);
      const playerHtml = await playerResponse.text();
      const compositionId = String((previewStatus as any).compositionId || compositionOptions[0] || 'SparoOSPromo-16x9');
      const protocolResult = await browser.executeAsync((
        baseUrl: string,
        targetCompositionId: string,
        done: (result: Record<string, unknown>) => void,
      ) => {
        const instanceId = `e2e-${Date.now()}`;
        const url = new URL(baseUrl);
        url.searchParams.set('compositionId', targetCompositionId);
        url.searchParams.set('frame', '0');
        url.searchParams.set('instanceId', instanceId);

        const iframe = document.createElement('iframe');
        iframe.src = url.toString();
        iframe.style.position = 'fixed';
        iframe.style.left = '-10000px';
        iframe.style.top = '0';
        iframe.style.width = '320px';
        iframe.style.height = '180px';

        let readyFrame = 0;
        let maxFrame = 0;
        let playAck = false;
        let pauseAck = false;
        let seekAck = false;
        let pauseFrame = 0;
        let seekTarget = 0;
        const errors: string[] = [];
        let timeout = 0;
        let onMessage: (event: MessageEvent) => void;

        const cleanup = (result: Record<string, unknown>) => {
          window.removeEventListener('message', onMessage);
          window.clearTimeout(timeout);
          iframe.remove();
          done(result);
        };

        const post = (type: string, payload: Record<string, unknown> = {}) => {
          iframe.contentWindow?.postMessage({
            source: 'sparo-remotion-live',
            type,
            compositionId: targetCompositionId,
            instanceId,
            ...payload,
          }, '*');
        };

        onMessage = (event: MessageEvent) => {
          const message = event.data || {};
          if (message.source !== 'sparo-remotion-player-host') return;
          if (message.instanceId !== instanceId) return;
          if (message.compositionId !== targetCompositionId) return;

          if (message.type === 'error') {
            errors.push(String(message.message || 'Player error'));
          }

          if (message.type === 'ready') {
            readyFrame = Number(message.frame || 0);
            maxFrame = readyFrame;
            post('play', { frame: readyFrame, commandId: 'e2e-play' });
            window.setTimeout(() => post('snapshot', { requestId: 'after-play' }), 1200);
            return;
          }

          if (message.type === 'frame') {
            maxFrame = Math.max(maxFrame, Number(message.frame || 0));
            return;
          }

          if (message.type === 'command') {
            if (message.command === 'play' && message.commandId === 'e2e-play') playAck = true;
            if (message.command === 'pause' && message.commandId === 'e2e-pause') pauseAck = true;
            if (message.command === 'seek' && message.commandId === 'e2e-seek') seekAck = true;
            return;
          }

          if (message.type === 'snapshot' && message.requestId === 'after-play') {
            const frame = Number(message.frame || 0);
            maxFrame = Math.max(maxFrame, frame);
            pauseFrame = maxFrame;
            post('pause', { frame: pauseFrame, commandId: 'e2e-pause' });
            window.setTimeout(() => post('snapshot', { requestId: 'after-pause' }), 350);
            return;
          }

          if (message.type === 'snapshot' && message.requestId === 'after-pause') {
            pauseFrame = Number(message.frame || pauseFrame);
            seekTarget = Math.min(pauseFrame + 12, 60);
            post('seek', { frame: seekTarget, commandId: 'e2e-seek' });
            window.setTimeout(() => post('snapshot', { requestId: 'after-seek' }), 350);
            return;
          }

          if (message.type === 'snapshot' && message.requestId === 'after-seek') {
            const seekFrame = Number(message.frame || 0);
            cleanup({
              ok: true,
              readyFrame,
              maxFrame,
              playAck,
              pauseAck,
              seekAck,
              pauseFrame,
              seekTarget,
              seekFrame,
              playing: Boolean(message.playing),
              errors,
            });
          }
        };

        timeout = window.setTimeout(() => {
          cleanup({
            ok: false,
            readyFrame,
            maxFrame,
            playAck,
            pauseAck,
            seekAck,
            pauseFrame,
            seekTarget,
            errors,
          });
        }, 10000);

        window.addEventListener('message', onMessage);
        document.body.appendChild(iframe);
      }, playerUrl, compositionId) as any;

      expect(playerUrl).toContain('http://127.0.0.1:');
      expect(playerResponse.ok).toBe(true);
      expect(playerHtml.toLowerCase()).toContain('remotion');
      expect(compositionOptions.join('|')).toContain('SparoOSPromo-16x9');
      expect(protocolResult.ok).toBe(true);
      expect(protocolResult.errors).toEqual([]);
      expect(protocolResult.playAck).toBe(true);
      expect(protocolResult.pauseAck).toBe(true);
      expect(protocolResult.seekAck).toBe(true);
      expect(protocolResult.maxFrame).toBeGreaterThan(protocolResult.readyFrame + 1);
      expect(Math.abs(protocolResult.seekFrame - protocolResult.seekTarget)).toBeLessThanOrEqual(1);
      expect(protocolResult.playing).toBe(false);
    } finally {
      await stopRemotionPreview(remotionFixturePath);
    }
  });
});
