/**
 * L1 FlowChat scroll spec.
 *
 * Exercises the real FlowChat/Virtuoso surface without depending on an AI
 * provider: the test injects a streaming session into the frontend stores and
 * then verifies scroll behavior around sticky latest output, expandable tool
 * cards, user history scroll, and jump-to-latest.
 */

import { browser, expect, $ } from '@wdio/globals';
import { Header } from '../page-objects/components/Header';
import { StartupPage } from '../page-objects/StartupPage';
import { ensureWorkspaceOpen } from '../helpers/workspace-utils';
import { ensureCodeSessionOpen } from '../helpers/workspace-helper';

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
}

const header = new Header();
const startupPage = new StartupPage();

async function injectStreamingScrollFixture(): Promise<string> {
  return browser.execute(async () => {
    const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
    const { useModernFlowChatStore } = await import('/src/flow_chat/store/modernFlowChatStore.ts');

    const now = Date.now();
    const sessionId = `e2e-flow-scroll-${now}`;
    const makeText = (label: string, repeat = 18) =>
      Array.from({ length: repeat }, (_, index) =>
        `${label} paragraph ${index + 1}: FlowChat scroll stability content for virtualized history reading.`
      ).join('\n\n');

    const dialogTurns = Array.from({ length: 12 }, (_, index) => {
      const turnId = `e2e-turn-${index + 1}`;
      const isLatest = index === 11;
      const baseTime = now + index * 1000;
      const items: any[] = [
        {
          id: `${turnId}-text-a`,
          type: 'text',
          timestamp: baseTime + 10,
          status: isLatest ? 'streaming' : 'completed',
          content: makeText(isLatest ? 'Streaming latest answer' : `Historical answer ${index + 1}`, isLatest ? 24 : 10),
          isStreaming: isLatest,
          isMarkdown: true,
        },
      ];

      if (isLatest) {
        items.push({
          id: 'e2e-scroll-tool',
          type: 'tool',
          timestamp: baseTime + 20,
          status: 'completed',
          toolName: 'E2EScrollProbe',
          toolCall: {
            id: 'e2e-scroll-tool-call',
            input: {
              operation: 'scroll-probe',
              target: 'FlowChat scroll fixture',
              note: 'This intentionally creates expandable detail content.',
            },
          },
          toolResult: {
            success: true,
            result: {
              summary: 'Expandable FlowChat scroll probe result',
              details: Array.from({ length: 36 }, (_, row) => ({
                row: row + 1,
                value: `expanded detail row ${row + 1}`,
              })),
            },
          },
          startTime: baseTime + 20,
          endTime: baseTime + 30,
        });
      }

      return {
        id: turnId,
        sessionId,
        userMessage: {
          id: `${turnId}-user`,
          content: isLatest
            ? 'Latest streaming turn that should pin near the top while output grows'
            : `Historical turn ${index + 1} ${makeText('user history', 2)}`,
          timestamp: baseTime,
        },
        modelRounds: [
          {
            id: `${turnId}-round-1`,
            index: 0,
            items,
            isStreaming: isLatest,
            isComplete: !isLatest,
            status: isLatest ? 'streaming' : 'completed',
            startTime: baseTime + 5,
            endTime: isLatest ? undefined : baseTime + 900,
          },
        ],
        status: isLatest ? 'processing' : 'completed',
        startTime: baseTime,
        endTime: isLatest ? undefined : baseTime + 900,
      };
    });

    const session: any = {
      sessionId,
      title: 'E2E FlowChat Scroll',
      titleStatus: 'generated',
      dialogTurns,
      status: 'processing',
      config: {
        maxContextTokens: 128128,
        autoCompact: true,
        enableTools: true,
        workspaceId: 'e2e-workspace',
      },
      createdAt: now,
      lastActiveAt: now,
      lastFinishedAt: undefined,
      error: null,
      maxContextTokens: 128128,
      mode: 'agentic',
      workspacePath: undefined,
      workspaceId: 'e2e-workspace',
      storageScope: 'workspace',
      parentSessionId: undefined,
      sessionKind: 'normal',
      btwThreads: [],
      btwOrigin: undefined,
      isTransient: true,
    };

    flowChatStore.setState((previous: any) => {
      const sessions = new Map(previous.sessions);
      sessions.set(sessionId, session);
      return {
        ...previous,
        sessions,
        activeSessionId: sessionId,
      };
    });
    useModernFlowChatStore.getState().setActiveSession(session);

    return sessionId;
  });
}

async function waitForFlowScroller(): Promise<void> {
  await browser.waitUntil(async () => {
    return browser.execute(() => {
      const root = document.querySelector('.virtual-message-list');
      if (!root) return false;
      const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
      return elements.some((element) => {
        const style = window.getComputedStyle(element);
        return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
      });
    });
  }, {
    timeout: 20000,
    interval: 250,
    timeoutMsg: 'FlowChat Virtuoso scroller did not become scrollable',
  });
}

