/**
 * L1 Subagent detail panel scroll spec.
 *
 * Injects a parent session containing a Task tool with executionProjection
 * into the FlowChat store, clicks the "Open details in panel" button on the
 * Task tool card to open the right-side TaskDetailPanel, and then verifies:
 *  - .task-detail-panel renders with scrollable content
 *  - data-virtuoso-scroller is scrollable (scrollHeight > clientHeight)
 *  - scrollBy + distanceFromBottom verification
 *  - scroll-to-latest button returns to bottom
 *  - top-to-bottom traversal confirms all content reachable
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

/**
 * Inject a session with a Task tool item that carries a full
 * executionProjection of subagent items, then make it active so the
 * Task tool card renders in the flow chat.
 */
async function injectSubagentFixture(): Promise<string> {
  return browser.execute(async () => {
    const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
    const { useModernFlowChatStore } = await import('/src/flow_chat/store/modernFlowChatStore.ts');
    const { descriptorFromAgentType, getBackendAgentType } = await import('/src/flow_chat/domain/sessionDescriptor.ts');

    const now = Date.now();
    const sessionId = 'e2e-subdetail-scroll-' + now;
    const descriptor = descriptorFromAgentType('agentic');
    const taskToolId = 'e2e-subdetail-task-tool';

    const projItems: any[] = [];
    for (let i = 1; i <= 5; i++) {
      projItems.push({
        id: 'sub-thinking-' + i,
        type: 'thinking',
        content: Array.from(
          { length: 8 },
          (_: any, k: number) =>
            'Subagent reasoning block ' + i + ' paragraph ' + (k + 1) + ': model thinking content for scroll testing.'
        ).join('\n\n'),
        isStreaming: false,
        isCollapsed: i > 1,
        timestamp: now + i * 100,
        status: 'completed',
      });
    }
    for (let i = 1; i <= 30; i++) {
      projItems.push({
        id: 'sub-text-' + i,
        type: 'text',
        content: Array.from(
          { length: 5 },
          (_: any, k: number) =>
            'Subagent output block ' + i + ', paragraph ' + (k + 1) + ': long content for TaskDetailPanel Virtuoso scrolling.'
        ).join('\n\n'),
        isStreaming: false,
        isMarkdown: true,
        timestamp: now + 2000 + i * 200,
        status: 'completed',
      });
    }
    projItems.push({
      id: 'sub-tool-write',
      type: 'tool',
      toolName: 'Write',
      toolCall: { id: 'sub-tool-write-call', input: { filePath: '/src/result.ts' } },
      toolResult: { success: true, result: { path: '/src/result.ts' } },
      timestamp: now + 8000,
      status: 'completed',
    });

    const execProj: any = {
      id: 'parent-session:' + taskToolId,
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: sessionId,
      parentTurnId: 'e2e-subdetail-turn',
      parentToolId: taskToolId,
      childSessionId: 'child-' + taskToolId,
      items: projItems,
      summary: {
        status: 'completed',
        latestLabel: 'Write done',
        latestToolName: 'Write',
        updatedAt: now + 30000,
      },
      createdAt: now,
      updatedAt: now + 30000,
    };

    const taskToolItem: any = {
      id: taskToolId,
      type: 'tool',
      toolName: 'Task',
      toolCall: {
        id: taskToolId,
        input: {
          description: 'Explore codebase for scroll testing',
          prompt: 'Please search the entire project for relevant patterns and produce a detailed report covering every file found.',
          subagent_type: 'Explore',
        },
      },
      toolResult: {
        success: true,
        result: { summary: 'Task completed successfully', duration: 12500 },
      },
      timestamp: now + 1000,
      status: 'completed',
      executionProjection: execProj,
    };

    const makeText = (label: string, repeat: number) =>
      Array.from({ length: repeat }, (_: any, i: number) => label + ' line ' + (i + 1)).join('\n');

    const session: any = {
      sessionId,
      title: 'E2E Subagent Detail Scroll',
      titleStatus: 'generated',
      dialogTurns: [
        {
          id: 'e2e-subdetail-turn',
          sessionId,
          userMessage: {
            id: 'e2e-subdetail-turn-user',
            content: makeText('User prompt for subagent test', 4),
            timestamp: now,
          },
          modelRounds: [
            {
              id: 'e2e-subdetail-turn-round-1',
              index: 0,
              items: [taskToolItem],
              isStreaming: false,
              isComplete: true,
              status: 'completed',
              startTime: now + 500,
              endTime: now + 30000,
            },
          ],
          status: 'completed',
          startTime: now,
          endTime: now + 30000,
        },
      ],
      status: 'completed',
      config: {
        agentType: getBackendAgentType(descriptor),
        maxContextTokens: 128128,
        autoCompact: true,
        enableTools: true,
        workspaceId: 'e2e-workspace',
      },
      createdAt: now,
      lastActiveAt: now,
      lastFinishedAt: now + 30000,
      error: null,
      maxContextTokens: 128128,
      descriptor,
      workspacePath: undefined,
      workspaceId: 'e2e-workspace',
      storageScope: 'workspace',
      parentSessionId: undefined,
      sessionKind: 'normal',
      btwThreads: [],
      btwOrigin: undefined,
      isTransient: true,
    };

    flowChatStore.setState((prev: any) => {
      const sessions = new Map(prev.sessions);
      sessions.set(sessionId, session);
      return { ...prev, sessions, activeSessionId: sessionId };
    });
    useModernFlowChatStore.getState().setActiveSession(session);

    return sessionId;
  });
}

