import type { TiptapTopLevelMarkdownBlock } from '../tiptap/utils/tiptapMarkdown';
import type { MarkdownTarget } from './protocol';
import { getTopLevelMarkdownBlockRanges, resolveDocPosition, type MarkdownRange } from './targetResolver';

const CONTEXT_CHARS = 80;

export interface AnchoredMarkdownEdit {
  opId: string;
  oldMarkdown: string;
  sourceRange: MarkdownRange | null;
  pmRange: { from: number; to: number };
  beforeContext: string;
  afterContext: string;
}

export interface AnchoredMarkdownApplyResult {
  markdown: string;
  applied: boolean;
  stale: boolean;
  reason?: 'empty-old-markdown' | 'source-range-mismatch' | 'old-markdown-not-found' | 'old-markdown-not-unique';
}

function countMatches(content: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = content.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}

function replaceRange(content: string, range: MarkdownRange, replacement: string): string {
  return `${content.slice(0, range.from)}${replacement}${content.slice(range.to)}`;
}

function resolveTargetRange(
  markdown: string,
  target: MarkdownTarget,
  blocks: TiptapTopLevelMarkdownBlock[],
): MarkdownRange | null {
  if (target.kind !== 'selection') {
    return null;
  }

  const blockRanges = getTopLevelMarkdownBlockRanges(markdown, blocks);
  const from = resolveDocPosition(target.from, markdown, blockRanges);
  const to = resolveDocPosition(target.to, markdown, blockRanges);
  if (from === null || to === null || from === to) {
    return null;
  }

  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function createAnchoredSelectionEdit(params: {
  opId: string;
  markdown: string;
  target: MarkdownTarget;
  blocks: TiptapTopLevelMarkdownBlock[];
  pmRange: { from: number; to: number };
  sourceRange?: MarkdownRange | null;
}): AnchoredMarkdownEdit | null {
  const sourceRange = params.sourceRange !== undefined
    ? params.sourceRange
    : resolveTargetRange(params.markdown, params.target, params.blocks);
  const oldMarkdown = sourceRange
    ? params.markdown.slice(sourceRange.from, sourceRange.to)
    : params.target.kind === 'selection'
      ? params.target.markdown
      : '';

  if (!oldMarkdown) {
    return null;
  }

  const contextFrom = sourceRange ? Math.max(0, sourceRange.from - CONTEXT_CHARS) : 0;
  const contextTo = sourceRange ? Math.min(params.markdown.length, sourceRange.to + CONTEXT_CHARS) : 0;

  return {
    opId: params.opId,
    oldMarkdown,
    sourceRange,
    pmRange: params.pmRange,
    beforeContext: sourceRange ? params.markdown.slice(contextFrom, sourceRange.from) : '',
    afterContext: sourceRange ? params.markdown.slice(sourceRange.to, contextTo) : '',
  };
}

export function applyAnchoredMarkdownEdit(
  currentMarkdown: string,
  edit: AnchoredMarkdownEdit,
  newMarkdown: string,
  options: { sourceHashMatches: boolean },
): AnchoredMarkdownApplyResult {
  if (!edit.oldMarkdown) {
    return { markdown: currentMarkdown, applied: false, stale: true, reason: 'empty-old-markdown' };
  }

  if (options.sourceHashMatches && edit.sourceRange) {
    const currentAtSourceRange = currentMarkdown.slice(edit.sourceRange.from, edit.sourceRange.to);
    if (currentAtSourceRange === edit.oldMarkdown) {
      return {
        markdown: replaceRange(currentMarkdown, edit.sourceRange, newMarkdown),
        applied: true,
        stale: false,
      };
    }
  }

  const matchCount = countMatches(currentMarkdown, edit.oldMarkdown);
  if (matchCount === 1) {
    return {
      markdown: currentMarkdown.replace(edit.oldMarkdown, newMarkdown),
      applied: true,
      stale: false,
    };
  }

  if (matchCount > 1) {
    const contextualOld = `${edit.beforeContext}${edit.oldMarkdown}${edit.afterContext}`;
    const contextualNew = `${edit.beforeContext}${newMarkdown}${edit.afterContext}`;
    if (edit.beforeContext || edit.afterContext) {
      const contextualMatchCount = countMatches(currentMarkdown, contextualOld);
      if (contextualMatchCount === 1) {
        return {
          markdown: currentMarkdown.replace(contextualOld, contextualNew),
          applied: true,
          stale: false,
        };
      }
    }
    return { markdown: currentMarkdown, applied: false, stale: true, reason: 'old-markdown-not-unique' };
  }

  return {
    markdown: currentMarkdown,
    applied: false,
    stale: true,
    reason: options.sourceHashMatches ? 'source-range-mismatch' : 'old-markdown-not-found',
  };
}
