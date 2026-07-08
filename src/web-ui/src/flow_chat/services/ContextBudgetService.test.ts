import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextBudgetSnapshot } from '../types/flow-chat';

const mocks = vi.hoisted(() => ({
  getContextBudget: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  sessionAPI: {
    getContextBudget: mocks.getContextBudget,
  },
}));

function createSnapshot(sessionId: string): ContextBudgetSnapshot {
  return {
    id: `snapshot-${sessionId}`,
    kind: 'static',
    sessionId,
    agentType: 'Runno',
    modelId: 'primary',
    provider: 'test',
    contextWindow: 128128,
    totals: {
      inputTokens: 100,
      reservedOutputTokens: 0,
      remainingTokens: 128028,
      usedRatio: 100 / 128128,
    },
    estimation: {
      algorithm: 'test',
      confidence: 'approx',
      calibrated: false,
    },
    segments: [],
    createdAt: 1,
  };
}

describe('ContextBudgetService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { contextBudgetService } = await import('./ContextBudgetService');
    contextBudgetService.clearCache();
  });

  it('deduplicates concurrent Agentic OS static budget requests across workspace path stabilization', async () => {
    const { contextBudgetService } = await import('./ContextBudgetService');
    mocks.getContextBudget.mockImplementation(async (sessionId: string) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return createSnapshot(sessionId);
    });

    const [first, second] = await Promise.all([
      contextBudgetService.loadStaticBudget({
        sessionId: 'agentic-session',
        agentType: 'Runno',
        modelId: 'primary',
        storageScope: 'agentic_os',
      }),
      contextBudgetService.loadStaticBudget({
        sessionId: 'agentic-session',
        agentType: 'Runno',
        modelId: 'primary',
        workspacePath: 'D:/runtime/agentic_os',
        storageScope: 'agentic_os',
      }),
    ]);

    expect(mocks.getContextBudget).toHaveBeenCalledTimes(1);
    expect(first.sessionId).toBe('agentic-session');
    expect(second.sessionId).toBe('agentic-session');
  });
});
