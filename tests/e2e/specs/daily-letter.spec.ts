import { browser, expect, $ } from '@wdio/globals';
import { openWorkspace } from '../helpers/workspace-helper';

describe('Daily Letter scene', () => {
  before(async () => {
    const opened = await openWorkspace();
    expect(opened).toBe(true);
  });

  it('opens from the lower-left menu and keeps the rail letter-based', async () => {
    const trigger = await $('[data-testid="workspace-footer-more-button"]');
    await trigger.waitForClickable({ timeout: 10000 });
    await trigger.click();
    await browser.pause(500);

    const dailyLetterButton = await $('[data-testid="workspace-footer-daily-letter-button"]');
    await dailyLetterButton.waitForClickable({ timeout: 10000 });
    await dailyLetterButton.moveTo();
    await dailyLetterButton.click();

    const scene = await $('[data-testid="daily-letter-scene"]');
    await scene.waitForDisplayed({ timeout: 15000 });
    expect(await scene.isDisplayed()).toBe(true);

    const rail = await $('.dl-rail');
    await rail.waitForDisplayed({ timeout: 10000 });
    const railText = await rail.getText();

    expect(railText.includes('今天') || railText.includes('Today')).toBe(true);
    expect(railText.includes('全部来信') || railText.includes('All letters')).toBe(true);
    expect(railText).not.toContain('等你回执');
    expect(railText).not.toContain('明日线索');
    expect(railText).not.toContain('For your receipt');
    expect(railText).not.toContain('Tomorrow cues');
  });

  it('shows the current letter board or an empty one-letter state', async () => {
    const board = await $('.dl-board');
    await board.waitForDisplayed({ timeout: 10000 });

    const hasLetter = await $('.dl-letter').isExisting();
    const hasEmptyState = await $('.dl-empty').isExisting();
    expect(hasLetter || hasEmptyState).toBe(true);
  });
});
