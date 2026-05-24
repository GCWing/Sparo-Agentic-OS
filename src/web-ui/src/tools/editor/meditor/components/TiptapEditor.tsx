import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Link from '@tiptap/extension-link';
import { ArrowUp, FileText, ListTodo, ListTree, PenLine, X } from 'lucide-react';
import type { Editor as TiptapEditorInstance, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { useI18n } from '@/infrastructure/i18n';
import { Button, IconButton, Input } from '@/design-system';
import { editorAiAPI } from '@/infrastructure/api/service-api/EditorAiAPI';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { activeEditTargetService } from '@/tools/editor/services/ActiveEditTargetService';
import { MarkdownAlignmentExtension } from '../extensions/MarkdownAlignmentExtension';
import { BlockIdExtension } from '../extensions/BlockIdExtension';
import { MarkdownImage } from '../extensions/MarkdownImageExtension';
import {
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableHeader,
  MarkdownTableRow,
} from '../extensions/MarkdownTableExtensions';
import {
  InlineAiPreviewExtension,
} from '../extensions/InlineAiPreviewExtension';
import { inlineAiPreviewPluginKey } from '../extensions/InlineAiPreviewPluginKey';
import { CoauthorCommentPinsExtension } from '../extensions/CoauthorCommentPinsExtension';
import { coauthorCommentPinsPluginKey } from '../extensions/CoauthorCommentPinsPluginKey';
import { CoauthorInlineSuggestionsExtension } from '../extensions/CoauthorInlineSuggestionsExtension';
import {
  COAUTHOR_INLINE_SUGGESTION_EVENT,
  coauthorInlineSuggestionsPluginKey,
  type CoauthorInlineSuggestion,
} from '../extensions/CoauthorInlineSuggestionsPluginKey';
import { RawHtmlBlock, RawHtmlInline, RenderOnlyBlock } from '../extensions/RawHtmlExtensions';
import { getBlockIndexForLine } from '../utils/markdownBlocks';
import {
  buildInlineContinuePrompt,
  buildInlineSummaryPrompt,
  buildInlineTodoPrompt,
  sanitizeInlineAiMarkdownResponse,
} from '../utils/inlineAi';
import { getCachedLocalImageDataUrl, loadLocalImages } from '../utils/loadLocalImages';
import { isLocalPath, resolveImagePath } from '../utils/rehype-local-images';
import {
  analyzeMarkdownEditability,
  markdownToTiptapDoc,
  tiptapDocToMarkdown,
  tiptapDocToTopLevelMarkdownBlocks,
} from '../utils/tiptapMarkdown';
import {
  builtInDocumentActions,
  buildDocumentTarget,
  buildCoauthorDocumentContext,
  COAUTHOR_COMMAND_EVENT,
  detectProposalStaleness,
  ProposalSession,
  applyProposalToMarkdown,
  computeReplaceDocumentReview,
  persistAcceptedComments,
  readPersistedComments,
  readDocumentProfileSidecar,
  registerMarkdownCoauthorCommands,
  resolveDocumentProfile,
  sha256Hex,
  useSuggestionStore,
  type DocumentEditOp,
  type DocumentEditProposal,
  type DocumentDiffReview,
  type DocumentIntent,
  type DocumentScope,
} from '../../coauthor';
import './TiptapEditor.scss';

const log = createLogger('TiptapEditor');

export interface TiptapEditorHandle {
  scrollToLine: (line: number, highlight?: boolean) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  focus: () => void;
  getContent: () => string;
  markSaved: () => void;
  setInitialContent: (content: string) => void;
  isDirty: boolean;
}

interface TiptapEditorProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  emptyDocumentPlaceholder?: string;
  readonly?: boolean;
  autofocus?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  filePath?: string;
  workspacePath?: string;
  basePath?: string;
}

function executeContentEditableAction(action: 'copy' | 'cut'): boolean {
  return document.execCommand(action);
}

function focusEditorWithoutScroll(instance: TiptapEditorInstance | null | undefined): void {
  if (!instance) {
    return;
  }

  const dom = instance.view.dom as HTMLElement | null;
  if (dom) {
    try {
      dom.focus({ preventScroll: true });
      return;
    } catch {
      dom.focus();
      return;
    }
  }

  instance.commands.focus();
}

function getTopLevelBlockIds(doc: JSONContent | null | undefined): string[] {
  return (doc?.content ?? [])
    .map((node: JSONContent) => (typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null))
    .filter((value: string | null): value is string => typeof value === 'string');
}

function syncInlineAiHints(
  instance: TiptapEditorInstance,
  root: HTMLDivElement | null,
  hintText: string
): void {
  if (!root) {
    return;
  }

  root.querySelectorAll<HTMLElement>('[data-inline-ai-hint]').forEach(element => {
    element.removeAttribute('data-inline-ai-hint');
  });
  root.querySelectorAll<HTMLElement>('[data-inline-ai-active]').forEach(element => {
    element.removeAttribute('data-inline-ai-active');
  });

  const { selection } = instance.state;
  const activeBlockId =
    selection.empty &&
    selection.$from.depth === 1 &&
    selection.$from.parent.type.name === 'paragraph' &&
    selection.$from.parent.textContent.trim().length === 0 &&
    typeof selection.$from.parent.attrs?.blockId === 'string'
      ? selection.$from.parent.attrs.blockId
      : null;

  instance.state.doc.forEach((node) => {
    if (node.type.name !== 'paragraph' || node.textContent.trim().length > 0) {
      return;
    }

    const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null;
    if (!blockId) {
      return;
    }

    const element = root.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (!element) {
      return;
    }

    element.setAttribute('data-inline-ai-hint', hintText);
    if (blockId === activeBlockId) {
      element.setAttribute('data-inline-ai-active', 'true');
    }
  });
}

async function resolveEditorLocalImages(
  root: HTMLDivElement | null,
  basePath?: string,
): Promise<void> {
  const container = root?.querySelector<HTMLElement>('.ProseMirror');
  if (!container) {
    return;
  }

  const imageNodes = container.querySelectorAll<HTMLImageElement>('img');

  imageNodes.forEach((img) => {
    if (img.dataset.localResolved === 'true') {
      return;
    }

    const src = img.getAttribute('src');
    if (!src || !isLocalPath(src)) {
      img.dataset.localResolved = 'true';
      return;
    }

    const absolutePath = resolveImagePath(src, basePath);
    const cachedDataUrl = getCachedLocalImageDataUrl(absolutePath);
    img.setAttribute('data-local-image', 'true');
    img.setAttribute('data-local-path', absolutePath);
    img.setAttribute('data-original-src', src);
    img.dataset.localResolved = 'true';

    if (cachedDataUrl) {
      img.src = cachedDataUrl;
      img.classList.remove('local-image-loading', 'local-image-error');
      img.classList.add('local-image-loaded');
      img.removeAttribute('data-local-image');
      img.removeAttribute('data-local-path');
      return;
    }

    if (!img.classList.contains('local-image-loaded')) {
      img.classList.add('local-image-loading');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
  });

  await loadLocalImages(container);
}

type InlineAiStatus = 'idle' | 'submitting' | 'streaming' | 'ready' | 'error';
type InlineAiPromptKind = 'continue' | 'summary' | 'todo';

type InlineAiState = {
  isOpen: boolean;
  promptKind: InlineAiPromptKind;
  query: string;
  status: InlineAiStatus;
  response: string;
  error: string | null;
  proposal: DocumentEditProposal | null;
  blockId: string;
  blockIndex: number;
  anchorTop: number;
  anchorLeft: number;
};

type InlineAiRequest = {
  requestId: string;
  cancel: () => Promise<void>;
  cleanup: () => void;
};

type CoauthorSelectionBubble = {
  top: number;
  left: number;
  selectedText: string;
  selectionFrom: number;
  selectionTo: number;
  mode: 'anchor' | 'input' | 'submitting';
  query: string;
};

type TopLevelBlockPosition = {
  blockId: string;
  blockIndex: number;
  pos: number;
  nodeSize: number;
  contentSize: number;
};

type MarkdownSection = {
  id: string;
  blockId?: string;
  pos: number;
  level: number;
  title: string;
};

function collectMarkdownSections(instance: TiptapEditorInstance): MarkdownSection[] {
  const sections: MarkdownSection[] = [];

  instance.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') {
      return;
    }

    const title = node.textContent.trim();
    if (!title) {
      return;
    }

    const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined;
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
    sections.push({
      id: blockId ?? `heading-${offset}`,
      blockId,
      pos: offset,
      level,
      title,
    });
  });

  return sections;
}

