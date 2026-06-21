import { create } from 'zustand';
import {
  goalAPI,
  type GoalExtractionRun,
  type GoalJudgeRun,
  type GoalLifecycleEvent,
  type GoalRecord,
  type GoalResponse,
} from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SessionGoalStore');

export type GoalUiPhase =
  | 'none'
  | 'extracting'
  | 'judging'
  | 'active'
  | 'waiting_user'
  | 'paused'
  | 'blocked'
  | 'budget_limited'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'needs_clarification'
  | 'rejected';

export interface SessionGoalSnapshot {
  sessionId: string;
  workspacePath?: string;
  phase: GoalUiPhase;
  goal?: GoalRecord | null;
  extraction?: GoalExtractionRun | null;
  judge?: GoalJudgeRun | null;
  message?: string | null;
  pendingObjective?: string | null;
  updatedAtMs: number;
}

export const EMPTY_SESSION_GOAL_SNAPSHOT: SessionGoalSnapshot = {
  sessionId: '',
  phase: 'none',
  goal: null,
  extraction: null,
  judge: null,
  message: null,
  pendingObjective: null,
  updatedAtMs: 0,
};

const emptySnapshotsBySession = new Map<string, SessionGoalSnapshot>();

interface ApplyGoalResponseInput {
  sessionId: string;
  workspacePath?: string;
  response?: GoalResponse | null;
  cleared?: boolean;
}

interface SessionGoalStoreState {
  snapshotsBySession: Record<string, SessionGoalSnapshot | undefined>;
  applyGoalEvent: (event: GoalLifecycleEvent) => void;
  applyGoalResponse: (input: ApplyGoalResponseInput) => void;
  clearSessionGoal: (sessionId: string) => void;
  refreshSessionGoal: (sessionId: string, workspacePath: string) => Promise<void>;
}

function stripGoalPrefix(rawInput?: string | null): string | null {
  const trimmed = rawInput?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.replace(/^\/goal\b/i, '').trim() || null;
}

function latestUpdatedAt(
  goal?: GoalRecord | null,
  extraction?: GoalExtractionRun | null,
  judge?: GoalJudgeRun | null,
): number {
  return Math.max(
    goal?.updatedAtMs ?? 0,
    extraction?.updatedAtMs ?? 0,
    judge?.updatedAtMs ?? 0,
    Date.now(),
  );
}

export function deriveGoalUiPhase(
  goal?: GoalRecord | null,
  extraction?: GoalExtractionRun | null,
  judge?: GoalJudgeRun | null,
): GoalUiPhase {
  if (judge?.status === 'queued' || judge?.status === 'running') {
    return 'judging';
  }
  if (extraction?.status === 'queued' || extraction?.status === 'running') {
    return 'extracting';
  }
  if (goal?.status) {
    return goal.status;
  }
  if (extraction?.status === 'needs_clarification') {
    return 'needs_clarification';
  }
  if (extraction?.status === 'rejected' || judge?.status === 'rejected') {
    return 'rejected';
  }
  if (extraction?.status === 'failed' || judge?.status === 'failed') {
    return 'failed';
  }
  return 'none';
}

function snapshotFromParts(input: {
  sessionId: string;
  workspacePath?: string;
  goal?: GoalRecord | null;
  extraction?: GoalExtractionRun | null;
  judge?: GoalJudgeRun | null;
  message?: string | null;
}): SessionGoalSnapshot {
  const phase = deriveGoalUiPhase(input.goal, input.extraction, input.judge);
  return {
    sessionId: input.sessionId,
    workspacePath: input.workspacePath,
    phase,
    goal: input.goal ?? null,
    extraction: input.extraction ?? null,
    judge: input.judge ?? null,
    message: input.message ?? null,
    pendingObjective: stripGoalPrefix(input.extraction?.rawInput),
    updatedAtMs: latestUpdatedAt(input.goal, input.extraction, input.judge),
  };
}

function mergeSnapshotParts(
  current: SessionGoalSnapshot | undefined,
  input: {
    sessionId: string;
    workspacePath?: string;
    goal?: GoalRecord | null;
    extraction?: GoalExtractionRun | null;
    judge?: GoalJudgeRun | null;
    message?: string | null;
  },
): SessionGoalSnapshot {
  const goal = input.goal ?? current?.goal ?? null;
  const extraction = input.extraction ?? current?.extraction ?? null;
  const judge = input.judge ?? current?.judge ?? null;
  return snapshotFromParts({
    sessionId: input.sessionId,
    workspacePath: input.workspacePath ?? current?.workspacePath,
    goal,
    extraction,
    judge,
    message: input.message ?? current?.message ?? null,
  });
}

export const useSessionGoalStore = create<SessionGoalStoreState>((set, get) => ({
  snapshotsBySession: {},

  applyGoalEvent: (event) => {
    if (!event.sessionId) return;
    if (event.eventType === 'goal_cleared') {
      get().clearSessionGoal(event.sessionId);
      return;
    }

    set(state => {
      const current = state.snapshotsBySession[event.sessionId];
      const next = mergeSnapshotParts(current, {
          sessionId: event.sessionId,
          workspacePath: event.workspacePath,
          goal: event.goal,
          extraction: event.extraction,
          judge: event.judge,
          message: event.message,
        });
      return {
        snapshotsBySession: {
          ...state.snapshotsBySession,
          [event.sessionId]: next,
        },
      };
    });
  },

  applyGoalResponse: ({ sessionId, workspacePath, response, cleared }) => {
    if (!sessionId) return;
    if (cleared) {
      get().clearSessionGoal(sessionId);
      return;
    }
    if (!response) return;

    const next = snapshotFromParts({
      sessionId,
      workspacePath,
      goal: response.goal,
      extraction: response.extraction,
      judge: response.judge,
      message: response.message,
    });

    set(state => {
      const current = state.snapshotsBySession[sessionId];
      if (next.phase === 'none' && (current?.phase === 'extracting' || current?.phase === 'judging')) {
        return state;
      }
      return {
        snapshotsBySession: {
          ...state.snapshotsBySession,
          [sessionId]: next,
        },
      };
    });
  },

  clearSessionGoal: (sessionId) => {
    set(state => ({
      snapshotsBySession: {
        ...state.snapshotsBySession,
        [sessionId]: {
          ...EMPTY_SESSION_GOAL_SNAPSHOT,
          sessionId,
          updatedAtMs: Date.now(),
        },
      },
    }));
  },

  refreshSessionGoal: async (sessionId, workspacePath) => {
    if (!sessionId.trim() || !workspacePath.trim()) return;
    try {
      const response = await goalAPI.getSessionGoal(sessionId, workspacePath);
      get().applyGoalResponse({ sessionId, workspacePath, response });
    } catch (error) {
      log.debug('Failed to refresh session goal', { sessionId, error });
    }
  },
}));

export function useSessionGoalSnapshot(sessionId?: string | null): SessionGoalSnapshot {
  return useSessionGoalStore(state =>
    sessionId ? state.snapshotsBySession[sessionId] ?? emptySnapshotForSession(sessionId) : EMPTY_SESSION_GOAL_SNAPSHOT
  );
}

function emptySnapshotForSession(sessionId: string): SessionGoalSnapshot {
  const cached = emptySnapshotsBySession.get(sessionId);
  if (cached) {
    return cached;
  }
  const snapshot = {
    ...EMPTY_SESSION_GOAL_SNAPSHOT,
    sessionId,
  };
  emptySnapshotsBySession.set(sessionId, snapshot);
  return snapshot;
}
