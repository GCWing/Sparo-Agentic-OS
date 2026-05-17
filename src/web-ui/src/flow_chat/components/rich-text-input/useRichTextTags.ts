import { useCallback } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ContextItem } from '../../../shared/types/context';
import type { MentionState } from '../RichTextInput';
import { getRangeByTextOffsets } from './richTextSelection';

const closedMentionState: MentionState = {
  isActive: false,
  query: '',
  startOffset: 0,
};

export function useRichTextTags({
  createTagElement,
  editorRef,
  handleInput,
  mentionStateRef,
  onMentionStateChange,
}: {
  createTagElement: (context: ContextItem) => HTMLSpanElement;
  editorRef: RefObject<HTMLDivElement | null>;
  handleInput: () => void;
  mentionStateRef: MutableRefObject<MentionState>;
  onMentionStateChange?: (state: MentionState) => void;
}) {
  const insertTagAtCursor = useCallback((context: ContextItem) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      const tag = createTagElement(context);
      const space = document.createTextNode(' ');

      range.insertNode(space);
      range.insertNode(tag);

      range.setStartAfter(space);
      range.setEndAfter(space);
      selection.removeAllRanges();
      selection.addRange(range);

      handleInput();
      return;
    }

    const tag = createTagElement(context);
    const space = document.createTextNode(' ');
    editor.appendChild(tag);
    editor.appendChild(space);
    handleInput();
  }, [createTagElement, editorRef, handleInput]);

  const insertTagReplacingMention = useCallback((context: ContextItem) => {
    const editor = editorRef.current;
    if (!editor || !mentionStateRef.current.isActive) {
      insertTagAtCursor(context);
      return;
    }

    const mentionStart = mentionStateRef.current.startOffset;
    const mentionEnd = mentionStart + 1 + mentionStateRef.current.query.length;
    const range = getRangeByTextOffsets(editor, mentionStart, mentionEnd);

    if (range) {
      range.deleteContents();
      const tag = createTagElement(context);
      const space = document.createTextNode(' ');
      range.insertNode(space);
      range.insertNode(tag);

      const selection = window.getSelection();
      if (selection) {
        const newRange = document.createRange();
        newRange.setStartAfter(space);
        newRange.setEndAfter(space);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }

      editor.focus();
      mentionStateRef.current = closedMentionState;
      onMentionStateChange?.(closedMentionState);
      handleInput();
      return;
    }

    insertTagAtCursor(context);
    mentionStateRef.current = closedMentionState;
    onMentionStateChange?.(closedMentionState);
  }, [
    createTagElement,
    editorRef,
    handleInput,
    insertTagAtCursor,
    mentionStateRef,
    onMentionStateChange,
  ]);

  return {
    insertTagAtCursor,
    insertTagReplacingMention,
  };
}
