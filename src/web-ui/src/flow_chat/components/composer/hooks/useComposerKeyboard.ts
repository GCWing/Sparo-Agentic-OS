import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type React from 'react';
import type { SessionDerivedState } from '../../../state-machine/types';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { SlashPickerItem } from '../model/composerCommands';
import { matchesBuiltinSlashCommand } from '../model/builtinSlashCommands';
import type { ChatInputTarget, ComposerSlashCommandState } from '../model/composerState';

type ComposerKeyboardItemsGetter<T> = () => T[];

interface UseComposerKeyboardParams {
  editorRef: RefObject<RichTextInputHandle | null>;
  isImeComposingRef: RefObject<boolean>;
  slashCommandState: ComposerSlashCommandState;
  setSlashCommandState: Dispatch<SetStateAction<ComposerSlashCommandState>>;
  canSwitchAgents: boolean;
  getFilteredIncrementalAgents: ComposerKeyboardItemsGetter<{ id: string }>;
  getFilteredActions: ComposerKeyboardItemsGetter<{ id: string }>;
  getSlashPickerItems: ComposerKeyboardItemsGetter<SlashPickerItem>;
  selectSlashCommandAgent: (agentId: string) => void;
  selectSlashCommandAction: (actionId: string) => void;
  selectSlashPromptCommand: (item: Extract<SlashPickerItem, { kind: 'mcpPrompt' }>) => void;
  showTargetSwitcher: boolean;
  setInputTarget: Dispatch<SetStateAction<ChatInputTarget>>;
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
  submitBtwFromInput: () => void;
  handleSendOrCancel: () => void;
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
  slashCommandState,
  setSlashCommandState,
  canSwitchAgents,
  getFilteredIncrementalAgents,
  getFilteredActions,
  getSlashPickerItems,
  selectSlashCommandAgent,
  selectSlashCommandAction,
  selectSlashPromptCommand,
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
  submitBtwFromInput,
  handleSendOrCancel,
  derivedState,
  cancelGeneration,
}: UseComposerKeyboardParams) {
  const selectCurrentSlashItem = useCallback((items: Array<{ id: string } | SlashPickerItem>) => {
    if (items.length === 0) {
      return;
    }

    if (slashCommandState.kind === 'agents') {
      const agent = items[slashCommandState.selectedIndex] as { id: string };
      selectSlashCommandAgent(agent.id);
      return;
    }

    if (slashCommandState.kind === 'actions') {
      const action = items[slashCommandState.selectedIndex] as { id: string };
      selectSlashCommandAction(action.id);
      return;
    }

    const item = items[slashCommandState.selectedIndex] as SlashPickerItem;
    if (item.kind === 'agent') {
      selectSlashCommandAgent(item.id);
    } else if (item.kind === 'mcpPrompt') {
      selectSlashPromptCommand(item);
    } else {
      selectSlashCommandAction(item.id);
    }
  }, [
    selectSlashCommandAction,
    selectSlashCommandAgent,
    selectSlashPromptCommand,
    slashCommandState.kind,
    slashCommandState.selectedIndex,
  ]);

  return useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      e.stopPropagation();

      if (onBtwShortcutBlocked()) {
        return;
      }

      const selected = (window.getSelection?.()?.toString() ?? '').trim();
      const initial = selected ? `/btw Explain this:\n\n${selected}` : '/btw ';
      activateInput();
      setInputValue(initial);
      focusInputSoon();
      return;
    }

    if (slashCommandState.isActive) {
      if (!(slashCommandState.kind === 'agents' && !canSwitchAgents)) {
        const items =
          slashCommandState.kind === 'agents'
            ? getFilteredIncrementalAgents()
            : slashCommandState.kind === 'actions'
              ? getFilteredActions()
              : getSlashPickerItems();
        const maxIndex = Math.max(0, items.length - 1);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashCommandState(prev => ({
            ...prev,
            selectedIndex: Math.min(prev.selectedIndex + 1, maxIndex),
          }));
          return;
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashCommandState(prev => ({
            ...prev,
            selectedIndex: Math.max(prev.selectedIndex - 1, 0),
          }));
          return;
        }

        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault();
          selectCurrentSlashItem(items);
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          const kind = slashCommandState.kind;
          setSlashCommandState({ isActive: false, kind: 'agents', query: '', selectedIndex: 0 });
          if (kind !== 'actions') {
            setInputValue('');
          }
          return;
        }
      }
    }

    if (showTargetSwitcher && e.key === 'Tab' && !e.shiftKey && !slashCommandState.isActive) {
      e.preventDefault();
      setInputTarget(prev => prev === 'main' ? 'btw' : 'main');
      return;
    }

    if (!slashCommandState.isActive && inputHistory.length > 0) {
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

      const isBtwCommand = matchesBuiltinSlashCommand(inputValue, 'btw');
      if (isBtwCommand) {
        submitBtwFromInput();
        return;
      }

      if (derivedState?.isProcessing) {
        if (!inputValue.trim()) return;
        handleSendOrCancel();
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
    canSwitchAgents,
    cancelGeneration,
    derivedState,
    editorRef,
    focusInputSoon,
    getFilteredActions,
    getFilteredIncrementalAgents,
    getSlashPickerItems,
    handleSendOrCancel,
    historyIndex,
    inputHistory,
    inputValue,
    isImeComposingRef,
    onBtwShortcutBlocked,
    savedDraft,
    selectCurrentSlashItem,
    setHistoryIndex,
    setInputTarget,
    setInputValue,
    setSavedDraft,
    setSlashCommandState,
    showTargetSwitcher,
    slashCommandState,
    submitBtwFromInput,
  ]);
}
