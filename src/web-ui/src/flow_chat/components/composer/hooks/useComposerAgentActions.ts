import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { AgentAction, AgentInfo } from '../../../reducers/agentReducer';

export function useComposerAgentActions({
  canSwitchAgents,
  currentAgent,
  dispatchMode,
  effectiveTargetSessionId,
  switchableAgents,
}: {
  canSwitchAgents: boolean;
  currentAgent: string;
  dispatchMode: Dispatch<AgentAction>;
  effectiveTargetSessionId?: string | null;
  switchableAgents: AgentInfo[];
}) {
  const applyAgentChange = useCallback((agentId: string) => {
    dispatchMode({
      type: 'SET_CURRENT_AGENT',
      payload: agentId,
    });

    try {
      sessionStorage.setItem('sparo:flowchat:lastAgent', agentId);
    } catch {
      // ignore
    }

    if (effectiveTargetSessionId) {
      FlowChatStore.getInstance().updateSessionActiveAgent(effectiveTargetSessionId, agentId);
    }
  }, [dispatchMode, effectiveTargetSessionId]);

  const requestAgentChange = useCallback((agentId: string) => {
    if (!canSwitchAgents || agentId === currentAgent || !switchableAgents.some(agent => agent.id === agentId)) {
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      return;
    }

    applyAgentChange(agentId);
    dispatchMode({ type: 'CLOSE_DROPDOWN' });
  }, [applyAgentChange, canSwitchAgents, currentAgent, dispatchMode, switchableAgents]);

  return {
    applyAgentChange,
    requestAgentChange,
  };
}
