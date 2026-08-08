import { describe, expect, it } from 'vitest';
import type { ComposerDocument } from '@/shared/types/composer';
import {
  COMPOSER_CONTEXT_REFERENCE_NODE,
  COMPOSER_HARD_BREAK_NODE,
  COMPOSER_PARAGRAPH_NODE,
  composerDocumentToTiptap,
  tiptapToComposerDocument,
} from './composerDocumentCodec';

describe('Composer Tiptap document codec', () => {
  it('round-trips ordered text, hard breaks, and reference atoms', () => {
    const document: ComposerDocument = {
      version: 2,
      nodes: [
        { type: 'text', text: 'Review\nthis ' },
        { type: 'context-ref', referenceId: 'reference-1' },
        { type: 'text', text: ' carefully' },
      ],
    };

    const tiptap = composerDocumentToTiptap(document);
    expect(tiptap).toEqual({
      type: 'doc',
      content: [{
        type: COMPOSER_PARAGRAPH_NODE,
        content: [
          { type: 'text', text: 'Review' },
          { type: COMPOSER_HARD_BREAK_NODE },
          { type: 'text', text: 'this ' },
          {
            type: COMPOSER_CONTEXT_REFERENCE_NODE,
            attrs: { referenceId: 'reference-1' },
          },
          { type: 'text', text: ' carefully' },
        ],
      }],
    });
    expect(tiptapToComposerDocument(tiptap)).toEqual(document);
  });

  it('normalizes adjacent text produced by hard breaks', () => {
    expect(tiptapToComposerDocument({
      type: 'doc',
      content: [{
        type: COMPOSER_PARAGRAPH_NODE,
        content: [
          { type: 'text', text: 'one' },
          { type: COMPOSER_HARD_BREAK_NODE },
          { type: 'text', text: 'two' },
        ],
      }],
    })).toEqual({
      version: 2,
      nodes: [{ type: 'text', text: 'one\ntwo' }],
    });
  });
});
