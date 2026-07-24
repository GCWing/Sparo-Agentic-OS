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
import { resolveProductAppTopBarContext } from '../navigation/workspaceTopBarContext';
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

    const productAppMetadata = session.customMetadata?.productAppRuntime;
    const productApp = resolveProductAppTopBarContext(productAppMetadata);
    const productAppWorkspace = productAppMetadata?.scope.kind === 'workspace'
      ? productAppMetadata.scope
      : null;
    const workspacePath = productApp
      ? productAppWorkspace?.workspacePath
      : session.workspacePath;

    let workspaceDisplayName = productAppWorkspace?.workspaceName?.trim() ?? '';
    if (workspacePath?.trim()) {
      const ws = resolveWorkspaceForSession({
        ...session,
        workspacePath,
        workspaceId: productAppWorkspace?.workspaceId ?? session.workspaceId,
      }, openedWorkspacesList);
      if (ws) {
        workspaceDisplayName = getWorkspaceDisplayName(ws).trim();
      }
      if (!workspaceDisplayName) {
        workspaceDisplayName = fallbackWorkspaceFolderLabel(workspacePath);
      }
    }

    return {
      descriptor: session.descriptor,
      workspacePath,
      workspaceDisplayName,
      productApp: productApp ?? undefined,
    };
  }, [openedWorkspacesList, session]);
}
