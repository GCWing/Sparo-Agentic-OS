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

  it('deduplicates concurrent identical Agentic OS static budget requests', async () => {
    const { contextBudgetService } = await import('./ContextBudgetService');
    mocks.getContextBudget.mockImplementation(async (locator: { session_id: string }) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return createSnapshot(locator.session_id);
    });

    const [first, second] = await Promise.all([
      contextBudgetService.loadStaticBudget({
        sessionId: 'agentic-session',
        agentType: 'Runno',
        modelId: 'primary',
        workspacePath: 'D:/runtime/agentic_os',
        domain: { kind: 'agentic_os' },
      }),
      contextBudgetService.loadStaticBudget({
        sessionId: 'agentic-session',
        agentType: 'Runno',
        modelId: 'primary',
        workspacePath: 'D:/runtime/agentic_os',
        domain: { kind: 'agentic_os' },
      }),
    ]);

    expect(mocks.getContextBudget).toHaveBeenCalledTimes(1);
    expect(first.sessionId).toBe('agentic-session');
    expect(second.sessionId).toBe('agentic-session');
  });

  it('re-reads the backend authority after an earlier request settles', async () => {
    const { contextBudgetService } = await import('./ContextBudgetService');
    mocks.getContextBudget
      .mockResolvedValueOnce(createSnapshot('model-change-session'))
      .mockResolvedValueOnce({
        ...createSnapshot('model-change-session'),
        id: 'snapshot-after-model-change',
        contextWindow: 1_000_000,
        totals: {
          inputTokens: 100,
          reservedOutputTokens: 0,
          remainingTokens: 999_900,
          usedRatio: 0.0001,
        },
      });

    const before = await contextBudgetService.loadStaticBudget({
      sessionId: 'model-change-session',
      agentType: 'Runno',
      modelId: 'primary',
      domain: { kind: 'agentic_os' },
    });
    const after = await contextBudgetService.loadStaticBudget({
      sessionId: 'model-change-session',
      agentType: 'Runno',
      modelId: 'primary',
      domain: { kind: 'agentic_os' },
    });

    expect(mocks.getContextBudget).toHaveBeenCalledTimes(2);
    expect(before.contextWindow).toBe(128128);
    expect(after.contextWindow).toBe(1_000_000);
  });
});
