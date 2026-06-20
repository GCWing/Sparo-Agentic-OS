import fs from 'node:fs';
import { browser, expect, $ } from '@wdio/globals';

describe('Live App composite workbench', () => {
  const workspacePath = process.env.E2E_TEST_WORKSPACE || process.cwd();
  const remotionFixturePath = process.env.E2E_REMOTION_WORKSPACE
    || 'D:\\workspace\\Sparo_OS_WorkSpace\\Sparo_OS_Remotion\\Promotional_video\\sparo-os-promo';
  const realRemotionIt = fs.existsSync(remotionFixturePath) ? it : it.skip;

  before(async () => {
    await browser.pause(3000);
  });

  async function openLiveAppById(appId: string, targetWorkspacePath = workspacePath): Promise<void> {
    await browser.execute(async (id, path) => {
      const { openLiveApp } = await import('/src/app/scenes/apps/live-app/liveAppWorkbenchService.ts');
      await openLiveApp(id, {
        workspacePath: path,
        locale: 'en-US',
      });
    }, appId, targetWorkspacePath);
  }

  async function stopRemotionPreview(targetWorkspacePath: string): Promise<void> {
    await browser.execute(async (path) => {
      const { liveAppAPI } = await import('/src/infrastructure/api/service-api/LiveAppAPI.ts');
      try {
        await liveAppAPI.backendCall(
          'builtin-remotion-live',
          'remotionRuntime.stopPlayerPreviewHost',
          { workspacePath: path },
          { workspacePath: path },
        );
      } catch {
        // Cleanup is best-effort because this path may run after a failed launch attempt.
      }
    }, targetWorkspacePath);
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

  it('keeps standalone Live Apps on the standalone runner surface', async () => {
    await openLiveAppById('builtin-spark-board');

    const liveAppScene = await $('[data-testid="live-app-scene"]');
    await liveAppScene.waitForDisplayed({ timeout: 30000 });

    await browser.waitUntil(
      async () => browser.execute(() => Boolean(
        document.querySelector('iframe[data-app-id="builtin-spark-board"]'),
      )),
      {
        timeout: 30000,
        timeoutMsg: 'Spark Board standalone iframe did not render',
      },
    );

    expect(await liveAppScene.isDisplayed()).toBe(true);
  });

  it('opens composite Live Apps as FlowChat plus a profile-owned aux panel', async () => {
    await openLiveAppById('builtin-remotion-live');

    const sessionScene = await $('[data-testid="session-scene"]');
    await sessionScene.waitForDisplayed({ timeout: 30000 });

    const previewPanel = await $('[data-testid="live-app-runner-panel"][data-app-id="builtin-remotion-live"]');
    await previewPanel.waitForDisplayed({ timeout: 30000 });

    const chatInput = await $('[data-testid="chat-input-container"], .composer-shell');
    await chatInput.waitForDisplayed({ timeout: 30000 });

    const profile = await browser.execute(() => {
      const scene = document.querySelector('[data-testid="session-scene"]');
      return scene?.getAttribute('data-agent');
    });

    expect(profile).toBe('live-app-workbench');
    expect(await previewPanel.isDisplayed()).toBe(true);
    expect(await chatInput.isDisplayed()).toBe(true);
  });

  it('creates Remotion Live from the Work Dock as a Live App workbench, not a builder chat', async () => {
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

    const previewPanel = await $('[data-testid="live-app-runner-panel"][data-app-id="builtin-remotion-live"]');
    await previewPanel.waitForDisplayed({ timeout: 30000 });

    const profile = await browser.execute(() => {
      const scene = document.querySelector('[data-testid="session-scene"]');
      return scene?.getAttribute('data-agent');
    });
    const workRecord = await browser.execute(async () => {
      const { useWorkStore } = await import('/src/app/agentic-os/work/data/workStore.ts');
      const matches = useWorkStore.getState().works
        .filter(work =>
          work.primarySurface.kind === 'live_app' &&
          work.primarySurface.appId === 'builtin-remotion-live'
        )
        .sort((a, b) => b.createdAt - a.createdAt);
      const work = matches[0];
      return work
        ? {
            kind: work.kind,
            assignmentKind: work.assignment?.kind,
            primarySurfaceKind: work.primarySurface.kind,
            appId: work.primarySurface.appId,
          }
        : null;
    });

    expect(profile).toBe('live-app-workbench');
    expect(await previewPanel.isDisplayed()).toBe(true);
    expect(workRecord).toEqual({
      kind: 'app_workflow',
      assignmentKind: 'application',
      primarySurfaceKind: 'live_app',
      appId: 'builtin-remotion-live',
    });
  });

  realRemotionIt('starts a real Remotion Player preview runtime for the fixture project', async () => {
    await openLiveAppById('builtin-remotion-live', remotionFixturePath);

    try {
      const previewPanel = await $('[data-testid="live-app-runner-panel"][data-app-id="builtin-remotion-live"]');
      await previewPanel.waitForDisplayed({ timeout: 30000 });

      await browser.waitUntil(
        async () => browser.execute(async (path) => {
          const { liveAppAPI } = await import('/src/infrastructure/api/service-api/LiveAppAPI.ts');
          const result = await liveAppAPI.backendCall(
            'builtin-remotion-live',
            'remotionRuntime.getPlayerPreviewHostStatus',
            { workspacePath: path },
            { workspacePath: path },
          );
          const output = (result as any).bridgeResult?.output ?? (result as any).bridgeResult ?? result;
          return output?.ready && typeof output?.url === 'string' && output.url.startsWith('http://127.0.0.1:')
            ? output
            : null;
        }, remotionFixturePath),
        {
          timeout: 90000,
          interval: 1000,
          timeoutMsg: 'Remotion Player preview host did not become ready',
        },
      );

      const previewStatus = await browser.execute(async (path) => {
        const { liveAppAPI } = await import('/src/infrastructure/api/service-api/LiveAppAPI.ts');
        const result = await liveAppAPI.backendCall(
          'builtin-remotion-live',
          'remotionRuntime.getPlayerPreviewHostStatus',
          { workspacePath: path },
          { workspacePath: path },
        );
        return (result as any).bridgeResult?.output ?? (result as any).bridgeResult ?? result;
      }, remotionFixturePath);

      const compositionOptions = await browser.execute(async (path) => {
        const { liveAppAPI } = await import('/src/infrastructure/api/service-api/LiveAppAPI.ts');
        const result = await liveAppAPI.backendCall(
          'builtin-remotion-live',
          'remotionRuntime.compileProject',
          { workspacePath: path },
          { workspacePath: path },
        );
        const output = (result as any).bridgeResult?.output ?? (result as any).bridgeResult ?? result;
        const manifest = output?.manifest ?? output?.compositionManifest ?? output;
        return Array.from(manifest?.compositions ?? []).map((composition: any) => composition.id || '');
      }, remotionFixturePath);

      const playerUrl = (previewStatus as any).url as string;
      const playerResponse = await fetch(playerUrl);
      const playerHtml = await playerResponse.text();

      expect(playerUrl).toContain('http://127.0.0.1:');
      expect(playerResponse.ok).toBe(true);
      expect(playerHtml.toLowerCase()).toContain('remotion');
      expect(compositionOptions.join('|')).toContain('SparoOSPromo-16x9');
    } finally {
      await stopRemotionPreview(remotionFixturePath);
    }
  });
});
