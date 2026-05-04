/**
 * Session Profile Registry.
 *
 * All registered profiles are tested in order; the first matching one wins.
 * If no profile matches, codingProfile is returned as the safe default.
 *
 * To add a new Agent: create a profile file under ./profiles/ and add it to PROFILES.
 */

import type { SessionProfile } from './types';
import { dispatcherProfile } from './profiles/dispatcherProfile';
import { codingProfile } from './profiles/codingProfile';
import { coworkProfile } from './profiles/coworkProfile';
import { designProfile } from './profiles/designProfile';
import { deepResearchProfile } from './profiles/deepResearchProfile';
import { liveAppStudioProfile } from './profiles/liveAppStudioProfile';
import { agentAppStudioProfile } from './profiles/agentAppStudioProfile';

/**
 * Ordered list of all registered profiles.
 * More-specific matchers should come before broader ones (e.g. dispatcher before coding).
 */
const PROFILES: readonly SessionProfile[] = [
  dispatcherProfile,
  liveAppStudioProfile,
  agentAppStudioProfile,
  coworkProfile,
  designProfile,
  deepResearchProfile,
  codingProfile, // broadest matcher — also serves as the fallback
];

/**
 * Resolve the profile for a given session mode string.
 * Returns codingProfile when mode is null/undefined or unrecognised.
 */
export function resolveProfile(mode?: string | null): SessionProfile {
  for (const profile of PROFILES) {
    if (profile.matches(mode)) {
      return profile;
    }
  }
  return codingProfile;
}

export { PROFILES };
