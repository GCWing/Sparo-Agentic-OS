import type { ContextBudgetSnapshot } from '@/flow_chat/types/flow-chat';
import type {
  DialogTurnData,
  SessionDomain,
  SessionLocator,
  SessionMetadata,
} from '@/shared/types/session-history';
import { createTauriCommandError } from '../errors/TauriCommandError';
import { api } from './ApiClient';

export class SessionAPI {
  async getContextBudget(
    locator: SessionLocator,
    agentType: string,
    workspacePath?: string,
    modelId?: string,
  ): Promise<ContextBudgetSnapshot> {
    try {
      return await api.invoke('get_context_budget', {
        request: {
          locator,
          agent_type: agentType,
          workspace_path: workspacePath,
          model_id: modelId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('get_context_budget', error, {
        locator,
        agentType,
        workspacePath,
        modelId,
      });
    }
  }

  async forkSession(
    source: SessionLocator,
    sourceTurnId: string,
  ): Promise<{ sessionId: string; sessionName: string; agentType: string }> {
    try {
      return await api.invoke('fork_session', {
        request: {
          source,
          source_turn_id: sourceTurnId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('fork_session', error, { source, sourceTurnId });
    }
  }

  async listSessions(domain: SessionDomain): Promise<SessionMetadata[]> {
    try {
      return await api.invoke('list_persisted_sessions', {
        request: { domain },
      });
    } catch (error) {
      throw createTauriCommandError('list_persisted_sessions', error, { domain });
    }
  }

  async loadSessionTurns(locator: SessionLocator, limit?: number): Promise<DialogTurnData[]> {
    try {
      const request: Record<string, unknown> = { locator };
      if (limit !== undefined) request.limit = limit;
      return await api.invoke('load_session_turns', { request });
    } catch (error) {
      throw createTauriCommandError('load_session_turns', error, { locator, limit });
    }
  }

  async saveSessionTurn(turnData: DialogTurnData, domain: SessionDomain): Promise<void> {
    try {
      await api.invoke('save_session_turn', {
        request: { turn_data: turnData, domain },
      });
    } catch (error) {
      throw createTauriCommandError('save_session_turn', error, { turnData, domain });
    }
  }

  async saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
    try {
      await api.invoke('save_session_metadata', {
        request: { metadata },
      });
    } catch (error) {
      throw createTauriCommandError('save_session_metadata', error, { metadata });
    }
  }

  async deleteSession(locator: SessionLocator): Promise<void> {
    try {
      await api.invoke('delete_persisted_session', {
        request: { locator },
      });
    } catch (error) {
      throw createTauriCommandError('delete_persisted_session', error, { locator });
    }
  }

  async touchSessionActivity(locator: SessionLocator): Promise<void> {
    try {
      await api.invoke('touch_session_activity', {
        request: { locator },
      });
    } catch (error) {
      throw createTauriCommandError('touch_session_activity', error, { locator });
    }
  }

  async loadSessionMetadata(locator: SessionLocator): Promise<SessionMetadata | null> {
    try {
      return await api.invoke('load_persisted_session_metadata', {
        request: { locator },
      });
    } catch (error) {
      throw createTauriCommandError('load_persisted_session_metadata', error, { locator });
    }
  }
}

export const sessionAPI = new SessionAPI();