function createInlineSessionId(prefix: string): string {
  try {
    const fn = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
    if (fn) {
      return `${prefix}-${fn()}`;
    }
  } catch {
    // Ignore and fall through.
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTopLevelBlockPositionById(
  instance: TiptapEditorInstance,
  blockId: string
): TopLevelBlockPosition | null {
  let result: TopLevelBlockPosition | null = null;

  instance.state.doc.forEach((node, offset, index) => {
    if (typeof node.attrs?.blockId !== 'string' || node.attrs.blockId !== blockId) {
      return;
    }

    result = {
      blockId,
      blockIndex: index,
      pos: offset,
      nodeSize: node.nodeSize,
      contentSize: node.content.size,
    };
  });

  return result;
}

function resolveBlockDocPosition(
  instance: TiptapEditorInstance,
  position: { kind: 'blockId'; blockId: string; offset?: number },
): number | null {
  const block = getTopLevelBlockPositionById(instance, position.blockId);
  if (!block) {
    return null;
  }

  const offset = Math.max(0, Math.min(position.offset ?? 0, block.contentSize));
  return block.pos + 1 + offset;
}

function resolveInlineCoauthorSuggestion(
  instance: TiptapEditorInstance,
  op: DocumentEditOp,
): CoauthorInlineSuggestion | null {
  if (op.type === 'insertAt') {
    if (op.position.kind !== 'blockId') {
      return null;
    }

    const pos = resolveBlockDocPosition(instance, op.position);
    return pos === null ? null : {
      opId: op.id,
      type: op.type,
      from: pos,
      to: pos,
      markdown: op.markdown,
      reason: op.reason,
    };
  }

  if (op.type === 'replaceRange' || op.type === 'deleteRange') {
    if (op.from.kind !== 'blockId' || op.to.kind !== 'blockId' || op.from.blockId !== op.to.blockId) {
      return null;
    }

    const from = resolveBlockDocPosition(instance, op.from);
    const to = resolveBlockDocPosition(instance, op.to);
    if (from === null || to === null || to < from) {
      return null;
    }

    return {
      opId: op.id,
      type: op.type,
      from,
      to,
      markdown: op.type === 'replaceRange' ? op.markdown : undefined,
      reason: op.reason,
    };
  }

  return null;
}

function getCurrentEmptyParagraphContext(
  instance: TiptapEditorInstance,
  root: HTMLDivElement | null
): Omit<InlineAiState, 'isOpen' | 'promptKind' | 'query' | 'status' | 'response' | 'error' | 'proposal'> | null {
  const { selection } = instance.state;
  if (!selection.empty || selection.$from.depth !== 1) {
    return null;
  }

  const parentNode = selection.$from.parent;
  if (parentNode.type.name !== 'paragraph' || parentNode.textContent.trim().length > 0) {
    return null;
  }

  const blockId = typeof parentNode.attrs?.blockId === 'string' ? parentNode.attrs.blockId : '';
  if (!blockId) {
    return null;
  }

  const blockIndex = selection.$from.index(0);
  const blockElement = root?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
  const rootRect = root?.getBoundingClientRect();
  const blockRect = blockElement?.getBoundingClientRect();

  return {
    blockId,
    blockIndex,
    anchorTop: root && rootRect && blockRect
      ? blockRect.top - rootRect.top + root.scrollTop + blockRect.height + 8
      : 16,
    anchorLeft: root && rootRect && blockRect
      ? blockRect.left - rootRect.left + root.scrollLeft
      : 16,
  };
}

function isMarkdownTableCellNode(node: ProseMirrorNode): boolean {
  return node.type.name === 'markdownTableHeader' || node.type.name === 'markdownTableCell';
}

function isEffectivelyEmptyMarkdownTableCell(node: ProseMirrorNode): boolean {
  if (!isMarkdownTableCellNode(node)) {
    return false;
  }

  if (node.childCount === 0) {
    return true;
  }

  let hasMeaningfulContent = false;

  node.descendants((child) => {
    if (child.isText) {
      if ((child.text ?? '').trim().length > 0) {
        hasMeaningfulContent = true;
        return false;
      }
      return;
    }

    if (child.isInline) {
      hasMeaningfulContent = true;
      return false;
    }
  });

  return !hasMeaningfulContent;
}

function isEffectivelyEmptyMarkdownTable(node: ProseMirrorNode): boolean {
  if (node.type.name !== 'markdownTable') {
    return false;
  }

  let hasCells = false;
  let hasMeaningfulContent = false;

  node.descendants((child) => {
    if (!isMarkdownTableCellNode(child)) {
      return;
    }

    hasCells = true;
    if (!isEffectivelyEmptyMarkdownTableCell(child)) {
      hasMeaningfulContent = true;
      return false;
    }
  });

  return hasCells && !hasMeaningfulContent;
}

function deleteEmptyMarkdownTableAtSelection(instance: TiptapEditorInstance): boolean {
  const { selection } = instance.state;
  if (!selection.empty) {
    return false;
  }

  const { $from } = selection;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (isMarkdownTableCellNode($from.node(depth))) {
      cellDepth = depth;
      break;
    }
  }

  if (cellDepth < 0) {
    return false;
  }

  const cellNode = $from.node(cellDepth);
  if ($from.parentOffset !== 0 || !isEffectivelyEmptyMarkdownTableCell(cellNode)) {
    return false;
  }

  let tableDepth = -1;
  for (let depth = cellDepth - 1; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === 'markdownTable') {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth < 0) {
    return false;
  }

  const tableNode = $from.node(tableDepth);
  if (!isEffectivelyEmptyMarkdownTable(tableNode)) {
    return false;
  }

  const tablePos = $from.before(tableDepth);
  const tr = instance.state.tr.deleteRange(tablePos, tablePos + tableNode.nodeSize);

  if (tr.doc.childCount === 0) {
    const paragraph = tr.doc.type.schema.nodes.paragraph?.create();
    if (paragraph) {
      tr.insert(0, paragraph);
    }
  }

  const nextSelectionPos = Math.min(tablePos, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(nextSelectionPos), nextSelectionPos > 0 ? -1 : 1));
  instance.view.dispatch(tr.scrollIntoView());
  return true;
}

function replaceEditorContentWithoutHistory(
  instance: TiptapEditorInstance,
  markdown: string,
): void {
  instance
    .chain()
    .setMeta('addToHistory', false)
    .setContent(markdownToTiptapDoc(markdown), {
      emitUpdate: false,
    })
    .run();
}

