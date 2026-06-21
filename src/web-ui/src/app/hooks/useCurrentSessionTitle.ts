/**
 * useCurrentSessionTitle — returns the focused FlowChat session title.
 * Subscribes to flowChatStore so the value updates reactively.
 */

import { useWorkspaceSurfaceStore } from '../navigation/workspaceSurfaceStore';
import { useFlowChatStoreSelector } from '../../flow_chat/hooks/useFlowChatStoreSelector';

export function useCurrentSessionTitle(): string {
  const focusedSessionId = useWorkspaceSurfaceStore(state => state.focusedSessionId);
  return useFlowChatStoreSelector(
    state => {
      const session = focusedSessionId ? state.sessions.get(focusedSessionId) : undefined;
      return session?.title ?? '';
    }
  );
}
