import { describe, expect, it } from 'vitest';
import { applyProposalToMarkdown } from './proposalApplier';
import { detectProposalStaleness } from './staleDetector';
import { getTopLevelMarkdownBlockRanges } from './targetResolver';
import { acceptDocumentDiffHunks, computeReplaceDocumentReview } from './documentDiff';
import type { MarkdownEditProposal } from './protocol';

const blocks = [
  { blockId: 'b1', markdown: '# Title' },
  { blockId: 'b2', markdown: 'Body text' },
];

describe('coauthor proposal applier', () => {
  it('applies blockId replacement without touching other blocks', () => {
    const proposal: MarkdownEditProposal = {
      proposalId: 'p1',
      sourceHash: 'hash',
      scope: 'block',
      intent: 'apply',
      ops: [{
        id: 'op1',
        type: 'replaceRange',
        from: { kind: 'blockId', blockId: 'b2', offset: 0 },
        to: { kind: 'blockId', blockId: 'b2', offset: 9 },
        markdown: 'Sharper body',
      }],
    };

    expect(applyProposalToMarkdown(proposal, '# Title\n\nBody text', blocks).markdown)
      .toBe('# Title\n\nSharper body');
  });

  it('marks proposals stale when hash changed and ranges cannot resolve', () => {
    const proposal: MarkdownEditProposal = {
      proposalId: 'p2',
      sourceHash: 'old',
      scope: 'block',
      intent: 'apply',
      ops: [{
        id: 'op-missing',
        type: 'insertAt',
        position: { kind: 'blockId', blockId: 'missing', offset: 0 },
        markdown: 'Nope',
      }],
    };

    expect(detectProposalStaleness(proposal, 'new', '# Title', blocks)).toEqual({
      stale: true,
      staleOpIds: ['op-missing'],
    });
  });

  it('keeps a proposal reviewable when source changes after the targeted range', () => {
    const sourceMarkdown = '# Title\n\nBody text';
    const proposal: MarkdownEditProposal = {
      proposalId: 'p-stale-after',
      sourceHash: 'old',
      sourceMarkdown,
      sourceBlocks: blocks,
      scope: 'block',
      intent: 'apply',
      ops: [{
        id: 'op-body',
        type: 'replaceRange',
        from: { kind: 'blockId', blockId: 'b2', offset: 0 },
        to: { kind: 'blockId', blockId: 'b2', offset: 4 },
        markdown: 'Main',
      }],
    };

    expect(detectProposalStaleness(
      proposal,
      'new',
      `${sourceMarkdown}\n\nAppendix`,
      [...blocks, { blockId: 'b3', markdown: 'Appendix' }],
    )).toEqual({
      stale: false,
      staleOpIds: [],
    });
  });

  it('marks only impacted operations stale when earlier source text changed', () => {
    const sourceMarkdown = '# Title\n\nBody text\n\nTail';
    const proposal: MarkdownEditProposal = {
      proposalId: 'p-stale-some',
      sourceHash: 'old',
      sourceMarkdown,
      sourceBlocks: [...blocks, { blockId: 'b3', markdown: 'Tail' }],
      scope: 'document',
      intent: 'apply',
      ops: [
        {
          id: 'op-title',
          type: 'replaceRange',
          from: { kind: 'blockId', blockId: 'b1', offset: 0 },
          to: { kind: 'blockId', blockId: 'b1', offset: 7 },
          markdown: '# Better',
        },
        {
          id: 'op-tail',
          type: 'replaceRange',
          from: { kind: 'blockId', blockId: 'b3', offset: 0 },
          to: { kind: 'blockId', blockId: 'b3', offset: 4 },
          markdown: 'End',
        },
      ],
    };

    expect(detectProposalStaleness(
      proposal,
      'new',
      '# Changed\n\nBody text\n\nTail',
      [
        { blockId: 'b1', markdown: '# Changed' },
        { blockId: 'b2', markdown: 'Body text' },
        { blockId: 'b3', markdown: 'Tail' },
      ],
    )).toEqual({
      stale: true,
      staleOpIds: ['op-title'],
    });
  });

  it('uses source positions for repeated block text', () => {
    const repeatedBlocks = [
      { blockId: 'first', markdown: 'Repeat' },
      { blockId: 'second', markdown: 'Repeat' },
    ];

    const ranges = getTopLevelMarkdownBlockRanges('Repeat\n\nRepeat', repeatedBlocks);

    expect(ranges.map(range => [range.blockId, range.from, range.to])).toEqual([
      ['first', 0, 6],
      ['second', 8, 14],
    ]);
  });

  it('routes replaceDocument through diff review and accepts selected hunks', async () => {
    const proposal: MarkdownEditProposal = {
      proposalId: 'p-diff',
      sourceHash: 'hash',
      scope: 'document',
      intent: 'review',
      ops: [{
        id: 'op-doc',
        type: 'replaceDocument',
        markdown: '# Title\n\nBetter body',
      }],
    };

    const review = await computeReplaceDocumentReview(proposal, '# Title\n\nBody text');

    expect(review?.proposalId).toBe('p-diff');
    expect(review?.opId).toBe('op-doc');
    expect(review?.diff.hunks.length).toBeGreaterThan(0);
    expect(acceptDocumentDiffHunks('# Title\n\nBody text', review!)).toBe('# Title\n\nBetter body');
  });
});
