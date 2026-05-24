import { diffService, type DiffComputeResult } from '../services/DiffService';
import type { DocumentEditProposal } from './protocol';

export interface DocumentDiffReview {
  proposalId: string;
  opId: string;
  modifiedMarkdown: string;
  diff: DiffComputeResult;
}

export async function computeReplaceDocumentReview(
  proposal: DocumentEditProposal,
  currentMarkdown: string,
): Promise<DocumentDiffReview | null> {
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
  review: DocumentDiffReview,
  hunkIds?: Set<string>,
): string {
  const selectedHunks = hunkIds
    ? review.diff.hunks.filter(hunk => hunkIds.has(hunk.id))
    : review.diff.hunks;

  return diffService.acceptHunks(currentMarkdown, selectedHunks);
}
