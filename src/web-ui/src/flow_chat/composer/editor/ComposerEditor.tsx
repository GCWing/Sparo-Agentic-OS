import type React from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { useTranslation } from 'react-i18next';
import type { ComposerDocument, ContextReference } from '@/shared/types/composer';
import {
  areComposerDocumentsEqual,
  getComposerReferenceIds,
  getComposerText,
} from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import {
  createContextTagElement,
} from '../../components/rich-text-input/richTextContextTags';
import { ContextReferenceExtension } from './ContextReferenceExtension';
import {
  ComposerDocumentRoot,
  ComposerHardBreak,
  ComposerHistory,
  ComposerParagraph,
  ComposerText,
} from './ComposerSchemaExtensions';
import {
  COMPOSER_CONTEXT_REFERENCE_NODE,
  composerDocumentToTiptap,
  composerTextToTiptapContent,
  tiptapToComposerDocument,
} from './composerDocumentCodec';

export interface MentionState {
  isActive: boolean;
  query: string;
  startOffset: number;
}

export interface ComposerIngressContext {
  asset: ContextItem;
  reference: ContextReference;
}

export interface RichTextInputProps {
  document: ComposerDocument;
  onChange: (document: ComposerDocument, activeReferenceIds: string[]) => void;
  onLargePaste?: (text: string) => ComposerIngressContext | null;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  assets: ContextItem[];
  references: ContextReference[];
  onOpenReference: (referenceId: string, anchor: HTMLElement) => void;
  onRemoveReference: (id: string) => void;
  onMentionStateChange?: (state: MentionState) => void;
  'data-testid'?: string;
}

export interface RichTextInputHandle {
  element: HTMLDivElement | null;
  focus: () => void;
  contains: (node: Node | null) => boolean;
  insertTag: (reference: ContextReference, context: ContextItem) => void;
  insertTagReplacingMention: (reference: ContextReference, context: ContextItem) => void;
  removeTag: (referenceId: string) => void;
  insertText: (text: string) => void;
  openMention: () => void;
  closeMention: () => void;
  getPlainText: () => string;
  getDocument: () => ComposerDocument;
}

interface MentionRange {
  from: number;
  to: number;
}

interface CallbackBridge {
  onBlur?: () => void;
  onChange: RichTextInputProps['onChange'];
  onCompositionEnd?: () => void;
  onCompositionStart?: () => void;
  onFocus?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onLargePaste?: (text: string) => ComposerIngressContext | null;
  onMentionStateChange?: (state: MentionState) => void;
  onOpenReference: RichTextInputProps['onOpenReference'];
  onRemoveReference: RichTextInputProps['onRemoveReference'];
}

const EMPTY_MENTION: MentionState = { isActive: false, query: '', startOffset: 0 };

function isAdjacentReferenceForAsset(
  view: EditorView,
  assetId: string,
  references: ContextReference[],
): boolean {
  const referenceById = new Map(references.map(reference => [reference.id, reference]));
  const assetIdForNode = (node: ProseMirrorNode | null): string | null => {
    if (node?.type.name !== COMPOSER_CONTEXT_REFERENCE_NODE) return null;
    const referenceId = node.attrs.referenceId;
    return typeof referenceId === 'string'
      ? referenceById.get(referenceId)?.assetId || null
      : null;
  };
  const { $from, $to } = view.state.selection;
  return assetIdForNode($from.nodeBefore) === assetId
    || assetIdForNode($to.nodeAfter) === assetId;
}

function sanitizeComposerText(text: string): string {
  // Browser engines can inject these control characters during rich editing.
  // eslint-disable-next-line no-control-regex -- the ranges are intentionally explicit
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028\u2029\uFEFF\u2060\u00AD]/g, '');
}

