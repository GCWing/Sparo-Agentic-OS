
import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { SessionMetadata, DialogTurnData, SessionStorageScope } from '@/shared/types/session-history';
import type { ContextBudgetSnapshot } from '@/flow_chat/types/flow-chat';

function storageScopeField(storageScope?: SessionStorageScope): Record<string, string> {
  const o: Record<string, string> = {};
  if (storageScope) {
    o.storage_scope = storageScope;
  }
  return o;
}

export class SessionAPI {
  async getContextBudget(
    sessionId: string,
    agentType: string,
    workspacePath?: string,
    modelId?: string,
    storageScope?: SessionStorageScope
  ): Promise<ContextBudgetSnapshot> {
    try {
      return await api.invoke('get_context_budget', {
        request: {
          session_id: sessionId,
          agent_type: agentType,
          workspace_path: workspacePath,
          model_id: modelId,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('get_context_budget', error, { sessionId, agentType, workspacePath, modelId, storageScope });
    }
  }

  async forkSession(
    sourceSessionId: string,
    sourceTurnId: string,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<{ sessionId: string; sessionName: string; agentType: string }> {
    try {
      return await api.invoke('fork_session', {
        request: {
          source_session_id: sourceSessionId,
          source_turn_id: sourceTurnId,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('fork_session', error, {
        sourceSessionId,
        sourceTurnId,
        workspacePath,
      });
    }
  }

  async listSessions(
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<SessionMetadata[]> {
    try {
      return await api.invoke('list_persisted_sessions', {
        request: {
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('list_persisted_sessions', error, { workspacePath });
    }
  }

  async loadSessionTurns(
    sessionId: string,
    workspacePath?: string,
    limit?: number,
    storageScope?: SessionStorageScope
  ): Promise<DialogTurnData[]> {
    try {
      const request: Record<string, unknown> = {
        session_id: sessionId,
        workspace_path: workspacePath,
        ...storageScopeField(storageScope),
      };

      if (limit !== undefined) {
        request.limit = limit;
      }

      return await api.invoke('load_session_turns', {
        request
      });
    } catch (error) {
      throw createTauriCommandError('load_session_turns', error, { sessionId, workspacePath, limit });
    }
  }

  async saveSessionTurn(
    turnData: DialogTurnData,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<void> {
    try {
      await api.invoke('save_session_turn', {
        request: {
          turn_data: turnData,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('save_session_turn', error, { turnData, workspacePath });
    }
  }

  async saveSessionMetadata(
    metadata: SessionMetadata,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<void> {
    try {
      await api.invoke('save_session_metadata', {
        request: {
          metadata,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('save_session_metadata', error, { metadata, workspacePath });
    }
  }

  async deleteSession(
    sessionId: string,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<void> {
    try {
      await api.invoke('delete_persisted_session', {
        request: {
          session_id: sessionId,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('delete_persisted_session', error, { sessionId, workspacePath });
    }
  }

  async touchSessionActivity(
    sessionId: string,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<void> {
    try {
      await api.invoke('touch_session_activity', {
        request: {
          session_id: sessionId,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('touch_session_activity', error, { sessionId, workspacePath });
    }
  }

  async loadSessionMetadata(
    sessionId: string,
    workspacePath?: string,
    storageScope?: SessionStorageScope
  ): Promise<SessionMetadata | null> {
    try {
      return await api.invoke('load_persisted_session_metadata', {
        request: {
          session_id: sessionId,
          workspace_path: workspacePath,
          ...storageScopeField(storageScope),
        }
      });
    } catch (error) {
      throw createTauriCommandError('load_persisted_session_metadata', error, { sessionId, workspacePath });
    }
  }
}

export const sessionAPI = new SessionAPI();
