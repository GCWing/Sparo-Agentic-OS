import { describe, expect, it } from 'vitest';
import {
  agenticOsProfile,
  codingProfile,
  productAppRuntimeProfile,
} from '@/app/session-profiles';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { resolveComposerSessionProfile } from './composerSessionProfile';

describe('resolveComposerSessionProfile', () => {
  it('uses the target session descriptor instead of the surrounding surface profile', () => {
    expect(resolveComposerSessionProfile({
      surfaceProfile: agenticOsProfile,
      targetDescriptor: SESSION_DESCRIPTORS.coding,
    })).toBe(codingProfile);
  });

  it('falls back to the surrounding surface profile when no target descriptor exists', () => {
    expect(resolveComposerSessionProfile({
      surfaceProfile: productAppRuntimeProfile,
      targetDescriptor: null,
    })).toBe(productAppRuntimeProfile);
  });
});
