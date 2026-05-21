import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import type { AgentAction } from '../../../reducers/agentReducer';
import { resolveWorkspaceChatInputMode } from '../../../utils/chatInputMode';

const log = createLogger('ComposerAgentSync');

interface UseComposerAgentSyncParams {
  activeSessionMode?: string;
  currentAgent: string;
  dispatchMode: Dispatch<AgentAction>;
  effectiveTargetSessionId?: string | null;
}

function persistLastMode(mode: string) {
  try {
    sessionStorage.setItem('sparo:flowchat:lastMode', mode);
  } catch {
    // ignore
  }
}

export function useComposerAgentSync({
  activeSessionMode,
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
      const customEvent = event as CustomEvent<{ sessionId: string; mode: string }>;
      const { sessionId, mode } = customEvent.detail || {};

      if (sessionId && mode) {
        log.debug('Session switched, syncing mode', { sessionId, mode });
        dispatchMode({ type: 'SET_CURRENT_AGENT', payload: mode });
        persistLastMode(mode);
      }
    };

    window.addEventListener('sparo:session-switched', handleSessionSwitched);

    return () => {
      window.removeEventListener('sparo:session-switched', handleSessionSwitched);
    };
  }, [dispatchMode]);

  useEffect(() => {
    const nextMode = resolveWorkspaceChatInputMode({
      currentAgent,
      isAssistantWorkspace: false,
      sessionMode: activeSessionMode,
    });

    if (nextMode) {
      log.debug('Syncing mode with workspace and session', {
        sessionId: effectiveTargetSessionId,
        mode: nextMode,
        sessionMode: activeSessionMode,
      });
      dispatchMode({ type: 'SET_CURRENT_AGENT', payload: nextMode });
      persistLastMode(nextMode);
    }
  }, [activeSessionMode, currentAgent, dispatchMode, effectiveTargetSessionId]);
}
