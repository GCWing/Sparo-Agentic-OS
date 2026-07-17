import { describe, expect, it, vi } from 'vitest';
import type { SettingsFlowSessionIdentity } from './settingsFlowSessionApi';
import {
  adoptResetSettingsFlowSession,
  SettingsFlowSessionAdoptionError,
} from './settingsFlowSessionTransition';

const nextIdentity: SettingsFlowSessionIdentity = {
  sessionId: 'settings-new',
  sessionName: 'Settings',
  agentType: 'SettingsAgent',
  workspacePath: null,
  storageScope: 'agentic_os',
};

describe('adoptResetSettingsFlowSession', () => {
  it('publishes the new backend identity before detaching and attaching', async () => {
    const order: string[] = [];

    await adoptResetSettingsFlowSession({
      previousSessionId: 'settings-old',
      identity: nextIdentity,
      publishIdentity: (identity) => order.push(`publish:${identity.sessionId}`),
      detachPrevious: (sessionId) => order.push(`detach:${sessionId}`),
      attachIdentity: async (identity) => {
        order.push(`attach:${identity.sessionId}`);
      },
    });

    expect(order).toEqual([
      'publish:settings-new',
      'detach:settings-old',
      'attach:settings-new',
    ]);
  });

  it('keeps the new identity authoritative when history attachment fails', async () => {
    let authoritativeSessionId = 'settings-old';
    const detachPrevious = vi.fn();

    await expect(adoptResetSettingsFlowSession({
      previousSessionId: 'settings-old',
      identity: nextIdentity,
      publishIdentity: (identity) => {
        authoritativeSessionId = identity.sessionId;
      },
      detachPrevious,
      attachIdentity: async () => {
        throw new Error('history unavailable');
      },
    })).rejects.toMatchObject({
      name: 'SettingsFlowSessionAdoptionError',
      identity: nextIdentity,
    } satisfies Partial<SettingsFlowSessionAdoptionError>);

    expect(authoritativeSessionId).toBe('settings-new');
    expect(detachPrevious).toHaveBeenCalledWith('settings-old');
  });
});
