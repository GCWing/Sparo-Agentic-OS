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
import { ArrowUp, FileText, ListTodo, ListTree, PenLine, Plus } from 'lucide-react';
import type { Editor as TiptapEditorInstance, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { useI18n } from '@/infrastructure/i18n';
import { Button, IconButton, Input } from '@/design-system';
import { markdownAiAPI } from '@/infrastructure/api/service-api/MarkdownAiAPI';
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
import { CoauthorSelectionHighlightExtension } from '../extensions/CoauthorSelectionHighlightExtension';
import { coauthorSelectionHighlightPluginKey } from '../extensions/CoauthorSelectionHighlightPluginKey';
import { CoauthorInlineSuggestionsExtension } from '../extensions/CoauthorInlineSuggestionsExtension';
import {
  COAUTHOR_INLINE_SUGGESTION_EVENT,
  coauthorInlineSuggestionsPluginKey,
  type CoauthorInlineSuggestion,
} from '../extensions/CoauthorInlineSuggestionsPluginKey';
import { RawHtmlBlock, RawHtmlInline, RenderOnlyBlock } from '../extensions/RawHtmlExtensions';
import { getBlockIndexForLine } from '../utils/markdownBlocks';
import {
  sanitizeInlineAiMarkdownResponse,
} from '../utils/inlineAi';
import { getCachedLocalImageDataUrl, loadLocalImages } from '../utils/loadLocalImages';
import { isLocalPath, resolveImagePath } from '../utils/rehype-local-images';
import {
  analyzeMarkdownEditability,
  markdownToTopLevelSourceRanges,
  markdownToTiptapDoc,
  tiptapDocToMarkdown,
  tiptapDocToTopLevelMarkdownBlocks,
} from '../utils/tiptapMarkdown';
import {
  insertMarkdownTableColumn,
  insertMarkdownTableRow,
  type MarkdownTableQuickInsertKind,
} from '../utils/markdownTableQuickInsert';
import {
  builtInMarkdownActions,
  buildMarkdownTarget,
  buildCoauthorDocumentContext,
  buildCoauthorSelectionRewriteContext,
  createAnchoredSelectionEdit,
  applyAnchoredMarkdownEdit,
  COAUTHOR_COMMAND_EVENT,
  detectProposalStaleness,
  ProposalSession,
  applyProposalToMarkdown,
  computeReplaceDocumentReview,
  persistAcceptedComments,
  readPersistedComments,
  readMarkdownDocumentProfileSidecar,
  registerMarkdownCoauthorCommands,
  resolveMarkdownDocumentProfile,
  getTopLevelMarkdownBlockRanges,
  lineColToMarkdownOffset,
  sha256Hex,
  useSuggestionStore,
  type AnchoredMarkdownEdit,
  type MarkdownEditOp,
  type MarkdownEditProposal,
  type MarkdownDiffReview,
  type DocPosition,
  type MarkdownTarget,
  type MarkdownIntent,
  type MarkdownScope,
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
  outline?: boolean;
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

type ResolvedSelectionMarkdownRange = {
  from: number;
  to: number;
  pmRange?: { from: number; to: number };
  strategy: 'exact' | 'block';
};

type InlineAiState = {
  isOpen: boolean;
  promptKind: InlineAiPromptKind;
  query: string;
  status: InlineAiStatus;
  response: string;
  error: string | null;
  proposal: MarkdownEditProposal | null;
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

type TableQuickInsertOuterControl = {
  type: 'outer';
  side: 'top' | 'bottom' | 'left' | 'right';
  kind: MarkdownTableQuickInsertKind;
  index: number;
};

type TableQuickInsertDividerControl = {
  type: 'divider';
  axis: 'horizontal' | 'vertical';
  kind: MarkdownTableQuickInsertKind;
  index: number;
  x: number;
  y: number;
};

type TableQuickInsertControl = TableQuickInsertOuterControl | TableQuickInsertDividerControl;

type TableQuickInsertOverlay = {
  blockId: string;
  top: number;
  left: number;
  width: number;
  height: number;
  control: TableQuickInsertControl;
};

type TableQuickInsertAction = {
  kind: MarkdownTableQuickInsertKind;
  blockId: string;
  index: number;
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

function inlinePromptKindToActionId(kind: InlineAiPromptKind): string {
  if (kind === 'summary') {
    return 'summary';
  }
  if (kind === 'todo') {
    return 'todo_extraction';
  }
  return 'continuation';
}

function getInlineProposalMarkdown(proposal: MarkdownEditProposal): string {
  const op = proposal.ops.find((item): item is Extract<MarkdownEditOp, { type: 'replaceRange' | 'insertAt' | 'replaceDocument' }> => (
    item.type === 'replaceRange' || item.type === 'insertAt' || item.type === 'replaceDocument'
  ));
  return op?.markdown ?? '';
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

function getTopLevelBlockPositionByIndex(
  instance: TiptapEditorInstance,
  targetIndex: number,
): TopLevelBlockPosition | null {
  let result: TopLevelBlockPosition | null = null;

  instance.state.doc.forEach((node, offset, index) => {
    if (index !== targetIndex) {
      return;
    }

    result = {
      blockId: typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : '',
      blockIndex: index,
      pos: offset,
      nodeSize: node.nodeSize,
      contentSize: node.content.size,
    };
  });

  return result;
}

function resolveMarkdownOffsetDocPosition(
  instance: TiptapEditorInstance,
  markdown: string,
  offset: number,
): number | null {
  const blocks = getTopLevelMarkdownBlockRanges(
    markdown,
    tiptapDocToTopLevelMarkdownBlocks(instance.getJSON()),
  );
  const markdownOffset = Math.max(0, Math.min(markdown.length, offset));
  const blockIndex = blocks.findIndex(block => markdownOffset >= block.from && markdownOffset <= block.to);
  const block = blockIndex >= 0 ? getTopLevelBlockPositionByIndex(instance, blockIndex) : null;
  if (!block) {
    return null;
  }

  const blockMarkdownOffset = Math.max(0, Math.min(markdownOffset - blocks[blockIndex].from, block.contentSize));
  return block.pos + 1 + blockMarkdownOffset;
}

function resolveDocumentOpPosition(
  instance: TiptapEditorInstance,
  markdown: string,
  position: DocPosition,
): number | null {
  if (position.kind === 'blockId') {
    return resolveBlockDocPosition(instance, position);
  }

  if (position.kind === 'markdownOffset') {
    return resolveMarkdownOffsetDocPosition(instance, markdown, position.offset);
  }

  return resolveMarkdownOffsetDocPosition(instance, markdown, lineColToMarkdownOffset(markdown, position.line, position.column));
}

function normalizeSelectionText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

function getMarkdownVisibleText(markdown: string): string {
  const doc = markdownToTiptapDoc(markdown);
  const blocks = doc.content ?? [];

  const renderNode = (node: JSONContent): string => {
    if (typeof node.text === 'string') {
      return node.text;
    }

    const children = node.content ?? [];
    const childText = children.map(renderNode);
    switch (node.type) {
      case 'doc':
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
      case 'blockquote':
        return childText.filter(Boolean).join('\n');
      case 'listItem':
      case 'taskItem':
      case 'paragraph':
      case 'heading':
        return childText.join('');
      case 'hardBreak':
        return '\n';
      default:
        return childText.join('');
    }
  };

  return blocks.map(renderNode).filter(Boolean).join('\n');
}

function resolveSelectionMarkdownRangeFromPm(
  instance: TiptapEditorInstance,
  markdown: string,
  from: number,
  to: number,
): ResolvedSelectionMarkdownRange | null {
  const pmBlocks: Array<{ index: number; from: number; to: number; text: string }> = [];
  instance.state.doc.forEach((node, offset, index) => {
    const blockFrom = offset;
    const blockTo = offset + node.nodeSize;
    pmBlocks.push({
      index,
      from: blockFrom,
      to: blockTo,
      text: instance.state.doc.textBetween(blockFrom, blockTo, '\n'),
    });
  });

  const startBlock = pmBlocks.find(block => from >= block.from && from <= block.to);
  const endBlock = pmBlocks.find(block => to >= block.from && to <= block.to);
  if (!startBlock || !endBlock) {
    return null;
  }

  const topLevelBlocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
  const sourceRanges = markdownToTopLevelSourceRanges(markdown);
  const markdownBlocks = getTopLevelMarkdownBlockRanges(
    markdown,
    topLevelBlocks,
  );
  const selectedText = instance.state.doc.textBetween(from, to, '\n');
  if (!selectedText) {
    return null;
  }

  const coveredPmBlocks = pmBlocks.filter(block => (
    block.index >= startBlock.index &&
    block.index <= endBlock.index
  ));
  const coveredMarkdownBlocks = coveredPmBlocks
    .map(block => {
      const resolvedBlock = markdownBlocks.find(item => item.index === block.index);
      const sourceRange = sourceRanges[block.index];
      if (resolvedBlock) {
        return resolvedBlock;
      }
      if (sourceRange) {
        return {
          ...topLevelBlocks[block.index],
          from: sourceRange.from,
          to: sourceRange.to,
          index: block.index,
        };
      }
      return null;
    })
    .filter((block): block is NonNullable<typeof block> => !!block);

  if (coveredMarkdownBlocks.length !== coveredPmBlocks.length) {
    return null;
  }

  const coveredText = coveredPmBlocks.map(block => block.text).join('\n');
  const selectedNormalized = normalizeSelectionText(selectedText);
  if (selectedNormalized === normalizeSelectionText(coveredText)) {
    return {
      from: coveredMarkdownBlocks[0].from,
      to: coveredMarkdownBlocks[coveredMarkdownBlocks.length - 1].to,
      pmRange: {
        from: coveredPmBlocks[0].from,
        to: coveredPmBlocks[coveredPmBlocks.length - 1].to,
      },
      strategy: 'block',
    };
  }

  const coveredMarkdownText = coveredMarkdownBlocks
    .map(block => getMarkdownVisibleText(block.markdown))
    .join('\n');
  if (selectedNormalized === normalizeSelectionText(coveredMarkdownText)) {
    return {
      from: coveredMarkdownBlocks[0].from,
      to: coveredMarkdownBlocks[coveredMarkdownBlocks.length - 1].to,
      pmRange: {
        from: coveredPmBlocks[0].from,
        to: coveredPmBlocks[coveredPmBlocks.length - 1].to,
      },
      strategy: 'block',
    };
  }

  if (startBlock.index !== endBlock.index) {
    return null;
  }

  const markdownBlock = coveredMarkdownBlocks[0];
  const selectionStartInBlockText = Math.max(0, from - startBlock.from - 1);
  const prefix = startBlock.text.slice(0, selectionStartInBlockText);
  const searchFrom = Math.max(0, prefix.length - selectedText.length);
  const markdownOffset = markdownBlock.markdown.indexOf(selectedText, searchFrom);
  if (markdownOffset >= 0) {
    return {
      from: markdownBlock.from + markdownOffset,
      to: markdownBlock.from + markdownOffset + selectedText.length,
      strategy: 'exact',
    };
  }

  return selectedNormalized === normalizeSelectionText(startBlock.text) ||
    selectedNormalized === normalizeSelectionText(getMarkdownVisibleText(markdownBlock.markdown))
    ? {
        from: markdownBlock.from,
        to: markdownBlock.to,
        pmRange: { from: startBlock.from, to: startBlock.to },
        strategy: 'block',
      }
    : null;
}

function getSelectionRewriteInsertContent(
  instance: TiptapEditorInstance,
  range: { from: number; to: number },
  markdown: string,
): JSONContent[] | string | null {
  const parsed = markdownToTiptapDoc(markdown).content ?? [];
  if (parsed.length === 0) {
    return '';
  }

  const $from = instance.state.doc.resolve(Math.max(0, Math.min(range.from, instance.state.doc.content.size)));
  const $to = instance.state.doc.resolve(Math.max(0, Math.min(range.to, instance.state.doc.content.size)));
  const isInlineTextSelection = $from.sameParent($to) && $from.parent.isTextblock;
  if (
    isInlineTextSelection &&
    parsed.length === 1 &&
    parsed[0].type === 'paragraph'
  ) {
    return parsed[0].content ?? '';
  }

  return parsed;
}

function applySelectionRewriteTransaction(
  instance: TiptapEditorInstance,
  range: { from: number; to: number },
  markdown: string,
): boolean {
  const docSize = instance.state.doc.content.size;
  const from = Math.max(0, Math.min(range.from, docSize));
  const to = Math.max(from, Math.min(range.to, docSize));
  const content = getSelectionRewriteInsertContent(instance, { from, to }, markdown);
  if (content === null) {
    return false;
  }

  return instance
    .chain()
    .setMeta('addToHistory', true)
    .insertContentAt({ from, to }, content, { updateSelection: false })
    .run();
}

function resolveInlineCoauthorSuggestion(
  instance: TiptapEditorInstance,
  markdown: string,
  op: MarkdownEditOp,
  selectionRewriteRange?: { from: number; to: number } | null,
): CoauthorInlineSuggestion | null {
  if (op.type === 'insertAt') {
    const pos = resolveDocumentOpPosition(instance, markdown, op.position);
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
    const from = op.id === 'op-rewrite-selection' && selectionRewriteRange
      ? selectionRewriteRange.from
      : resolveDocumentOpPosition(instance, markdown, op.from);
    const to = op.id === 'op-rewrite-selection' && selectionRewriteRange
      ? selectionRewriteRange.to
      : resolveDocumentOpPosition(instance, markdown, op.to);
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
      layout: 'stackedDiff',
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

function getMarkdownTableCellTextPosition(
  tablePos: number,
  tableNode: ProseMirrorNode,
  rowIndex: number,
  columnIndex: number,
): number | null {
  if (tableNode.type.name !== 'markdownTable' || rowIndex < 0 || columnIndex < 0) {
    return null;
  }

  let rowPos = tablePos + 1;
  for (let index = 0; index < tableNode.childCount; index += 1) {
    const row = tableNode.child(index);
    if (index === rowIndex) {
      let cellPos = rowPos + 1;
      for (let cellIndex = 0; cellIndex < row.childCount; cellIndex += 1) {
        const cell = row.child(cellIndex);
        if (cellIndex === columnIndex) {
          return cellPos + 1;
        }
        cellPos += cell.nodeSize;
      }
      return null;
    }
    rowPos += row.nodeSize;
  }

  return null;
}

function applyMarkdownTableQuickInsert(
  instance: TiptapEditorInstance,
  action: TableQuickInsertAction,
): boolean {
  const block = getTopLevelBlockPositionById(instance, action.blockId);
  const tableNode = block ? instance.state.doc.nodeAt(block.pos) : null;
  if (!block || !tableNode || tableNode.type.name !== 'markdownTable') {
    return false;
  }

  const mutation = action.kind === 'column'
    ? insertMarkdownTableColumn(tableNode.toJSON(), action.index)
    : insertMarkdownTableRow(tableNode.toJSON(), action.index);

  if (!mutation) {
    return false;
  }

  let nextTableNode: ProseMirrorNode;
  try {
    nextTableNode = instance.schema.nodeFromJSON(mutation.table);
  } catch (error) {
    log.warn('Failed to build Markdown table quick insert node', { kind: action.kind, error });
    return false;
  }

  const tr = instance.state.tr
    .replaceWith(block.pos, block.pos + tableNode.nodeSize, nextTableNode)
    .setMeta('addToHistory', true);
  const focusPos = getMarkdownTableCellTextPosition(
    block.pos,
    nextTableNode,
    mutation.focusRowIndex,
    mutation.focusColumnIndex,
  );

  if (focusPos !== null) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, Math.min(focusPos, tr.doc.content.size)));
    } catch {
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(block.pos + 1, tr.doc.content.size))));
    }
  }

  instance.view.dispatch(tr.scrollIntoView());
  focusEditorWithoutScroll(instance);
  return true;
}

function getElementFromEventTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

function findMarkdownTableFromTarget(target: EventTarget | null): HTMLTableElement | null {
  const element = getElementFromEventTarget(target);
  if (!element || element.closest('.m-editor-table-quick-insert')) {
    return null;
  }

  return element.closest<HTMLTableElement>('table[data-type="markdown-table"][data-block-id]');
}

function findMarkdownTableByBlockId(root: HTMLDivElement, blockId: string): HTMLTableElement | null {
  const tables = root.querySelectorAll<HTMLTableElement>('table[data-type="markdown-table"][data-block-id]');
  return Array.from(tables).find(table => table.getAttribute('data-block-id') === blockId) ?? null;
}

const TABLE_QUICK_INSERT_RAIL_SIZE = 28;
const TABLE_QUICK_INSERT_REACH_SIZE = 36;
const TABLE_QUICK_INSERT_DIVIDER_REACH_SIZE = 10;
const TABLE_QUICK_INSERT_HIDE_DELAY_MS = 180;

function isPointInTableQuickInsertReach(table: HTMLTableElement, clientX: number, clientY: number): boolean {
  const rect = table.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const inHorizontalReach =
    x >= -TABLE_QUICK_INSERT_REACH_SIZE &&
    x <= rect.width + TABLE_QUICK_INSERT_REACH_SIZE &&
    y >= -TABLE_QUICK_INSERT_REACH_SIZE &&
    y <= rect.height + TABLE_QUICK_INSERT_REACH_SIZE;
  const inVerticalReach =
    y >= -TABLE_QUICK_INSERT_REACH_SIZE &&
    y <= rect.height + TABLE_QUICK_INSERT_REACH_SIZE &&
    x >= -TABLE_QUICK_INSERT_REACH_SIZE &&
    x <= rect.width + TABLE_QUICK_INSERT_REACH_SIZE;

  return inHorizontalReach || inVerticalReach;
}

