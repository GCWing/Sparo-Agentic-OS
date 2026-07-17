import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { invoke },
}));

import { settingsFlowSessionApi } from './settingsFlowSessionApi';

const identity = {
  sessionId: 'settings-session-1',
  sessionName: 'Settings',
  agentType: 'SettingsAgent' as const,
  workspacePath: null,
  storageScope: 'agentic_os' as const,
};

describe('settingsFlowSessionApi', () => {
  beforeEach(() => invoke.mockReset());

  it('ensures the app-lifetime settings session', async () => {
    invoke.mockResolvedValue(identity);

    await expect(settingsFlowSessionApi.ensure()).resolves.toEqual(identity);
    expect(invoke).toHaveBeenCalledWith('ensure_settings_flow_session', {});
  });

  it('resets the current session through the owning lifecycle command', async () => {
    invoke.mockResolvedValue({ ...identity, sessionId: 'settings-session-2' });

    await expect(settingsFlowSessionApi.reset('settings-session-1')).resolves.toMatchObject({
      sessionId: 'settings-session-2',
    });
    expect(invoke).toHaveBeenCalledWith('reset_settings_flow_session', {
      request: { sessionId: 'settings-session-1' },
    });
  });

  it('rejects a response that is not a trusted settings identity', async () => {
    invoke.mockResolvedValue({ ...identity, agentType: 'Runno' });

    await expect(settingsFlowSessionApi.ensure()).rejects.toThrow();
  });

  it('requires the backend-owned fixed session title', async () => {
    invoke.mockResolvedValue({ ...identity, sessionName: '' });

    await expect(settingsFlowSessionApi.ensure()).rejects.toThrow();
  });
});
