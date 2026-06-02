import { browser, expect, $ } from '@wdio/globals';
import { openWorkspace } from '../helpers/workspace-helper';
import { saveStepScreenshot } from '../helpers/screenshot-utils';

type SettingsTab =
  | 'appearance'
  | 'basics'
  | 'models'
  | 'aiUsage'
  | 'dataStorage'
  | 'personalization'
  | 'permissions'
  | 'editor'
  | 'keyboard'
  | 'memory';

const SETTINGS_TABS: SettingsTab[] = [
  'basics',
  'appearance',
  'models',
  'keyboard',
  'personalization',
  'permissions',
  'memory',
  'editor',
  'aiUsage',
  'dataStorage',
];

interface RectMetrics {
  width: number;
  height: number;
  left: number;
  right: number;
}

async function openSettingsTab(tab: SettingsTab): Promise<void> {
  await browser.execute(async (targetTab: SettingsTab) => {
    const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
    const { useSettingsStore } = await import('/src/app/scenes/settings/settingsStore.ts');

    useSettingsStore.getState().setActiveTab(targetTab);
    openWorkspaceScene('settings');
  }, tab);

  await browser.waitUntil(async () => {
    const scene = await $('.sparo-settings-scene');
    return scene.isExisting();
  }, {
    timeout: 15000,
    interval: 250,
    timeoutMsg: `Settings scene did not open for tab ${tab}`,
  });

  await browser.waitUntil(async () => {
    const title = await $('.sparo-config-page-header__title');
    return title.isExisting();
  }, {
    timeout: 15000,
    interval: 250,
    timeoutMsg: `Settings tab ${tab} did not render a page title`,
  });

  await browser.waitUntil(async () => {
    const loading = await $('.sparo-config-page-loading');
    return !(await loading.isExisting());
  }, {
    timeout: 20000,
    interval: 250,
    timeoutMsg: `Settings tab ${tab} stayed in loading state`,
  });

  await browser.pause(300);
}

describe('Settings UI layout', () => {
  before(async () => {
    await browser.pause(1500);
    expect(await openWorkspace()).toBe(true);
  });

  it('keeps the appearance theme preview compact inside the form row', async () => {
    await openSettingsTab('appearance');

    await browser.waitUntil(async () => {
      const preview = await $('.theme-config__selected-preview');
      return preview.isExisting();
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Selected theme preview did not render',
    });

    const metrics = await browser.execute(() => {
      function rect(selector: string): RectMetrics | null {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
        };
      }

      const preview = rect('.theme-config__selected-preview');
      const picker = rect('.theme-config__theme-picker');
      const nestedFullPreviewCount = document.querySelectorAll(
        '.theme-config__selected-preview .theme-preview-thumbnail'
      ).length;

      return { preview, picker, nestedFullPreviewCount };
    });

    expect(metrics.preview).not.toBeNull();
    expect(metrics.picker).not.toBeNull();
    expect(metrics.nestedFullPreviewCount).toBe(1);
    expect(metrics.preview!.height).toBeGreaterThanOrEqual(120);
    expect(metrics.preview!.height).toBeLessThanOrEqual(190);
    expect(metrics.preview!.width).toBeLessThanOrEqual(metrics.picker!.width);
    expect(metrics.preview!.left).toBeGreaterThanOrEqual(metrics.picker!.left - 1);
    expect(metrics.preview!.right).toBeLessThanOrEqual(metrics.picker!.right + 1);

    await saveStepScreenshot('settings-appearance-theme-preview-compact');
  });

  it('keeps advanced model connection details collapsed by default', async () => {
    await openSettingsTab('models');

    await browser.waitUntil(async () => {
      const section = await $('.ai-model-config__advanced-connection-summary');
      return section.isExisting();
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Advanced connection summary did not render',
    });

    const expandedGroups = await browser.$$('.ai-model-config__advanced-connection-group');
    expect(expandedGroups.length).toBe(0);

    await saveStepScreenshot('settings-models-advanced-connection-collapsed');
  });

  it('keeps expanded advanced model connection spacing aligned with settings rows', async () => {
    await openSettingsTab('models');

    const toggle = await $('.ai-model-config__advanced-connection-section .sparo-config-page-section__extra button');
    await toggle.click();

    await browser.waitUntil(async () => {
      const groups = await browser.$$('.ai-model-config__advanced-connection-group');
      return groups.length >= 2;
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Advanced connection details did not expand',
    });

    const metrics = await browser.execute(() => {
      const section = document.querySelector('.ai-model-config__advanced-connection-section');
      const body = section?.querySelector('.sparo-config-page-section__body');
      const title = section?.querySelector('.ai-model-config__advanced-connection-title');
      const row = section?.querySelector('.sparo-config-page-row');
      if (!body || !title || !row) {
        return { titleLeft: 0, rowLeft: 1, rowTop: 0, titleBottom: 0 };
      }

      const titleRect = title.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();

      return {
        titleLeft: Math.round(titleRect.left),
        rowLeft: Math.round(rowRect.left),
        rowTop: Math.round(rowRect.top),
        titleBottom: Math.round(titleRect.bottom),
      };
    });

    expect(Math.abs(metrics.titleLeft - metrics.rowLeft)).toBeLessThanOrEqual(1);
    expect(metrics.rowTop - metrics.titleBottom).toBeGreaterThanOrEqual(0);
    expect(metrics.rowTop - metrics.titleBottom).toBeLessThanOrEqual(12);

    await saveStepScreenshot('settings-models-advanced-connection-expanded');
  });

  it('keeps every settings tab within the content viewport', async () => {
    for (const tab of SETTINGS_TABS) {
      await openSettingsTab(tab);

      const overflow = await browser.execute(() => {
        const content = document.querySelector('.sparo-settings-scene__content');
        const wrapper = document.querySelector('.sparo-settings-scene__content-wrapper');
        const title = document.querySelector('.sparo-config-page-header__title');
        const contentInner = document.querySelector('.sparo-config-page-content__inner');
        if (!content || !wrapper) {
          return { contentOverflow: 0, wrapperOverflow: 0, hasTitle: false, hasBody: false };
        }

        return {
          contentOverflow: content.scrollWidth - content.clientWidth,
          wrapperOverflow: wrapper.scrollWidth - wrapper.clientWidth,
          hasTitle: Boolean(title?.textContent?.trim()),
          hasBody: Boolean(contentInner?.textContent?.trim()),
        };
      });

      expect(overflow.contentOverflow).toBeLessThanOrEqual(1);
      expect(overflow.wrapperOverflow).toBeLessThanOrEqual(1);
      expect(overflow.hasTitle).toBe(true);
      expect(overflow.hasBody).toBe(true);

      await saveStepScreenshot(`settings-tab-${tab}-layout`);
    }
  });
});
