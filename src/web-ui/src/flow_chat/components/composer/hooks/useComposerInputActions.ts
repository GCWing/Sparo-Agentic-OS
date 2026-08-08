import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { notificationService } from '@/shared/notification-system';
import type { ContextItem } from '../../../../shared/types/context';
import type { ComposerContextSnapshot } from '../../../../shared/types/composer';
import type {
  AttachmentReferenceResolution,
  AttachmentResolveOptions,
} from '@/shared/stores/contextStore';
import { CHAT_INPUT_CONFIG } from '../../../constants/chatInputConfig';
import type { InputAction } from '../../../reducers/inputReducer';
import type { RichTextInputHandle } from '../../RichTextInput';

export function useComposerInputActions({
  currentSessionId,
  dispatchInput,
  inputIsActive,
  inputValueRef,
  isBtwSession,
  richTextInputRef,
  replaceDraftText,
  clearDraft,
  resolveAttachmentReference,
  setHistoryIndex,
  setSavedDraft,
  t,
}: {
  currentSessionId?: string | null;
  dispatchInput: Dispatch<InputAction>;
  inputIsActive: boolean;
  inputValueRef: MutableRefObject<string>;
  isBtwSession: boolean;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
  replaceDraftText: (text: string) => void;
  clearDraft: () => void;
  resolveAttachmentReference: (
    context: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentReferenceResolution;
  setHistoryIndex: Dispatch<SetStateAction<number>>;
  setSavedDraft: Dispatch<SetStateAction<ComposerContextSnapshot | null>>;
  t: TFunction<'flow-chat'>;
}) {
  const focusRichTextInputSoon = useCallback(() => {
    window.requestAnimationFrame(() => {
      richTextInputRef.current?.focus();
    });
  }, [richTextInputRef]);

  const setComposerInputValue = useCallback((value: string) => {
    replaceDraftText(value);
    dispatchInput({ type: 'SET_VALUE', payload: value });
    inputValueRef.current = value;
  }, [dispatchInput, inputValueRef, replaceDraftText]);

  const activateComposerInput = useCallback(() => {
    dispatchInput({ type: 'ACTIVATE' });
  }, [dispatchInput]);

  const clearComposerInput = useCallback(() => {
    clearDraft();
    dispatchInput({ type: 'CLEAR_VALUE' });
    inputValueRef.current = '';
  }, [clearDraft, dispatchInput, inputValueRef]);

  const resetHistoryDraft = useCallback(() => {
    setHistoryIndex(-1);
    setSavedDraft(null);
  }, [setHistoryIndex, setSavedDraft]);

  const isBtwShortcutBlocked = useCallback(() => {
    if (!currentSessionId) {
      notificationService.error(t('btw.noSession', { defaultValue: 'No active session for /btw' }));
      return true;
    }
    if (isBtwSession) {
      notificationService.warning(t('btw.nestedDisabled', { defaultValue: 'Side questions cannot create another side question' }));
      return true;
    }
    return false;
  }, [currentSessionId, isBtwSession, t]);

  const handleActivate = useCallback((event?: React.MouseEvent) => {
    if (
      event?.target instanceof HTMLButtonElement ||
      (event?.target instanceof Element && event.target.closest('button'))
    ) {
      if (!inputIsActive) {
        dispatchInput({ type: 'ACTIVATE' });
      }
      return;
    }

    if (!inputIsActive) {
      dispatchInput({ type: 'ACTIVATE' });
      focusRichTextInputSoon();
    }
  }, [dispatchInput, focusRichTextInputSoon, inputIsActive]);

  const handleDropContextAdded = useCallback((context: ContextItem) => {
    const resolution = resolveAttachmentReference(context, context.type === 'image'
      ? { maxAssetsOfType: CHAT_INPUT_CONFIG.image.maxCount }
      : undefined);
    if (resolution.kind === 'rejected') {
      notificationService.warning(t('input.maxImagesWarning', { count: CHAT_INPUT_CONFIG.image.maxCount }), { duration: 3000 });
      return;
    }
    richTextInputRef.current?.insertTag(resolution.reference, resolution.asset);
    if (!inputIsActive) {
      dispatchInput({ type: 'ACTIVATE' });
    }
  }, [dispatchInput, inputIsActive, resolveAttachmentReference, richTextInputRef, t]);

  return {
    activateComposerInput,
    clearComposerInput,
    focusRichTextInputSoon,
    handleActivate,
    handleDropContextAdded,
    isBtwShortcutBlocked,
    resetHistoryDraft,
    setComposerInputValue,
  };
}
