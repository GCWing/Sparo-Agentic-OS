/**
 * Store sync service
 * Syncs data from old FlowChatStore to new ModernFlowChatStore
 * Maintains original concept: Session → DialogTurn → ModelRound → FlowItem
 */

import { flowChatStore } from '../store/FlowChatStore';
import { useModernFlowChatStore } from '../store/modernFlowChatStore';
import { createLogger } from '@/shared/utils/logger';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import type { Session } from '../types/flow-chat';

const log = createLogger('StoreSync');

function isSessionAlreadySynced(
  sessionId: string,
  session: Session,
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
  let lastSyncedSession: Session | null = null;

  const syncFocusedSession = (active: { sessionId: string | null; session: Session | null }) => {
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
  };

  const getFocusedSnapshot = () => {
    const sessionId = useWorkspaceSurfaceStore.getState().focusedSessionId;
    const session = sessionId
      ? flowChatStore.getState().sessions.get(sessionId) ?? null
      : null;
    return {
      sessionId,
      session,
    };
  };

  const unsubscribeFlowChat = flowChatStore.subscribeSelector(
    getFocusedSnapshot,
    syncFocusedSession,
    (left, right) => left.sessionId === right.sessionId && left.session === right.session,
  );
  const unsubscribeSurface = useWorkspaceSurfaceStore.subscribe(() => {
    syncFocusedSession(getFocusedSnapshot());
  });

  const current = getFocusedSnapshot();
  if (current.sessionId && current.session) {
    lastSyncedSessionId = current.sessionId;
    lastSyncedSession = current.session;
    const modernStore = useModernFlowChatStore.getState();
    if (!isSessionAlreadySynced(current.sessionId, current.session, modernStore)) {
      modernStore.setActiveSession(current.session);
    }
  }

  return () => {
    unsubscribeFlowChat();
    unsubscribeSurface();
  };
}
