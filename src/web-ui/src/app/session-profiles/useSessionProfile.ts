import { useContext } from 'react';
import { SessionProfileContext, type SessionProfileContextValue } from './SessionProfileReactContext';

/**
 * Returns the profile for the currently active session.
 * Falls back to codingProfile when no session is active.
 */
export function useSessionProfile(): SessionProfileContextValue {
  return useContext(SessionProfileContext);
}