export const TiptapEditor = React.forwardRef<TiptapEditorHandle, TiptapEditorProps>(({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  emptyDocumentPlaceholder,
  readonly = false,
  autofocus = false,
  onDirtyChange,
  filePath,
  workspacePath,
  basePath,
}, ref) => {
  const { t } = useI18n('tools');
  const { t: tCommon } = useI18n('common');
  const rootRef = useRef<HTMLDivElement>(null);
  const inlineRequestRef = useRef<InlineAiRequest | null>(null);
  const inlineAiStateRef = useRef<InlineAiState | null>(null);
  const readonlyRef = useRef(readonly);
  const filePathRef = useRef(filePath);
  const editorRef = useRef<TiptapEditorInstance | null>(null);
  const savedContentRef = useRef(value);
  const currentMarkdownRef = useRef(value);
  const preserveTrailingNewlineRef = useRef(value.endsWith('\n'));
  const applyingExternalValueRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);
  const targetIdRef = useRef(`markdown-ir-tiptap-${Math.random().toString(36).slice(2, 10)}`);
  const inlineAiInputRef = useRef<HTMLInputElement | null>(null);
  const inlineAiInputComposingRef = useRef(false);
  const coauthorSelectionInputRef = useRef<HTMLInputElement | null>(null);
  const outlineFocusTimerRef = useRef<number | null>(null);
  const outlineActiveSyncTimerRef = useRef<number | null>(null);
  const outlineActiveSyncPausedRef = useRef(false);
  const [inlineAiState, setInlineAiState] = useState<InlineAiState | null>(null);
  const [sections, setSections] = useState<MarkdownSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [coauthorBusy, setCoauthorBusy] = useState(false);
  const [coauthorDocumentDiff, setCoauthorDocumentDiff] = useState<DocumentDiffReview | null>(null);
  const [coauthorSelectionBubble, setCoauthorSelectionBubble] = useState<CoauthorSelectionBubble | null>(null);
  const [persistedCommentPins, setPersistedCommentPins] = useState<Array<{
    id: string;
    blockId?: string;
    message: string;
    severity?: 'info' | 'warning' | 'error';
  }>>([]);
  const activeProposalId = useSuggestionStore(state => state.activeProposalId);
  const activeEntry = useSuggestionStore(state => (
    state.activeProposalId ? state.entries[state.activeProposalId] : undefined
  ));

  const initialContent = useMemo(() => markdownToTiptapDoc(value), [value]);
  const inlineAiTriggerHint = t('editor.meditor.inlineAi.triggerHint');

  const syncSections = useCallback((instance: TiptapEditorInstance) => {
    const nextSections = collectMarkdownSections(instance);
    setSections(nextSections);
    setActiveSectionId(current => (
      nextSections.some(section => section.id === current)
        ? current
        : nextSections[0]?.id ?? null
    ));
  }, []);

  const getSectionElement = useCallback((section: MarkdownSection): HTMLElement | null => {
    const root = rootRef.current;

    if (section.blockId) {
      const element = root?.querySelector<HTMLElement>(`[data-block-id="${section.blockId}"]`);
      if (element) {
        return element;
      }
    }

    return (editorRef.current?.view.nodeDOM(section.pos) as HTMLElement | null) ?? null;
  }, []);

  const syncActiveSection = useCallback(() => {
    if (outlineActiveSyncPausedRef.current) {
      return;
    }

    const root = rootRef.current;
    if (!root || sections.length === 0) {
      setActiveSectionId(null);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const activationTop = rootRect.top + 120;
    let nextActiveId = sections[0]?.id ?? null;

    for (const section of sections) {
      const element = getSectionElement(section);
      if (!element) {
        continue;
      }

      if (element.getBoundingClientRect().top <= activationTop) {
        nextActiveId = section.id;
      } else {
        break;
      }
    }

    setActiveSectionId(current => current === nextActiveId ? current : nextActiveId);
  }, [getSectionElement, sections]);

  const scrollToSection = useCallback((sectionId: string) => {
    const instance = editorRef.current;
    const section = sections.find(item => item.id === sectionId);
    const element = section ? getSectionElement(section) : null;

    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: 'auto', block: 'start' });
    setActiveSectionId(sectionId);
    outlineActiveSyncPausedRef.current = true;

    if (outlineActiveSyncTimerRef.current !== null) {
      window.clearTimeout(outlineActiveSyncTimerRef.current);
      outlineActiveSyncTimerRef.current = null;
    }
    outlineActiveSyncTimerRef.current = window.setTimeout(() => {
      outlineActiveSyncTimerRef.current = null;
      outlineActiveSyncPausedRef.current = false;
      syncActiveSection();
    }, 120);

    if (outlineFocusTimerRef.current !== null) {
      window.clearTimeout(outlineFocusTimerRef.current);
      outlineFocusTimerRef.current = null;
    }

    if (instance) {
      outlineFocusTimerRef.current = window.setTimeout(() => {
        outlineFocusTimerRef.current = null;
        if (editorRef.current === instance) {
          focusEditorWithoutScroll(instance);
        }
      }, 220);
    }
  }, [getSectionElement, sections, syncActiveSection]);

  useEffect(() => {
    return () => {
      if (outlineFocusTimerRef.current !== null) {
        window.clearTimeout(outlineFocusTimerRef.current);
      }
      if (outlineActiveSyncTimerRef.current !== null) {
        window.clearTimeout(outlineActiveSyncTimerRef.current);
      }
    };
  }, []);

  const handleOutlineItemMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const handleOutlineItemClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, sectionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    scrollToSection(sectionId);
  }, [scrollToSection]);

  const syncCoauthorSelectionBubble = useCallback((instance: TiptapEditorInstance) => {
    if (coauthorSelectionBubble?.mode === 'input' || coauthorSelectionBubble?.mode === 'submitting') {
      return;
    }

    const { selection } = instance.state;
    if (selection.empty || readonlyRef.current) {
      setCoauthorSelectionBubble(null);
      return;
    }

    const selectedText = instance.state.doc.textBetween(selection.from, selection.to, '\n').trim();
    if (!selectedText) {
      setCoauthorSelectionBubble(null);
      return;
    }

    const root = rootRef.current;
    if (!root) {
      setCoauthorSelectionBubble(null);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const coords = instance.view.coordsAtPos(selection.to);
    setCoauthorSelectionBubble({
      selectedText,
      selectionFrom: selection.from,
      selectionTo: selection.to,
      top: coords.bottom - rootRect.top + root.scrollTop + 8,
      left: Math.max(8, coords.left - rootRect.left + root.scrollLeft),
      mode: 'anchor',
      query: '',
    });
  }, [coauthorSelectionBubble?.mode]);

  useEffect(() => {
    let cancelled = false;
    const proposal = activeEntry?.proposal;

    if (!proposal || !proposal.ops.some(op => op.type === 'replaceDocument')) {
      setCoauthorDocumentDiff(null);
      return;
    }

    void computeReplaceDocumentReview(proposal, currentMarkdownRef.current)
      .then((review) => {
        if (!cancelled) {
          setCoauthorDocumentDiff(review);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          log.warn('Failed to compute co-author document diff review', {
            proposalId: proposal.proposalId,
            error,
          });
          setCoauthorDocumentDiff(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeEntry?.proposal]);

  useEffect(() => {
    inlineAiStateRef.current = inlineAiState;
  }, [inlineAiState]);

  useEffect(() => {
    registerMarkdownCoauthorCommands();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void readPersistedComments(workspacePath, filePath)
      .then(comments => {
        if (cancelled) {
          return;
        }
        setPersistedCommentPins(comments.map(comment => ({
          id: comment.id,
          blockId: comment.from.kind === 'blockId' ? comment.from.blockId : undefined,
          message: comment.message,
          severity: comment.severity,
        })));
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, workspacePath]);

  useEffect(() => {
    if (!inlineAiState?.isOpen || inlineAiState.status !== 'idle') {
      return;
    }

    window.setTimeout(() => {
      const input = inlineAiInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      const value = input.value;
      input.setSelectionRange(value.length, value.length);
    }, 0);
  }, [inlineAiState?.isOpen, inlineAiState?.status]);

  useEffect(() => {
    if (coauthorSelectionBubble?.mode !== 'input') {
      return;
    }

    window.setTimeout(() => {
      coauthorSelectionInputRef.current?.focus();
    }, 0);
  }, [coauthorSelectionBubble?.mode]);

  useEffect(() => {
    readonlyRef.current = readonly;
  }, [readonly]);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  const serializeEditorMarkdown = useCallback((instance: TiptapEditorInstance): string => (
    tiptapDocToMarkdown(instance.getJSON(), {
      preserveTrailingNewline: preserveTrailingNewlineRef.current,
    })
  ), []);

  const closeInlineAi = useCallback((options?: { cancelRequest?: boolean; focusEditor?: boolean }) => {
    const shouldCancel = options?.cancelRequest ?? false;
    const shouldFocusEditor = options?.focusEditor ?? true;

    const activeRequest = inlineRequestRef.current;
    if (shouldCancel && activeRequest) {
      void activeRequest.cancel().catch(error => {
        log.warn('Failed to cancel inline AI request', {
          requestId: activeRequest.requestId,
          error,
        });
      });
    }

    activeRequest?.cleanup();
    inlineRequestRef.current = null;
    setInlineAiState(null);

    if (shouldFocusEditor) {
      window.setTimeout(() => {
        focusEditorWithoutScroll(editorRef.current);
      }, 0);
    }
  }, []);

  const openInlineAi = useCallback((instance: TiptapEditorInstance) => {
    const nextState = getCurrentEmptyParagraphContext(instance, rootRef.current);
    if (!nextState) {
      return false;
    }

    setInlineAiState({
      ...nextState,
      isOpen: true,
      promptKind: 'continue',
      query: '',
      status: 'idle',
      response: '',
      error: null,
      proposal: null,
    });

    return true;
  }, []);

  const insertGeneratedMarkdown = useCallback((instance: TiptapEditorInstance, blockId: string, markdown: string) => {
    const normalized = sanitizeInlineAiMarkdownResponse(markdown);
    if (!normalized) {
      return false;
    }

    const targetBlock = getTopLevelBlockPositionById(instance, blockId);
    if (!targetBlock) {
      return false;
    }

    const content = markdownToTiptapDoc(normalized).content ?? [];
    if (content.length === 0) {
      return false;
    }

    return instance
      .chain()
      .focus()
      .insertContentAt(
        {
          from: targetBlock.pos,
          to: targetBlock.pos + targetBlock.nodeSize,
        },
        content
      )
      .run();
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    autofocus,
    editable: !readonly,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: ({ editor, node, hasAnchor }) => {
          if (node.type.name !== 'paragraph') {
            return placeholder ?? '';
          }

          if (editor.isEmpty && emptyDocumentPlaceholder) {
            return emptyDocumentPlaceholder;
          }

          if (!hasAnchor) {
            return placeholder ?? '';
          }

          return inlineAiTriggerHint;
        },
      }),
      MarkdownAlignmentExtension,
      BlockIdExtension,
      MarkdownImage.configure({
        basePath,
      }),
      Details.configure({
        persist: true,
      }),
      DetailsSummary,
      DetailsContent,
      // Keep raw/render-only fallbacks for HTML we still can't round-trip safely.
      RenderOnlyBlock.configure({
        basePath,
      }),
      RawHtmlBlock.configure({
        basePath,
      }),
      RawHtmlInline.configure({
        label: t('editor.meditor.rawHtml.inlineLabel'),
      }),
      MarkdownTable,
      MarkdownTableRow,
      MarkdownTableHeader,
      MarkdownTableCell,
      InlineAiPreviewExtension,
      CoauthorCommentPinsExtension,
      CoauthorInlineSuggestionsExtension,
    ],
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (readonlyRef.current || inlineAiStateRef.current?.isOpen) {
          return false;
        }

        const instance = editorRef.current;
        if (
          event.key === 'Backspace' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !!instance &&
          deleteEmptyMarkdownTableAtSelection(instance)
        ) {
          event.preventDefault();
          return true;
        }

        if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }

        if (!instance) {
          return false;
        }

        const opened = openInlineAi(instance);
        if (!opened) {
          return false;
        }

        event.preventDefault();
        return true;
      },
    },
    content: initialContent,
    onCreate: ({ editor: instance }: { editor: TiptapEditorInstance }) => {
      editorRef.current = instance;
      preserveTrailingNewlineRef.current = value.endsWith('\n');
      const markdown = serializeEditorMarkdown(instance);
      currentMarkdownRef.current = markdown;
      savedContentRef.current = markdown;
      syncSections(instance);
      syncInlineAiHints(instance, rootRef.current, inlineAiTriggerHint);
      onDirtyChange?.(false);
    },
    onFocus: ({ editor: instance }: { editor: TiptapEditorInstance }) => {
      activeEditTargetService.setActiveTarget(targetIdRef.current);
      syncInlineAiHints(instance, rootRef.current, inlineAiTriggerHint);
      onFocus?.();
    },
    onBlur: ({ editor: instance }: { editor: TiptapEditorInstance }) => {
      syncInlineAiHints(instance, rootRef.current, inlineAiTriggerHint);
      window.setTimeout(() => {
        const root = rootRef.current;
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
        if (root && activeElement && root.contains(activeElement)) {
          return;
        }

        activeEditTargetService.clearActiveTarget(targetIdRef.current);
      }, 0);
      onBlur?.();
    },
    onSelectionUpdate: ({ editor: instance }: { editor: TiptapEditorInstance }) => {
      syncInlineAiHints(instance, rootRef.current, inlineAiTriggerHint);
      syncCoauthorSelectionBubble(instance);
    },
    onUpdate: ({ editor: instance }: { editor: TiptapEditorInstance }) => {
      const markdown = serializeEditorMarkdown(instance);
      currentMarkdownRef.current = markdown;
      syncSections(instance);
      syncInlineAiHints(instance, rootRef.current, inlineAiTriggerHint);

      if (applyingExternalValueRef.current) {
        applyingExternalValueRef.current = false;
        return;
      }

      onChange(markdown);
      onDirtyChange?.(markdown !== savedContentRef.current);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editorRef.current = editor;
    editor.setEditable(!readonly);
  }, [editor, readonly]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    syncInlineAiHints(editor, rootRef.current, inlineAiTriggerHint);
  }, [editor, inlineAiTriggerHint]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let frameId: number | null = null;
    const requestSync = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncActiveSection();
      });
    };

    requestSync();
    root.addEventListener('scroll', requestSync, { passive: true });
    window.addEventListener('resize', requestSync);

    return () => {
      root.removeEventListener('scroll', requestSync);
      window.removeEventListener('resize', requestSync);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [sections, syncActiveSection]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    let cancelled = false;
    let running = false;
    let rerunRequested = false;

    const run = async () => {
      if (cancelled || running) {
        rerunRequested = true;
        return;
      }

      running = true;
      rerunRequested = false;

      do {
        rerunRequested = false;
        try {
          await resolveEditorLocalImages(rootRef.current, basePath);
        } catch (error) {
          if (!cancelled) {
            log.error('Failed to resolve editor local images', { error, basePath });
          }
        }
      } while (!cancelled && rerunRequested);

      running = false;
    };

    const scheduleRun = () => {
      if (cancelled) {
        return;
      }
      void run();
    };

    scheduleRun();

    const container = rootRef.current?.querySelector<HTMLElement>('.ProseMirror');
    const observer = container
      ? new MutationObserver(() => {
          scheduleRun();
        })
      : null;

    if (observer && container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src'],
      });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [basePath, editor, value]);

  useEffect(() => {
    if (!editor || value === currentMarkdownRef.current) {
      return;
    }

    applyingExternalValueRef.current = true;
    preserveTrailingNewlineRef.current = value.endsWith('\n');
    currentMarkdownRef.current = value;
    replaceEditorContentWithoutHistory(editor, value);
    syncSections(editor);
    syncInlineAiHints(editor, rootRef.current, inlineAiTriggerHint);
    onDirtyChange?.(value !== savedContentRef.current);
  }, [editor, inlineAiTriggerHint, syncSections, value, onDirtyChange]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    return activeEditTargetService.bindTarget({
      id: targetIdRef.current,
      kind: 'markdown-ir',
      focus: () => {
        focusEditorWithoutScroll(editor);
      },
      hasTextFocus: () => editor.isFocused,
      undo: () => editor.commands.undo(),
      redo: () => editor.commands.redo(),
      cut: () => {
        if (readonly) {
          return false;
        }

        editor.commands.focus();
        return executeContentEditableAction('cut');
      },
      copy: () => {
        editor.commands.focus();
        return executeContentEditableAction('copy');
      },
      selectAll: () => {
        editor.commands.focus();
        return editor.commands.selectAll();
      },
      containsElement: (element) => {
        const root = rootRef.current;
        return !!root && !!element && root.contains(element);
      },
    });
  }, [editor, readonly]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }

      useSuggestionStore.getState().clearFile(filePathRef.current);
      inlineRequestRef.current?.cancel().catch(error => {
        log.warn('Failed to cancel inline AI request during cleanup', { error });
      });
      inlineRequestRef.current?.cleanup();
      inlineRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inlineAiState?.isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('.m-editor-inline-ai') || target.closest('.m-editor-inline-ai-preview')) {
        return;
      }

      const shouldCancel =
        inlineAiStateRef.current?.status === 'submitting' ||
        inlineAiStateRef.current?.status === 'streaming';
      closeInlineAi({ cancelRequest: shouldCancel, focusEditor: false });
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [closeInlineAi, inlineAiState?.isOpen]);

  const focusBlockByIndex = useCallback((instance: TiptapEditorInstance, index: number, highlight: boolean) => {
    const blockIds = getTopLevelBlockIds(instance.getJSON());
    const blockId = blockIds[index];

    if (!blockId) {
      instance.commands.focus('end');
      return;
    }

    const root = rootRef.current;
    const element = root?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);

    if (!element) {
      instance.commands.focus('end');
      return;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (highlight) {
      element.classList.add('m-editor-tiptap-block-highlighted');

      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }

      highlightTimerRef.current = window.setTimeout(() => {
        element.classList.remove('m-editor-tiptap-block-highlighted');
      }, 3000);
    }

    instance.commands.focus();
  }, []);

  const handleContinueWriting = useCallback(async (
    options?: { userInputOverride?: string; promptKindOverride?: InlineAiPromptKind }
  ) => {
    if (!inlineAiState || inlineAiState.status === 'submitting' || inlineAiState.status === 'streaming') {
      return;
    }

    inlineRequestRef.current?.cleanup();
    inlineRequestRef.current = null;

    const requestId = createInlineSessionId('meditor-inline');

    setInlineAiState(current => current ? {
      ...current,
      status: 'submitting',
      response: '',
      error: null,
      proposal: null,
    } : current);

    let responseText = '';
    let isCleanedUp = false;
    let unlistenChunk: () => void = () => {};
    let unlistenCompleted: () => void = () => {};
    let unlistenFailed: () => void = () => {};

    const cleanup = () => {
      if (isCleanedUp) {
        return;
      }
      isCleanedUp = true;

      try {
        unlistenChunk();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        unlistenCompleted();
      } catch {
        // Ignore cleanup failures.
      }
      try {
        unlistenFailed();
      } catch {
        // Ignore cleanup failures.
      }
    };

    unlistenChunk = editorAiAPI.onTextChunk(event => {
      if (event.requestId !== requestId) {
        return;
      }

      if (!event.text) {
        return;
      }

      responseText += event.text;
      setInlineAiState(current => current ? {
        ...current,
        status: 'streaming',
        response: responseText,
        error: null,
      } : current);
    });

    unlistenCompleted = editorAiAPI.onCompleted(event => {
      if (event.requestId !== requestId) {
        return;
      }

      cleanup();
      inlineRequestRef.current = null;

      const finalText = event.fullText && event.fullText.length >= responseText.length
        ? event.fullText
        : responseText;
      const sanitizedResponse = sanitizeInlineAiMarkdownResponse(finalText);

      if (!sanitizedResponse) {
        setInlineAiState(current => current ? {
          ...current,
          status: 'error',
          error: t('editor.meditor.inlineAi.continueEmptyResult'),
        } : current);
        return;
      }

      void sha256Hex(currentMarkdownRef.current).then(sourceHash => {
        const sourceMarkdown = currentMarkdownRef.current;
        const proposal: DocumentEditProposal = {
          proposalId: `proposal-${requestId}`,
          filePath,
          sourceHash,
          sourceMarkdown,
          sourceBlocks: tiptapDocToTopLevelMarkdownBlocks(editorRef.current?.getJSON()),
          scope: 'block',
          intent: 'apply',
          summary: t('editor.meditor.inlineAi.previewTitle'),
          ops: [{
            id: `op-${requestId}`,
            type: 'replaceRange',
            from: { kind: 'blockId', blockId: inlineAiState.blockId, offset: 0 },
            to: { kind: 'blockId', blockId: inlineAiState.blockId, offset: 0 },
            markdown: sanitizedResponse,
            reason: t('editor.meditor.inlineAi.continueMode'),
          }],
        };

        setInlineAiState(current => current ? {
          ...current,
          status: 'ready',
          response: sanitizedResponse,
          error: null,
          proposal,
        } : current);
      });
    });

    unlistenFailed = editorAiAPI.onError(event => {
      if (event.requestId !== requestId) {
        return;
      }

      cleanup();
      inlineRequestRef.current = null;
      setInlineAiState(current => current ? {
        ...current,
      status: 'error',
      error: typeof event.error === 'string' ? event.error : t('editor.meditor.inlineAi.continueFailed'),
      proposal: null,
    } : current);
    });

    inlineRequestRef.current = {
      requestId,
      cancel: () => editorAiAPI.cancel({ requestId }),
      cleanup,
    };

    const resolvedUserInput = options?.userInputOverride ?? inlineAiState.query;
    const promptKind = options?.promptKindOverride ?? inlineAiState.promptKind;
    const instance = editorRef.current;
    const promptParams = {
      userInput: resolvedUserInput,
      markdown: currentMarkdownRef.current,
      blockIndex: inlineAiState.blockIndex,
      filePath,
      topLevelBlocks: instance ? tiptapDocToTopLevelMarkdownBlocks(instance.getJSON()) : undefined,
    };
    const prompt = promptKind === 'summary'
      ? buildInlineSummaryPrompt(promptParams)
      : promptKind === 'todo'
        ? buildInlineTodoPrompt(promptParams)
        : buildInlineContinuePrompt(promptParams);

    try {
      await editorAiAPI.stream({
        requestId,
        modelId: 'primary',
        prompt,
      });
    } catch (error) {
      cleanup();
      inlineRequestRef.current = null;
      log.error('Failed to start inline continuation request', { error });
      setInlineAiState(current => current ? {
        ...current,
      status: 'error',
      error: error instanceof Error ? error.message : t('editor.meditor.inlineAi.continueStartFailed'),
      proposal: null,
    } : current);
    }
  }, [filePath, inlineAiState, t]);

  const handleAcceptInlineContinue = useCallback(() => {
    const instance = editorRef.current;
    if (!inlineAiState || !instance) {
      return;
    }

    let inserted = false;
    if (inlineAiState.proposal) {
      const blocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
      const result = applyProposalToMarkdown(
        inlineAiState.proposal,
        currentMarkdownRef.current,
        blocks,
        new Set(inlineAiState.proposal.ops.map(op => op.id)),
      );
      if (result.appliedOpIds.length > 0) {
        preserveTrailingNewlineRef.current = result.markdown.endsWith('\n');
        inserted = instance
          .chain()
          .focus()
          .setContent(markdownToTiptapDoc(result.markdown), { emitUpdate: true })
          .run();
      }
    } else {
      inserted = insertGeneratedMarkdown(instance, inlineAiState.blockId, inlineAiState.response);
    }
    if (!inserted) {
      setInlineAiState(current => current ? {
        ...current,
        status: 'error',
        error: t('editor.meditor.inlineAi.continueEmptyResult'),
      } : current);
      return;
    }

    notificationService.success(t('editor.meditor.inlineAi.continueInserted'), { duration: 2500 });
    setInlineAiState(null);
    window.setTimeout(() => {
      instance.commands.focus();
    }, 0);
  }, [inlineAiState, insertGeneratedMarkdown, t]);

  const handleRejectInlineContinue = useCallback(() => {
    const shouldCancel = inlineAiState?.status === 'submitting' || inlineAiState?.status === 'streaming';
    closeInlineAi({ cancelRequest: shouldCancel, focusEditor: true });
  }, [closeInlineAi, inlineAiState?.status]);

  const handleRetryInlineContinue = useCallback(() => {
    void handleContinueWriting();
  }, [handleContinueWriting]);

  const handleRunCoauthor = useCallback(async (
    actionId: string,
    userDirective: string,
    options?: { scope?: DocumentScope; intent?: DocumentIntent; keepSelectionUi?: boolean },
  ) => {
    const instance = editorRef.current;
    if (!instance || coauthorBusy || readonlyRef.current) {
      return;
    }

    const action = builtInDocumentActions.find(item => item.id === actionId);
    if (!action) {
      return;
    }

    const resolvedScope = options?.scope ?? 'block';
    const markdown = currentMarkdownRef.current;
    const sourceBlocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
    const editability = analyzeMarkdownEditability(markdown);
    const shouldForceReview =
      editability.containsRenderOnlyBlocks ||
      editability.containsRawHtmlBlocks ||
      editability.hardIssues.length > 0;
    const resolvedIntent = shouldForceReview ? 'review' : (options?.intent ?? 'apply');

    setCoauthorBusy(true);
    if (!options?.keepSelectionUi) {
      setCoauthorSelectionBubble(null);
    }

    try {
      const target = buildDocumentTarget(instance, markdown, resolvedScope);
      const sidecarProfile = await readDocumentProfileSidecar(workspacePath, filePath);
      const sourceHash = await sha256Hex(markdown);
      const profile = resolveDocumentProfile(markdown, {
        disabled: false,
        sidecar: sidecarProfile,
        globalDefault: { language: 'same as document', tone: 'clear and concise' },
      }).profile;
      const session = new ProposalSession();
      await session.run(action, {
        actionId,
        scope: resolvedScope,
        intent: resolvedIntent,
        filePath,
        sourceHash,
        sourceMarkdown: markdown,
        sourceBlocks,
        documentMarkdown: buildCoauthorDocumentContext(markdown, resolvedScope, target),
        target,
        profile,
        userDirective: userDirective.trim() || undefined,
        modelId: 'primary',
      });
    } catch (error) {
      log.error('Failed to run Markdown co-author proposal', {
        actionId,
        scope: resolvedScope,
        intent: resolvedIntent,
        error,
      });
      notificationService.error(error instanceof Error ? error.message : t('editor.meditor.coauthor.failed'), {
        duration: 3500,
      });
    } finally {
      setCoauthorBusy(false);
    }
  }, [coauthorBusy, filePath, t, workspacePath]);

  const handleSubmitSelectionRewrite = useCallback(async () => {
    const selectionBubble = coauthorSelectionBubble;
    const query = selectionBubble?.query.trim();
    if (!selectionBubble || !query || selectionBubble.mode === 'submitting') {
      return;
    }

    setCoauthorSelectionBubble(current => current ? {
      ...current,
      mode: 'submitting',
    } : current);

    try {
      const instance = editorRef.current;
      if (instance) {
        const from = Math.max(0, Math.min(selectionBubble.selectionFrom, instance.state.doc.content.size));
        const to = Math.max(from, Math.min(selectionBubble.selectionTo, instance.state.doc.content.size));
        instance.view.dispatch(
          instance.state.tr
            .setMeta('addToHistory', false)
            .setSelection(TextSelection.create(instance.state.doc, from, to))
        );
      }

      await handleRunCoauthor('rewrite_selection', query, {
        scope: 'selection',
        intent: 'apply',
        keepSelectionUi: true,
      });
      setCoauthorSelectionBubble(null);
    } catch {
      setCoauthorSelectionBubble(current => current ? {
        ...current,
        mode: 'input',
      } : current);
    }
  }, [
    coauthorSelectionBubble,
    handleRunCoauthor,
  ]);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{
        actionId?: string;
        scope?: DocumentScope;
        intent?: DocumentIntent;
      }>).detail;
      if (!detail?.actionId) {
        return;
      }
      void handleRunCoauthor(detail.actionId, '', {
        scope: detail.scope,
        intent: detail.intent,
      });
    };

    window.addEventListener(COAUTHOR_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(COAUTHOR_COMMAND_EVENT, handleCommand);
  }, [handleRunCoauthor]);

  const applyActiveCoauthorProposal = useCallback(async (opIds?: Set<string>) => {
    const instance = editorRef.current;
    if (!instance || !activeEntry) {
      return;
    }

    const markdown = currentMarkdownRef.current;
    const currentHash = await sha256Hex(markdown);
    const blocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
    const stale = detectProposalStaleness(activeEntry.proposal, currentHash, markdown, blocks);
    if (stale.stale) {
      useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'stale', {
        staleOpIds: stale.staleOpIds,
      });
      notificationService.warning(t('editor.meditor.coauthor.stale'), { duration: 3200 });
      return;
    }

    const result = coauthorDocumentDiff?.proposalId === activeEntry.proposal.proposalId && !opIds
      ? {
          markdown: coauthorDocumentDiff.modifiedMarkdown,
          appliedOpIds: [coauthorDocumentDiff.opId],
          commentOpIds: [],
        }
      : applyProposalToMarkdown(activeEntry.proposal, markdown, blocks, opIds);
    useSuggestionStore.getState().acceptOps(activeEntry.proposal.proposalId, result.appliedOpIds);
    useSuggestionStore.getState().acceptOps(activeEntry.proposal.proposalId, result.commentOpIds);
    void persistAcceptedComments(workspacePath, activeEntry.proposal, result.commentOpIds).catch(error => {
      log.warn('Failed to persist co-author comments', {
        proposalId: activeEntry.proposal.proposalId,
        error,
      });
    });

    if (result.appliedOpIds.length > 0) {
      preserveTrailingNewlineRef.current = result.markdown.endsWith('\n');
      instance
        .chain()
        .focus()
        .setContent(markdownToTiptapDoc(result.markdown), { emitUpdate: true })
        .run();
    }

    const handled = new Set([
      ...activeEntry.acceptedOpIds,
      ...activeEntry.rejectedOpIds,
      ...result.appliedOpIds,
      ...result.commentOpIds,
    ]);
    if (handled.size >= activeEntry.proposal.ops.length) {
      useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'applied');
    }

    notificationService.success(t('editor.meditor.coauthor.applied'), { duration: 2500 });
  }, [activeEntry, coauthorDocumentDiff, t, workspacePath]);

  const rejectCoauthorOps = useCallback((opIds: string[]) => {
    if (!activeProposalId || !activeEntry) {
      return;
    }
    useSuggestionStore.getState().rejectOps(activeProposalId, opIds);
    const handled = new Set([...activeEntry.acceptedOpIds, ...activeEntry.rejectedOpIds, ...opIds]);
    if (handled.size >= activeEntry.proposal.ops.length) {
      useSuggestionStore.getState().setStatus(activeProposalId, 'discarded');
    }
  }, [activeEntry, activeProposalId]);

  const rejectActiveCoauthorProposal = useCallback(() => {
    if (!activeProposalId || !activeEntry) {
      return;
    }
    rejectCoauthorOps(activeEntry.proposal.ops.map(op => op.id));
  }, [activeEntry, activeProposalId, rejectCoauthorOps]);

  const handleInlineAiQuickAction = useCallback((promptKind: InlineAiPromptKind, query: string) => {
    setInlineAiState(current => current ? {
      ...current,
      promptKind,
      query,
    } : current);
    void handleContinueWriting({
      userInputOverride: query,
      promptKindOverride: promptKind,
    });
  }, [handleContinueWriting]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const previewState = inlineAiState &&
      inlineAiState.status !== 'idle'
      ? {
          blockId: inlineAiState.blockId,
          status: inlineAiState.status,
          response: inlineAiState.response,
          error: inlineAiState.error,
          basePath,
          canAccept: (
            inlineAiState.status === 'ready' &&
            !!inlineAiState.response.trim()
          ),
          labels: {
            title: t('editor.meditor.inlineAi.previewTitle'),
            streaming: t('editor.meditor.inlineAi.previewStreaming'),
            ready: t('editor.meditor.inlineAi.previewReady'),
            error: t('editor.meditor.inlineAi.continueFailed'),
            accept: t('editor.meditor.inlineAi.accept'),
            reject: t('editor.meditor.inlineAi.reject'),
            retry: tCommon('retry'),
          },
          onAccept: handleAcceptInlineContinue,
          onReject: handleRejectInlineContinue,
          onRetry: handleRetryInlineContinue,
        }
      : null;

    editor.view.dispatch(
      editor.state.tr
        .setMeta('addToHistory', false)
        .setMeta(inlineAiPreviewPluginKey, previewState)
    );
  }, [
    basePath,
    editor,
    handleAcceptInlineContinue,
    handleRejectInlineContinue,
    handleRetryInlineContinue,
    inlineAiState,
    t,
    tCommon,
  ]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const activePins = activeEntry?.proposal.ops
      .filter((op): op is Extract<DocumentEditOp, { type: 'comment' }> => (
        op.type === 'comment' &&
        !activeEntry.acceptedOpIds.includes(op.id) &&
        !activeEntry.rejectedOpIds.includes(op.id)
      ))
      .map(op => ({
        id: op.id,
        blockId: op.from.kind === 'blockId' ? op.from.blockId : undefined,
        message: op.message,
        severity: op.severity,
      }))
      .filter(pin => !!pin.blockId) ?? [];
    const pins = [...persistedCommentPins, ...activePins];

    editor.view.dispatch(
      editor.state.tr
        .setMeta('addToHistory', false)
        .setMeta(coauthorCommentPinsPluginKey, pins.length > 0 ? {
          pins,
          labels: {
            comment: t('editor.meditor.coauthor.commentPin'),
          },
        } : null)
    );
  }, [activeEntry, editor, persistedCommentPins, t]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const suggestions = activeEntry?.proposal.ops
      .filter(op => (
        !activeEntry.acceptedOpIds.includes(op.id) &&
        !activeEntry.rejectedOpIds.includes(op.id)
      ))
      .map(op => resolveInlineCoauthorSuggestion(editor, op))
      .filter((suggestion): suggestion is CoauthorInlineSuggestion => !!suggestion)
      .map(suggestion => ({
        ...suggestion,
        reason: activeEntry?.status === 'streaming' ? '__streaming__' : suggestion.reason,
      })) ?? [];

    editor.view.dispatch(
      editor.state.tr
        .setMeta('addToHistory', false)
        .setMeta(coauthorInlineSuggestionsPluginKey, suggestions.length > 0 ? {
          suggestions,
          labels: {
            accept: t('editor.meditor.coauthor.acceptOp'),
            reject: t('editor.meditor.coauthor.rejectOp'),
            proposed: t('editor.meditor.coauthor.proposed'),
            streaming: t('editor.meditor.coauthor.streamingRewrite'),
          },
        } : null)
    );
  }, [activeEntry, editor, t]);

  useEffect(() => {
    const handleInlineSuggestionEvent = (event: Event) => {
      const detail = (event as CustomEvent<{
        opId?: string;
        action?: 'accept' | 'reject';
      }>).detail;

      if (!detail?.opId || !detail.action) {
        return;
      }

      if (detail.action === 'accept') {
        void applyActiveCoauthorProposal(new Set([detail.opId]));
        return;
      }

      rejectCoauthorOps([detail.opId]);
    };

    window.addEventListener(COAUTHOR_INLINE_SUGGESTION_EVENT, handleInlineSuggestionEvent);
    return () => window.removeEventListener(COAUTHOR_INLINE_SUGGESTION_EVENT, handleInlineSuggestionEvent);
  }, [applyActiveCoauthorProposal, rejectCoauthorOps]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activeEntry) {
        return;
      }

      const hasCommand = event.metaKey || event.ctrlKey;
      if (hasCommand && event.key === 'Enter') {
        event.preventDefault();
        void applyActiveCoauthorProposal();
        return;
      }

      if (hasCommand && event.key === 'Backspace') {
        event.preventDefault();
        rejectActiveCoauthorProposal();
        return;
      }

      if (event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void applyActiveCoauthorProposal();
        return;
      }

      if (event.altKey && event.key === 'Backspace') {
        event.preventDefault();
        rejectActiveCoauthorProposal();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeEntry, applyActiveCoauthorProposal, rejectActiveCoauthorProposal]);

  useImperativeHandle(ref, () => ({
    scrollToLine: (line: number, highlight = true) => {
      if (!editor) {
        return;
      }

      const blockIndex = getBlockIndexForLine(currentMarkdownRef.current, line);
      if (blockIndex < 0) {
        editor.commands.focus();
        return;
      }

      focusBlockByIndex(editor, blockIndex, highlight);
    },
    undo: () => editor?.commands.undo() ?? false,
    redo: () => editor?.commands.redo() ?? false,
    get canUndo() {
      return editor?.can().undo() ?? false;
    },
    get canRedo() {
      return editor?.can().redo() ?? false;
    },
    focus: () => {
      focusEditorWithoutScroll(editor);
    },
    getContent: () => currentMarkdownRef.current,
    markSaved: () => {
      savedContentRef.current = currentMarkdownRef.current;
      onDirtyChange?.(false);
    },
    setInitialContent: (content: string) => {
      preserveTrailingNewlineRef.current = content.endsWith('\n');
      savedContentRef.current = content;
      currentMarkdownRef.current = content;

      if (!editor) {
        return;
      }

      applyingExternalValueRef.current = true;
      replaceEditorContentWithoutHistory(editor, content);
      onDirtyChange?.(false);
    },
    get isDirty() {
      return currentMarkdownRef.current !== savedContentRef.current;
    },
  }), [editor, focusBlockByIndex, onDirtyChange]);

  const isInlineBusy =
    inlineAiState?.status === 'submitting' || inlineAiState?.status === 'streaming';
  const canSubmitInlinePrompt = !!inlineAiState?.query.trim() && !isInlineBusy;

  return (
    <div
      ref={rootRef}
      className="m-editor-tiptap"
      data-has-outline={sections.length > 0 ? 'true' : undefined}
    >
      {coauthorSelectionBubble && (
        <div
          className="m-editor-selection-coauthor"
          data-mode={coauthorSelectionBubble.mode}
          data-testid="md-coauthor-selection-bubble"
          style={{
            top: `${coauthorSelectionBubble.top}px`,
            left: `${coauthorSelectionBubble.left}px`,
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (coauthorSelectionBubble.mode === 'anchor') {
              event.preventDefault();
            }
          }}
        >
          {coauthorSelectionBubble.mode === 'anchor' ? (
            <button
              type="button"
              className="m-editor-selection-coauthor__anchor"
              aria-label={t('editor.meditor.coauthor.selectionAnchor')}
              title={t('editor.meditor.coauthor.selectionAnchor')}
              onClick={() => {
                setCoauthorSelectionBubble(current => current ? {
                  ...current,
                  mode: 'input',
                } : current);
              }}
            >
              <img src="/sparo-logo-mark.png" alt="" aria-hidden="true" />
            </button>
          ) : (
            <form
              className="m-editor-selection-coauthor__capsule"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitSelectionRewrite();
              }}
            >
              <span className="m-editor-selection-coauthor__brand" aria-hidden="true">
                <img src="/sparo-logo-mark.png" alt="" />
              </span>
              <input
                ref={coauthorSelectionInputRef}
                value={coauthorSelectionBubble.query}
                disabled={coauthorSelectionBubble.mode === 'submitting'}
                placeholder={t('editor.meditor.coauthor.selectionPromptPlaceholder')}
                aria-label={t('editor.meditor.coauthor.selectionPromptPlaceholder')}
                onChange={(event) => {
                  const query = event.target.value;
                  setCoauthorSelectionBubble(current => current ? {
                    ...current,
                    query,
                  } : current);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setCoauthorSelectionBubble(null);
                    window.setTimeout(() => {
                      editorRef.current?.commands.focus();
                    }, 0);
                  }
                }}
              />
              <button
                type="submit"
                className="m-editor-selection-coauthor__send"
                disabled={!coauthorSelectionBubble.query.trim() || coauthorSelectionBubble.mode === 'submitting' || coauthorBusy}
                aria-label={t('editor.meditor.coauthor.selectionSubmit')}
                title={t('editor.meditor.coauthor.selectionSubmit')}
              >
                {coauthorSelectionBubble.mode === 'submitting' ? '...' : 'Enter'}
              </button>
              <button
                type="button"
                className="m-editor-selection-coauthor__close"
                aria-label={t('editor.meditor.coauthor.selectionClose')}
                title={t('editor.meditor.coauthor.selectionClose')}
                disabled={coauthorSelectionBubble.mode === 'submitting'}
                onClick={() => {
                  setCoauthorSelectionBubble(null);
                  window.setTimeout(() => {
                    editorRef.current?.commands.focus();
                  }, 0);
                }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </form>
          )}
        </div>
      )}
      {sections.length > 0 && (
        <div className="m-editor-tiptap__outline-shell">
          <nav className="m-editor-tiptap__outline" aria-label={t('editor.meditor.outline.label')}>
            <div className="m-editor-tiptap__outline-title">
              <ListTree size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{t('editor.meditor.outline.title')}</span>
            </div>
            <div className="m-editor-tiptap__outline-list">
              {sections.map(section => (
                <button
                  key={section.id}
                  type="button"
                  className="m-editor-tiptap__outline-item"
                  data-level={section.level}
                  data-active={section.id === activeSectionId}
                  onMouseDown={handleOutlineItemMouseDown}
                  onClick={(event) => handleOutlineItemClick(event, section.id)}
                >
                  <span>{section.title}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}
      <EditorContent editor={editor} />
      {inlineAiState?.isOpen && inlineAiState.status === 'idle' && (
        <div
          className="m-editor-inline-ai"
          data-testid="md-inline-ai-panel"
          style={{
            top: `${inlineAiState.anchorTop}px`,
            left: `${inlineAiState.anchorLeft}px`,
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <div className="m-editor-inline-ai__surface">
            <div className="m-editor-inline-ai__panel">
              <div className="m-editor-inline-ai__composer">
                <Input
                  ref={inlineAiInputRef}
                  variant="filled"
                  inputSize="medium"
                  className="m-editor-inline-ai__composer-input"
                  data-testid="md-inline-ai-input"
                  prefix={<PenLine size={14} strokeWidth={1.75} />}
                  value={inlineAiState.query}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setInlineAiState(current => current ? {
                      ...current,
                      query: nextValue,
                    } : current);
                  }}
                  onCompositionStart={() => {
                    inlineAiInputComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    requestAnimationFrame(() => {
                      inlineAiInputComposingRef.current = false;
                    });
                  }}
                  placeholder={t('editor.meditor.inlineAi.askPlaceholder')}
                  onKeyDown={(event) => {
                    const isComposing =
                      (event.nativeEvent as KeyboardEvent).isComposing ||
                      inlineAiInputComposingRef.current;

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      handleRejectInlineContinue();
                      return;
                    }

                    if (event.key === 'Enter') {
                      if (isComposing) {
                        return;
                      }
                      event.preventDefault();
                      if (!inlineAiState.query.trim()) {
                        return;
                      }
                      void handleContinueWriting();
                    }
                  }}
                  suffix={(
                    <div className="m-editor-inline-ai__composer-actions">
                      <span className="m-editor-inline-ai__page-chip">{t('editor.meditor.inlineAi.currentPage')}</span>
                      <IconButton
                        type="button"
                        className="m-editor-inline-ai__send"
                        onClick={() => {
                          void handleContinueWriting();
                        }}
                        disabled={!canSubmitInlinePrompt}
                        aria-label={t('editor.meditor.inlineAi.askSubmit')}
                        tooltip={t('editor.meditor.inlineAi.askSubmit')}
                        size="xs"
                        shape="circle"
                        variant="primary"
                      >
                        <ArrowUp size={13} strokeWidth={2.1} />
                      </IconButton>
                    </div>
                  )}
                />
              </div>

              <div className="m-editor-inline-ai__section-title">
                {t('editor.meditor.inlineAi.suggestionSection')}
              </div>

              <div className="m-editor-inline-ai__quick-actions">
                <Button
                  type="button"
                  className="m-editor-inline-ai__quick-action m-editor-inline-ai__quick-action--primary"
                  variant="ghost"
                  size="small"
                  data-testid="md-inline-ai-continue"
                  onClick={() => {
                    handleInlineAiQuickAction('continue', '');
                  }}
                >
                  <span className="m-editor-inline-ai__quick-action-icon">
                    <PenLine size={14} strokeWidth={1.75} />
                  </span>
                  <span>{t('editor.meditor.inlineAi.continueMode')}</span>
                </Button>
                <Button
                  type="button"
                  className="m-editor-inline-ai__quick-action"
                  variant="ghost"
                  size="small"
                  data-testid="md-inline-ai-summary"
                  onClick={() => {
                    handleInlineAiQuickAction('summary', t('editor.meditor.inlineAi.summaryDirection'));
                  }}
                >
                  <span className="m-editor-inline-ai__quick-action-icon">
                    <FileText size={14} strokeWidth={1.75} />
                  </span>
                  <span>{t('editor.meditor.inlineAi.summaryAction')}</span>
                </Button>
                <Button
                  type="button"
                  className="m-editor-inline-ai__quick-action"
                  variant="ghost"
                  size="small"
                  data-testid="md-inline-ai-todo"
                  onClick={() => {
                    handleInlineAiQuickAction('todo', t('editor.meditor.inlineAi.todoDirection'));
                  }}
                >
                  <span className="m-editor-inline-ai__quick-action-icon">
                    <ListTodo size={14} strokeWidth={1.75} />
                  </span>
                  <span>{t('editor.meditor.inlineAi.todoAction')}</span>
                </Button>
              </div>

              <div className="m-editor-inline-ai__footer">
                <Button
                  type="button"
                  className="m-editor-inline-ai__footer-dismiss"
                  variant="ghost"
                  size="small"
                  onClick={handleRejectInlineContinue}
                >
                  {t('editor.meditor.inlineAi.cancel')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

TiptapEditor.displayName = 'TiptapEditor';
