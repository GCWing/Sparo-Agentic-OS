import {
  resolveProfile,
  type SessionProfile,
} from '@/app/session-profiles';
import type { SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';

export function resolveComposerSessionProfile({
  surfaceProfile,
  targetDescriptor,
}: {
  surfaceProfile: SessionProfile;
  targetDescriptor?: SessionDescriptor | null;
}): SessionProfile {
  return resolveProfile(targetDescriptor?.profileId ?? surfaceProfile.id);
}
