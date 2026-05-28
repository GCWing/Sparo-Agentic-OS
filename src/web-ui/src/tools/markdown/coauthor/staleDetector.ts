import type { MarkdownEditProposal } from './protocol';
import type { TiptapTopLevelMarkdownBlock } from '../tiptap/utils/tiptapMarkdown';
import { opToRange } from './proposalApplier';
import type { MarkdownRange } from './targetResolver';

export interface ProposalStaleResult {
  stale: boolean;
  staleOpIds: string[];
}

function getChangedSourceRange(sourceMarkdown: string, currentMarkdown: string): MarkdownRange {
  let prefixLength = 0;
  const minLength = Math.min(sourceMarkdown.length, currentMarkdown.length);

  while (
    prefixLength < minLength &&
    sourceMarkdown[prefixLength] === currentMarkdown[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength + prefixLength < sourceMarkdown.length &&
    suffixLength + prefixLength < currentMarkdown.length &&
    sourceMarkdown[sourceMarkdown.length - 1 - suffixLength] === currentMarkdown[currentMarkdown.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    from: prefixLength,
    to: sourceMarkdown.length - suffixLength,
  };
}

function couldAffectRange(changedSourceRange: MarkdownRange, opRange: MarkdownRange): boolean {
  if (changedSourceRange.from === changedSourceRange.to) {
    return opRange.from === opRange.to
      ? changedSourceRange.from <= opRange.from
      : changedSourceRange.from < opRange.to;
  }

  return changedSourceRange.from <= opRange.to && changedSourceRange.to >= opRange.from;
}

export function detectProposalStaleness(
  proposal: MarkdownEditProposal,
  currentSourceHash: string,
  currentMarkdown: string,
  blocks: TiptapTopLevelMarkdownBlock[],
): ProposalStaleResult {
  if (proposal.sourceHash === currentSourceHash) {
    return { stale: false, staleOpIds: [] };
  }

  if (!proposal.sourceMarkdown || !proposal.sourceBlocks) {
    return {
      stale: true,
      staleOpIds: proposal.ops.map(op => op.id),
    };
  }

  const changedSourceRange = getChangedSourceRange(proposal.sourceMarkdown, currentMarkdown);
  const staleOpIds = proposal.ops
    .filter((op) => {
      if (op.type === 'replaceDocument') {
        return true;
      }

      const sourceRange = opToRange(op, proposal.sourceMarkdown ?? '', proposal.sourceBlocks ?? []);
      const currentRange = opToRange(op, currentMarkdown, blocks);
      return !sourceRange || !currentRange || couldAffectRange(changedSourceRange, sourceRange);
    })
    .map(op => op.id);

  return {
    stale: staleOpIds.length > 0,
    staleOpIds,
  };
}
