/**
 * Rich text input component.
 * Supports inserting file tags inline and using @ to select files/folders.
 */

import React, { useRef, useEffect, useCallback, useImperativeHandle, useState } from 'react';
import type { ContextItem } from '../../shared/types/context';
import { getRichTextExternalSyncAction } from './richTextInputSync';
import { createContextTagElement } from './rich-text-input/richTextContextTags';
import {
  collapseSelectionToEnd,
  insertPlainTextAtSelection,
  scrubInvisibleTextNodes,
} from './rich-text-input/richTextSelection';
import {
  extractRichTextContent,
  getVisibleRichTextContexts,
  sanitizeRichText,
} from './rich-text-input/richTextPlainText';
import { useRichTextMention } from './rich-text-input/useRichTextMention';
import { useRichTextTags } from './rich-text-input/useRichTextTags';
import './RichTextInput.scss';

/** @ mention state */
export interface MentionState {
  isActive: boolean;
  query: string;
  startOffset: number;  // Position of the @ symbol in text
}

export interface RichTextInputProps {
  value: string;
  onChange: (value: string, contexts: ContextItem[]) => void;
  onLargePaste?: (text: string) => string | null;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contexts: ContextItem[];
  onRemoveContext: (id: string) => void;
  /** Callback when @ mention state changes */
  onMentionStateChange?: (state: MentionState) => void;
}

export interface RichTextInputHandle {
  element: HTMLDivElement | null;
  focus: () => void;
  contains: (node: Node | null) => boolean;
  insertTag: (context: ContextItem) => void;
  insertTagReplacingMention: (context: ContextItem) => void;
  openMention: () => void;
  closeMention: () => void;
  getPlainText: () => string;
}

