/**
 * Session profile provider — wires React Context for the active session's profile.
 *
 * SessionProfileProvider reads the active session descriptor from the FlowChat
 * store, resolves the matching SessionProfile, and makes it available to the
 * entire component tree via useSessionProfile().
 *
 * The resolved profile object is a module-level constant, so the Context value
 * reference only changes when the session type actually switches — no spurious
 * re-renders for consumers.
 */

import React, { useMemo } from 'react';
import { resolveProfile } from './SessionProfileRegistry';
import { SessionProfileContext, type SessionProfileContextValue } from './SessionProfileReactContext';
import { useFlowChatStoreSelector } from '@/flow_chat/hooks/useFlowChatStoreSelector';
import { useWorkspaceSurfaceStore } from '../navigation/workspaceSurfaceStore';

export const SessionProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const activeSurface = useWorkspaceSurfaceStore((state) => state.activeSurface);
  const profileId = useFlowChatStoreSelector((state) => {
    const sessionId =
      activeSurface.kind === 'agentic-os-home'
        ? activeSurface.agenticOsSessionId
        : activeSurface.kind === 'session'
          ? activeSurface.sessionId
          : state.activeSessionId;
    return sessionId ? state.sessions.get(sessionId)?.descriptor?.profileId : undefined;
  });

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