async function injectLiveSubagentFixture(): Promise<{ sessionId: string; taskToolId: string }> {
  return browser.execute(async () => {
    const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
    const { useModernFlowChatStore } = await import('/src/flow_chat/store/modernFlowChatStore.ts');
    const { executionGraphStore } = await import('/src/flow_chat/execution/ExecutionGraphStore.ts');
    const { descriptorFromAgentType, getBackendAgentType } = await import('/src/flow_chat/domain/sessionDescriptor.ts');

    const now = Date.now();
    const sessionId = 'e2e-subdetail-live-scroll-' + now;
    const descriptor = descriptorFromAgentType('agentic');
    const taskToolId = 'e2e-subdetail-live-task-tool';
    const childSessionId = 'child-' + taskToolId;
    const parentTurnId = 'e2e-subdetail-live-turn';
    const makeText = (label: string, repeat: number) =>
      Array.from({ length: repeat }, (_: any, i: number) => label + ' line ' + (i + 1)).join('\n\n');

    const liveItems: any[] = [];
    for (let i = 1; i <= 18; i++) {
      liveItems.push({
        id: 'live-sub-text-' + i,
        type: 'text',
        content: makeText('Live subagent markdown block ' + i, 5),
        isStreaming: false,
        isMarkdown: true,
        timestamp: now + i * 100,
        status: 'completed',
      });
      liveItems.push({
        id: 'live-sub-tool-' + i,
        type: 'tool',
        toolName: i % 2 === 0 ? 'Read' : 'Grep',
        toolCall: {
          id: 'live-sub-tool-call-' + i,
          input: {
            file_path: '/src/example-' + i + '.ts',
            pattern: 'scroll-stability-' + i,
          },
        },
        toolResult: {
          success: true,
          result: {
            summary: 'Initial tool result ' + i,
            rows: Array.from({ length: 4 }, (_: any, row: number) => ({
              row: row + 1,
              value: 'initial result row ' + (row + 1),
            })),
          },
        },
        timestamp: now + 5000 + i * 100,
        status: 'completed',
      });
    }
    liveItems.push({
      id: 'live-sub-tail-tool',
      type: 'tool',
      toolName: 'Read',
      toolCall: {
        id: 'live-sub-tail-tool-call',
        input: { file_path: '/src/tail.ts' },
      },
      timestamp: now + 9000,
      status: 'running',
      runtime: {
        lifecycle: 'running',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: { file_path: '/src/tail.ts' },
        startedAt: now + 9000,
      },
    });

    executionGraphStore.hydrateNode({
      id: sessionId + ':' + taskToolId,
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: sessionId,
      parentTurnId,
      parentToolId: taskToolId,
      childSessionId,
      items: liveItems,
      summary: {
        status: 'running',
        activity: 'running_tool',
        latestLabel: 'Read running',
        latestToolName: 'Read',
        updatedAt: now + 9000,
      },
      nodeState: {
        status: 'running',
        activity: 'running_tool',
      },
      createdAt: now,
      updatedAt: now + 9000,
    } as any);

    const taskToolItem: any = {
      id: taskToolId,
      type: 'tool',
      toolName: 'Task',
      toolCall: {
        id: taskToolId,
        input: {
          description: 'Live subagent tool card scroll testing',
          prompt: 'Keep a live subagent detail panel open while nested tool cards update.',
          subagent_type: 'Explore',
        },
      },
      timestamp: now + 1000,
      status: 'running',
      runtime: {
        lifecycle: 'running',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: {
          description: 'Live subagent tool card scroll testing',
          prompt: 'Keep a live subagent detail panel open while nested tool cards update.',
          subagent_type: 'Explore',
        },
        startedAt: now + 1000,
      },
    };

    const session: any = {
      sessionId,
      title: 'E2E Live Subagent Detail Scroll',
      titleStatus: 'generated',
      dialogTurns: [
        {
          id: parentTurnId,
          sessionId,
          userMessage: {
            id: parentTurnId + '-user',
            content: makeText('User prompt for live subagent test', 4),
            timestamp: now,
          },
          modelRounds: [
            {
              id: parentTurnId + '-round-1',
              index: 0,
              items: [taskToolItem],
              isStreaming: true,
              isComplete: false,
              status: 'running',
              startTime: now + 500,
            },
          ],
          status: 'processing',
          startTime: now,
        },
      ],
      status: 'processing',
      config: {
        agentType: getBackendAgentType(descriptor),
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
      descriptor,
      workspacePath: undefined,
      workspaceId: 'e2e-workspace',
      storageScope: 'workspace',
      parentSessionId: undefined,
      sessionKind: 'normal',
      btwThreads: [],
      btwOrigin: undefined,
      isTransient: true,
    };

    flowChatStore.setState((prev: any) => {
      const sessions = new Map(prev.sessions);
      sessions.set(sessionId, session);
      return { ...prev, sessions, activeSessionId: sessionId };
    });
    useModernFlowChatStore.getState().setActiveSession(session);

    return { sessionId, taskToolId };
  });
}

async function mutateLiveSubagentToolCards(sessionId: string, taskToolId: string): Promise<void> {
  await browser.execute(async ({ sessionId: activeSessionId, taskToolId: activeTaskToolId }) => {
    const { executionGraphStore } = await import('/src/flow_chat/execution/ExecutionGraphStore.ts');
    const node = executionGraphStore.getNode(activeSessionId, activeTaskToolId) as any;
    if (!node) {
      throw new Error('Missing live subagent execution node');
    }

    const now = Date.now();
    const nextItems = node.items.map((item: any, index: number) => {
      if (item.type !== 'tool') {
        return item;
      }

      return {
        ...item,
        status: index % 3 === 0 ? 'running' : 'completed',
        timestamp: now + index,
        toolResult: {
          success: true,
          result: {
            summary: 'Updated live tool result ' + index,
            details: Array.from({ length: 18 }, (_: any, row: number) => ({
              row: row + 1,
              value: 'updated result row ' + (row + 1) + ' for nested tool ' + index,
            })),
          },
        },
        runtime: {
          ...(item.runtime ?? {}),
          lifecycle: index % 3 === 0 ? 'running' : 'completed',
          inputPhase: 'parsed',
          confirmation: 'none',
          input: item.toolCall?.input ?? {},
          result: {
            summary: 'Updated live tool result ' + index,
          },
          endedAt: index % 3 === 0 ? undefined : now + index,
        },
      };
    });

    executionGraphStore.hydrateNode({
      ...node,
      items: nextItems,
      summary: {
        ...node.summary,
        status: 'running',
        activity: 'running_tool',
        latestLabel: 'Nested tools updated',
        updatedAt: now,
      },
      nodeState: {
        status: 'running',
        activity: 'running_tool',
      },
      updatedAt: now,
    });
  }, { sessionId, taskToolId });
}

/** Wait until .task-detail-panel is rendered and its Virtuoso scroller is scrollable. */
async function waitForTaskDetailPanel(): Promise<void> {
  await browser.waitUntil(async () => {
    return browser.execute(() => {
      const panel = document.querySelector('.task-detail-panel');
      if (!panel) return false;
      const scroller = panel.querySelector('[data-virtuoso-scroller]') as HTMLElement | null;
      return scroller !== null && scroller.scrollHeight > scroller.clientHeight;
    });
  }, {
    timeout: 35000,
    interval: 300,
    timeoutMsg: 'TaskDetailPanel or its Virtuoso scroller did not become scrollable',
  });
}

/** Get scroll metrics from the TaskDetailPanel Virtuoso scroller. */
async function getPanelMetrics(): Promise<ScrollMetrics> {
  return browser.execute(() => {
    const panel = document.querySelector('.task-detail-panel');
    if (!panel) return { scrollTop: 0, scrollHeight: 0, clientHeight: 0, distanceFromBottom: 0 };
    const scroller = panel.querySelector('[data-virtuoso-scroller]') as HTMLElement | null;
    if (!scroller) return { scrollTop: 0, scrollHeight: 0, clientHeight: 0, distanceFromBottom: 0 };
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      distanceFromBottom: Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
    };
  });
}

