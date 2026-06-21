export type {
  SessionProfile,
  SessionSidecarActionDescriptor,
  SessionSidecarActionResult,
  SessionSidecarIconId,
  TabAutoOpenDescriptor,
  TabAutoOpenResult,
} from './types';
export type {
  SessionDefaultSurface,
  SessionDisplayMode,
  SessionTypeDefinition,
} from './SessionProfileRegistry';
export {
  resolveProfile,
  resolveSessionTypeDefinition,
  resolveSessionTypeDefinitionForDescriptor,
  PROFILES,
  SESSION_TYPE_DEFINITIONS,
} from './SessionProfileRegistry';
export { SessionProfileProvider } from './SessionProfileProvider';
export { useSessionProfile } from './useSessionProfile';
export { openSessionSidecarPanel } from './sidecarActionController';

// Individual profiles (useful for type-checking in tests or profile-specific imports)
export { agenticOsProfile } from './profiles/agenticOsProfile';
export { codingProfile } from './profiles/codingProfile';
export { coworkProfile } from './profiles/coworkProfile';
export { designProfile } from './profiles/designProfile';
export { deepResearchProfile } from './profiles/deepResearchProfile';
export { liveAppStudioProfile } from './profiles/liveAppStudioProfile';
export { liveAppWorkbenchProfile } from './profiles/liveAppWorkbenchProfile';
