import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ContextItem } from '../../../../shared/types/context';
import type { InputAction } from '../../../reducers/inputReducer';
import type { SessionDerivedState } from '../../../state-machine/types';
import type { ComposerSlashCommandState } from '../model/composerState';
import type { SlashMcpPromptItem } from '../model/composerCommands';

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'modes',
  query: '',
  selectedIndex: 0,
};

export function useComposerTextInput({
  contexts,
  derivedState,
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

    const trimmedLower = text.trim().toLowerCase();
    const isBtwCommand = trimmedLower.startsWith('/btw');
    const isCompactCommand = trimmedLower.startsWith('/compact');
    const isScanHostCommand = trimmedLower.startsWith('/scan_host');
    const isProcessing = !!derivedState?.isProcessing;

    if (derivedState?.isProcessing && !isBtwCommand && !isCompactCommand && !isScanHostCommand) {
      setQueuedInput(text);
    }

    if (text.startsWith('/')) {
      const afterSlash = text.slice(1);
      const hasWhitespace = /\s/.test(afterSlash);
      const firstToken = afterSlash.trimStart().split(/\s+/, 1)[0]?.toLowerCase?.() ?? '';
      const query = firstToken;
      const matchedMcpPrompt = resolveTypedMcpPromptCommand(text);

      if (isProcessing) {
        if (!hasWhitespace && (query === '' || query.startsWith('b') || query.startsWith('s'))) {
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

      if (!isBtwCommand && !isCompactCommand && !isScanHostCommand && !matchedMcpPrompt) {
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
