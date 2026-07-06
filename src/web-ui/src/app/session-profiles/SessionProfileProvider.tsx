/**
 * Session profile provider — wires React Context for the active session's profile.
 *
 * Profile resolution follows navigation focus from workspaceSurfaceStore only.
 */

import React, { useMemo } from 'react';
import { resolveProfile } from './SessionProfileRegistry';
import { SessionProfileContext, type SessionProfileContextValue } from './SessionProfileReactContext';
import { useFlowChatStoreSelector } from '@/flow_chat/hooks/useFlowChatStoreSelector';
import {
  selectFocusedSessionId,
  useWorkspaceSurfaceStore,
} from '../navigation/workspaceSurfaceStore';

export const SessionProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const focusedSessionId = useWorkspaceSurfaceStore(selectFocusedSessionId);
  const profileId = useFlowChatStoreSelector((state) => (
    focusedSessionId ? state.sessions.get(focusedSessionId)?.descriptor?.profileId : undefined
  ));

  const value = useMemo<SessionProfileContextValue>(
    () => ({ profile: resolveProfile(profileId) }),
    [profileId],
  );

  return (
    <SessionProfileContext.Provider value={value}>
      {children}
    </SessionProfileContext.Provider>
  );
};