function getPointDistanceToTable(table: HTMLTableElement, clientX: number, clientY: number): number {
  const rect = table.getBoundingClientRect();
  const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
  const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function findMarkdownTableNearPoint(root: HTMLDivElement, clientX: number, clientY: number): HTMLTableElement | null {
  const tables = Array.from(root.querySelectorAll<HTMLTableElement>('table[data-type="markdown-table"][data-block-id]'));
  return tables
    .filter(table => isPointInTableQuickInsertReach(table, clientX, clientY))
    .sort((left, right) => (
      getPointDistanceToTable(left, clientX, clientY) - getPointDistanceToTable(right, clientX, clientY)
    ))[0] ?? null;
}

function clampTableQuickInsertCoordinate(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getNearestTableQuickInsertDivider(
  rows: HTMLTableRowElement[],
  firstRowCells: HTMLTableCellElement[],
  tableRect: DOMRect,
  pointerX: number,
  pointerY: number,
): TableQuickInsertDividerControl | null {
  if (
    pointerX < 0 ||
    pointerX > tableRect.width ||
    pointerY < 0 ||
    pointerY > tableRect.height
  ) {
    return null;
  }

  const verticalCandidates = firstRowCells
    .slice(0, -1)
    .map((cell, index) => {
      const cellRect = cell.getBoundingClientRect();
      const x = cellRect.right - tableRect.left;
      return {
        axis: 'vertical' as const,
        kind: 'column' as const,
        index: index + 1,
        x,
        y: clampTableQuickInsertCoordinate(pointerY, 0, tableRect.height),
        distance: Math.abs(pointerX - x),
      };
    })
    .filter(candidate => (
      candidate.distance <= TABLE_QUICK_INSERT_DIVIDER_REACH_SIZE &&
      pointerY >= 0 &&
      pointerY <= tableRect.height
    ));

  const horizontalCandidates = rows
    .slice(0, -1)
    .map((row, index) => {
      const rowRect = row.getBoundingClientRect();
      const y = rowRect.bottom - tableRect.top;
      return {
        axis: 'horizontal' as const,
        kind: 'row' as const,
        index: index + 1,
        x: clampTableQuickInsertCoordinate(pointerX, 0, tableRect.width),
        y,
        distance: Math.abs(pointerY - y),
      };
    })
    .filter(candidate => (
      candidate.distance <= TABLE_QUICK_INSERT_DIVIDER_REACH_SIZE &&
      pointerX >= 0 &&
      pointerX <= tableRect.width
    ));

  const nearest = [...verticalCandidates, ...horizontalCandidates]
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest) {
    return null;
  }

  return {
    type: 'divider',
    axis: nearest.axis,
    kind: nearest.kind,
    index: nearest.index,
    x: Math.round(nearest.x),
    y: Math.round(nearest.y),
  };
}

function measureTableQuickInsertOverlay(
  root: HTMLDivElement,
  table: HTMLTableElement,
  pointer: { clientX: number; clientY: number },
): TableQuickInsertOverlay | null {
  const blockId = table.getAttribute('data-block-id');
  const rows = Array.from(table.rows);
  const firstRowCells = rows[0] ? Array.from(rows[0].cells) : [];
  if (!blockId || rows.length === 0 || firstRowCells.length === 0) {
    return null;
  }

  const rootRect = root.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  if (tableRect.width <= 0 || tableRect.height <= 0) {
    return null;
  }

  const pointerX = pointer.clientX - tableRect.left;
  const pointerY = pointer.clientY - tableRect.top;
  const dividerControl = getNearestTableQuickInsertDivider(
    rows,
    firstRowCells,
    tableRect,
    pointerX,
    pointerY,
  );
  if (dividerControl) {
    return {
      blockId,
      top: Math.round(tableRect.top - rootRect.top + root.scrollTop),
      left: Math.round(tableRect.left - rootRect.left + root.scrollLeft),
      width: Math.round(tableRect.width),
      height: Math.round(tableRect.height),
      control: dividerControl,
    };
  }

  const sideDistances = [
    {
      side: 'top' as const,
      distance: Math.abs(pointerY),
      active:
        pointerX >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerX <= tableRect.width + TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerY >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerY <= TABLE_QUICK_INSERT_RAIL_SIZE,
    },
    {
      side: 'bottom' as const,
      distance: Math.abs(pointerY - tableRect.height),
      active:
        pointerX >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerX <= tableRect.width + TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerY >= tableRect.height - TABLE_QUICK_INSERT_RAIL_SIZE &&
        pointerY <= tableRect.height + TABLE_QUICK_INSERT_REACH_SIZE,
    },
    {
      side: 'left' as const,
      distance: Math.abs(pointerX),
      active:
        pointerY >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerY <= tableRect.height + TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerX >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerX <= TABLE_QUICK_INSERT_RAIL_SIZE,
    },
    {
      side: 'right' as const,
      distance: Math.abs(pointerX - tableRect.width),
      active:
        pointerY >= -TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerY <= tableRect.height + TABLE_QUICK_INSERT_REACH_SIZE &&
        pointerX >= tableRect.width - TABLE_QUICK_INSERT_RAIL_SIZE &&
        pointerX <= tableRect.width + TABLE_QUICK_INSERT_REACH_SIZE,
    },
  ];
  const activeSide = sideDistances
    .filter(side => side.active)
    .sort((left, right) => left.distance - right.distance)[0]?.side ?? null;

  if (!activeSide) {
    return null;
  }

  const columnCount = firstRowCells.length;
  const control = activeSide === 'top'
    ? {
        type: 'outer' as const,
        side: activeSide,
        kind: 'row' as const,
        index: 1,
      }
    : activeSide === 'bottom'
      ? {
          type: 'outer' as const,
          side: activeSide,
          kind: 'row' as const,
          index: rows.length,
        }
      : activeSide === 'left'
        ? {
            type: 'outer' as const,
            side: activeSide,
            kind: 'column' as const,
            index: 0,
          }
        : {
            type: 'outer' as const,
            side: activeSide,
            kind: 'column' as const,
            index: columnCount,
          };

  return {
    blockId,
    top: Math.round(tableRect.top - rootRect.top + root.scrollTop),
    left: Math.round(tableRect.left - rootRect.left + root.scrollLeft),
    width: Math.round(tableRect.width),
    height: Math.round(tableRect.height),
    control,
  };
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
  outline = true,
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
  const selectionRewriteRangeRef = useRef<{ from: number; to: number } | null>(null);
  const selectionRewriteAnchorRef = useRef<AnchoredMarkdownEdit | null>(null);
  const coauthorInlineLogSignatureRef = useRef<string>('');
  const outlineFocusTimerRef = useRef<number | null>(null);
  const outlineActiveSyncTimerRef = useRef<number | null>(null);
  const outlineActiveSyncPausedRef = useRef(false);
  const tableQuickInsertOverlayRef = useRef<TableQuickInsertOverlay | null>(null);
  const tableQuickInsertHideTimerRef = useRef<number | null>(null);
  const [inlineAiState, setInlineAiState] = useState<InlineAiState | null>(null);
  const [sections, setSections] = useState<MarkdownSection[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [coauthorBusy, setCoauthorBusy] = useState(false);
  const [coauthorDocumentDiff, setCoauthorDocumentDiff] = useState<MarkdownDiffReview | null>(null);
  const [coauthorSelectionBubble, setCoauthorSelectionBubble] = useState<CoauthorSelectionBubble | null>(null);
  const [coauthorSelectionProcessingRange, setCoauthorSelectionProcessingRange] = useState<{ from: number; to: number } | null>(null);
  const [tableQuickInsertOverlay, setTableQuickInsertOverlay] = useState<TableQuickInsertOverlay | null>(null);
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
  const inlineAiTriggerHint = t('markdown.tiptap.inlineAi.triggerHint');

  useEffect(() => {
    tableQuickInsertOverlayRef.current = tableQuickInsertOverlay;
  }, [tableQuickInsertOverlay]);

  const syncSections = useCallback((instance: TiptapEditorInstance) => {
    const nextSections = collectMarkdownSections(instance);
    setSections(nextSections);
    setActiveSectionId(current => (
      nextSections.some(section => section.id === current)
        ? current
        : nextSections[0]?.id ?? null
    ));
  }, []);

  const cancelTableQuickInsertHide = useCallback(() => {
    if (tableQuickInsertHideTimerRef.current === null) {
      return;
    }

    window.clearTimeout(tableQuickInsertHideTimerRef.current);
    tableQuickInsertHideTimerRef.current = null;
  }, []);

  const scheduleTableQuickInsertHide = useCallback(() => {
    cancelTableQuickInsertHide();
    tableQuickInsertHideTimerRef.current = window.setTimeout(() => {
      tableQuickInsertHideTimerRef.current = null;
      setTableQuickInsertOverlay(null);
    }, TABLE_QUICK_INSERT_HIDE_DELAY_MS);
  }, [cancelTableQuickInsertHide]);

  const refreshTableQuickInsertOverlay = useCallback(() => {
    const root = rootRef.current;
    const current = tableQuickInsertOverlayRef.current;
    if (!root || !current || readonlyRef.current) {
      setTableQuickInsertOverlay(null);
      return;
    }

    const table = findMarkdownTableByBlockId(root, current.blockId);
    if (!table) {
      setTableQuickInsertOverlay(null);
      return;
    }

    const rect = table.getBoundingClientRect();
    const pointer = current.control.type === 'divider'
      ? {
          clientX: rect.left + current.control.x,
          clientY: rect.top + current.control.y,
        }
      : current.control.side === 'top'
        ? { clientX: rect.left + rect.width / 2, clientY: rect.top }
        : current.control.side === 'bottom'
          ? { clientX: rect.left + rect.width / 2, clientY: rect.bottom }
          : current.control.side === 'left'
            ? { clientX: rect.left, clientY: rect.top + rect.height / 2 }
            : { clientX: rect.right, clientY: rect.top + rect.height / 2 };
    setTableQuickInsertOverlay(measureTableQuickInsertOverlay(root, table, pointer));
  }, []);

  const handleRootPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    cancelTableQuickInsertHide();

    if (readonlyRef.current) {
      setTableQuickInsertOverlay(null);
      return;
    }

    const root = rootRef.current;
    if (!root) {
      setTableQuickInsertOverlay(null);
      return;
    }

    const targetElement = getElementFromEventTarget(event.target);
    if (targetElement?.closest('.m-editor-table-quick-insert')) {
      return;
    }

    const targetTable = findMarkdownTableFromTarget(event.target);
    const current = tableQuickInsertOverlayRef.current;
    const table = targetTable ?? findMarkdownTableNearPoint(root, event.clientX, event.clientY) ?? (
      current
        ? findMarkdownTableByBlockId(root, current.blockId)
        : null
    );
    if (!table) {
      setTableQuickInsertOverlay(null);
      return;
    }

    if (!targetTable && !isPointInTableQuickInsertReach(table, event.clientX, event.clientY)) {
      scheduleTableQuickInsertHide();
      return;
    }

    setTableQuickInsertOverlay(measureTableQuickInsertOverlay(root, table, event));
  }, [cancelTableQuickInsertHide, scheduleTableQuickInsertHide]);

  const handleRootPointerLeave = useCallback(() => {
    scheduleTableQuickInsertHide();
  }, [scheduleTableQuickInsertHide]);

  const handleTableQuickInsert = useCallback((action: TableQuickInsertAction) => {
    const instance = editorRef.current;
    if (!instance || readonlyRef.current) {
      return;
    }

    const applied = applyMarkdownTableQuickInsert(instance, action);
    if (applied) {
      window.requestAnimationFrame(refreshTableQuickInsertOverlay);
    }
  }, [refreshTableQuickInsertOverlay]);

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
      if (tableQuickInsertHideTimerRef.current !== null) {
        window.clearTimeout(tableQuickInsertHideTimerRef.current);
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
    if (coauthorSelectionBubble?.mode !== 'input') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const root = rootRef.current;
      const selectionCoauthor = root?.querySelector('.m-editor-selection-coauthor');
      if (selectionCoauthor?.contains(target)) {
        return;
      }

      setCoauthorSelectionBubble(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [coauthorSelectionBubble?.mode]);

  useEffect(() => {
    readonlyRef.current = readonly;
    if (readonly) {
      cancelTableQuickInsertHide();
      setTableQuickInsertOverlay(null);
    }
  }, [cancelTableQuickInsertHide, readonly]);

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

  const sourceBackedBlockLabels = {
    preview: t('markdown.tiptap.rawHtml.preview'),
    sandbox: t('markdown.tiptap.rawHtml.sandbox'),
    source: t('markdown.tiptap.rawHtml.source'),
    editSource: t('markdown.tiptap.rawHtml.editSource'),
    html: t('markdown.tiptap.rawHtml.html'),
    details: t('markdown.tiptap.rawHtml.details'),
    frontmatter: t('markdown.tiptap.rawHtml.frontmatter'),
    footnote: t('markdown.tiptap.rawHtml.footnote'),
    markdown: t('markdown.tiptap.rawHtml.markdown'),
  };

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
        labels: sourceBackedBlockLabels,
      }),
      RawHtmlBlock.configure({
        basePath,
        labels: sourceBackedBlockLabels,
      }),
      RawHtmlInline.configure({
        label: t('markdown.tiptap.rawHtml.inlineLabel'),
      }),
      MarkdownTable,
      MarkdownTableRow,
      MarkdownTableHeader,
      MarkdownTableCell,
      InlineAiPreviewExtension,
      CoauthorCommentPinsExtension,
      CoauthorSelectionHighlightExtension,
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

    const requestId = createInlineSessionId('markdown-inline');
    const instance = editorRef.current;
    if (!instance) {
      return;
    }

    setInlineAiState(current => current ? {
      ...current,
      status: 'submitting',
      response: '',
      error: null,
      proposal: null,
    } : current);

    const cleanup = () => {
      // Proposal requests are cleaned up by the Markdown action runner.
    };

    inlineRequestRef.current = {
      requestId,
      cancel: () => markdownAiAPI.cancel({ requestId }),
      cleanup,
    };

    const resolvedUserInput = options?.userInputOverride ?? inlineAiState.query;
    const promptKind = options?.promptKindOverride ?? inlineAiState.promptKind;
    const actionId = inlinePromptKindToActionId(promptKind);
    const action = builtInMarkdownActions.find(item => item.id === actionId);
    if (!action) {
      setInlineAiState(current => current ? {
        ...current,
        status: 'error',
        error: t('markdown.tiptap.inlineAi.continueFailed'),
        proposal: null,
      } : current);
      return;
    }

    try {
      const markdown = currentMarkdownRef.current;
      const sourceBlocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
      const sourceHash = await sha256Hex(markdown);
      const target: MarkdownTarget = {
        kind: 'block',
        blockId: inlineAiState.blockId,
        from: { kind: 'blockId', blockId: inlineAiState.blockId, offset: 0 },
        to: { kind: 'blockId', blockId: inlineAiState.blockId, offset: 0 },
        markdown: '',
      };
      const sidecarProfile = await readMarkdownDocumentProfileSidecar(workspacePath, filePath);
      const profile = resolveMarkdownDocumentProfile(markdown, {
        disabled: false,
        sidecar: sidecarProfile,
        globalDefault: { language: 'same as document', tone: 'clear and concise' },
      }).profile;
      const session = new ProposalSession();
      const proposal = await session.run(action, {
        requestId,
        actionId,
        scope: 'block',
        intent: 'apply',
        filePath,
        sourceHash,
        sourceMarkdown: markdown,
        sourceBlocks,
        documentMarkdown: buildCoauthorDocumentContext(markdown, 'block', target),
        target,
        profile,
        userDirective: resolvedUserInput.trim() || undefined,
        modelId: 'primary',
      });
      inlineRequestRef.current = null;
      const response = sanitizeInlineAiMarkdownResponse(getInlineProposalMarkdown(proposal));
      if (!response) {
        setInlineAiState(current => current ? {
          ...current,
          status: 'error',
          error: t('markdown.tiptap.inlineAi.continueEmptyResult'),
          proposal: null,
        } : current);
        return;
      }
      setInlineAiState(current => current ? {
        ...current,
        status: 'ready',
        response,
        error: null,
        proposal,
      } : current);
    } catch (error) {
      cleanup();
      inlineRequestRef.current = null;
      log.error('Failed to run inline Markdown co-author proposal', { actionId, error });
      setInlineAiState(current => current ? {
        ...current,
      status: 'error',
      error: error instanceof Error ? error.message : t('markdown.tiptap.inlineAi.continueStartFailed'),
      proposal: null,
    } : current);
    }
  }, [filePath, inlineAiState, t, workspacePath]);

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
        error: t('markdown.tiptap.inlineAi.continueEmptyResult'),
      } : current);
      return;
    }

    notificationService.success(t('markdown.tiptap.inlineAi.continueInserted'), { duration: 2500 });
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
    options?: {
      scope?: MarkdownScope;
      intent?: MarkdownIntent;
      keepSelectionUi?: boolean;
      targetOverride?: MarkdownTarget;
      documentMarkdownOverride?: string;
    },
  ) => {
    const instance = editorRef.current;
    if (!instance || coauthorBusy || readonlyRef.current) {
      return;
    }

    const action = builtInMarkdownActions.find(item => item.id === actionId);
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
      const target = options?.targetOverride ?? buildMarkdownTarget(instance, markdown, resolvedScope);
      const sidecarProfile = await readMarkdownDocumentProfileSidecar(workspacePath, filePath);
      const sourceHash = await sha256Hex(markdown);
      const profile = resolveMarkdownDocumentProfile(markdown, {
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
        documentMarkdown: options?.documentMarkdownOverride ?? buildCoauthorDocumentContext(markdown, resolvedScope, target),
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
      notificationService.error(error instanceof Error ? error.message : t('markdown.tiptap.coauthor.failed'), {
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

    try {
      const instance = editorRef.current;
      let targetOverride: MarkdownTarget | undefined;
      let documentMarkdownOverride: string | undefined;
      if (instance) {
        const from = Math.max(0, Math.min(selectionBubble.selectionFrom, instance.state.doc.content.size));
        const to = Math.max(from, Math.min(selectionBubble.selectionTo, instance.state.doc.content.size));
        selectionRewriteRangeRef.current = { from, to };
        setCoauthorSelectionProcessingRange({ from, to });
        instance.view.dispatch(
          instance.state.tr
            .setMeta('addToHistory', false)
            .setSelection(TextSelection.create(instance.state.doc, from, to))
        );
        const markdown = currentMarkdownRef.current;
        const sourceBlocks = tiptapDocToTopLevelMarkdownBlocks(instance.getJSON());
        const sourceRange = resolveSelectionMarkdownRangeFromPm(instance, markdown, from, to);
        if (!sourceRange) {
          log.warn('Unable to resolve selected Markdown source range for co-author rewrite', {
            pmFrom: from,
            pmTo: to,
            selectedTextChars: instance.state.doc.textBetween(from, to, '\n').length,
            markdownChars: markdown.length,
          });
          notificationService.warning(t('markdown.tiptap.coauthor.selectionUnresolved'), { duration: 3200 });
          setCoauthorSelectionProcessingRange(null);
          selectionRewriteRangeRef.current = null;
          return;
        }
        const selectedMarkdown = markdown.slice(sourceRange.from, sourceRange.to);
        const rewritePmRange = sourceRange.pmRange ?? { from, to };
        selectionRewriteRangeRef.current = rewritePmRange;
        setCoauthorSelectionProcessingRange(rewritePmRange);
        targetOverride = {
          kind: 'selection',
          from: { kind: 'markdownOffset', offset: sourceRange.from },
          to: { kind: 'markdownOffset', offset: sourceRange.to },
          markdown: selectedMarkdown,
        };
        documentMarkdownOverride = buildCoauthorSelectionRewriteContext(markdown, sourceRange);
        log.debug('Prepared selected Markdown for co-author rewrite', {
          pmFrom: from,
          pmTo: to,
          markdownFrom: sourceRange.from,
          markdownTo: sourceRange.to,
          selectedMarkdownChars: selectedMarkdown.length,
          selectedTextChars: instance.state.doc.textBetween(from, to, '\n').length,
          strategy: sourceRange.strategy,
          pmApplyFrom: rewritePmRange.from,
          pmApplyTo: rewritePmRange.to,
          preservesMarkdownSyntax: /(^|\n)\s{0,3}([-*+]|\d+\.)\s|\*\*|__|`|^#{1,6}\s/m.test(selectedMarkdown),
        });
        selectionRewriteAnchorRef.current = createAnchoredSelectionEdit({
          opId: 'op-rewrite-selection',
          markdown,
          target: targetOverride,
          blocks: sourceBlocks,
          pmRange: rewritePmRange,
          sourceRange,
        });
      }
      setCoauthorSelectionBubble(null);

      await handleRunCoauthor('rewrite_selection', query, {
        scope: 'selection',
        intent: 'apply',
        keepSelectionUi: true,
        targetOverride,
        documentMarkdownOverride,
      });
      setCoauthorSelectionProcessingRange(null);
    } catch {
      setCoauthorSelectionProcessingRange(null);
      setCoauthorSelectionBubble(current => current ? {
        ...current,
        mode: 'input',
      } : current);
      selectionRewriteRangeRef.current = null;
      selectionRewriteAnchorRef.current = null;
    }
  }, [
    coauthorSelectionBubble,
    handleRunCoauthor,
    t,
  ]);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{
        actionId?: string;
        scope?: MarkdownScope;
        intent?: MarkdownIntent;
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
    const selectedOps = opIds
      ? activeEntry.proposal.ops.filter(op => opIds.has(op.id))
      : activeEntry.proposal.ops;
    const anchoredRewriteOp = selectedOps.find(op => (
      op.id === 'op-rewrite-selection' &&
      op.type === 'replaceRange' &&
      selectionRewriteAnchorRef.current?.opId === op.id
    ));
    const anchoredRewriteEdit = selectionRewriteAnchorRef.current;

    if (!anchoredRewriteOp) {
      const stale = detectProposalStaleness(activeEntry.proposal, currentHash, markdown, blocks);
      if (stale.stale) {
        useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'stale', {
          staleOpIds: stale.staleOpIds,
        });
        notificationService.warning(t('markdown.tiptap.coauthor.stale'), { duration: 3200 });
        return;
      }
    }

    const result = anchoredRewriteOp && anchoredRewriteOp.type === 'replaceRange' && anchoredRewriteEdit
      ? (() => {
          if (activeEntry.proposal.sourceHash === currentHash) {
            const applied = applySelectionRewriteTransaction(
              instance,
              anchoredRewriteEdit.pmRange,
              anchoredRewriteOp.markdown,
            );
            log.debug('Applied co-author selection rewrite through editor transaction', {
              proposalId: activeEntry.proposal.proposalId,
              opId: anchoredRewriteOp.id,
              pmFrom: anchoredRewriteEdit.pmRange.from,
              pmTo: anchoredRewriteEdit.pmRange.to,
              sourceRangeResolved: !!anchoredRewriteEdit.sourceRange,
              oldMarkdownChars: anchoredRewriteEdit.oldMarkdown.length,
              replacementMarkdownChars: anchoredRewriteOp.markdown.length,
              applied,
            });
            if (!applied) {
              useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'stale', {
                staleOpIds: [anchoredRewriteOp.id],
              });
              notificationService.warning(t('markdown.tiptap.coauthor.stale'), { duration: 3200 });
              return null;
            }

            const nextMarkdown = serializeEditorMarkdown(instance);
            currentMarkdownRef.current = nextMarkdown;
            return {
              markdown: nextMarkdown,
              appliedOpIds: [anchoredRewriteOp.id],
              commentOpIds: [],
              editorAlreadyUpdated: true,
            };
          }

          const anchoredResult = applyAnchoredMarkdownEdit(
            markdown,
            anchoredRewriteEdit,
            anchoredRewriteOp.markdown,
            { sourceHashMatches: activeEntry.proposal.sourceHash === currentHash },
          );
          log.debug('Applied co-author selection rewrite through Markdown anchor', {
            proposalId: activeEntry.proposal.proposalId,
            opId: anchoredRewriteOp.id,
            sourceRangeResolved: !!anchoredRewriteEdit.sourceRange,
            oldMarkdownChars: anchoredRewriteEdit.oldMarkdown.length,
            replacementMarkdownChars: anchoredRewriteOp.markdown.length,
            applied: anchoredResult.applied,
            stale: anchoredResult.stale,
            reason: anchoredResult.reason,
          });
          if (!anchoredResult.applied) {
            useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'stale', {
              staleOpIds: [anchoredRewriteOp.id],
            });
            notificationService.warning(t('markdown.tiptap.coauthor.stale'), { duration: 3200 });
            return null;
          }
          return {
            markdown: anchoredResult.markdown,
            appliedOpIds: [anchoredRewriteOp.id],
            commentOpIds: [],
            editorAlreadyUpdated: false,
          };
        })()
      : coauthorDocumentDiff?.proposalId === activeEntry.proposal.proposalId && !opIds
      ? {
          markdown: coauthorDocumentDiff.modifiedMarkdown,
          appliedOpIds: [coauthorDocumentDiff.opId],
          commentOpIds: [],
          editorAlreadyUpdated: false,
        }
      : {
          ...applyProposalToMarkdown(activeEntry.proposal, markdown, blocks, opIds),
          editorAlreadyUpdated: false,
        };
    if (!result) {
      return;
    }
    if (result.appliedOpIds.length === 0 && result.commentOpIds.length === 0) {
      useSuggestionStore.getState().setStatus(activeEntry.proposal.proposalId, 'stale', {
        staleOpIds: selectedOps.map(op => op.id),
      });
      notificationService.warning(t('markdown.tiptap.coauthor.stale'), { duration: 3200 });
      return;
    }
    const afterHash = await sha256Hex(result.markdown);
    log.debug('Co-author proposal acceptance result', {
      proposalId: activeEntry.proposal.proposalId,
      selectedOpCount: selectedOps.length,
      appliedOpCount: result.appliedOpIds.length,
      commentOpCount: result.commentOpIds.length,
      editorAlreadyUpdated: result.editorAlreadyUpdated,
      beforeMarkdownChars: markdown.length,
      afterMarkdownChars: result.markdown.length,
      beforeHash: currentHash,
      afterHash,
    });
    void persistAcceptedComments(workspacePath, activeEntry.proposal, result.commentOpIds).catch(error => {
      log.warn('Failed to persist co-author comments', {
        proposalId: activeEntry.proposal.proposalId,
        error,
      });
    });

    if (result.appliedOpIds.length > 0 && !result.editorAlreadyUpdated) {
      preserveTrailingNewlineRef.current = result.markdown.endsWith('\n');
      const root = rootRef.current;
      const scrollTop = root?.scrollTop;
      const scrollLeft = root?.scrollLeft;
      instance
        .chain()
        .setContent(markdownToTiptapDoc(result.markdown), { emitUpdate: true })
        .run();
      if (root && scrollTop !== undefined && scrollLeft !== undefined) {
        window.requestAnimationFrame(() => {
          root.scrollTop = scrollTop;
          root.scrollLeft = scrollLeft;
        });
      }
    }

    const handled = new Set([
      ...activeEntry.acceptedOpIds,
      ...activeEntry.rejectedOpIds,
      ...result.appliedOpIds,
      ...result.commentOpIds,
    ]);
    if (handled.size >= activeEntry.proposal.ops.length) {
      useSuggestionStore.getState().completeProposal(activeEntry.proposal.proposalId, {
        status: 'applied',
        acceptedOpIds: result.appliedOpIds,
      });
      selectionRewriteAnchorRef.current = null;
      selectionRewriteRangeRef.current = null;
      setCoauthorSelectionProcessingRange(null);
      instance.view.dispatch(
        instance.state.tr
          .setMeta('addToHistory', false)
          .setMeta(coauthorInlineSuggestionsPluginKey, null)
          .setMeta(coauthorSelectionHighlightPluginKey, null)
      );
    } else {
      useSuggestionStore.getState().acceptOps(activeEntry.proposal.proposalId, result.appliedOpIds);
      useSuggestionStore.getState().acceptOps(activeEntry.proposal.proposalId, result.commentOpIds);
    }

    notificationService.success(t('markdown.tiptap.coauthor.applied'), { duration: 2500 });
  }, [activeEntry, coauthorDocumentDiff, serializeEditorMarkdown, t, workspacePath]);

  const rejectCoauthorOps = useCallback((opIds: string[]) => {
    if (!activeProposalId || !activeEntry) {
      return;
    }
    useSuggestionStore.getState().rejectOps(activeProposalId, opIds);
    const handled = new Set([...activeEntry.acceptedOpIds, ...activeEntry.rejectedOpIds, ...opIds]);
    if (handled.size >= activeEntry.proposal.ops.length) {
      useSuggestionStore.getState().completeProposal(activeProposalId, {
        status: 'discarded',
        rejectedOpIds: opIds,
      });
      selectionRewriteAnchorRef.current = null;
      selectionRewriteRangeRef.current = null;
      setCoauthorSelectionProcessingRange(null);
      editorRef.current?.view.dispatch(
        editorRef.current.state.tr
          .setMeta('addToHistory', false)
          .setMeta(coauthorInlineSuggestionsPluginKey, null)
          .setMeta(coauthorSelectionHighlightPluginKey, null)
      );
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
            title: t('markdown.tiptap.inlineAi.previewTitle'),
            streaming: t('markdown.tiptap.inlineAi.previewStreaming'),
            ready: t('markdown.tiptap.inlineAi.previewReady'),
            error: t('markdown.tiptap.inlineAi.continueFailed'),
            accept: t('markdown.tiptap.inlineAi.accept'),
            reject: t('markdown.tiptap.inlineAi.reject'),
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
      .filter((op): op is Extract<MarkdownEditOp, { type: 'comment' }> => (
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
            comment: t('markdown.tiptap.coauthor.commentPin'),
          },
        } : null)
    );
  }, [activeEntry, editor, persistedCommentPins, t]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const highlight = coauthorSelectionBubble ? {
      from: coauthorSelectionBubble.selectionFrom,
      to: coauthorSelectionBubble.selectionTo,
      phase: coauthorSelectionBubble.mode === 'submitting' ? 'processing' as const : 'selected' as const,
    } : coauthorSelectionProcessingRange ? {
      from: coauthorSelectionProcessingRange.from,
      to: coauthorSelectionProcessingRange.to,
      phase: 'processing' as const,
    } : null;

    editor.view.dispatch(
      editor.state.tr
        .setMeta('addToHistory', false)
        .setMeta(coauthorSelectionHighlightPluginKey, highlight)
    );
  }, [coauthorSelectionBubble, coauthorSelectionProcessingRange, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const suggestions = activeEntry?.proposal.ops
      .filter(op => (
        !activeEntry.acceptedOpIds.includes(op.id) &&
        !activeEntry.rejectedOpIds.includes(op.id)
      ))
      .map(op => resolveInlineCoauthorSuggestion(
        editor,
        currentMarkdownRef.current,
        op,
        activeEntry?.proposal.scope === 'selection' ? selectionRewriteRangeRef.current : null,
      ))
      .filter((suggestion): suggestion is CoauthorInlineSuggestion => !!suggestion)
      .map(suggestion => ({
        ...suggestion,
        reason: activeEntry?.status === 'streaming' ? '__streaming__' : suggestion.reason,
      })) ?? [];

    const logSignature = activeEntry
      ? `${activeEntry.proposal.proposalId}:${activeEntry.status}:${suggestions.map(suggestion => `${suggestion.opId}:${suggestion.markdown?.length ?? 0}`).join(',')}`
      : '';
    if (logSignature !== coauthorInlineLogSignatureRef.current) {
      coauthorInlineLogSignatureRef.current = logSignature;
      log.debug('Rendered editor inline suggestions', {
        proposalId: activeEntry?.proposal.proposalId,
        status: activeEntry?.status,
        suggestionCount: suggestions.length,
        markdownChars: suggestions.map(suggestion => suggestion.markdown?.length ?? 0),
      });
    }

    editor.view.dispatch(
      editor.state.tr
        .setMeta('addToHistory', false)
        .setMeta(coauthorInlineSuggestionsPluginKey, suggestions.length > 0 ? {
          suggestions,
          labels: {
            accept: t('markdown.tiptap.coauthor.acceptOp'),
            reject: t('markdown.tiptap.coauthor.rejectOp'),
            acceptShort: t('markdown.tiptap.coauthor.acceptShort'),
            rejectShort: t('markdown.tiptap.coauthor.rejectShort'),
            proposed: t('markdown.tiptap.coauthor.proposed'),
            streaming: t('markdown.tiptap.coauthor.streamingRewrite'),
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
  const showOutline = outline && sections.length > 0;

  return (
    <div
      ref={rootRef}
      className="m-editor-tiptap"
      data-has-outline={showOutline ? 'true' : undefined}
      onPointerLeave={handleRootPointerLeave}
      onPointerMove={handleRootPointerMove}
      onScroll={refreshTableQuickInsertOverlay}
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
              aria-label={t('markdown.tiptap.coauthor.selectionAnchor')}
              title={t('markdown.tiptap.coauthor.selectionAnchor')}
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
                placeholder={t('markdown.tiptap.coauthor.selectionPromptPlaceholder')}
                aria-label={t('markdown.tiptap.coauthor.selectionPromptPlaceholder')}
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
              <IconButton
                type="submit"
                className="m-editor-selection-coauthor__send"
                disabled={!coauthorSelectionBubble.query.trim() || coauthorSelectionBubble.mode === 'submitting' || coauthorBusy}
                aria-label={t('markdown.tiptap.coauthor.selectionSubmit')}
                tooltip={t('markdown.tiptap.coauthor.selectionSubmit')}
                size="small"
                shape="circle"
                variant="accent"
              >
                <ArrowUp size={14} strokeWidth={2.1} />
              </IconButton>
            </form>
          )}
        </div>
      )}
      {showOutline && (
        <div className="m-editor-tiptap__outline-shell">
          <nav className="m-editor-tiptap__outline" aria-label={t('markdown.tiptap.outline.label')}>
            <div className="m-editor-tiptap__outline-title">
              <ListTree size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{t('markdown.tiptap.outline.title')}</span>
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
      {tableQuickInsertOverlay && (
        <div
          className="m-editor-table-quick-insert"
          contentEditable={false}
          style={{
            top: `${tableQuickInsertOverlay.top}px`,
            left: `${tableQuickInsertOverlay.left}px`,
            width: `${tableQuickInsertOverlay.width}px`,
            height: `${tableQuickInsertOverlay.height}px`,
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerEnter={cancelTableQuickInsertHide}
          onPointerMove={cancelTableQuickInsertHide}
          onPointerLeave={scheduleTableQuickInsertHide}
        >
          {tableQuickInsertOverlay.control.type === 'outer' ? (
            <button
              key={`${tableQuickInsertOverlay.control.side}-${tableQuickInsertOverlay.control.index}`}
              type="button"
              className={[
                'm-editor-table-quick-insert__strip',
                `m-editor-table-quick-insert__strip--${tableQuickInsertOverlay.control.side}`,
              ].join(' ')}
              aria-label={t(`markdown.tiptap.tableQuickInsert.${
                tableQuickInsertOverlay.control.kind === 'column' ? 'insertColumn' : 'insertRow'
              }`)}
              title={t(`markdown.tiptap.tableQuickInsert.${
                tableQuickInsertOverlay.control.kind === 'column' ? 'insertColumn' : 'insertRow'
              }`)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                cancelTableQuickInsertHide();
                handleTableQuickInsert({
                  kind: tableQuickInsertOverlay.control.kind,
                  blockId: tableQuickInsertOverlay.blockId,
                  index: tableQuickInsertOverlay.control.index,
                });
              }}
              onPointerEnter={cancelTableQuickInsertHide}
              onPointerMove={cancelTableQuickInsertHide}
              onPointerLeave={scheduleTableQuickInsertHide}
            >
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : (
            <button
              key={`${tableQuickInsertOverlay.control.axis}-${tableQuickInsertOverlay.control.index}`}
              type="button"
              className={[
                'm-editor-table-quick-insert__divider-button',
                `m-editor-table-quick-insert__divider-button--${tableQuickInsertOverlay.control.axis}`,
              ].join(' ')}
              style={{
                left: `${tableQuickInsertOverlay.control.x}px`,
                top: `${tableQuickInsertOverlay.control.y}px`,
              }}
              aria-label={t(`markdown.tiptap.tableQuickInsert.${
                tableQuickInsertOverlay.control.kind === 'column' ? 'insertColumn' : 'insertRow'
              }`)}
              title={t(`markdown.tiptap.tableQuickInsert.${
                tableQuickInsertOverlay.control.kind === 'column' ? 'insertColumn' : 'insertRow'
              }`)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                cancelTableQuickInsertHide();
                handleTableQuickInsert({
                  kind: tableQuickInsertOverlay.control.kind,
                  blockId: tableQuickInsertOverlay.blockId,
                  index: tableQuickInsertOverlay.control.index,
                });
              }}
              onPointerEnter={cancelTableQuickInsertHide}
              onPointerMove={cancelTableQuickInsertHide}
              onPointerLeave={scheduleTableQuickInsertHide}
            >
              <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
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
                  placeholder={t('markdown.tiptap.inlineAi.askPlaceholder')}
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
                      <span className="m-editor-inline-ai__page-chip">{t('markdown.tiptap.inlineAi.currentPage')}</span>
                      <IconButton
                        type="button"
                        className="m-editor-inline-ai__send"
                        onClick={() => {
                          void handleContinueWriting();
                        }}
                        disabled={!canSubmitInlinePrompt}
                        aria-label={t('markdown.tiptap.inlineAi.askSubmit')}
                        tooltip={t('markdown.tiptap.inlineAi.askSubmit')}
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
                {t('markdown.tiptap.inlineAi.suggestionSection')}
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
                  <span>{t('markdown.tiptap.inlineAi.continueMode')}</span>
                </Button>
                <Button
                  type="button"
                  className="m-editor-inline-ai__quick-action"
                  variant="ghost"
                  size="small"
                  data-testid="md-inline-ai-summary"
                  onClick={() => {
                    handleInlineAiQuickAction('summary', t('markdown.tiptap.inlineAi.summaryDirection'));
                  }}
                >
                  <span className="m-editor-inline-ai__quick-action-icon">
                    <FileText size={14} strokeWidth={1.75} />
                  </span>
                  <span>{t('markdown.tiptap.inlineAi.summaryAction')}</span>
                </Button>
                <Button
                  type="button"
                  className="m-editor-inline-ai__quick-action"
                  variant="ghost"
                  size="small"
                  data-testid="md-inline-ai-todo"
                  onClick={() => {
                    handleInlineAiQuickAction('todo', t('markdown.tiptap.inlineAi.todoDirection'));
                  }}
                >
                  <span className="m-editor-inline-ai__quick-action-icon">
                    <ListTodo size={14} strokeWidth={1.75} />
                  </span>
                  <span>{t('markdown.tiptap.inlineAi.todoAction')}</span>
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
                  {t('markdown.tiptap.inlineAi.cancel')}
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
