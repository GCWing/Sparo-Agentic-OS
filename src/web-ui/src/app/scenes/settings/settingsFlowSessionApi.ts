import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import { api } from '@/infrastructure/api/service-api/ApiClient';

export interface SettingsFlowSessionIdentity {
  sessionId: string;
  sessionName: string;
  agentType: 'SettingsAgent';
  workspacePath?: string | null;
  storageScope: 'agentic_os';
}

function validateIdentity(value: SettingsFlowSessionIdentity): SettingsFlowSessionIdentity {
  if (
    !value?.sessionId?.trim()
    || !value.sessionName?.trim()
    || value.agentType !== 'SettingsAgent'
    || value.storageScope !== 'agentic_os'
  ) {
    throw new Error('Invalid settings FlowChat session identity');
  }
  return value;
}

export const settingsFlowSessionApi = {
  async ensure(): Promise<SettingsFlowSessionIdentity> {
    try {
      const identity = await api.invoke<SettingsFlowSessionIdentity>(
        'ensure_settings_flow_session',
        {},
      );
      return validateIdentity(identity);
    } catch (error) {
      throw createTauriCommandError('ensure_settings_flow_session', error);
    }
  },

  async reset(sessionId: string): Promise<SettingsFlowSessionIdentity> {
    try {
      const identity = await api.invoke<SettingsFlowSessionIdentity>(
        'reset_settings_flow_session',
        { request: { sessionId } },
      );
      return validateIdentity(identity);
    } catch (error) {
      throw createTauriCommandError('reset_settings_flow_session', error, { sessionId });
    }
  },
};
