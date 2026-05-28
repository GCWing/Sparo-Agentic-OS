import { diffService, type DiffComputeResult } from '@/tools/editor/services/DiffService';
import type { MarkdownEditProposal } from './protocol';

export interface MarkdownDiffReview {
  proposalId: string;
  opId: string;
  modifiedMarkdown: string;
  diff: DiffComputeResult;
}

export async function computeReplaceDocumentReview(
  proposal: MarkdownEditProposal,
  currentMarkdown: string,
): Promise<MarkdownDiffReview | null> {
  const replaceOp = proposal.ops.find(op => op.type === 'replaceDocument');
  if (!replaceOp || replaceOp.type !== 'replaceDocument') {
    return null;
  }

  return {
    proposalId: proposal.proposalId,
    opId: replaceOp.id,
    modifiedMarkdown: replaceOp.markdown,
    diff: await diffService.computeDiff(currentMarkdown, replaceOp.markdown, {
      contextLines: 3,
      timeout: 5000,
    }),
  };
}

export function acceptDocumentDiffHunks(
  currentMarkdown: string,
  review: MarkdownDiffReview,
  hunkIds?: Set<string>,
): string {
  const selectedHunks = hunkIds
    ? review.diff.hunks.filter(hunk => hunkIds.has(hunk.id))
    : review.diff.hunks;

  return diffService.acceptHunks(currentMarkdown, selectedHunks);
}
