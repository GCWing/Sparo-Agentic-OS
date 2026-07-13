import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { ComposerDocument } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import {
  createComposerContextSnapshot,
  serializeComposerDocumentForDisplay,
  serializeComposerDocumentForModel,
} from './composerContextRegistry';

const t = ((key: string, options?: Record<string, unknown>) => {
  if (key === 'input.context.textFragment') return `Long text: ${options?.preview}`;
  if (key === 'input.context.characterCount') return `${options?.count} chars`;
  return key;
}) as TFunction<'flow-chat'>;

const pastedText: ContextItem = {
  id: 'paste-1',
  type: 'text-fragment',
  timestamp: 1,
  content: 'COPIED\nCONTENT',
  charCount: 14,
  source: 'clipboard',
  format: 'markdown',
};

describe('Composer context serialization', () => {
  it('injects a pasted fragment at its actual node position', () => {
    const document: ComposerDocument = {
      version: 1,
      nodes: [
        { type: 'text', text: 'before:' },
        { type: 'context-ref', contextId: pastedText.id },
        { type: 'text', text: ':after' },
      ],
    };

    expect(serializeComposerDocumentForModel(document, [pastedText]))
      .toBe('before:COPIED\nCONTENT:after');
    expect(serializeComposerDocumentForDisplay(document, [pastedText], t))
      .toBe('before:[Long text: COPIED CONTENT]:after');
  });

  it('preserves repeated references without string replacement ambiguity', () => {
    const document: ComposerDocument = {
      version: 1,
      nodes: [
        { type: 'context-ref', contextId: pastedText.id },
        { type: 'text', text: ' / ' },
        { type: 'context-ref', contextId: pastedText.id },
      ],
    };

    expect(serializeComposerDocumentForModel(document, [pastedText]))
      .toBe('COPIED\nCONTENT / COPIED\nCONTENT');
  });

  it('persists only referenced inline contexts plus out-of-band images', () => {
    const unusedFile: ContextItem = {
      id: 'unused-file',
      type: 'file',
      timestamp: 2,
      fileName: 'unused.ts',
      filePath: 'D:/unused.ts',
    };
    const document: ComposerDocument = {
      version: 1,
      nodes: [{ type: 'context-ref', contextId: pastedText.id }],
    };
    const snapshot = createComposerContextSnapshot(document, [pastedText, unusedFile]);

    expect(snapshot.contexts.map(context => context.id)).toEqual(['paste-1']);
    expect(snapshot.document).not.toBe(document);
  });
});
