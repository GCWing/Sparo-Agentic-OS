import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { createLogger } from '@/shared/utils/logger';
import type { AgentAction } from '../../../reducers/agentReducer';
import type { SessionDescriptor } from '../../../domain/sessionDescriptor';

const log = createLogger('ComposerAgentSync');

interface UseComposerAgentSyncParams {
  activeSessionDescriptor?: SessionDescriptor;
  dispatchMode: Dispatch<AgentAction>;
  explicitTargetSessionId?: string | null;
  effectiveTargetSessionId?: string | null;
  allowGlobalAgentSync?: boolean;
}

function persistLastMode(mode: string) {
  try {
    sessionStorage.setItem('sparo:flowchat:lastAgent', mode);
  } catch {
    // ignore
  }
}

export function useComposerAgentSync({
  activeSessionDescriptor,
  dispatchMode,
  explicitTargetSessionId,
  effectiveTargetSessionId,
  allowGlobalAgentSync = true,
}: UseComposerAgentSyncParams) {
  const activeAgentId = activeSessionDescriptor?.agentPolicy.activeAgentId;
  const activeProfileId = activeSessionDescriptor?.profileId;

  useEffect(() => {
    if (!allowGlobalAgentSync) return;

    const fetchAvailableAgents = async () => {
      try {
        const { agentAPI } = await import('@/infrastructure/api/service-api/AgentAPI');
        const agents = await agentAPI.listAgents();
        dispatchMode({ type: 'SET_AVAILABLE_AGENTS', payload: agents });
      } catch (error) {
        log.error('Failed to fetch available agents', { error });
      }
    };

    fetchAvailableAgents();

    return configManager.watch('core.ai.agent_capability_configs', () => {
      void fetchAvailableAgents();
    });
  }, [allowGlobalAgentSync, dispatchMode]);

  useEffect(() => {
    if (!allowGlobalAgentSync) return;

    const handleSessionSwitched = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId: string; descriptor?: SessionDescriptor }>;
      const { sessionId, descriptor } = customEvent.detail || {};
      const agentId = descriptor?.agentPolicy.activeAgentId;
      const pinnedSessionId = explicitTargetSessionId ?? effectiveTargetSessionId;

      if (pinnedSessionId && sessionId !== pinnedSessionId) {
        return;
      }

      if (sessionId && agentId) {
        log.debug('Session switched, syncing active agent', { sessionId, agentId });
        dispatchMode({ type: 'SET_CURRENT_AGENT', payload: agentId });
        persistLastMode(agentId);
      }
    };

    window.addEventListener('sparo:session-switched', handleSessionSwitched);

    return () => {
      window.removeEventListener('sparo:session-switched', handleSessionSwitched);
    };
  }, [allowGlobalAgentSync, dispatchMode, effectiveTargetSessionId, explicitTargetSessionId]);

  useEffect(() => {
    const nextMode = activeAgentId;

    if (nextMode) {
      log.debug('Syncing mode with workspace and session', {
        sessionId: effectiveTargetSessionId,
        mode: nextMode,
        profileId: activeProfileId,
      });
      dispatchMode({ type: 'SET_CURRENT_AGENT', payload: nextMode });
      if (allowGlobalAgentSync) {
        persistLastMode(nextMode);
      }
    }
  }, [
    activeAgentId,
    activeProfileId,
    allowGlobalAgentSync,
    dispatchMode,
    effectiveTargetSessionId,
  ]);
}
