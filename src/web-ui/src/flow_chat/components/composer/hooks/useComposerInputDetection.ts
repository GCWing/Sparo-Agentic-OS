import { useCallback } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { ComposerDocument, ContextReference } from '../../../../shared/types/composer';
import { getComposerText } from '../../../../shared/types/composer';
import type { InputAction } from '../../../reducers/inputReducer';
import type { SessionDerivedState } from '../../../state-machine/types';
import {
  detectComposerInput,
  type ComposerInputDetection,
} from '../model/composerInputDetection';

export function useComposerInputDetection({
  references,
  derivedState,
  dispatchInput,
  inputIsActive,
  inputValueRef,
  isImeComposingRef,
  setDocument,
  removeReference,
  setInputDetection,
  setQueuedInput,
  shouldQueueDraft,
}: {
  references: ContextReference[];
  derivedState: SessionDerivedState | null;
  dispatchInput: Dispatch<InputAction>;
  inputIsActive: boolean;
  inputValueRef: MutableRefObject<string>;
  isImeComposingRef: MutableRefObject<boolean>;
  setDocument: (document: ComposerDocument) => void;
  removeReference: (id: string) => void;
  setInputDetection: (detection: ComposerInputDetection) => void;
  setQueuedInput: (value: string | null) => void;
  shouldQueueDraft: (text: string) => boolean;
}) {
  return useCallback((document: ComposerDocument, activeReferenceIds: string[]) => {
    const text = getComposerText(document);
    if (!inputIsActive && text.length > 0) {
      dispatchInput({ type: 'ACTIVATE' });
    }

    const activeIds = new Set(activeReferenceIds);
    references.forEach(reference => {
      if (!activeIds.has(reference.id)) {
        removeReference(reference.id);
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
    references,
    derivedState?.isProcessing,
    dispatchInput,
    inputIsActive,
    inputValueRef,
    isImeComposingRef,
    setDocument,
    removeReference,
    setInputDetection,
    setQueuedInput,
    shouldQueueDraft,
  ]);
}
