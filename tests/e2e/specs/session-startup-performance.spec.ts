import { browser, expect } from '@wdio/globals';

describe('Session startup performance guards', () => {
  before(async () => {
    await browser.pause(2_000);
  });

  it('hydrates large session metadata batches with a single store notification', async () => {
    const result = await browser.execute(async () => {
      const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
      const prefix = `e2e-bulk-${Date.now()}`;
      const workspacePath = `D:/workspace/${prefix}`;
      const metadata = Array.from({ length: 120 }, (_, index) => ({
        sessionId: `${prefix}-${index}`,
        sessionName: `Bulk ${index}`,
        agentType: 'Runno',
        modelName: 'primary',
        createdAt: index + 1,
        lastActiveAt: 10_000 + index,
        turnCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        status: 'completed' as const,
        tags: [],
        workspacePath,
        storageScope: 'workspace' as const,
      }));

      let notificationCount = 0;
      const unsubscribe = flowChatStore.subscribeSelector(
        state => state.sessions.size,
        () => {
          notificationCount += 1;
        },
      );

      const beforeSize = flowChatStore.getState().sessions.size;
      const inserted = await flowChatStore.hydrateWorkspaceSessionsMetadata(
        metadata,
        workspacePath,
        'workspace',
      );
      const afterSize = flowChatStore.getState().sessions.size;
      unsubscribe();

      flowChatStore.setState(prev => {
        const sessions = new Map(prev.sessions);
        for (const item of metadata) {
          sessions.delete(item.sessionId);
        }
        return { ...prev, sessions };
      });

      return {
        inserted,
        notificationCount,
        addedSessionCount: afterSize - beforeSize,
      };
    });

    expect(result.inserted).toBe(120);
    expect(result.addedSessionCount).toBe(120);
    expect(result.notificationCount).toBeLessThanOrEqual(1);
  });

  it('deduplicates static context budget requests while Agentic OS workspace path stabilizes', async () => {
    const result = await browser.execute(async () => {
      const { contextBudgetService } = await import('/src/flow_chat/services/ContextBudgetService.ts');
      const { sessionAPI } = await import('/src/infrastructure/api/service-api/SessionAPI.ts');
      const originalGetContextBudget = sessionAPI.getContextBudget.bind(sessionAPI);
      const calls: unknown[][] = [];

      sessionAPI.getContextBudget = (async (...args: unknown[]) => {
        calls.push(args);
        await new Promise(resolve => setTimeout(resolve, 25));
        const sessionId = String(args[0]);
        return {
          id: `e2e-budget-${sessionId}`,
          kind: 'static',
          sessionId,
          agentType: 'Runno',
          modelId: 'primary',
          provider: 'e2e',
          contextWindow: 128128,
          totals: {
            inputTokens: 10,
            reservedOutputTokens: 0,
            remainingTokens: 128118,
            usedRatio: 10 / 128128,
          },
          estimation: {
            algorithm: 'e2e',
            confidence: 'approx',
            calibrated: false,
          },
          segments: [],
          createdAt: Date.now(),
        };
      }) as typeof sessionAPI.getContextBudget;

      try {
        contextBudgetService.clearCache();
        await Promise.all([
          contextBudgetService.loadStaticBudget({
            sessionId: 'e2e-agentic-budget',
            agentType: 'Runno',
            modelId: 'primary',
            storageScope: 'agentic_os',
          }),
          contextBudgetService.loadStaticBudget({
            sessionId: 'e2e-agentic-budget',
            agentType: 'Runno',
            modelId: 'primary',
            workspacePath: 'D:/runtime/agentic_os',
            storageScope: 'agentic_os',
          }),
        ]);

        return { callCount: calls.length };
      } finally {
        sessionAPI.getContextBudget = originalGetContextBudget;
        contextBudgetService.clearCache();
      }
    });

    expect(result.callCount).toBe(1);
  });
});
