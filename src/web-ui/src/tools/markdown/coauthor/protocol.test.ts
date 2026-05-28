import { describe, expect, it } from 'vitest';
import { extractProposalFromText, parseMarkdownEditProposal } from './protocol';

describe('coauthor proposal protocol', () => {
  it('parses structured proposals', () => {
    const proposal = parseMarkdownEditProposal({
      proposalId: 'p1',
      sourceHash: 'abc',
      scope: 'block',
      intent: 'apply',
      ops: [{
        id: 'op1',
        type: 'replaceRange',
        from: { kind: 'blockId', blockId: 'b1', offset: 0 },
        to: { kind: 'blockId', blockId: 'b1', offset: 5 },
        markdown: 'Hello',
      }],
    });

    expect(proposal.ops).toHaveLength(1);
    expect(proposal.ops[0].type).toBe('replaceRange');
  });

  it('extracts fenced JSON fallbacks', () => {
    const proposal = extractProposalFromText([
      '```json',
      '{"proposalId":"p2","sourceHash":"hash","scope":"document","intent":"review","ops":[{"id":"c1","type":"comment","from":{"kind":"markdownOffset","offset":0},"to":{"kind":"markdownOffset","offset":4},"message":"Check this."}]}',
      '```',
    ].join('\n'));

    expect(proposal.proposalId).toBe('p2');
    expect(proposal.ops[0].type).toBe('comment');
  });
});
