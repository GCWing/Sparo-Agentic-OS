import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type React from 'react';
import type { SessionDerivedState } from '../../../state-machine/types';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { ChatInputTarget } from '../model/composerState';

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
  inputHistory: string[];
  historyIndex: number;
  setHistoryIndex: Dispatch<SetStateAction<number>>;
  savedDraft: string;
  setSavedDraft: Dispatch<SetStateAction<string>>;
  inputValue: string;
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
  return range.collapsed && range.startOffset === 0 &&
    (range.startContainer === editor ||
      (range.startContainer.nodeType === Node.TEXT_NODE &&
        range.startContainer.previousSibling === null &&
        range.startContainer.parentNode === editor));
}

function isCursorAtEditorEnd(range: Range, editor: HTMLDivElement): boolean {
  if (!range.collapsed) return false;
  const editorContent = editor.textContent || '';
  let cursorPos = 0;
  const traverse = (node: Node): boolean => {
    if (node === range.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        cursorPos += range.startOffset;
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      cursorPos += (node.textContent || '').length;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(node.childNodes)) {
        if (traverse(child)) return true;
      }
    }
    return false;
  };
  traverse(editor);
  return cursorPos === editorContent.length;
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
  inputValue,
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
          if (historyIndex === -1 && inputValue.trim()) {
            setSavedDraft(inputValue);
          }
          if (historyIndex < inputHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setInputValue(inputHistory[newIndex]);
          }
          return;
        }

        if (e.key === 'ArrowDown' && isCursorAtEditorEnd(range, editor)) {
          e.preventDefault();
          if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setInputValue(inputHistory[newIndex]);
          } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            setInputValue(savedDraft);
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

      if (derivedState?.isProcessing && !inputValue.trim() && !hasSubmitIntent) {
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
    historyIndex,
    inputHistory,
    inputValue,
    isImeComposingRef,
    moveCommandSelection,
    onBtwShortcutBlocked,
    onBtwShortcutDraft,
    savedDraft,
    selectCurrentCommandOption,
    setHistoryIndex,
    setInputTarget,
    setInputValue,
    setSavedDraft,
    showTargetSwitcher,
  ]);
}
