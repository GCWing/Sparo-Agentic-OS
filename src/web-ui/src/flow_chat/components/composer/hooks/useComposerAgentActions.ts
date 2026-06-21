import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { InputAction } from '../../../reducers/inputReducer';
import type { AgentAction, AgentInfo } from '../../../reducers/agentReducer';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { SlashMcpPromptItem } from '../model/composerCommands';
import {
  buildInputForSelectedBuiltinSlashCommand,
  type BuiltinSlashCommandContext,
} from '../model/builtinSlashCommands';
import type { ComposerSlashCommandState } from '../model/composerState';

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'agents',
  query: '',
  selectedIndex: 0,
};

export function useComposerAgentActions({
  canSwitchAgents,
  currentAgent,
  builtinCommandContext,
  dispatchInput,
  dispatchMode,
  effectiveTargetSessionId,
  inputValue,
  richTextInputRef,
  setQueuedInput,
  setSlashCommandState,
  switchableAgents,
}: {
  canSwitchAgents: boolean;
  currentAgent: string;
  builtinCommandContext: BuiltinSlashCommandContext;
  dispatchInput: Dispatch<InputAction>;
  dispatchMode: Dispatch<AgentAction>;
  effectiveTargetSessionId?: string | null;
  inputValue: string;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
  setQueuedInput: (value: string | null) => void;
  setSlashCommandState: Dispatch<SetStateAction<ComposerSlashCommandState>>;
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

  const selectSlashCommandAgent = useCallback((agentId: string) => {
    requestAgentChange(agentId);
    dispatchInput({ type: 'CLEAR_VALUE' });
    setSlashCommandState(closedSlashState);
  }, [dispatchInput, requestAgentChange, setSlashCommandState]);

  const selectSlashCommandAction = useCallback((actionId: string) => {
    const next = buildInputForSelectedBuiltinSlashCommand(
      actionId,
      inputValue || '',
      builtinCommandContext,
    );

    if (next === null) {
      return;
    }

    dispatchInput({ type: 'SET_VALUE', payload: next });
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);
    window.setTimeout(() => richTextInputRef.current?.focus(), 0);
  }, [
    builtinCommandContext,
    dispatchInput,
    inputValue,
    richTextInputRef,
    setQueuedInput,
    setSlashCommandState,
  ]);

  const selectSlashPromptCommand = useCallback((item: SlashMcpPromptItem) => {
    const hasArguments = item.arguments.length > 0;
    dispatchInput({
      type: 'SET_VALUE',
      payload: hasArguments ? `${item.command} ` : item.command,
    });
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);
    window.setTimeout(() => richTextInputRef.current?.focus(), 0);
  }, [dispatchInput, richTextInputRef, setQueuedInput, setSlashCommandState]);

  return {
    applyAgentChange,
    requestAgentChange,
    selectSlashCommandAction,
    selectSlashCommandAgent,
    selectSlashPromptCommand,
  };
}
