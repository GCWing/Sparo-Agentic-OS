import type { Editor as TiptapEditorInstance, JSONContent } from '@tiptap/core';
import type { TiptapTopLevelMarkdownBlock } from '../meditor/utils/tiptapMarkdown';
import { markdownToTopLevelSourceRanges, tiptapDocToTopLevelMarkdownBlocks } from '../meditor/utils/tiptapMarkdown';
import type { DocPosition, DocumentScope, DocumentTarget } from './protocol';

export interface MarkdownRange {
  from: number;
  to: number;
}

export interface TopLevelBlockRange extends TiptapTopLevelMarkdownBlock {
  from: number;
  to: number;
  index: number;
  pmFrom?: number;
  pmTo?: number;
}

export function lineColToMarkdownOffset(markdown: string, line: number, column: number): number {
  const targetLine = Math.max(1, line);
  const targetColumn = Math.max(1, column);
  let currentLine = 1;
  let currentColumn = 1;

  for (let offset = 0; offset < markdown.length; offset += 1) {
    if (currentLine === targetLine && currentColumn === targetColumn) {
      return offset;
    }

    if (markdown[offset] === '\n') {
      currentLine += 1;
      currentColumn = 1;
    } else {
      currentColumn += 1;
    }
  }

  return markdown.length;
}

export function getTopLevelMarkdownBlockRanges(
  markdown: string,
  blocks: TiptapTopLevelMarkdownBlock[],
): TopLevelBlockRange[] {
  const sourceRanges = markdownToTopLevelSourceRanges(markdown);
  if (sourceRanges.length >= blocks.length) {
    return blocks.map((block, index) => {
      const sourceRange = sourceRanges[index];
      if (sourceRange && (!block.markdown || sourceRange.markdown === block.markdown || sourceRange.markdown.includes(block.markdown))) {
        return {
          ...block,
          from: sourceRange.from,
          to: sourceRange.to,
          index,
        };
      }
      return null;
    }).filter((range): range is TopLevelBlockRange => !!range);
  }

  let cursor = 0;
  return blocks.map((block, index) => {
    const blockMarkdown = block.markdown;
    const found = markdown.indexOf(blockMarkdown, cursor);
    const from = found >= 0 ? found : cursor;
    const to = Math.min(markdown.length, from + blockMarkdown.length);
    cursor = to;
    while (cursor < markdown.length && markdown[cursor] === '\n') {
      cursor += 1;
    }
    return { ...block, from, to, index };
  });
}

export function resolveDocPosition(
  position: DocPosition,
  markdown: string,
  blocks: TopLevelBlockRange[],
): number | null {
  if (position.kind === 'markdownOffset') {
    return Math.max(0, Math.min(markdown.length, position.offset));
  }

  if (position.kind === 'lineCol') {
    return lineColToMarkdownOffset(markdown, position.line, position.column);
  }

  const block = blocks.find(item => item.blockId === position.blockId);
  if (!block) {
    return null;
  }

  return Math.max(block.from, Math.min(block.to, block.from + (position.offset ?? 0)));
}

function getSelectionBlockId(editor: TiptapEditorInstance): string | undefined {
  const { selection } = editor.state;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    const blockId = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined;
    if (blockId) {
      return blockId;
    }
  }
  return undefined;
}

function getTopLevelPmBlockRanges(editor: TiptapEditorInstance): Array<{ blockId?: string; from: number; to: number; index: number }> {
  const ranges: Array<{ blockId?: string; from: number; to: number; index: number }> = [];
  editor.state.doc.forEach((node, offset, index) => {
    ranges.push({
      blockId: typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : undefined,
      from: offset,
      to: offset + node.nodeSize,
      index,
    });
  });
  return ranges;
}

function getSelectionBlockRange(editor: TiptapEditorInstance): { blockId?: string; from: number; to: number; index: number } | null {
  const { from, to } = editor.state.selection;
  return getTopLevelPmBlockRanges(editor).find(block => from >= block.from && to <= block.to) ?? null;
}

export function buildDocumentTarget(
  editor: TiptapEditorInstance,
  markdown: string,
  scope: DocumentScope,
): DocumentTarget {
  const pmBlocks = getTopLevelPmBlockRanges(editor);
  const blocks = getTopLevelMarkdownBlockRanges(
    markdown,
    tiptapDocToTopLevelMarkdownBlocks(editor.getJSON() as JSONContent),
  ).map((block) => {
    const pmBlock = pmBlocks.find(item => item.index === block.index);
    return {
      ...block,
      pmFrom: pmBlock?.from,
      pmTo: pmBlock?.to,
    };
  });

  if (scope === 'document') {
    return { kind: 'document' };
  }

  const blockId = getSelectionBlockId(editor);
  const block = blockId ? blocks.find(item => item.blockId === blockId) : null;

  if (scope === 'block' && block) {
    return {
      kind: 'block',
      blockId: block.blockId,
      from: { kind: 'blockId', blockId: block.blockId ?? '', offset: 0 },
      to: { kind: 'blockId', blockId: block.blockId ?? '', offset: block.markdown.length },
      markdown: block.markdown,
    };
  }

  const { from, to } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, '\n');
  if (scope === 'selection' && selectedText.trim()) {
    const selectionBlock = getSelectionBlockRange(editor);
    const markdownBlock = selectionBlock?.blockId
      ? blocks.find(item => item.blockId === selectionBlock.blockId)
      : null;

    if (selectionBlock?.blockId && markdownBlock) {
      const blockText = editor.state.doc.textBetween(selectionBlock.from, selectionBlock.to, '\n');
      const selectionStartInBlockText = Math.max(0, from - selectionBlock.from - 1);
      const prefix = blockText.slice(0, selectionStartInBlockText);
      const markdownOffset = markdownBlock.markdown.indexOf(selectedText, Math.max(0, prefix.length - selectedText.length));
      if (markdownOffset >= 0) {
        return {
          kind: 'selection',
          from: { kind: 'blockId', blockId: selectionBlock.blockId, offset: markdownOffset },
          to: { kind: 'blockId', blockId: selectionBlock.blockId, offset: markdownOffset + selectedText.length },
          markdown: selectedText,
        };
      }
    }

    const absoluteOffset = markdown.indexOf(selectedText);
    return {
      kind: 'selection',
      from: { kind: 'markdownOffset', offset: Math.max(0, absoluteOffset) },
      to: { kind: 'markdownOffset', offset: Math.max(0, absoluteOffset) + selectedText.length },
      markdown: selectedText,
    };
  }

  return { kind: 'document' };
}
