import { createContext } from 'react';
import type { SessionProfile } from './types';
import { codingProfile } from './profiles/codingProfile';

export interface SessionProfileContextValue {
  profile: SessionProfile;
}

export const SessionProfileContext = createContext<SessionProfileContextValue>({
  profile: codingProfile,
});
