import { useCallback, useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { AgentInfo } from '../../../reducers/agentReducer';
import type { ComposerMcpPromptCommand } from '../model/composerCommands';
import {
  getComposerCommandOptions,
  resolveComposerCommandOption,
  type ComposerCommandContext,
} from '../model/composerCommandRegistry';
import type { ComposerCommandInteractionState } from '../model/composerState';
import type { ComposerInputDetection } from '../model/composerInputDetection';

export function useComposerCommandOptions({
  t,
  commandContext,
  commandState,
  inputDetection,
  incrementalAgents,
  loadMcpPromptCommands,
  mcpPromptCommands,
}: {
  t: TFunction<'flow-chat'>;
  commandContext: ComposerCommandContext;
  commandState: ComposerCommandInteractionState;
  inputDetection: ComposerInputDetection;
  incrementalAgents: AgentInfo[];
  loadMcpPromptCommands: () => Promise<void>;
  mcpPromptCommands: ComposerMcpPromptCommand[];
}) {
  useEffect(() => {
    if (commandContext.isProcessing) return;
    if (!commandState.isOpen && inputDetection.kind !== 'slash-command') return;
    void loadMcpPromptCommands();
  }, [
    commandContext.isProcessing,
    commandState.isOpen,
    inputDetection.kind,
    loadMcpPromptCommands,
  ]);

  const allCommandOptions = useMemo(() => getComposerCommandOptions({
    t,
    context: commandContext,
    incrementalAgents,
    mcpPromptCommands,
    query: '',
  }), [commandContext, incrementalAgents, mcpPromptCommands, t]);

  const commandOptions = useMemo(() => getComposerCommandOptions({
    t,
    context: commandContext,
    incrementalAgents,
    mcpPromptCommands,
    query: commandState.query,
  }), [commandContext, commandState.query, incrementalAgents, mcpPromptCommands, t]);

  const resolveCommandOption = useCallback((rawToken: string) => (
    resolveComposerCommandOption(allCommandOptions, rawToken)
  ), [allCommandOptions]);

  return {
    allCommandOptions,
    commandOptions,
    resolveCommandOption,
  };
}
