import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ContextItem } from '../../../../shared/types/context';
import type { InputAction } from '../../../reducers/inputReducer';
import type { SessionDerivedState } from '../../../state-machine/types';
import type { ComposerSlashCommandState } from '../model/composerState';
import type { SlashMcpPromptItem } from '../model/composerCommands';
import {
  parseSlashCommandDraft,
  resolveTypedBuiltinSlashCommand,
  shouldKeepInputOutOfTurnQueue,
  shouldOpenBuiltinActionsWhileProcessing,
  type BuiltinSlashCommandContext,
} from '../model/builtinSlashCommands';

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'agents',
  query: '',
  selectedIndex: 0,
};

export function useComposerTextInput({
  contexts,
  derivedState,
  builtinCommandContext,
  dispatchInput,
  inputIsActive,
  inputValueRef,
  prunePendingLargePastes,
  removeContext,
  resolveTypedMcpPromptCommand,
  setQueuedInput,
  setSlashCommandState,
  slashCommandState,
}: {
  contexts: ContextItem[];
  derivedState: SessionDerivedState | null;
  builtinCommandContext: BuiltinSlashCommandContext;
  dispatchInput: Dispatch<InputAction>;
  inputIsActive: boolean;
  inputValueRef: MutableRefObject<string>;
  prunePendingLargePastes: (text: string) => void;
  removeContext: (id: string) => void;
  resolveTypedMcpPromptCommand: (text: string) => SlashMcpPromptItem | null;
  setQueuedInput: (value: string | null) => void;
  setSlashCommandState: Dispatch<SetStateAction<ComposerSlashCommandState>>;
  slashCommandState: ComposerSlashCommandState;
}) {
  return useCallback((text: string, activeContexts: ContextItem[]) => {
    if (!inputIsActive && text.length > 0) {
      dispatchInput({ type: 'ACTIVATE' });
    }

    const activeContextIds = new Set(activeContexts.map(context => context.id));
    contexts.forEach(context => {
      if (context.type === 'image') return;
      if (!activeContextIds.has(context.id)) {
        removeContext(context.id);
      }
    });

    prunePendingLargePastes(text);
    dispatchInput({ type: 'SET_VALUE', payload: text });
    inputValueRef.current = text;

    const isProcessing = !!derivedState?.isProcessing;
    const shouldBypassQueue = shouldKeepInputOutOfTurnQueue(text);

    if (derivedState?.isProcessing && !shouldBypassQueue) {
      setQueuedInput(text);
    }

    const slashDraft = parseSlashCommandDraft(text);
    if (slashDraft.hasLeadingSlash) {
      const { hasWhitespaceAfterCommandToken, query } = slashDraft;
      const matchedMcpPrompt = resolveTypedMcpPromptCommand(text);
      const matchedBuiltinCommand = resolveTypedBuiltinSlashCommand(text, builtinCommandContext);

      if (isProcessing) {
        if (!hasWhitespaceAfterCommandToken && shouldOpenBuiltinActionsWhileProcessing(query)) {
          setSlashCommandState({
            isActive: true,
            kind: 'actions',
            query,
            selectedIndex: 0,
          });
        } else if (slashCommandState.isActive && slashCommandState.kind === 'actions') {
          setSlashCommandState(closedSlashState);
        }
        return;
      }

      if (!matchedBuiltinCommand && !matchedMcpPrompt) {
        setSlashCommandState({
          isActive: true,
          kind: 'all',
          query,
          selectedIndex: 0,
        });
        return;
      }
    }

    if (slashCommandState.isActive) {
      setSlashCommandState(closedSlashState);
    }
  }, [
    builtinCommandContext,
    contexts,
    derivedState?.isProcessing,
    dispatchInput,
    inputIsActive,
    inputValueRef,
    prunePendingLargePastes,
    removeContext,
    resolveTypedMcpPromptCommand,
    setQueuedInput,
    setSlashCommandState,
    slashCommandState.isActive,
    slashCommandState.kind,
  ]);
}