function insertJsonInlineContent(view: EditorView, content: JSONContent[]): void {
  const nodes = content.map(node => view.state.schema.nodeFromJSON(node));
  const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

function createReactKeyboardFacade(event: KeyboardEvent): React.KeyboardEvent {
  return {
    nativeEvent: event,
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    isDefaultPrevented: () => event.defaultPrevented,
    isPropagationStopped: () => false,
    persist: () => {},
    get defaultPrevented() { return event.defaultPrevented; },
  } as unknown as React.KeyboardEvent;
}

function readEditorDocument(editor: Editor | null): ComposerDocument {
  return editor ? tiptapToComposerDocument(editor.getJSON()) : { version: 2, nodes: [] };
}

function syncEditorEmptyState(editor: Editor): void {
  if (!editor.isDestroyed) {
    editor.view.dom.classList.toggle('rich-text-input--empty', editor.isEmpty);
  }
}

export const ComposerEditor = forwardRef<RichTextInputHandle, RichTextInputProps>(({
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
  assets,
  references,
  onOpenReference,
  onRemoveReference,
  onMentionStateChange,
  'data-testid': testId,
}, ref) => {
  const { t } = useTranslation('flow-chat');
  const [isFocused, setIsFocused] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const assetsRef = useRef(assets);
  const referencesRef = useRef(references);
  const callbacksRef = useRef<CallbackBridge>({
    onChange,
    onOpenReference,
    onRemoveReference,
  });
  const placeholderRef = useRef(placeholder);
  const isComposingRef = useRef(false);
  const mentionRangeRef = useRef<MentionRange | null>(null);
  const mentionStateRef = useRef<MentionState>(EMPTY_MENTION);
  const blurTimerRef = useRef<number | null>(null);
  const customClassNamesRef = useRef<string[]>([]);

  assetsRef.current = assets;
  referencesRef.current = references;
  placeholderRef.current = placeholder;
  callbacksRef.current = {
    onBlur,
    onChange,
    onCompositionEnd,
    onCompositionStart,
    onFocus,
    onKeyDown,
    onLargePaste,
    onMentionStateChange,
    onOpenReference,
    onRemoveReference,
  };

  const publishMention = useCallback((next: MentionState, range: MentionRange | null) => {
    const previous = mentionStateRef.current;
    mentionStateRef.current = next;
    mentionRangeRef.current = range;
    if (
      previous.isActive !== next.isActive ||
      previous.query !== next.query ||
      previous.startOffset !== next.startOffset
    ) {
      callbacksRef.current.onMentionStateChange?.(next);
    }
  }, []);

  const closeMention = useCallback(() => {
    publishMention(EMPTY_MENTION, null);
  }, [publishMention]);

  const detectMention = useCallback((instance: Editor) => {
    if (isComposingRef.current || !instance.isFocused) return;
    const { from, empty } = instance.state.selection;
    if (!empty) {
      closeMention();
      return;
    }

    const scanStart = Math.max(0, from - 256);
    const beforeCaret = instance.state.doc.textBetween(scanStart, from, '\n', '\uFFFC');
    const match = beforeCaret.match(/(?:^|\s)@([^\s@\uFFFC]*)$/);
    if (!match) {
      closeMention();
      return;
    }

    const query = match[1];
    const mentionFrom = from - query.length - 1;
    publishMention(
      { isActive: true, query, startOffset: mentionFrom },
      { from: mentionFrom, to: from },
    );
  }, [closeMention, publishMention]);

  const renderReferenceElement = useCallback((element: HTMLSpanElement, referenceId: string) => {
    const reference = referencesRef.current.find(item => item.id === referenceId);
    const asset = reference
      ? assetsRef.current.find(item => item.id === reference.assetId)
      : undefined;
    const attachmentNumber = asset
      ? assetsRef.current.findIndex(item => item.id === asset.id) + 1
      : 0;

    element.setAttribute('data-composer-context-reference', '');
    element.dataset.referenceId = referenceId;
    element.contentEditable = 'false';

    if (!reference || !asset) {
      element.className = 'rich-text-tag-pill';
      element.setAttribute('aria-label', referenceId);
      const label = document.createElement('span');
      label.className = 'rich-text-tag-pill__text';
      label.textContent = referenceId;
      element.replaceChildren(label);
      return;
    }

    const rendered = createContextTagElement(
      reference,
      asset,
      attachmentNumber,
      t,
      callbacksRef.current.onOpenReference,
      callbacksRef.current.onRemoveReference,
    );
    const selected = element.classList.contains('rich-text-tag-pill--selected');
    element.className = `${rendered.className}${selected ? ' rich-text-tag-pill--selected' : ''}`;
    element.title = rendered.title;
    element.setAttribute('aria-label', rendered.getAttribute('aria-label') || '');
    element.dataset.referenceId = reference.id;
    element.dataset.assetId = asset.id;
    element.dataset.contextType = asset.type;
    element.replaceChildren(...Array.from(rendered.childNodes));
  }, [t]);

  const createReferenceElement = useCallback((referenceId: string) => {
    const element = document.createElement('span');
    renderReferenceElement(element, referenceId);
    return element;
  }, [renderReferenceElement]);

  const updateReferenceElement = useCallback((element: HTMLSpanElement, referenceId: string) => {
    renderReferenceElement(element, referenceId);
  }, [renderReferenceElement]);

  const extensions = useMemo(() => [
    ComposerDocumentRoot,
    ComposerParagraph,
    ComposerText,
    ComposerHardBreak,
    ComposerHistory,
    ContextReferenceExtension.configure({
      createElement: createReferenceElement,
      updateElement: updateReferenceElement,
    }),
    Placeholder.configure({
      placeholder: () => placeholderRef.current,
      emptyEditorClass: 'rich-text-input--empty',
      emptyNodeClass: 'rich-text-input__empty-node',
    }),
  ], [createReferenceElement, updateReferenceElement]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: composerDocumentToTiptap(composerDocument),
    extensions,
    editorProps: {
      attributes: {
        class: 'rich-text-input',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => {
        if (isComposingRef.current && event.key === 'Enter') return true;
        callbacksRef.current.onKeyDown?.(createReactKeyboardFacade(event));
        return event.defaultPrevented;
      },
      handleTextInput: (view, from, to, text) => {
        const clean = sanitizeComposerText(text);
        if (clean === text) return false;
        if (clean) view.dispatch(view.state.tr.insertText(clean, from, to));
        return true;
      },
      handlePaste: (view, event) => {
        const imageItem = Array.from(event.clipboardData?.items || [])
          .find(item => item.type.startsWith('image/'));
        if (imageItem) {
          const file = imageItem.getAsFile();
          if (file) {
            const EventCtor = view.dom.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
            view.dom.dispatchEvent(new EventCtor('imagePaste', {
              detail: { file },
              bubbles: true,
            }));
          }
          return true;
        }

        closeMention();
        const text = sanitizeComposerText(event.clipboardData?.getData('text/plain') || '');
        const ingress = callbacksRef.current.onLargePaste?.(text) ?? null;
        if (ingress) {
          if (isAdjacentReferenceForAsset(view, ingress.asset.id, referencesRef.current)) {
            callbacksRef.current.onRemoveReference(ingress.reference.id);
            return true;
          }
          assetsRef.current = [
            ...assetsRef.current.filter(item => item.id !== ingress.asset.id),
            ingress.asset,
          ];
          referencesRef.current = [
            ...referencesRef.current.filter(item => item.id !== ingress.reference.id),
            ingress.reference,
          ];
          insertJsonInlineContent(view, [{
            type: COMPOSER_CONTEXT_REFERENCE_NODE,
            attrs: { referenceId: ingress.reference.id },
          }]);
          return true;
        }

        insertJsonInlineContent(view, composerTextToTiptapContent(text));
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => {
          isComposingRef.current = true;
          callbacksRef.current.onCompositionStart?.();
          return false;
        },
        compositionend: () => {
          isComposingRef.current = false;
          callbacksRef.current.onCompositionEnd?.();
          requestAnimationFrame(() => {
            const instance = editorRef.current;
            if (instance) {
              syncEditorEmptyState(instance);
              const nextDocument = readEditorDocument(instance);
              callbacksRef.current.onChange(nextDocument, getComposerReferenceIds(nextDocument));
              detectMention(instance);
            }
          });
          return false;
        },
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (isComposingRef.current) return;
      syncEditorEmptyState(instance);
      const nextDocument = readEditorDocument(instance);
      callbacksRef.current.onChange(nextDocument, getComposerReferenceIds(nextDocument));
      detectMention(instance);
    },
    onSelectionUpdate: ({ editor: instance }) => detectMention(instance),
    onFocus: ({ editor: instance }) => {
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
      setIsFocused(true);
      callbacksRef.current.onFocus?.();
      detectMention(instance);
    },
    onBlur: () => {
      setIsFocused(false);
      callbacksRef.current.onBlur?.();
      blurTimerRef.current = window.setTimeout(closeMention, 200);
    },
  }, [extensions]);

  editorRef.current = editor;

  useEffect(() => () => {
    if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed || isComposingRef.current) return;
    syncEditorEmptyState(editor);
    const currentDocument = readEditorDocument(editor);
    if (areComposerDocumentsEqual(currentDocument, composerDocument)) return;

    const restoreFocus = editor.isFocused;
    editor.commands.setContent(composerDocumentToTiptap(composerDocument), { emitUpdate: false });
    syncEditorEmptyState(editor);
    if (restoreFocus) editor.commands.focus('end');
  }, [composerDocument, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    customClassNamesRef.current.forEach(name => dom.classList.remove(name));
    const customClassNames = className.split(/\s+/).filter(Boolean);
    customClassNames.forEach(name => dom.classList.add(name));
    customClassNamesRef.current = customClassNames;
    dom.classList.add('rich-text-input');
    dom.classList.toggle('rich-text-input--focused', isFocused);
    dom.classList.toggle('rich-text-input--disabled', disabled);
    dom.dataset.placeholder = placeholder;
    if (testId) dom.dataset.testid = testId;
    else delete dom.dataset.testid;
  }, [className, disabled, editor, isFocused, placeholder, testId]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.querySelectorAll<HTMLSpanElement>('[data-composer-context-reference]')
      .forEach(element => renderReferenceElement(element, element.dataset.referenceId || ''));
  }, [assets, editor, references, renderReferenceElement]);

  useImperativeHandle(ref, () => ({
    get element() {
      return editor && !editor.isDestroyed ? editor.view.dom as HTMLDivElement : null;
    },
    focus: () => editor?.commands.focus('end'),
    contains: node => Boolean(node && editor && !editor.isDestroyed && editor.view.dom.contains(node)),
    insertTag: (reference, context) => {
      if (
        editor
        && isAdjacentReferenceForAsset(editor.view, reference.assetId, referencesRef.current)
      ) {
        callbacksRef.current.onRemoveReference(reference.id);
        return;
      }
      assetsRef.current = [
        ...assetsRef.current.filter(item => item.id !== context.id),
        context,
      ];
      referencesRef.current = [
        ...referencesRef.current.filter(item => item.id !== reference.id),
        reference,
      ];
      if (!editor) return;
      const chain = editor.chain();
      if (!editor.isFocused) chain.focus('end');
      chain.insertContent({
        type: COMPOSER_CONTEXT_REFERENCE_NODE,
        attrs: { referenceId: reference.id },
      }).run();
    },
    insertTagReplacingMention: (reference, context) => {
      assetsRef.current = [
        ...assetsRef.current.filter(item => item.id !== context.id),
        context,
      ];
      referencesRef.current = [
        ...referencesRef.current.filter(item => item.id !== reference.id),
        reference,
      ];
      const range = mentionRangeRef.current;
      if (!editor) return;
      const chain = editor.chain();
      if (range) chain.focus();
      else if (!editor.isFocused) chain.focus('end');
      if (range) chain.deleteRange(range);
      chain.insertContent({
        type: COMPOSER_CONTEXT_REFERENCE_NODE,
        attrs: { referenceId: reference.id },
      }).run();
      closeMention();
    },
    removeTag: referenceId => {
      if (!editor) return;
      let target: { from: number; to: number } | null = null;
      editor.state.doc.descendants((node, position) => {
        if (
          !target &&
          node.type.name === COMPOSER_CONTEXT_REFERENCE_NODE &&
          node.attrs.referenceId === referenceId
        ) {
          target = { from: position, to: position + node.nodeSize };
          return false;
        }
        return true;
      });
      if (target) editor.commands.deleteRange(target);
    },
    insertText: text => {
      if (!editor) return;
      const chain = editor.chain();
      if (!editor.isFocused) chain.focus('end');
      chain.insertContent(composerTextToTiptapContent(sanitizeComposerText(text))).run();
    },
    openMention: () => {
      if (!editor) return;
      const chain = editor.chain();
      if (!editor.isFocused) chain.focus('end');
      chain.insertContent('@').run();
      detectMention(editor);
    },
    closeMention,
    getPlainText: () => getComposerText(readEditorDocument(editor)),
    getDocument: () => readEditorDocument(editor),
  }), [closeMention, detectMention, editor]);

  return <EditorContent className="composer-editor-surface" editor={editor} />;
});

ComposerEditor.displayName = 'ComposerEditor';

export default ComposerEditor;
