import fs from 'node:fs';
import { browser, expect, $ } from '@wdio/globals';

import { callProductAppRuntimeBackend } from '../helpers/product-app-runtime-helper';

describe('HarmonyOS Dev Product App runtime', () => {
  const workspacePath = process.env.E2E_TEST_WORKSPACE || process.cwd();
  const harmonyFixturePath = process.env.E2E_HARMONY_WORKSPACE || 'D:\\workspace\\bitfun_harmony';
  const realHarmonyIt = fs.existsSync(harmonyFixturePath) ? it : it.skip;
  const buildIt = fs.existsSync(harmonyFixturePath) && process.env.E2E_HARMONY_RUN_BUILD === '1' ? it : it.skip;

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

  async function ensureHarmonyProductAppRuntimeHost(): Promise<string> {
    await openProductAppById('builtin-harmony-dev', harmonyFixturePath);
    const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-harmony-dev"]');
    await previewPanel.waitForDisplayed({ timeout: 30000 });
    const hostId = await previewPanel.getAttribute('data-app-id');
    if (!hostId) {
      throw new Error('Harmony Dev Product App runtime host not found');
    }
    return hostId;
  }

  async function callHarmonyRuntime(action: string, input: Record<string, unknown> = {}): Promise<any> {
    await ensureHarmonyProductAppRuntimeHost();
    const result = await callProductAppRuntimeBackend(
      'builtin-harmony-dev',
      `harmonyRuntime.${action}`,
      { workspacePath: harmonyFixturePath, ...input },
      harmonyFixturePath,
    );
    return (result as any).bridgeResult?.output ?? (result as any).bridgeResult ?? result;
  }

  realHarmonyIt('opens as FlowChat plus a Product App runtime-owned HarmonyOS preview tab', async () => {
    await openProductAppById('builtin-harmony-dev', harmonyFixturePath);

    const sessionScene = await $('[data-testid="session-scene"]');
    await sessionScene.waitForDisplayed({ timeout: 30000 });

    const previewPanel = await $('[data-testid="product-app-runtime-panel"][data-product-app-id="builtin-harmony-dev"]');
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

  realHarmonyIt('detects the real bitfun_harmony project without leaking signing secrets', async () => {
    const output = await callHarmonyRuntime('detectProject');
    const serialized = JSON.stringify(output);

    expect(output.ok).toBe(true);
    expect(output.project.kind).toBe('harmonyos');
    expect(output.project.bundleName).toBe('com.example.bitfun_mobile');
    expect(output.project.modules[0].mainElement).toBe('EntryAbility');
    expect(output.project.signing.redacted).toBe(true);
    expect(serialized).not.toContain('keyPassword');
    expect(serialized).not.toContain('storePassword');
    expect(serialized).not.toContain('0000001B');
  });

  realHarmonyIt('reports DevEco toolchain, emulator candidates, and the current HDC target gate', async () => {
    const toolchain = await callHarmonyRuntime('detectToolchain');
    const targets = await callHarmonyRuntime('listTargets');
    const emulators = await callHarmonyRuntime('listEmulators');

    expect(toolchain.toolchain.hvigorw.available).toBe(true);
    expect(toolchain.toolchain.hdc.available).toBe(true);
    expect(toolchain.toolchain.java.available).toBe(true);
    expect(Array.isArray(targets.targets)).toBe(true);
    expect(Array.isArray(emulators.emulators)).toBe(true);
    expect(emulators.recommendedEmulator?.isPublic).toBe(true);
    expect(String(emulators.recommendedEmulator?.apiVersion || '')).toContain('24');
  });

  buildIt('can run the heavy HarmonyOS assemble pipeline when explicitly enabled', async () => {
    const output = await callHarmonyRuntime('buildProject', { includeTests: false, timeoutMs: 300000 });

    expect(output.ok).toBe(true);
    expect(output.artifact?.path || output.runtimeState?.latestArtifact?.path).toMatch(/\.(app|hap)$/);
  });
});