async function getScrollMetrics(): Promise<ScrollMetrics> {
  return browser.execute(() => {
    const root = document.querySelector('.virtual-message-list');
    if (!root) {
      throw new Error('Missing .virtual-message-list');
    }

    const scroller = Array.from(root.querySelectorAll<HTMLElement>('*')).find((element) => {
      const style = window.getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    });
    if (!scroller) {
      throw new Error('Missing FlowChat scroller');
    }

    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      distanceFromBottom: Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
    };
  });
}

async function scrollFlowBy(deltaY: number): Promise<void> {
  await browser.execute((amount: number) => {
    const root = document.querySelector('.virtual-message-list');
    const scroller = root
      ? Array.from(root.querySelectorAll<HTMLElement>('*')).find((element) => {
          const style = window.getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
        })
      : null;
    if (!scroller) {
      throw new Error('Missing FlowChat scroller');
    }

    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight, scroller.scrollTop + amount));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: amount, bubbles: true, cancelable: true }));
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, deltaY);
}

async function getLatestTurnTopDelta(): Promise<number> {
  return browser.execute(() => {
    const scrollerRoot = document.querySelector('.virtual-message-list');
    const latest = document.querySelector<HTMLElement>('.virtual-item-wrapper[data-turn-id="e2e-turn-12"][data-item-type="user-message"]');
    const scroller = scrollerRoot
      ? Array.from(scrollerRoot.querySelectorAll<HTMLElement>('*')).find((element) => {
          const style = window.getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
        })
      : null;
    if (!latest || !scroller) return Number.POSITIVE_INFINITY;
    return Math.abs(latest.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
  });
}

describe('L1 FlowChat scroll interactions', () => {
  let hasWorkspace = false;

  before(async () => {
    await browser.pause(3000);
    await header.waitForLoad();
    hasWorkspace = await ensureWorkspaceOpen(startupPage);
    if (hasWorkspace) {
      await ensureCodeSessionOpen();
    }
  });

  it('keeps streaming latest output stable across card disclosure, user scroll, and jump-to-latest', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    const sessionId = await injectStreamingScrollFixture();
    await waitForFlowScroller();

    await browser.waitUntil(async () => {
      const latestUser = await $(`.virtual-item-wrapper[data-turn-id="e2e-turn-12"][data-item-type="user-message"]`);
      return latestUser.isExisting();
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Latest streaming user turn did not render',
    });

    const toolCard = await $('[data-tool-card-id="e2e-scroll-tool"] .base-tool-card, [data-tool-card-id="e2e-scroll-tool"] .compact-tool-card');
    await toolCard.waitForExist({ timeout: 10000 });
    await toolCard.click();

    await browser.waitUntil(async () => {
      const expanded = await $('[data-tool-card-id="e2e-scroll-tool"] .base-tool-card-expanded, [data-tool-card-id="e2e-scroll-tool"] .compact-tool-card-expanded');
      return expanded.isExisting();
    }, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Expandable tool card did not open',
    });

    const afterExpand = await getScrollMetrics();
    const latestDeltaAfterExpand = await getLatestTurnTopDelta();
    expect(afterExpand.distanceFromBottom).toBeLessThan(240);
    expect(latestDeltaAfterExpand).toBeLessThan(360);

    await $('[data-tool-card-id="e2e-scroll-tool"] .base-tool-card, [data-tool-card-id="e2e-scroll-tool"] .compact-tool-card').click();
    await browser.waitUntil(async () => {
      const expanded = await $('[data-tool-card-id="e2e-scroll-tool"] .base-tool-card-expanded, [data-tool-card-id="e2e-scroll-tool"] .compact-tool-card-expanded');
      return !(await expanded.isExisting());
    }, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Expandable tool card did not close',
    });

    const afterCollapse = await getScrollMetrics();
    const latestDeltaAfterCollapse = await getLatestTurnTopDelta();
    expect(afterCollapse.distanceFromBottom).toBeLessThan(240);
    expect(latestDeltaAfterCollapse).toBeLessThan(360);

    await scrollFlowBy(-500);
    await browser.waitUntil(async () => {
      const bar = await $('.scroll-to-latest-bar .scroll-to-latest-bar__control');
      return bar.isExisting();
    }, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: 'Scroll-to-latest bar did not appear after user history scroll',
    });

    await $('.scroll-to-latest-bar .scroll-to-latest-bar__control').click();
    await browser.waitUntil(async () => {
      const metrics = await getScrollMetrics();
      const latestUserTopDelta = await getLatestTurnTopDelta();
      return metrics.distanceFromBottom < 180 || latestUserTopDelta < 120;
    }, {
      timeout: 8000,
      interval: 150,
      timeoutMsg: 'Jump-to-latest did not return to latest streaming region',
    });

    expect(sessionId).toContain('e2e-flow-scroll-');
  });
});
