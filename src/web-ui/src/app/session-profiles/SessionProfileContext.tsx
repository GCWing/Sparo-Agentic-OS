/**
 * SessionProfileContext — React Context for the active session's profile.
 *
 * SessionProfileProvider reads the active session mode from headerStore,
 * resolves the matching SessionProfile, and makes it available to the entire
 * component tree via useSessionProfile().
 *
 * The resolved profile object is a module-level constant, so the Context value
 * reference only changes when the session type actually switches — no spurious
 * re-renders for consumers.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useHeaderStore } from '../stores/headerStore';
import { resolveProfile } from './SessionProfileRegistry';
import type { SessionProfile } from './types';
import { codingProfile } from './profiles/codingProfile';

interface SessionProfileContextValue {
  profile: SessionProfile;
}

const SessionProfileContext = createContext<SessionProfileContextValue>({
  profile: codingProfile,
});

export const SessionProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mode = useHeaderStore((s) => s.sessionContext?.mode);

  const value = useMemo<SessionProfileContextValue>(
    () => ({ profile: resolveProfile(mode) }),
    // resolveProfile returns the same constant object for the same mode string,
    // so this only creates a new object when `mode` actually changes.
    [mode],
  );

  return (
    <SessionProfileContext.Provider value={value}>
      {children}
    </SessionProfileContext.Provider>
  );
};

/**
 * Returns the profile for the currently active session.
 * Falls back to codingProfile when no session is active.
 */
export function useSessionProfile(): SessionProfileContextValue {
  return useContext(SessionProfileContext);
}
