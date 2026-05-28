import { describe, expect, it } from 'vitest';
import { applyAnchoredMarkdownEdit, createAnchoredSelectionEdit, type AnchoredMarkdownEdit } from './anchoredEdit';
import type { MarkdownTarget } from './protocol';

function edit(overrides: Partial<AnchoredMarkdownEdit> = {}): AnchoredMarkdownEdit {
  return {
    opId: 'op-rewrite-selection',
    oldMarkdown: 'middle',
    sourceRange: { from: 6, to: 12 },
    pmRange: { from: 1, to: 7 },
    beforeContext: 'start ',
    afterContext: ' end',
    ...overrides,
  };
}

describe('anchored coauthor edit', () => {
  it('applies at the frozen source range when the source hash still matches', () => {
    const result = applyAnchoredMarkdownEdit('start middle end', edit(), 'better', {
      sourceHashMatches: true,
    });

    expect(result).toMatchObject({ applied: true, stale: false });
    expect(result.markdown).toBe('start better end');
  });

  it('does not fall back to the beginning when the selected markdown is missing', () => {
    const result = applyAnchoredMarkdownEdit('start other end', edit(), 'better', {
      sourceHashMatches: false,
    });

    expect(result).toMatchObject({
      applied: false,
      stale: true,
      reason: 'old-markdown-not-found',
    });
    expect(result.markdown).toBe('start other end');
  });

  it('uses context to disambiguate repeated selected markdown', () => {
    const result = applyAnchoredMarkdownEdit('first middle end\nstart middle end', edit(), 'better', {
      sourceHashMatches: false,
    });

    expect(result).toMatchObject({ applied: true, stale: false });
    expect(result.markdown).toBe('first middle end\nstart better end');
  });

  it('marks repeated matches stale when context cannot disambiguate', () => {
    const result = applyAnchoredMarkdownEdit(
      'middle\nmiddle',
      edit({ beforeContext: '', afterContext: '' }),
      'better',
      { sourceHashMatches: false },
    );

    expect(result).toMatchObject({
      applied: false,
      stale: true,
      reason: 'old-markdown-not-unique',
    });
    expect(result.markdown).toBe('middle\nmiddle');
  });

  it('creates old markdown from resolved document target ranges', () => {
    const target: MarkdownTarget = {
      kind: 'selection',
      from: { kind: 'blockId', blockId: 'b2', offset: 0 },
      to: { kind: 'blockId', blockId: 'b2', offset: 4 },
      markdown: 'Body',
    };

    const anchored = createAnchoredSelectionEdit({
      opId: 'op-rewrite-selection',
      markdown: '# Title\n\nBody text',
      target,
      blocks: [
        { blockId: 'b1', markdown: '# Title' },
        { blockId: 'b2', markdown: 'Body text' },
      ],
      pmRange: { from: 10, to: 14 },
    });

    expect(anchored?.oldMarkdown).toBe('Body');
    expect(anchored?.sourceRange).toEqual({ from: 9, to: 13 });
  });

  it('uses explicit source ranges instead of target fallback positions', () => {
    const target: MarkdownTarget = {
      kind: 'selection',
      from: { kind: 'markdownOffset', offset: 0 },
      to: { kind: 'markdownOffset', offset: 0 },
      markdown: 'middle',
    };

    const anchored = createAnchoredSelectionEdit({
      opId: 'op-rewrite-selection',
      markdown: 'start middle end',
      target,
      blocks: [{ blockId: 'b1', markdown: 'start middle end' }],
      pmRange: { from: 7, to: 13 },
      sourceRange: { from: 6, to: 12 },
    });

    expect(anchored?.oldMarkdown).toBe('middle');
    expect(anchored?.sourceRange).toEqual({ from: 6, to: 12 });
  });
});
