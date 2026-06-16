import { create } from 'zustand';
import {
  agentAPI,
  type DialogQueuePause,
  type DialogTurnGuidanceRequestedEvent,
  type DialogTurnQueueDeletedEvent,
  type DialogTurnQueueDispatchingEvent,
  type DialogTurnQueuePausedEvent,
  type DialogTurnQueueUpdatedEvent,
  type DialogTurnQueuedEvent,
  type QueuedDialogTurn,
} from '@/infrastructure/api/service-api/AgentAPI';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SessionTurnQueueStore');

interface SessionTurnQueueState {
  queuesBySession: Record<string, QueuedDialogTurn[]>;
  pauseBySession: Record<string, DialogQueuePause | undefined>;
  refreshQueue: (sessionId: string) => Promise<void>;
  setQueue: (sessionId: string, items: QueuedDialogTurn[], pause?: DialogQueuePause | null) => void;
  applyQueued: (event: DialogTurnQueuedEvent) => void;
  applyUpdated: (event: DialogTurnQueueUpdatedEvent) => void;
  applyDeleted: (event: DialogTurnQueueDeletedEvent) => void;
  applyDispatching: (event: DialogTurnQueueDispatchingEvent) => void;
  applyPaused: (event: DialogTurnQueuePausedEvent) => void;
  applyGuidanceRequested: (event: DialogTurnGuidanceRequestedEvent) => void;
  clearPause: (sessionId: string) => void;
  removeTurn: (sessionId: string, turnId: string) => void;
}

function orderQueue(items: QueuedDialogTurn[]): QueuedDialogTurn[] {
  return [...items].sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position;
    return left.enqueuedAtMs - right.enqueuedAtMs;
  });
}

export const useSessionTurnQueueStore = create<SessionTurnQueueState>((set, get) => ({
  queuesBySession: {},
  pauseBySession: {},

  refreshQueue: async (sessionId) => {
    if (!sessionId.trim()) return;
    try {
      const response = await agentAPI.listQueuedDialogTurns(sessionId);
      get().setQueue(sessionId, response.items, response.pause ?? null);
    } catch (error) {
      log.error('Failed to refresh session turn queue', { sessionId, error });
    }
  },

  setQueue: (sessionId, items, pause) => {
    set(state => ({
      queuesBySession: {
        ...state.queuesBySession,
        [sessionId]: orderQueue(items),
      },
      pauseBySession: {
        ...state.pauseBySession,
        [sessionId]: pause ?? undefined,
      },
    }));
  },

  applyQueued: (event) => {
    set(state => {
      const current = state.queuesBySession[event.sessionId] ?? [];
      const withoutExisting = current.filter(item => item.turnId !== event.turnId);
      const nextItem: QueuedDialogTurn = {
        sessionId: event.sessionId,
        turnId: event.turnId,
        userInput: event.userInput,
        originalUserInput: event.originalUserInput,
        agentType: event.agentType,
        queuePriority: event.queuePriority,
        position: event.queueDepth,
        enqueuedAtMs: event.enqueuedAtMs,
        hasImages: event.hasImages,
        imageCount: event.imageCount,
        status: 'queued',
      };
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [event.sessionId]: orderQueue([...withoutExisting, nextItem]),
        },
      };
    });
  },

  applyUpdated: (event) => {
    set(state => {
      const current = state.queuesBySession[event.sessionId] ?? [];
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [event.sessionId]: current.map(item =>
            item.turnId === event.turnId
              ? {
                  ...item,
                  userInput: event.userInput,
                  originalUserInput: event.originalUserInput,
                }
              : item
          ),
        },
      };
    });
  },

  applyDeleted: (event) => {
    set(state => {
      const current = state.queuesBySession[event.sessionId] ?? [];
      const next = current.filter(item => item.turnId !== event.turnId);
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [event.sessionId]: next,
        },
        pauseBySession: event.queueDepth === 0
          ? {
              ...state.pauseBySession,
              [event.sessionId]: undefined,
            }
          : state.pauseBySession,
      };
    });
  },

  applyDispatching: (event) => {
    set(state => {
      const current = state.queuesBySession[event.sessionId] ?? [];
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [event.sessionId]: current.map(item =>
            item.turnId === event.turnId ? { ...item, status: 'dispatching' } : item
          ),
        },
      };
    });
  },

  applyPaused: (event) => {
    set(state => ({
      pauseBySession: {
        ...state.pauseBySession,
        [event.sessionId]: {
          reason: event.reason,
          turnId: event.turnId,
          error: event.error,
        },
      },
    }));
  },

  applyGuidanceRequested: (event) => {
    set(state => {
      const current = state.queuesBySession[event.sessionId] ?? [];
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [event.sessionId]: current.filter(item => item.turnId !== event.sourceTurnId),
        },
        pauseBySession: event.queueDepth === 0
          ? {
              ...state.pauseBySession,
              [event.sessionId]: undefined,
            }
          : state.pauseBySession,
      };
    });
  },

  clearPause: (sessionId) => {
    set(state => ({
      pauseBySession: {
        ...state.pauseBySession,
        [sessionId]: undefined,
      },
    }));
  },

  removeTurn: (sessionId, turnId) => {
    set(state => {
      const current = state.queuesBySession[sessionId] ?? [];
      const next = current.filter(item => item.turnId !== turnId);
      return {
        queuesBySession: {
          ...state.queuesBySession,
          [sessionId]: next,
        },
        pauseBySession: next.length === 0
          ? {
              ...state.pauseBySession,
              [sessionId]: undefined,
            }
          : state.pauseBySession,
      };
    });
  },
}));
