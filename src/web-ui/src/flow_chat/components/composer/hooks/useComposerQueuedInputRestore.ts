import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject } from 'react';
import { createLogger } from '@/shared/utils/logger';
import type { InputAction } from '../../../reducers/inputReducer';
import type { RichTextInputHandle } from '../../RichTextInput';

const log = createLogger('ComposerQueuedInputRestore');

export function useComposerQueuedInputRestore({
  replaceDraftText,
  dispatchInput,
  effectiveTargetSessionId,
  inputValueRef,
  queuedInput,
  richTextInputRef,
}: {
  replaceDraftText: (text: string) => void;
  dispatchInput: Dispatch<InputAction>;
  effectiveTargetSessionId?: string | null;
  inputValueRef: MutableRefObject<string>;
  queuedInput?: string | null;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
}) {
  useEffect(() => {
    if (!queuedInput?.trim() || !effectiveTargetSessionId) {
      return;
    }

    const currentValue = inputValueRef.current;
    if (currentValue !== queuedInput && !currentValue.trim()) {
      log.debug('Detected queuedInput, restoring message to input', { queuedInput });
      replaceDraftText(queuedInput);
      dispatchInput({ type: 'ACTIVATE' });
      dispatchInput({ type: 'SET_VALUE', payload: queuedInput });
      inputValueRef.current = queuedInput;
      richTextInputRef.current?.focus();
    }
  }, [
    replaceDraftText,
    dispatchInput,
    effectiveTargetSessionId,
    inputValueRef,
    queuedInput,
    richTextInputRef,
  ]);
}
