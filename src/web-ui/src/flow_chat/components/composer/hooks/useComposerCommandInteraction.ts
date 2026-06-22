import { useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  getComposerCommandTokenKey,
  NO_COMPOSER_INPUT_DETECTION,
  removeComposerInputTriggerToken,
  type ComposerInputDetection,
} from '../model/composerInputDetection';
import type { ComposerCommandOption } from '../model/composerCommandRegistry';
import {
  CLOSED_COMPOSER_COMMAND_INTERACTION,
  clearComposerCommandInteractionDismissal,
  closeComposerCommandInteraction,
  openComposerCommandInteraction,
  type ComposerCommandInteractionState,
} from '../model/composerState';

export function useComposerCommandInteraction({
  applyCommandOption,
  commandOptions,
  commandState,
  focusInputSoon,
  inputDetection,
  inputValue,
  onSwitchAgent,
  onDispatchAppAction,
  resolveCommandOption,
  setCommandState,
  setInputDetection,
  setInputValue,
  setQueuedInput,
}: {
  applyCommandOption: (option: ComposerCommandOption) => void;
  commandOptions: ComposerCommandOption[];
  commandState: ComposerCommandInteractionState;
  focusInputSoon: () => void;
  inputDetection: ComposerInputDetection;
  inputValue: string;
  onSwitchAgent: (agentId: string) => void;
  onDispatchAppAction?: (action: { providerId: string; actionId: string; payload?: unknown }) => void;
  resolveCommandOption: (rawToken: string) => ComposerCommandOption | null;
  setCommandState: Dispatch<SetStateAction<ComposerCommandInteractionState>>;
  setInputDetection: (detection: ComposerInputDetection) => void;
  setInputValue: (value: string) => void;
  setQueuedInput: (value: string | null) => void;
}) {
  const currentTokenKey = getComposerCommandTokenKey(inputDetection);
  const closeCommandPicker = useCallback((options?: { suppressCurrentToken?: boolean }) => {
    setCommandState(prev => closeComposerCommandInteraction(prev, {
      dismissTokenKey: options?.suppressCurrentToken ? currentTokenKey : null,
    }));
  }, [currentTokenKey, setCommandState]);

  const consumeCommandOption = useCallback((option: ComposerCommandOption) => {
    if (option.select.type === 'switch-agent') {
      onSwitchAgent(option.select.agentId);
    } else if (option.select.type === 'dispatch-app-action') {
      onDispatchAppAction?.({
        providerId: option.select.providerId,
        actionId: option.select.actionId,
        payload: option.select.payload,
      });
    } else {
      applyCommandOption(option);
    }

    const nextValue = removeComposerInputTriggerToken(inputValue, inputDetection);
    setInputValue(nextValue);
    setQueuedInput(null);
    setInputDetection(NO_COMPOSER_INPUT_DETECTION);
    closeCommandPicker();
    focusInputSoon();
  }, [
    applyCommandOption,
    closeCommandPicker,
    focusInputSoon,
    inputDetection,
    inputValue,
    onDispatchAppAction,
    onSwitchAgent,
    setInputDetection,
    setInputValue,
    setQueuedInput,
  ]);

  useEffect(() => {
    if (inputDetection.kind !== 'slash-command') {
      if (commandState.isOpen || commandState.dismissedTokenKey) {
        setCommandState(clearComposerCommandInteractionDismissal);
      }
      return;
    }

    const tokenKey = getComposerCommandTokenKey(inputDetection);
    if (tokenKey && commandState.dismissedTokenKey === tokenKey) {
      if (commandState.isOpen) {
        closeCommandPicker({ suppressCurrentToken: true });
      }
      return;
    }

    const exactOption = resolveCommandOption(inputDetection.rawToken);
    const shouldConsumeExactOption =
      exactOption &&
      (
        inputDetection.hasWhitespaceAfterToken ||
          exactOption.kind === 'operation' ||
          exactOption.kind === 'agent-switch' ||
          exactOption.kind === 'app-action' ||
          (
          exactOption.select.type === 'set-prompt-template' &&
          exactOption.select.prompt.arguments.length === 0
        )
      );

    if (shouldConsumeExactOption) {
      consumeCommandOption(exactOption);
      return;
    }

    if (!inputDetection.hasWhitespaceAfterToken) {
      setCommandState(prev => openComposerCommandInteraction(prev, {
        query: inputDetection.query,
        tokenKey,
      }));
      return;
    }

    setCommandState(CLOSED_COMPOSER_COMMAND_INTERACTION);
  }, [
    closeCommandPicker,
    commandState.dismissedTokenKey,
    commandState.isOpen,
    consumeCommandOption,
    inputDetection,
    resolveCommandOption,
    setCommandState,
  ]);

  useEffect(() => {
    if (!commandState.isOpen) return;
    setCommandState(prev => ({
      ...prev,
      selectedIndex: Math.max(0, Math.min(prev.selectedIndex, Math.max(0, commandOptions.length - 1))),
    }));
  }, [commandOptions.length, commandState.isOpen, setCommandState]);

  const moveCommandSelection = useCallback((delta: number) => {
    setCommandState(prev => ({
      ...prev,
      selectedIndex: Math.max(
        0,
        Math.min(prev.selectedIndex + delta, Math.max(0, commandOptions.length - 1)),
      ),
    }));
  }, [commandOptions.length, setCommandState]);

  const selectCommandOption = useCallback((option: ComposerCommandOption) => {
    consumeCommandOption(option);
  }, [consumeCommandOption]);

  const selectCurrentCommandOption = useCallback(() => {
    const option = commandOptions[commandState.selectedIndex];
    if (!option) return;
    consumeCommandOption(option);
  }, [commandOptions, commandState.selectedIndex, consumeCommandOption]);

  return {
    closeCommandPicker,
    moveCommandSelection,
    selectCommandOption,
    selectCurrentCommandOption,
  };
}
