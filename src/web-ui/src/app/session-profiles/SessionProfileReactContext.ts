import { createContext } from 'react';
import type { SessionProfile } from './types';
import { runnoProfile } from './profiles/runnoProfile';

export interface SessionProfileContextValue {
  profile: SessionProfile;
}

export const SessionProfileContext = createContext<SessionProfileContextValue>({
  profile: runnoProfile,
});
