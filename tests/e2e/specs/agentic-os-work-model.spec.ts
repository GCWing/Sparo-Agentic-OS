/**
 * Agentic OS Work model spec: verifies the Work Dock keeps the original compact
 * navigation affordance while opening the refactored Work Center surface.
 */

import { browser, expect, $ } from '@wdio/globals';
import { Header } from '../page-objects/components/Header';
import { StartupPage } from '../page-objects/StartupPage';
import { ensureWorkspaceOpen } from '../helpers/workspace-utils';

describe('Agentic OS Work model', () => {
  let header: Header;
  let startupPage: StartupPage;
  let hasWorkspace = false;

  before(async () => {
    console.log('[WorkModel] Starting Work model E2E spec');
    header = new Header();
    startupPage = new StartupPage();

    await browser.pause(3000);
    await header.waitForLoad();
    hasWorkspace = await ensureWorkspaceOpen(startupPage);
  });

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

  it('opens the Work Dock using the available navigation affordance', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    await ensureWorkDockExpanded();

    const newWork = await $('[data-testid="work-dock-new-work"]');
    const openCenter = await $('[data-testid="work-dock-open-center"]');
    await newWork.waitForExist({ timeout: 15000 });
    await openCenter.waitForExist({ timeout: 15000 });
    expect(await newWork.isExisting()).toBe(true);
    expect(await openCenter.isExisting()).toBe(true);
  });

  it('opens the Work Center surface from the dock', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    await ensureWorkDockExpanded();

    const openCenter = await $('[data-testid="work-dock-open-center"]');
    await openCenter.waitForClickable({ timeout: 15000 });
    await openCenter.click();

    const workCenter = await $('[data-testid="work-center-scene"]');
    await workCenter.waitForDisplayed({ timeout: 15000 });
    expect(await workCenter.isDisplayed()).toBe(true);
  });
});
