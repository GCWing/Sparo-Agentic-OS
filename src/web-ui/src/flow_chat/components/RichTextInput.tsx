/**
 * Structured Composer editor.
 * Text and atomic context references are read from the DOM in visual order;
 * no context is represented by a magic string or absolute character offset.
 */

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerDocument } from '@/shared/types/composer';
import {
  areComposerDocumentsEqual,
  getComposerText,
  hasComposerContent,
} from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import {
  openComposerContext,
  type OpenContextOptions,
} from '../domain/composerContextRegistry';
import {
  createContextTagElement,
  updateContextTagElement,
} from './rich-text-input/richTextContextTags';
import {
  collapseSelectionToEnd,
  insertPlainTextAtSelection,
  scrubInvisibleTextNodes,
} from './rich-text-input/richTextSelection';
import {
  extractComposerDocument,
  getVisibleRichTextContexts,
  sanitizeRichText,
} from './rich-text-input/richTextPlainText';
import { useRichTextMention } from './rich-text-input/useRichTextMention';
import { useRichTextTags } from './rich-text-input/useRichTextTags';
import './RichTextInput.scss';

export interface MentionState {
  isActive: boolean;
  query: string;
  startOffset: number;
}

export interface RichTextInputProps {
  document: ComposerDocument;
  onChange: (document: ComposerDocument, contexts: ContextItem[]) => void;
  onLargePaste?: (text: string) => ContextItem | null;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contexts: ContextItem[];
  openContextOptions: OpenContextOptions;
  onRemoveContext: (id: string) => void;
  onMentionStateChange?: (state: MentionState) => void;
  'data-testid'?: string;
}

export interface RichTextInputHandle {
  element: HTMLDivElement | null;
  focus: () => void;
  contains: (node: Node | null) => boolean;
  insertTag: (context: ContextItem) => void;
  insertTagReplacingMention: (context: ContextItem) => void;
  insertText: (text: string) => void;
  openMention: () => void;
  closeMention: () => void;
  getPlainText: () => string;
  getDocument: () => ComposerDocument;
}

function contextBeforeCaret(editor: HTMLElement, range: Range): HTMLElement | null {
  if (!range.collapsed) return null;
  let candidate: Node | null = null;
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    candidate = range.startContainer.previousSibling;
  } else if (range.startContainer === editor && range.startOffset > 0) {
    candidate = editor.childNodes[range.startOffset - 1] ?? null;
  }
  return candidate instanceof HTMLElement && candidate.classList.contains('rich-text-tag-pill')
    ? candidate
    : null;
}

