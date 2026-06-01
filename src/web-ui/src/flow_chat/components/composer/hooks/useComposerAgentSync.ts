import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import type { AgentAction } from '../../../reducers/agentReducer';
import type { SessionDescriptor } from '../../../domain/sessionDescriptor';

const log = createLogger('ComposerAgentSync');

interface UseComposerAgentSyncParams {
  activeSessionDescriptor?: SessionDescriptor;
  currentAgent: string;
  dispatchMode: Dispatch<AgentAction>;
  effectiveTargetSessionId?: string | null;
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
  currentAgent,
  dispatchMode,
  effectiveTargetSessionId,
}: UseComposerAgentSyncParams) {
  useEffect(() => {
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

    const handleAgentConfigUpdated = () => {
      fetchAvailableAgents();
    };

    globalEventBus.on('agent:config:updated', handleAgentConfigUpdated);

    return () => {
      globalEventBus.off('agent:config:updated', handleAgentConfigUpdated);
    };
  }, [dispatchMode]);

  useEffect(() => {
    const handleSessionSwitched = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId: string; descriptor?: SessionDescriptor }>;
      const { sessionId, descriptor } = customEvent.detail || {};
      const agentId = descriptor?.agentPolicy.activeAgentId;

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
  }, [dispatchMode]);

  useEffect(() => {
    const nextMode = activeSessionDescriptor?.agentPolicy.activeAgentId;

    if (nextMode) {
      log.debug('Syncing mode with workspace and session', {
        sessionId: effectiveTargetSessionId,
        mode: nextMode,
        profileId: activeSessionDescriptor?.profileId,
      });
      dispatchMode({ type: 'SET_CURRENT_AGENT', payload: nextMode });
      persistLastMode(nextMode);
    }
  }, [activeSessionDescriptor, currentAgent, dispatchMode, effectiveTargetSessionId]);
}
