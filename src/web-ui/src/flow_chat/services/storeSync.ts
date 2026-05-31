/**
 * Store sync service
 * Syncs data from old FlowChatStore to new ModernFlowChatStore
 * Maintains original concept: Session → DialogTurn → ModelRound → FlowItem
 */

import { flowChatStore } from '../store/FlowChatStore';
import { useModernFlowChatStore } from '../store/modernFlowChatStore';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('StoreSync');

function isSessionAlreadySynced(
  sessionId: string,
  session: object,
  modernStore: ReturnType<typeof useModernFlowChatStore.getState>
): boolean {
  return (
    modernStore.activeSession?.sessionId === sessionId &&
    modernStore.activeSession === session
  );
}

/**
 * Sync session data to new Store
 */
export function syncSessionToModernStore(sessionId: string): void {
  const oldState = flowChatStore.getState();
  const session = oldState.sessions.get(sessionId);

  if (!session) {
    log.warn('Session not found', { sessionId });
    return;
  }

  const modernStore = useModernFlowChatStore.getState();
  if (isSessionAlreadySynced(sessionId, session, modernStore)) {
    return;
  }
  modernStore.setActiveSession(session);
}

/**
 * Start auto sync
 * Listens to old Store changes and automatically syncs to new Store
 *
 * Performance optimization: relies on FlowChatStore's immutable updates, each update creates a new session reference.
 * Uses reference comparison to skip redundant syncs — if the active session object hasn't changed, no work is done.
 */
export function startAutoSync(): () => void {
  let lastSyncedSessionId: string | null = null;
  let lastSyncedSession: object | null = null;

  const unsubscribe = flowChatStore.subscribeSelector((state) => {
    const session = state.activeSessionId
      ? state.sessions.get(state.activeSessionId) ?? null
      : null;
    return {
      sessionId: state.activeSessionId,
      session,
    };
  }, (active) => {
    const modernStore = useModernFlowChatStore.getState();

    if (active.sessionId) {
      if (active.session && (active.session !== lastSyncedSession || active.sessionId !== lastSyncedSessionId)) {
        lastSyncedSessionId = active.sessionId;
        lastSyncedSession = active.session;
        modernStore.setActiveSession(active.session);
      }
    } else if (lastSyncedSessionId !== null) {
      lastSyncedSessionId = null;
      lastSyncedSession = null;
      modernStore.clear();
    }
  }, (left, right) => left.sessionId === right.sessionId && left.session === right.session);

  const currentState = flowChatStore.getState();
  if (currentState.activeSessionId) {
    const session = currentState.sessions.get(currentState.activeSessionId);
    if (session) {
      lastSyncedSessionId = currentState.activeSessionId;
      lastSyncedSession = session;
      const modernStore = useModernFlowChatStore.getState();
      if (!isSessionAlreadySynced(currentState.activeSessionId, session, modernStore)) {
        modernStore.setActiveSession(session);
      }
    }
  }

  return unsubscribe;
}
