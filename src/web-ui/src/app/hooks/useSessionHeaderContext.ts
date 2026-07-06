/**
 * Derived session header context for UnifiedTopBar.
 * Single source: focused session from surface store + FlowChatStore session data.
 */

import { useMemo } from 'react';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import {
  fallbackWorkspaceFolderLabel,
  resolveWorkspaceForSession,
} from '@/flow_chat/utils/sessionOrdering';
import { useFlowChatStoreSelector } from '@/flow_chat/hooks/useFlowChatStoreSelector';
import {
  selectFocusedSessionId,
  useWorkspaceSurfaceStore,
} from '../navigation/workspaceSurfaceStore';
import type { SessionHeaderContext } from '../stores/headerStore';

export function useSessionHeaderContext(): SessionHeaderContext | null {
  const focusedSessionId = useWorkspaceSurfaceStore(selectFocusedSessionId);
  const { openedWorkspacesList } = useWorkspaceContext();

  const session = useFlowChatStoreSelector((state) => (
    focusedSessionId ? state.sessions.get(focusedSessionId) : undefined
  ));

  return useMemo((): SessionHeaderContext | null => {
    if (!session?.sessionId || !session.descriptor) {
      return null;
    }

    let workspaceDisplayName = '';
    if (session.workspacePath?.trim()) {
      const ws = resolveWorkspaceForSession(session, openedWorkspacesList);
      if (ws) {
        workspaceDisplayName = getWorkspaceDisplayName(ws).trim();
      }
      if (!workspaceDisplayName) {
        workspaceDisplayName = fallbackWorkspaceFolderLabel(session.workspacePath);
      }
    }

    return {
      descriptor: session.descriptor,
      workspacePath: session.workspacePath,
      workspaceDisplayName,
    };
  }, [openedWorkspacesList, session]);
}
