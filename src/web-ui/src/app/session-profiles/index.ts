export type { SessionProfile, TabAutoOpenDescriptor } from './types';
export { resolveProfile, PROFILES } from './SessionProfileRegistry';
export { SessionProfileProvider } from './SessionProfileProvider';
export { useSessionProfile } from './useSessionProfile';

// Individual profiles (useful for type-checking in tests or profile-specific imports)
export { dispatcherProfile } from './profiles/dispatcherProfile';
export { codingProfile } from './profiles/codingProfile';
export { coworkProfile } from './profiles/coworkProfile';
export { designProfile } from './profiles/designProfile';
export { deepResearchProfile } from './profiles/deepResearchProfile';
export { liveAppStudioProfile } from './profiles/liveAppStudioProfile';
