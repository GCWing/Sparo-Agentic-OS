import type { MarkdownEditOp, MarkdownEditProposal } from './protocol';
import { getTopLevelMarkdownBlockRanges, resolveDocPosition, type MarkdownRange } from './targetResolver';
import type { TiptapTopLevelMarkdownBlock } from '../tiptap/utils/tiptapMarkdown';

export interface ProposalApplyResult {
  markdown: string;
  appliedOpIds: string[];
  commentOpIds: string[];
}

export function opToRange(
  op: MarkdownEditOp,
  markdown: string,
  blocks: TiptapTopLevelMarkdownBlock[],
): MarkdownRange | null {
  const blockRanges = getTopLevelMarkdownBlockRanges(markdown, blocks);
  if (op.type === 'replaceDocument') {
    return { from: 0, to: markdown.length };
  }
  if (op.type === 'insertAt') {
    const position = resolveDocPosition(op.position, markdown, blockRanges);
    return position === null ? null : { from: position, to: position };
  }
  const from = resolveDocPosition(op.from, markdown, blockRanges);
  const to = resolveDocPosition(op.to, markdown, blockRanges);
  if (from === null || to === null) {
    return null;
  }
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function applyProposalToMarkdown(
  proposal: MarkdownEditProposal,
  markdown: string,
  blocks: TiptapTopLevelMarkdownBlock[],
  opIds?: Set<string>,
): ProposalApplyResult {
  const selectedOps = opIds ? proposal.ops.filter(op => opIds.has(op.id)) : proposal.ops;
  const editable = selectedOps.filter(op => op.type !== 'comment');
  const ranges = editable
    .map(op => ({ op, range: opToRange(op, markdown, blocks) }))
    .filter((item): item is { op: Exclude<MarkdownEditOp, { type: 'comment' }>; range: MarkdownRange } => !!item.range)
    .sort((left, right) => right.range.from - left.range.from);

  let nextMarkdown = markdown;
  const appliedOpIds: string[] = [];

  for (const { op, range } of ranges) {
    if (op.type === 'replaceDocument') {
      nextMarkdown = op.markdown;
    } else if (op.type === 'deleteRange') {
      nextMarkdown = `${nextMarkdown.slice(0, range.from)}${nextMarkdown.slice(range.to)}`;
    } else {
      nextMarkdown = `${nextMarkdown.slice(0, range.from)}${op.markdown}${nextMarkdown.slice(range.to)}`;
    }
    appliedOpIds.push(op.id);
  }

  return {
    markdown: nextMarkdown,
    appliedOpIds,
    commentOpIds: selectedOps.filter(op => op.type === 'comment').map(op => op.id),
  };
}
