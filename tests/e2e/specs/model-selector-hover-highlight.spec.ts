import { browser, expect, $, $$ } from '@wdio/globals';
import { ensureBitFunCoderSessionOpen, openWorkspace } from '../helpers/workspace-helper';
import { saveElementScreenshot } from '../helpers/screenshot-utils';

describe('Model selector hover highlight', () => {
  it('uses a single fast moving hover surface in the chat input model menu', async () => {
    const hasWorkspace = await openWorkspace();
    expect(hasWorkspace).toBe(true);

    await browser.execute(async () => {
      const { configManager } = await import('/src/infrastructure/config/services/ConfigManager.ts');
      await configManager.setConfig('ai.models', [
        {
          id: 'e2e-primary-model',
          name: 'E2E Primary',
          provider: 'openai',
          model_name: 'gpt-e2e-primary',
          enabled: true,
          capabilities: ['text_chat'],
          context_window: 128000,
        },
        {
          id: 'e2e-fast-model',
          name: 'E2E Fast',
          provider: 'openai',
          model_name: 'gpt-e2e-fast',
          enabled: true,
          capabilities: ['text_chat'],
          context_window: 32000,
        },
        {
          id: 'e2e-hover-model',
          name: 'E2E Hover',
          provider: 'openai',
          model_name: 'gpt-e2e-hover',
          enabled: true,
          capabilities: ['text_chat'],
          context_window: 64000,
        },
      ]);
      await configManager.setConfig('ai.default_models', {
        primary: 'e2e-primary-model',
        fast: 'e2e-fast-model',
      });
      await configManager.setConfig('ai.agent_models', {
        code: 'primary',
      });
    });

    await ensureBitFunCoderSessionOpen();

    const trigger = await $('.sparo-model-selector__trigger');
    await trigger.waitForDisplayed({ timeout: 15000 });
    await trigger.click();

    const dropdown = await $('.sparo-model-selector__dropdown');
    await dropdown.waitForDisplayed({ timeout: 5000 });

    const options = await $$('.sparo-model-selector__option');
    expect(options.length).toBeGreaterThanOrEqual(3);

    await options[0].moveTo({ xOffset: 24, yOffset: 12 });
    await browser.execute(() => {
      const option = document.querySelectorAll('.sparo-model-selector__option')[0] as HTMLElement | undefined;
      option?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      option?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      option?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      option?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await browser.pause(80);
    await options[2].moveTo({ xOffset: 24, yOffset: 12 });
    await browser.execute(() => {
      const option = document.querySelectorAll('.sparo-model-selector__option')[2] as HTMLElement | undefined;
      option?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      option?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      option?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      option?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await browser.pause(130);

    const highlightState = await browser.execute(() => {
      const dropdownElement = document.querySelector('.sparo-model-selector__dropdown');
      const highlight = document.querySelector('.sparo-model-selector__hover-highlight');
      const optionsElements = Array.from(document.querySelectorAll('.sparo-model-selector__option'));

      if (!dropdownElement || !highlight) {
        return {
          dropdownFound: Boolean(dropdownElement),
          highlightFound: Boolean(highlight),
          highlightCount: 0,
          visible: false,
          optionBackgrounds: [],
          beforeContent: '',
          afterContent: '',
        };
      }

      const highlightStyle = window.getComputedStyle(highlight);
      const optionBackgrounds = optionsElements.map(option => window.getComputedStyle(option).backgroundColor);

      return {
        dropdownFound: true,
        highlightFound: true,
        highlightCount: document.querySelectorAll('.sparo-model-selector__hover-highlight').length,
        visible: highlightStyle.opacity !== '0',
        optionBackgrounds,
        beforeContent: window.getComputedStyle(highlight, '::before').content,
        afterContent: window.getComputedStyle(highlight, '::after').content,
      };
    });

    expect(highlightState.dropdownFound).toBe(true);
    expect(highlightState.highlightFound).toBe(true);
    expect(highlightState.highlightCount).toBe(1);
    expect(highlightState.visible).toBe(true);
    expect(highlightState.beforeContent === 'none' || highlightState.beforeContent === '').toBe(true);
    expect(highlightState.afterContent === 'none' || highlightState.afterContent === '').toBe(true);
    expect(highlightState.optionBackgrounds.every(background => background === 'rgba(0, 0, 0, 0)')).toBe(true);

    await saveElementScreenshot('.sparo-model-selector__dropdown', 'model-selector-hover-highlight');
  });
});
