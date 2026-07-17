import { describe, expect, it } from 'vitest';
import { settingsProfile } from './settingsProfile';

describe('settingsProfile', () => {
  it('restricts the embedded composer to plain settings conversation', () => {
    expect(settingsProfile.workspaceScope.kind).toBe('global');
    expect(settingsProfile.composer?.agentSwitching).toEqual({ mode: 'disabled' });
    expect(settingsProfile.composer?.builtIns).toMatchObject({
      'attach-context': 'hidden',
      'attach-image': 'hidden',
      skills: 'hidden',
      btw: 'hidden',
      goal: 'hidden',
      compact: 'hidden',
      init: 'hidden',
      'prompt-template': 'hidden',
    });
    expect(settingsProfile.composer?.showModelSelector).toBe(false);
    expect(settingsProfile.composer?.showVoiceInput).toBe(false);
    expect(settingsProfile.composer?.allowContextInput).toBe(false);
    expect(settingsProfile.capabilities.autoTitle).toBe(false);
    expect(settingsProfile.capabilities.modelSelection).toBe('runtime-owned');
    expect(settingsProfile.messageActions).toEqual({
      showUserEdit: false,
      showUserRecovery: false,
      showUserRollback: false,
      showAssistantFork: false,
      showAssistantExport: false,
    });
  });
});
