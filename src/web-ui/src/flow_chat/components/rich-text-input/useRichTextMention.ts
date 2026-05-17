import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { MentionState } from '../RichTextInput';
import { getCursorOffset } from './richTextSelection';

const closedMentionState: MentionState = {
  isActive: false,
  query: '',
  startOffset: 0,
};

export function useRichTextMention({
  editorRef,
  insertPlainText,
  onMentionStateChange,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
  insertPlainText: (text: string) => void;
  onMentionStateChange?: (state: MentionState) => void;
}) {
  const mentionStateRef = useRef<MentionState>(closedMentionState);

  const closeMention = useCallback(() => {
    if (mentionStateRef.current.isActive) {
      mentionStateRef.current = closedMentionState;
      onMentionStateChange?.(closedMentionState);
    }
  }, [onMentionStateChange]);

  const detectMention = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      closeMention();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      closeMention();
      return;
    }

    const cursorPosition = getCursorOffset(editor);
    if (cursorPosition < 0) {
      closeMention();
      return;
    }

    const fullText = editor.textContent || '';
    const textBeforeCursor = fullText.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const query = textBeforeCursor.slice(lastAtIndex + 1);

      if (!query.includes(' ') && !query.includes('\n')) {
        const newState: MentionState = {
          isActive: true,
          query,
          startOffset: lastAtIndex,
        };

        if (
          !mentionStateRef.current.isActive ||
          mentionStateRef.current.query !== query ||
          mentionStateRef.current.startOffset !== lastAtIndex
        ) {
          mentionStateRef.current = newState;
          onMentionStateChange?.(newState);
        }
        return;
      }
    }

    closeMention();
  }, [closeMention, editorRef, onMentionStateChange]);

  const openMention = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    insertPlainText('@');
    requestAnimationFrame(() => {
      detectMention();
    });
  }, [detectMention, editorRef, insertPlainText]);

  const closeMentionSoon = useCallback(() => {
    window.setTimeout(closeMention, 200);
  }, [closeMention]);

  return {
    closeMention,
    closeMentionSoon,
    detectMention,
    mentionStateRef,
    openMention,
  };
}