export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>(({
  value,
  onChange,
  onLargePaste,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onFocus,
  onBlur,
  placeholder = 'Describe your request...',
  disabled = false,
  className = '',
  contexts,
  onRemoveContext,
  onMentionStateChange,
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const internalRef = editorRef;
  const [isFocused, setIsFocused] = useState(false);
  const isComposingRef = useRef(false);
  const lastContextIdsRef = useRef<Set<string>>(new Set());

  const createTagElement = useCallback((context: ContextItem): HTMLSpanElement => {
    return createContextTagElement(context, onRemoveContext);
  }, [onRemoveContext]);

  // Extract plain text including # tag format
  const extractTextContent = useCallback((): string => {
    return extractRichTextContent(internalRef.current);
  }, [internalRef]);

  const insertPlainText = useCallback((text: string) => {
    insertPlainTextAtSelection(internalRef.current, text);
  }, [internalRef]);

  const {
    closeMention,
    closeMentionSoon,
    detectMention,
    mentionStateRef,
    openMention,
  } = useRichTextMention({
    editorRef: internalRef,
    insertPlainText,
    onMentionStateChange,
  });

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;

    const editor = internalRef.current;

    if (editor) {
      scrubInvisibleTextNodes(editor);
    }

    const textContent = extractTextContent();
    const visibleContexts = getVisibleRichTextContexts(internalRef.current, contexts);

    if (editor && textContent.length === 0 && visibleContexts.length === 0) {
      editor.replaceChildren();
    }

    onChange(textContent, visibleContexts);
    
    // Ensure detection runs after DOM updates
    requestAnimationFrame(() => {
      detectMention();
    });
  }, [contexts, detectMention, extractTextContent, internalRef, onChange]);

  const handleBeforeInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;
    const inputType = inputEvent.inputType;

    // Only act on insertText and block attempts to insert purely-invisible content.
    // We intentionally avoid a blanket whitelist so that we never accidentally
    // block browser-internal input types (cursor movement, spellcheck, etc.).
    if (inputType === 'insertText' && inputEvent.data != null) {
      const cleaned = sanitizeRichText(inputEvent.data);
      if (cleaned.length === 0) {
        e.preventDefault();
      }
    }
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    
    // Detect image paste
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    
    if (imageItem) {
      // Dispatch image paste event for parent handling
      const file = imageItem.getAsFile();
      if (file && internalRef.current) {
        const customEvent = new CustomEvent('imagePaste', { 
          detail: { file },
          bubbles: true 
        });
        internalRef.current.dispatchEvent(customEvent);
      }
      return;
    }
    
    closeMention();
    
    const text = e.clipboardData.getData('text/plain');
    const largePastePlaceholder = onLargePaste?.(text);
    insertPlainText(largePastePlaceholder ?? text);
    
    // Mark that we just pasted to prevent mention detection in the next input event
    isComposingRef.current = true;
    requestAnimationFrame(() => {
      isComposingRef.current = false;
      handleInput();
    });
  }, [closeMention, handleInput, internalRef, insertPlainText, onLargePaste]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const nativeIsComposing = (e.nativeEvent as KeyboardEvent).isComposing;
    const composing = nativeIsComposing || isComposingRef.current;
    
    if (!composing && e.key === 'Backspace' && internalRef.current) {
      const selection = window.getSelection();
      if (selection) {
        const range = selection.getRangeAt(0);
        
        if (range.collapsed && range.startOffset === 0) {
          const previousSibling = range.startContainer.previousSibling;
          if (previousSibling && (previousSibling as HTMLElement).classList?.contains('rich-text-tag-pill')) {
            e.preventDefault();
            const contextId = (previousSibling as HTMLElement).dataset.contextId;
            if (contextId) {
              onRemoveContext(contextId);
            }
            return;
          }
        }
      }
    }
    
    if (composing && e.key === 'Enter') {
      return;
    }

    onKeyDown?.(e);
  }, [internalRef, onKeyDown, onRemoveContext]);

  const {
    insertTagAtCursor,
    insertTagReplacingMention,
  } = useRichTextTags({
    createTagElement,
    editorRef: internalRef,
    handleInput,
    mentionStateRef,
    onMentionStateChange,
  });

  useImperativeHandle(ref, () => ({
    get element() {
      return internalRef.current;
    },
    focus: () => {
      const editor = internalRef.current;
      if (!editor) return;
      editor.focus();
      collapseSelectionToEnd(editor);
    },
    contains: (node: Node | null) => {
      return !!node && !!internalRef.current?.contains(node);
    },
    insertTag: insertTagAtCursor,
    insertTagReplacingMention,
    openMention,
    closeMention,
    getPlainText: extractTextContent,
  }), [closeMention, extractTextContent, insertTagAtCursor, insertTagReplacingMention, internalRef, openMention]);

  // Initialize and sync value changes from external sources.
  // This editor is effectively controlled by comparing the parent's value
  // with the current DOM content, rather than tracking a "skip next sync" flag.
  useEffect(() => {
    const editor = internalRef.current;
    if (!editor) return;

    if (isComposingRef.current) return;
    
    // Detect template fill mode via placeholder elements
    const hasPlaceholders = editor.querySelector('.rich-text-placeholder') !== null;
    if (hasPlaceholders) {
      // Skip value sync; template rendering owns the content
      return;
    }
    
    const currentContent = extractTextContent();
    const syncAction = getRichTextExternalSyncAction(value, currentContent);
    
    if (syncAction === 'noop') {
      return;
    }

    if (syncAction === 'clear') {
      editor.textContent = '';
      return;
    }
    
    if (syncAction === 'replace') {
      editor.textContent = value;
      
      // Restore cursor to the end
      requestAnimationFrame(() => {
        if (editor.childNodes.length > 0) {
          collapseSelectionToEnd(editor);
        }
        editor.focus();
      });
    }
  }, [extractTextContent, internalRef, value]);

  // Remove tags for deleted contexts
  useEffect(() => {
    const editor = internalRef.current;
    if (!editor) return;

    const currentContextIds = new Set(contexts.map(c => c.id));
    const previousContextIds = lastContextIdsRef.current;

    const deletedIds = Array.from(previousContextIds).filter(id => !currentContextIds.has(id));

    deletedIds.forEach(id => {
      const tagElement = editor.querySelector(`[data-context-id="${id}"]`);
      if (tagElement) {
        const nextSibling = tagElement.nextSibling;
        if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE && nextSibling.textContent === ' ') {
          nextSibling.remove();
        }
        tagElement.remove();
      }
    });

    lastContextIdsRef.current = currentContextIds;
  }, [contexts, internalRef]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    closeMentionSoon();
    onBlur?.();
  }, [closeMentionSoon, onBlur]);

  // Handle IME composition
  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    onCompositionStart?.();
  }, [onCompositionStart]);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    onCompositionEnd?.();
    handleInput();
  }, [handleInput, onCompositionEnd]);

  return (
    <div
      ref={internalRef}
      className={`rich-text-input ${isFocused ? 'rich-text-input--focused' : ''} ${className}`}
      contentEditable={!disabled}
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      data-placeholder={placeholder}
      suppressContentEditableWarning
    />
  );
});

RichTextInput.displayName = 'RichTextInput';

export default RichTextInput;
