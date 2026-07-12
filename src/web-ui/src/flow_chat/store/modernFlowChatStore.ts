/**
 * Modern FlowChat Store
 * High-performance state management using Zustand + Immer.
 *
 * Projection work lives in `projections/flowChatProjectionScheduler`; this
 * store only publishes the active projection result and visible-turn state.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { immer } from 'zustand/middleware/immer';
import type { Session } from '../types/flow-chat';
import type { SessionDescriptor } from '../domain/sessionDescriptor';
import { flowChatStore } from './FlowChatStore';
import { useFlowChatStoreSelector } from '../hooks/useFlowChatStoreSelector';
import {
  selectFocusedSessionId,
  useWorkspaceSurfaceStore,
} from '@/app/navigation/workspaceSurfaceStore';
import {
  clearProjectionScheduler,
  getProjectionVersion,
  getSessionVirtualItems,
  sessionToVirtualItems,
  type ExploreGroupData,
  type ExploreGroupStats,
  type VirtualItem,
} from '../projections/flowChatProjectionScheduler';

export {
  getProjectionVersion,
  getSessionVirtualItems,
  sessionToVirtualItems,
  type ExploreGroupData,
  type ExploreGroupStats,
  type VirtualItem,
};

/**
 * Currently visible turn information.
 */
export interface VisibleTurnInfo {
  turnIndex: number;
  totalTurns: number;
  userMessage: string;
  turnId: string;
}

export interface ActiveSessionMeta {
  sessionId?: string;
  descriptor?: SessionDescriptor;
  workspaceId?: string;
  workspacePath?: string;
  storageScope?: Session['storageScope'];
  createdAt?: number;
  lastFinishedAt?: number;
  loadPhase?: Session['loadPhase'];
}

export function sessionToActiveSessionMeta(session: Session | null | undefined): ActiveSessionMeta {
  if (!session) {
    return {};
  }

  return {
    sessionId: session.sessionId,
    descriptor: session.descriptor,
    workspaceId: session.workspaceId,
    workspacePath: session.workspacePath,
    storageScope: session.storageScope,
    createdAt: session.createdAt,
    lastFinishedAt: session.lastFinishedAt,
    loadPhase: session.loadPhase,
  };
}

interface ModernFlowChatState {
  activeSession: Session | null;
  virtualItems: VirtualItem[];
  visibleTurnInfo: VisibleTurnInfo | null;

  setActiveSession: (session: Session | null) => void;
  updateVirtualItems: () => void;
  setVisibleTurnInfo: (info: VisibleTurnInfo | null) => void;
  clear: () => void;
}

function getInitialModernState(): Pick<
  ModernFlowChatState,
  'activeSession' | 'virtualItems' | 'visibleTurnInfo'
> {
  const legacyState = flowChatStore.getState();
  const focusedSessionId = selectFocusedSessionId(useWorkspaceSurfaceStore.getState());
  const activeSession = focusedSessionId
    ? legacyState.sessions.get(focusedSessionId) ?? null
    : null;

  return {
    activeSession,
    virtualItems: sessionToVirtualItems(activeSession),
    visibleTurnInfo: null,
  };
}

export const useModernFlowChatStore = create<ModernFlowChatState>()(
  immer((set, get) => ({
    ...getInitialModernState(),

    setActiveSession: (session) => {
      const items = sessionToVirtualItems(session);
      set((state) => {
        state.activeSession = session;
        state.virtualItems = items;
      });
    },

    updateVirtualItems: () => {
      const session = get().activeSession;
      const items = sessionToVirtualItems(session);

      set((state) => {
        state.virtualItems = items;
      });
    },

    setVisibleTurnInfo: (info) => {
      set((state) => {
        state.visibleTurnInfo = info;
      });
    },

    clear: () => {
      clearProjectionScheduler();

      set((state) => {
        state.activeSession = null;
        state.virtualItems = [];
        state.visibleTurnInfo = null;
      });
    },
  }))
);

export const useVirtualItems = () =>
  useModernFlowChatStore(state => state.virtualItems);

export const useActiveSession = () =>
  useModernFlowChatStore(state => state.activeSession);

export const useActiveSessionMeta = () =>
  useModernFlowChatStore(useShallow(state => {
    return sessionToActiveSessionMeta(state.activeSession);
  }));

export function useScopedSession(sessionId?: string | null): Session | null {
  const sessions = useFlowChatStoreSelector(state => state.sessions);
  const requestedSessionId = sessionId?.trim() ?? '';

  return useMemo(() => {
    if (!requestedSessionId) {
      return null;
    }
    return sessions.get(requestedSessionId) ?? null;
  }, [requestedSessionId, sessions]);
}

export const useVisibleTurnInfo = () =>
  useModernFlowChatStore(state => state.visibleTurnInfo);

/**
 * Get actions (does not trigger re-render).
 */
export const useFlowChatActions = () =>
  useModernFlowChatStore(useShallow(state => ({
    setActiveSession: state.setActiveSession,
    updateVirtualItems: state.updateVirtualItems,
    setVisibleTurnInfo: state.setVisibleTurnInfo,
    clear: state.clear,
  })));
