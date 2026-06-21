import { describe, expect, it } from 'vitest';
import { deriveGoalUiPhase, useSessionGoalStore } from './sessionGoalStore';
import type { GoalLifecycleEvent } from '@/infrastructure/api';

describe('sessionGoalStore', () => {
  it('derives transient processing phases from backend runs', () => {
    expect(deriveGoalUiPhase(null, { extractionId: 'extract-1', status: 'running' }, null))
      .toBe('extracting');
    expect(deriveGoalUiPhase(null, null, { judgeId: 'judge-1', status: 'running' }))
      .toBe('judging');
  });

  it('applies goal lifecycle events and clears a session goal', () => {
    const store = useSessionGoalStore.getState();
    const event: GoalLifecycleEvent = {
      eventType: 'goal_extraction_run',
      sessionId: 'session-goal-store-test',
      workspacePath: 'D:/workspace/test',
      extraction: {
        extractionId: 'extract-1',
        status: 'running',
        rawInput: '/goal ship the feature',
      },
      updatedAtMs: Date.now(),
    };

    store.applyGoalEvent(event);
    expect(useSessionGoalStore.getState().snapshotsBySession[event.sessionId]?.phase)
      .toBe('extracting');
    expect(useSessionGoalStore.getState().snapshotsBySession[event.sessionId]?.pendingObjective)
      .toBe('ship the feature');

    store.applyGoalEvent({
      ...event,
      eventType: 'goal_cleared',
      extraction: null,
    });
    expect(useSessionGoalStore.getState().snapshotsBySession[event.sessionId]?.phase)
      .toBe('none');
  });

  it('merges partial extraction events without clearing the durable goal', () => {
    const sessionId = 'session-goal-store-merge-test';
    const store = useSessionGoalStore.getState();

    store.applyGoalResponse({
      sessionId,
      workspacePath: 'D:/workspace/test',
      response: {
        accepted: true,
        message: 'Goal created',
        goal: {
          goalId: 'goal-1',
          sessionId,
          revision: 1,
          status: 'active',
          contract: {
            rawTrigger: '/goal ship the feature',
            resolvedObjective: 'ship the feature',
            successCriteria: [],
          },
          progress: {
            remainingGaps: [],
            continuationTurns: 0,
            triggerTurnId: 'turn-1',
          },
          updatedAtMs: Date.now(),
        },
      },
    });

    store.applyGoalEvent({
      eventType: 'goal_extraction_run',
      sessionId,
      workspacePath: 'D:/workspace/test',
      goal: null,
      extraction: {
        extractionId: 'extract-2',
        status: 'accepted',
        rawInput: '/goal ship the feature',
      },
      updatedAtMs: Date.now(),
    });

    const snapshot = useSessionGoalStore.getState().snapshotsBySession[sessionId];
    expect(snapshot?.goal?.goalId).toBe('goal-1');
    expect(snapshot?.phase).toBe('active');
    expect(snapshot?.extraction?.extractionId).toBe('extract-2');
  });
});
