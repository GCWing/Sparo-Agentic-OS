/**
 * Session Profile Registry.
 *
 * All registered profiles are tested in order; the first matching one wins.
 * If no profile matches, codingProfile is returned as the safe default.
 *
 * To add a new Agent: create a profile file under ./profiles/ and add it to PROFILES.
 */

import type { SessionProfile } from './types';
import { agenticOsProfile } from './profiles/agenticOsProfile';
import { codingProfile } from './profiles/codingProfile';
import { coworkProfile } from './profiles/coworkProfile';
import { designProfile } from './profiles/designProfile';
import { deepResearchProfile } from './profiles/deepResearchProfile';
import { liveAppStudioProfile } from './profiles/liveAppStudioProfile';
import { liveAppWorkbenchProfile } from './profiles/liveAppWorkbenchProfile';
import { agentAppStudioProfile } from './profiles/agentAppStudioProfile';
import type { SessionProfileId } from '@/flow_chat/domain/sessionDescriptor';

/**
 * Ordered list of all registered profiles.
 * More-specific matchers should come before broader ones (e.g. Agentic OS before coding).
 */
const PROFILES: readonly SessionProfile[] = [
  agenticOsProfile,
  liveAppWorkbenchProfile,
  liveAppStudioProfile,
  agentAppStudioProfile,
  coworkProfile,
  designProfile,
  deepResearchProfile,
  codingProfile, // broadest matcher — also serves as the fallback
];

const PROFILES_BY_ID = new Map<SessionProfileId | string, SessionProfile>(
  PROFILES.map(profile => [profile.id, profile])
);

export function resolveProfile(profileId?: SessionProfileId | string | null): SessionProfile {
  if (profileId === 'dispatcher') return agenticOsProfile;
  return (profileId && PROFILES_BY_ID.get(profileId)) || codingProfile;
}

export { PROFILES };
