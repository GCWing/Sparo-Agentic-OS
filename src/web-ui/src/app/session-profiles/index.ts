export type {
  SessionComposerActionProviderId,
  SessionComposerActionAvailability,
  SessionComposerAgentSwitching,
  SessionComposerBuiltinActionId,
  SessionComposerPolicy,
  SessionAgentContextHint,
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
export { SessionProfileScope } from './SessionProfileScope';
export { useSessionProfile } from './useSessionProfile';
export { openSessionSidecarPanel } from './sidecarActionController';

// Individual profiles (useful for type-checking in tests or profile-specific imports)
export { agenticOsProfile } from './profiles/agenticOsProfile';
export { runnoProfile } from './profiles/runnoProfile';
export { bitfunCoderProfile } from './profiles/bitfunCoderProfile';
export { coworkProfile } from './profiles/coworkProfile';
export { designProfile } from './profiles/designProfile';
export { deepResearchProfile } from './profiles/deepResearchProfile';
export { appBuilderProfile } from './profiles/appBuilderProfile';
export { settingsProfile } from './profiles/settingsProfile';
export { productAppRuntimeProfile } from './profiles/productAppRuntimeProfile';
