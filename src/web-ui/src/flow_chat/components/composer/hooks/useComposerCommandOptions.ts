import { useCallback, useEffect, useMemo } from 'react';
import type { ComposerActionDescriptor } from '../actions/composerActionTypes';
import {
  getComposerCommandOptions,
  resolveComposerCommandOption,
  type ComposerCommandContext,
} from '../model/composerCommandRegistry';
import type { ComposerCommandInteractionState } from '../model/composerState';
import type { ComposerInputDetection } from '../model/composerInputDetection';

export function useComposerCommandOptions({
  actions,
  commandContext,
  commandState,
  inputDetection,
  loadMcpPromptCommands,
}: {
  actions: ComposerActionDescriptor[];
  commandContext: ComposerCommandContext;
  commandState: ComposerCommandInteractionState;
  inputDetection: ComposerInputDetection;
  loadMcpPromptCommands: () => Promise<void>;
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
    actions,
    query: '',
  }), [actions]);

  const commandOptions = useMemo(() => getComposerCommandOptions({
    actions,
    query: commandState.query,
  }), [actions, commandState.query]);

  const resolveCommandOption = useCallback((rawToken: string) => (
    resolveComposerCommandOption(allCommandOptions, rawToken)
  ), [allCommandOptions]);

  return {
    allCommandOptions,
    commandOptions,
    resolveCommandOption,
  };
}
