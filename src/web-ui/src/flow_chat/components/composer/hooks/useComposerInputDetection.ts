import { useCallback } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { ContextItem } from '../../../../shared/types/context';
import type { ComposerDocument } from '../../../../shared/types/composer';
import { getComposerText } from '../../../../shared/types/composer';
import type { InputAction } from '../../../reducers/inputReducer';
import type { SessionDerivedState } from '../../../state-machine/types';
import {
  detectComposerInput,
  type ComposerInputDetection,
} from '../model/composerInputDetection';

export function useComposerInputDetection({
  contexts,
  derivedState,
  dispatchInput,
  inputIsActive,
  inputValueRef,
  isImeComposingRef,
  setDocument,
  removeContext,
  setInputDetection,
  setQueuedInput,
  shouldQueueDraft,
}: {
  contexts: ContextItem[];
  derivedState: SessionDerivedState | null;
  dispatchInput: Dispatch<InputAction>;
  inputIsActive: boolean;
  inputValueRef: MutableRefObject<string>;
  isImeComposingRef: MutableRefObject<boolean>;
  setDocument: (document: ComposerDocument) => void;
  removeContext: (id: string) => void;
  setInputDetection: (detection: ComposerInputDetection) => void;
  setQueuedInput: (value: string | null) => void;
  shouldQueueDraft: (text: string) => boolean;
}) {
  return useCallback((document: ComposerDocument, activeContexts: ContextItem[]) => {
    const text = getComposerText(document);
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

    setDocument(document);
    dispatchInput({ type: 'SET_VALUE', payload: text });
    inputValueRef.current = text;

    if (derivedState?.isProcessing && shouldQueueDraft(text)) {
      setQueuedInput(text);
    }

    setInputDetection(detectComposerInput({
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      isComposing: isImeComposingRef.current,
    }));
  }, [
    contexts,
    derivedState?.isProcessing,
    dispatchInput,
    inputIsActive,
    inputValueRef,
    isImeComposingRef,
    setDocument,
    removeContext,
    setInputDetection,
    setQueuedInput,
    shouldQueueDraft,
  ]);
}
