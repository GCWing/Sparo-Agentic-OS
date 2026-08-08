import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type React from 'react';
import type { SessionDerivedState } from '../../../state-machine/types';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { ChatInputTarget } from '../model/composerState';
import type { ComposerContextSnapshot } from '@/shared/types/composer';
import type { InputHistoryEntry } from '../../../store/inputHistoryStore';

interface UseComposerKeyboardParams {
  editorRef: RefObject<RichTextInputHandle | null>;
  isImeComposingRef: RefObject<boolean>;
  commandPickerOpen: boolean;
  commandOptionCount: number;
  moveCommandSelection: (delta: number) => void;
  selectCurrentCommandOption: () => void;
  closeCommandPicker: (options?: { suppressCurrentToken?: boolean }) => void;
  showTargetSwitcher: boolean;
  setInputTarget: (target: ChatInputTarget | ((previous: ChatInputTarget) => ChatInputTarget)) => void;
  inputHistory: InputHistoryEntry[];
  historyIndex: number;
  setHistoryIndex: Dispatch<SetStateAction<number>>;
  savedDraft: ComposerContextSnapshot | null;
  setSavedDraft: Dispatch<SetStateAction<ComposerContextSnapshot | null>>;
  currentDraft: ComposerContextSnapshot;
  restoreDraft: (snapshot: ComposerContextSnapshot) => void;
  hasContent: boolean;
  setInputValue: (value: string) => void;
  activateInput: () => void;
  focusInputSoon: () => void;
  onBtwShortcutBlocked: () => boolean;
  onBtwShortcutDraft: (draft: string) => void;
  handleSendOrCancel: () => void;
  hasSubmitIntent: boolean;
  derivedState: SessionDerivedState | null;
  cancelGeneration: () => void;
}

function isCursorAtEditorStart(range: Range, editor: HTMLDivElement): boolean {
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;
  const contentBeforeCaret = range.cloneRange();
  contentBeforeCaret.selectNodeContents(editor);
  contentBeforeCaret.setEnd(range.startContainer, range.startOffset);
  return contentBeforeCaret.toString().length === 0;
}

function isCursorAtEditorEnd(range: Range, editor: HTMLDivElement): boolean {
  if (!range.collapsed || !editor.contains(range.endContainer)) return false;
  const contentAfterCaret = range.cloneRange();
  contentAfterCaret.selectNodeContents(editor);
  contentAfterCaret.setStart(range.endContainer, range.endOffset);
  return contentAfterCaret.toString().length === 0;
}

export function useComposerKeyboard({
  editorRef,
  isImeComposingRef,
  commandPickerOpen,
  commandOptionCount,
  moveCommandSelection,
  selectCurrentCommandOption,
  closeCommandPicker,
  showTargetSwitcher,
  setInputTarget,
  inputHistory,
  historyIndex,
  setHistoryIndex,
  savedDraft,
  setSavedDraft,
  currentDraft,
  restoreDraft,
  hasContent,
  setInputValue,
  activateInput,
  focusInputSoon,
  onBtwShortcutBlocked,
  onBtwShortcutDraft,
  handleSendOrCancel,
  hasSubmitIntent,
  derivedState,
  cancelGeneration,
}: UseComposerKeyboardParams) {
  return useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      e.stopPropagation();

      if (onBtwShortcutBlocked()) {
        return;
      }

      const selected = (window.getSelection?.()?.toString() ?? '').trim();
      onBtwShortcutDraft(selected ? `Explain this:\n\n${selected}` : '');
      activateInput();
      focusInputSoon();
      return;
    }

    if (commandPickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveCommandSelection(1);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveCommandSelection(-1);
        return;
      }

      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        if (commandOptionCount > 0) {
          selectCurrentCommandOption();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPicker({ suppressCurrentToken: true });
        return;
      }
    }

    if (showTargetSwitcher && e.key === 'Tab' && !e.shiftKey && !commandPickerOpen) {
      e.preventDefault();
      setInputTarget(prev => prev === 'main' ? 'btw' : 'main');
      return;
    }

    if (!commandPickerOpen && inputHistory.length > 0) {
      const selection = window.getSelection();
      const editor = editorRef.current?.element;

      if (selection && selection.rangeCount > 0 && editor) {
        const range = selection.getRangeAt(0);

        if (e.key === 'ArrowUp' && isCursorAtEditorStart(range, editor)) {
          e.preventDefault();
          if (historyIndex === -1 && hasContent) {
            setSavedDraft(currentDraft);
          }
          if (historyIndex < inputHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            restoreDraft(inputHistory[newIndex].composerContext);
          }
          return;
        }

        if (e.key === 'ArrowDown' && isCursorAtEditorEnd(range, editor)) {
          e.preventDefault();
          if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            restoreDraft(inputHistory[newIndex].composerContext);
          } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            if (savedDraft) restoreDraft(savedDraft);
            else setInputValue('');
          }
          return;
        }
      }
    }

    const nativeEvt = e.nativeEvent as KeyboardEvent;
    const isComposing =
      isImeComposingRef.current ||
      nativeEvt.isComposing ||
      nativeEvt.keyCode === 229;

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposing) {
        return;
      }

      e.preventDefault();

      if (derivedState?.isProcessing && !hasContent && !hasSubmitIntent) {
        return;
      }

      handleSendOrCancel();
    }

    if (e.key === 'Escape' && derivedState?.canCancel) {
      e.preventDefault();
      cancelGeneration();
    }
  }, [
    activateInput,
    cancelGeneration,
    closeCommandPicker,
    commandOptionCount,
    commandPickerOpen,
    derivedState,
    editorRef,
    focusInputSoon,
    handleSendOrCancel,
    hasSubmitIntent,
    hasContent,
    historyIndex,
    inputHistory,
    isImeComposingRef,
    moveCommandSelection,
    onBtwShortcutBlocked,
    onBtwShortcutDraft,
    savedDraft,
    currentDraft,
    restoreDraft,
    selectCurrentCommandOption,
    setHistoryIndex,
    setInputTarget,
    setInputValue,
    setSavedDraft,
    showTargetSwitcher,
  ]);
}