export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>(({
  document: composerDocument,
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
  openContextOptions,
  onRemoveContext,
  onMentionStateChange,
  'data-testid': testId,
}, ref) => {
  const { t } = useTranslation('flow-chat');
  const editorRef = useRef<HTMLDivElement>(null);
  const contextsRef = useRef(contexts);
  const openOptionsRef = useRef(openContextOptions);
  const isComposingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  contextsRef.current = contexts;
  openOptionsRef.current = openContextOptions;

  const resolveContext = useCallback((id: string) => (
    contextsRef.current.find(context => context.id === id)
  ), []);

  const createTagElement = useCallback((context: ContextItem): HTMLSpanElement => (
    createContextTagElement(
      context,
      t,
      resolveContext,
      openComposerContext,
      () => openOptionsRef.current,
      onRemoveContext,
    )
  ), [onRemoveContext, resolveContext, t]);

  const extractDocument = useCallback(() => extractComposerDocument(editorRef.current), []);
  const insertPlainText = useCallback((text: string) => {
    insertPlainTextAtSelection(editorRef.current, text);
  }, []);

  const {
    closeMention,
    closeMentionSoon,
    detectMention,
    mentionStateRef,
    openMention,
  } = useRichTextMention({
    editorRef,
    insertPlainText,
    onMentionStateChange,
  });

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    const editor = editorRef.current;
    if (editor) scrubInvisibleTextNodes(editor);

    let nextDocument = extractDocument();
    const visibleContexts = getVisibleRichTextContexts(nextDocument, contextsRef.current);
    if (editor && !hasComposerContent(nextDocument) && visibleContexts.every(context => context.type === 'image')) {
      editor.replaceChildren();
      nextDocument = { version: 1, nodes: [] };
    }
    onChange(nextDocument, visibleContexts);
    requestAnimationFrame(detectMention);
  }, [detectMention, extractDocument, onChange]);

  const { insertTagAtCursor, insertTagReplacingMention } = useRichTextTags({
    createTagElement,
    editorRef,
    handleInput,
    mentionStateRef,
    onMentionStateChange,
  });

  const handleBeforeInput = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType === 'insertText' && inputEvent.data != null) {
      if (sanitizeRichText(inputEvent.data).length === 0) event.preventDefault();
    }
  }, []);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    event.preventDefault();
    const imageItem = Array.from(event.clipboardData.items)
      .find(item => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file && editorRef.current) {
        editorRef.current.dispatchEvent(new CustomEvent('imagePaste', {
          detail: { file },
          bubbles: true,
        }));
      }
      return;
    }

    closeMention();
    const text = event.clipboardData.getData('text/plain');
    const context = onLargePaste?.(text) ?? null;
    if (context) {
      contextsRef.current = [
        ...contextsRef.current.filter(item => item.id !== context.id),
        context,
      ];
      insertTagAtCursor(context);
      return;
    }

    insertPlainText(text);
    isComposingRef.current = true;
    requestAnimationFrame(() => {
      isComposingRef.current = false;
      handleInput();
    });
  }, [closeMention, handleInput, insertPlainText, insertTagAtCursor, onLargePaste]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const composing = (event.nativeEvent as KeyboardEvent).isComposing || isComposingRef.current;
    if (!composing && event.key === 'Backspace' && editorRef.current) {
      const selection = window.getSelection();
      if (selection?.rangeCount) {
        const tag = contextBeforeCaret(editorRef.current, selection.getRangeAt(0));
        const contextId = tag?.dataset.contextId;
        if (contextId) {
          event.preventDefault();
          onRemoveContext(contextId);
          return;
        }
      }
    }
    if (composing && event.key === 'Enter') return;
    onKeyDown?.(event);
  }, [onKeyDown, onRemoveContext]);

  useImperativeHandle(ref, () => ({
    get element() { return editorRef.current; },
    focus: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      collapseSelectionToEnd(editor);
    },
    contains: node => !!node && !!editorRef.current?.contains(node),
    insertTag: insertTagAtCursor,
    insertTagReplacingMention,
    insertText: text => {
      insertPlainText(text);
      handleInput();
    },
    openMention,
    closeMention,
    getPlainText: () => getComposerText(extractDocument()),
    getDocument: extractDocument,
  }), [
    closeMention,
    extractDocument,
    handleInput,
    insertPlainText,
    insertTagAtCursor,
    insertTagReplacingMention,
    openMention,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isComposingRef.current) return;
    if (editor.querySelector('.rich-text-placeholder')) return;

    const currentDocument = extractDocument();
    if (!areComposerDocumentsEqual(composerDocument, currentDocument)) {
      const fragment = window.document.createDocumentFragment();
      const byId = new Map(contexts.map(context => [context.id, context]));
      for (const node of composerDocument.nodes) {
        if (node.type === 'text') {
          fragment.appendChild(window.document.createTextNode(node.text));
        } else {
          const context = byId.get(node.contextId);
          if (context) fragment.appendChild(createTagElement(context));
        }
      }
      editor.replaceChildren(fragment);
      if (document.activeElement === editor) collapseSelectionToEnd(editor);
      return;
    }

    const byId = new Map(contexts.map(context => [context.id, context]));
    editor.querySelectorAll<HTMLSpanElement>('.rich-text-tag-pill').forEach(tag => {
      const context = tag.dataset.contextId ? byId.get(tag.dataset.contextId) : undefined;
      if (context) updateContextTagElement(tag, context, t);
    });
  }, [composerDocument, contexts, createTagElement, extractDocument, t]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocus?.();
  }, [onFocus]);
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    closeMentionSoon();
    onBlur?.();
  }, [closeMentionSoon, onBlur]);
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
      ref={editorRef}
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
      data-testid={testId}
      suppressContentEditableWarning
    />
  );
});

RichTextInput.displayName = 'RichTextInput';
export default RichTextInput;
