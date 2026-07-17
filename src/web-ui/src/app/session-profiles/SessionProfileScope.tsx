import React, { useMemo } from 'react';
import type { SessionProfileId } from '@/flow_chat/domain/sessionDescriptor';
import { resolveProfile } from './SessionProfileRegistry';
import { SessionProfileContext, type SessionProfileContextValue } from './SessionProfileReactContext';

export interface SessionProfileScopeProps {
  profileId: SessionProfileId;
  children: React.ReactNode;
}

/**
 * Resolves a profile for an explicitly embedded session surface.
 * This keeps nested FlowChat surfaces independent from workspace navigation focus.
 */
export function SessionProfileScope({ profileId, children }: SessionProfileScopeProps) {
  const value = useMemo<SessionProfileContextValue>(
    () => ({ profile: resolveProfile(profileId) }),
    [profileId],
  );

  return (
    <SessionProfileContext.Provider value={value}>
      {children}
    </SessionProfileContext.Provider>
  );
}
