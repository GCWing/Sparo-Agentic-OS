/**
 * L0 smoke spec: minimal critical checks that the app starts.
 * These tests must pass before any release - they verify basic app functionality.
 */

import { browser, expect, $ } from '@wdio/globals';

describe('L0 Smoke Tests', () => {
  describe('Application launch', () => {
    it('app window should open with title', async () => {
      await browser.pause(5000);
      const title = await browser.getTitle();
      console.log('[L0] App title:', title);
      expect(title).toBeDefined();
      expect(title.length).toBeGreaterThan(0);
    });

    it('document should be in ready state', async () => {
      const readyState = await browser.execute(() => document.readyState);
      expect(readyState).toBe('complete');
      console.log('[L0] Document ready state: complete');
    });
  });

  describe('DOM structure', () => {
    it('page should have body element', async () => {
      await browser.pause(1000);
      const body = await $('body');
      const exists = await body.isExisting();
      expect(exists).toBe(true);
      console.log('[L0] Body element exists');
    });

    it('should have root React element', async () => {
      const exists = await browser.execute(() => {
        const root = document.getElementById('root');
        return Boolean(root && root.childElementCount > 0);
      });

      if (exists) {
        console.log('[L0] Found hydrated #root element');
        expect(exists).toBe(true);
      } else {
        const appExists = await browser.execute(() => Boolean(
          document.querySelector('[data-testid="app-layout"], .sparo-app-layout, main[data-testid="app-main-content"]')
        ));
        console.log('[L0] app shell exists:', appExists);
        expect(appExists).toBe(true);
      }
    });

    it('should have non-trivial DOM tree', async () => {
      const elementCount = await browser.execute(() => {
        return document.querySelectorAll('*').length;
      });
      
      expect(elementCount).toBeGreaterThan(10);
      console.log('[L0] DOM element count:', elementCount);
    });
  });

  describe('Core UI components', () => {
    it('Header should be visible', async () => {
      await browser.pause(2000);
      const header = await $('.sparo-nav-panel, .sparo-scene-bar, .sparo-nav-bar, [data-testid="header-container"]');
      const exists = await header.isExisting();

      if (exists) {
        console.log('[L0] Header found via data-testid');
        expect(exists).toBe(true);
      } else {
        console.log('[L0] Checking fallback selectors...');
        const selectors = [
          '.sparo-nav-panel',
          '.sparo-scene-bar',
          '.sparo-nav-bar',
          'header',
          '.header',
          '[class*="header"]',
          '[class*="Header"]'
        ];

        let found = false;
        for (const selector of selectors) {
          const element = await $(selector);
          const fallbackExists = await element.isExisting();
          if (fallbackExists) {
            console.log(`[L0] Header found: ${selector}`);
            found = true;
            break;
          }
        }

        if (!found) {
          const html = await $('body').getHTML();
          console.log('[L0] Body HTML snippet:', html.substring(0, 500));
          console.error('[L0] CRITICAL: Header not found - frontend may not be loaded');
        }
        
        expect(found).toBe(true);
      }
    });

    it('should have either startup page or workspace UI', async () => {
      // Check for workspace UI (chat input indicates workspace is open)
      const chatExists = await browser.execute(() => Boolean(
        document.querySelector('[data-testid="chat-input-container"], .composer-shell, .flow-chat-container')
      ));

      if (chatExists) {
        console.log('[L0] Workspace UI visible');
        expect(chatExists).toBe(true);
        return;
      }

      // Check for welcome/startup scene with multiple selectors
      const welcomeSelectors = [
        '.welcome-scene--first-time',
        '.welcome-scene',
        '.sparo-scene-viewport--welcome',
      ];

      let welcomeExists = await browser.execute((selectors) => {
        return selectors.some(selector => Boolean(document.querySelector(selector)));
      }, welcomeSelectors);

      if (!welcomeExists) {
        // Fallback: check for scene viewport
        welcomeExists = await browser.execute(() => Boolean(
          document.querySelector('.sparo-scene-viewport, .sparo-app-main-workspace, main[data-testid="app-main-content"]')
        ));
        console.log('[L0] Fallback check - app workspace shell exists:', welcomeExists);
      }

      if (!welcomeExists && !chatExists) {
        console.error('[L0] CRITICAL: Neither welcome nor workspace UI found');
      }

      expect(welcomeExists || chatExists).toBe(true);
    });
  });

  describe('No critical errors', () => {
    it('should not have JavaScript errors', async () => {
      const logs = await browser.getLogs('browser');
      const errors = logs.filter(log => log.level === 'SEVERE');
      
      if (errors.length > 0) {
        console.error('[L0] Console errors detected:', errors.length);
        errors.slice(0, 3).forEach(err => {
          console.error('[L0] Error:', err.message);
        });
      } else {
        console.log('[L0] No JavaScript errors');
      }
      
      expect(errors.length).toBe(0);
    });

    it('viewport should have valid dimensions', async () => {
      const dimensions = await browser.execute(() => {
        return {
          width: window.innerWidth,
          height: window.innerHeight,
        };
      });
      
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
      console.log('[L0] Viewport dimensions:', dimensions);
    });
  });
});