/** Programmatically scroll the TaskDetailPanel Virtuoso scroller by deltaY. */
async function scrollPanelBy(deltaY: number): Promise<void> {
  await browser.execute((amount: number) => {
    const panel = document.querySelector('.task-detail-panel');
    if (!panel) return;
    const scroller = panel.querySelector('[data-virtuoso-scroller]') as HTMLElement | null;
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight, scroller.scrollTop + amount));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: amount, bubbles: true, cancelable: true }));
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, deltaY);
}

describe('L1 Subagent detail panel scroll', () => {
  let hasWorkspace = false;

  before(async () => {
    await browser.pause(3000);
    await header.waitForLoad();
    hasWorkspace = await ensureWorkspaceOpen(startupPage);
    if (hasWorkspace) {
      await ensureCodeSessionOpen();
    }
  });

  it('opens TaskDetailPanel via UI button click and verifies vertical scrolling', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    // 1. Inject session containing a completed Task tool card
    const sessionId = await injectSubagentFixture();
    await browser.pause(2000);

    // 2. Locate the "Open details in panel" button on the Task tool card
    //    and click it.  This triggers the full React lifecycle: agent-create-tab
    //    -> addTab -> ContentCanvas renders FlexiblePanel -> TaskDetailPanel mounts.
    const openBtn = await $('button.tool-right-rail.task-header-rail');
    await openBtn.waitForExist({ timeout: 15000 });
    await openBtn.scrollIntoView();
    await browser.pause(300);
    await openBtn.click();
    await browser.pause(2000);

    // 3. Wait for the TaskDetailPanel Virtuoso to render with overflow
    await waitForTaskDetailPanel();

    // 4. Confirm scrollable content (scrollHeight > clientHeight)
    const initial = await getPanelMetrics();
    expect(initial.scrollHeight).toBeGreaterThan(0);
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);

    // Panel starts at the top (scrollTop=0) because the subagent is completed
    // and followOutput is disabled.  Scroll to bottom first.
    await scrollPanelBy(99999);
    await browser.pause(400);
    const atBottom = await getPanelMetrics();
    expect(atBottom.distanceFromBottom).toBeLessThan(300);

    // 5. Scroll up — should enter reading-history mode
    await scrollPanelBy(-600);
    await browser.pause(400);
    const mid = await getPanelMetrics();
    expect(mid.distanceFromBottom).toBeGreaterThan(100);

    // 6. Click "scroll to latest" to return to bottom
    const latestBtn = await $('.task-detail-panel__scroll-to-latest-button').catch(() => null);
    if (latestBtn && await latestBtn.isExisting()) {
      await latestBtn.click();
      await browser.pause(600);
      const afterLatest = await getPanelMetrics();
      expect(afterLatest.distanceFromBottom).toBeLessThan(240);
    }

    // 7. Scroll to the very top and confirm we're there
    await scrollPanelBy(-99999);
    await browser.pause(400);
    const top = await getPanelMetrics();
    expect(top.scrollTop).toBeLessThan(10);

    // 8. Step down and verify we can reach the bottom
    let reachedBottom = false;
    for (let i = 0; i < 80; i++) {
      await scrollPanelBy(200);
      await browser.pause(60);
      const current = await getPanelMetrics();
      if (current.distanceFromBottom <= 5) {
        reachedBottom = true;
        break;
      }
    }
    expect(reachedBottom).toBe(true);

    expect(sessionId).toContain('e2e-subdetail-scroll-');
  });

  it('does not jump back to bottom when live nested tool cards update after user scrolls up', async function () {
    if (!hasWorkspace) {
      this.skip();
      return;
    }

    const { sessionId, taskToolId } = await injectLiveSubagentFixture();
    await browser.pause(1000);

    const openBtn = await $('button.tool-right-rail.task-header-rail');
    await openBtn.waitForExist({ timeout: 15000 });
    await openBtn.scrollIntoView();
    await browser.pause(300);
    await openBtn.click();
    await waitForTaskDetailPanel();

    await scrollPanelBy(99999);
    await browser.pause(500);
    const atBottom = await getPanelMetrics();
    expect(atBottom.distanceFromBottom).toBeLessThan(300);

    await scrollPanelBy(-900);
    await browser.pause(500);
    const afterUserScroll = await getPanelMetrics();
    expect(afterUserScroll.distanceFromBottom).toBeGreaterThan(250);

    await mutateLiveSubagentToolCards(sessionId, taskToolId);
    await browser.pause(1200);
    const afterToolUpdates = await getPanelMetrics();

    expect(afterToolUpdates.distanceFromBottom).toBeGreaterThan(250);
    expect(Math.abs(afterToolUpdates.scrollTop - afterUserScroll.scrollTop)).toBeLessThan(80);

    const latestBtn = await $('.task-detail-panel__scroll-to-latest-button');
    await latestBtn.waitForExist({ timeout: 5000 });
    await latestBtn.click();
    await browser.pause(800);
    const afterLatest = await getPanelMetrics();
    expect(afterLatest.distanceFromBottom).toBeLessThan(240);

    expect(sessionId).toContain('e2e-subdetail-live-scroll-');
  });
});
