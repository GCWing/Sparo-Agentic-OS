import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { ComposerDocument, ContextReference } from '@/shared/types/composer';
import { parseComposerContextSnapshot } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';
import {
  createComposerContextSnapshot,
  createComposerSubmissionEnvelope,
  openComposerContextWorkspace,
  serializeComposerDocumentForDisplay,
  serializeComposerDocumentForModel,
} from './composerContextRegistry';
import {
  registerComposerContextWorkspaceHost,
  type OpenComposerContextWorkspaceRequest,
} from './composerContextWorkspacePort';

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

const pastedTextReference: ContextReference = {
  id: 'ref-paste-1',
  assetId: pastedText.id,
  scope: 'inline',
  role: 'reference',
  snapshotPolicy: 'current',
  createdAt: 1,
};

describe('Composer context serialization', () => {
  it('builds the canonical submission envelope with stable ids and display ordinals', () => {
    const document: ComposerDocument = {
      version: 2,
      nodes: [
        { type: 'text', text: 'Review ' },
        { type: 'context-ref', referenceId: pastedTextReference.id },
      ],
    };
    const envelope = createComposerSubmissionEnvelope(
      document,
      [pastedTextReference],
      [pastedText],
      'normal',
      t,
      10,
    );

    expect(envelope.document.nodes).toEqual([
      { type: 'text', text: 'Review ' },
      { type: 'attachment_ref', attachmentId: pastedText.id },
    ]);
    expect(envelope.attachments).toEqual([{
      id: pastedText.id,
      ordinal: 1,
      type: pastedText.type,
      title: 'COPIED',
      modelContent: pastedText.content,
    }]);
  });

  it('uses a positional marker and serializes the attachment content once', () => {
    const document: ComposerDocument = {
      version: 2,
      nodes: [
        { type: 'text', text: 'before:' },
        { type: 'context-ref', referenceId: pastedTextReference.id },
        { type: 'text', text: ':after' },
      ],
    };

    expect(serializeComposerDocumentForModel(document, [pastedTextReference], [pastedText]))
      .toBe('before:[Attachment 1]:after\n\n[Attachment 1: text-fragment]\nCOPIED\nCONTENT');
    expect(serializeComposerDocumentForDisplay(document, [pastedTextReference], [pastedText], t))
      .toBe('before:[Long text: COPIED CONTENT]:after');
  });

  it('preserves repeated references without string replacement ambiguity', () => {
    const document: ComposerDocument = {
      version: 2,
      nodes: [
        { type: 'context-ref', referenceId: pastedTextReference.id },
        { type: 'text', text: ' / ' },
        { type: 'context-ref', referenceId: pastedTextReference.id },
      ],
    };

    expect(serializeComposerDocumentForModel(document, [pastedTextReference], [pastedText]))
      .toBe('[Attachment 1] / [Attachment 1]\n\n[Attachment 1: text-fragment]\nCOPIED\nCONTENT');
  });

  it('persists every attachment while retaining only document references', () => {
    const unusedFile: ContextItem = {
      id: 'unused-file',
      type: 'file',
      timestamp: 2,
      fileName: 'unused.ts',
      filePath: 'D:/unused.ts',
    };
    const document: ComposerDocument = {
      version: 2,
      nodes: [{ type: 'context-ref', referenceId: pastedTextReference.id }],
    };
    const snapshot = createComposerContextSnapshot(
      document,
      [pastedTextReference],
      [pastedText, unusedFile],
    );

    expect(snapshot.assets.map(context => context.id)).toEqual(['paste-1', 'unused-file']);
    expect(snapshot.references.map(reference => reference.id)).toEqual(['ref-paste-1']);
    expect(snapshot.document).not.toBe(document);
  });

  it('serializes an attachment even when it has no positional reference', () => {
    const turnReference: ContextReference = {
      ...pastedTextReference,
      id: 'ref-turn-paste',
      scope: 'turn',
    };
    const document: ComposerDocument = {
      version: 2,
      nodes: [{ type: 'text', text: 'Summarize this.' }],
    };

    expect(serializeComposerDocumentForModel(document, [turnReference], [pastedText]))
      .toBe('Summarize this.\n\n[Attachment 1: text-fragment]\nCOPIED\nCONTENT');
  });

  it('migrates a persisted V1 snapshot into assets and references', () => {
    const migrated = parseComposerContextSnapshot({
      schemaVersion: 1,
      document: {
        version: 1,
        nodes: [{ type: 'context-ref', contextId: pastedText.id }],
      },
      contexts: [pastedText],
      createdAt: 10,
    });

    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.assets[0]?.id).toBe(pastedText.id);
    expect(migrated?.references[0]?.scope).toBe('inline');
    expect(migrated?.document.nodes[0]).toEqual({
      type: 'context-ref',
      referenceId: `migrated-ref-${pastedText.id}`,
    });
  });

  it('opens images as lightweight media references in the shared scene container', () => {
    const requests: OpenComposerContextWorkspaceRequest[] = [];
    const unregister = registerComposerContextWorkspaceHost({
      open: request => {
        requests.push(request);
        return true;
      },
      hasItem: () => false,
    });
    const image: ContextItem = {
      id: 'image-1',
      type: 'image',
      timestamp: 1,
      imageName: 'architecture.png',
      width: 1920,
      height: 1080,
      fileSize: 1024,
      mimeType: 'image/png',
      source: 'file',
      sourceRef: { kind: 'local-file', path: 'D:/images/architecture.png' },
    };

    try {
      expect(openComposerContextWorkspace(
        image,
        { t, draftKey: 'draft-1' },
        'scene-focus',
      )).toBe(true);
      expect(requests).toEqual([{
        presentation: 'scene-focus',
        item: {
          type: 'image-viewer',
          title: 'architecture.png',
          duplicateCheckKey: 'context-workspace:draft-1:image-1',
          replaceExisting: true,
          data: {
            sourceRef: image.sourceRef,
            previewUrl: undefined,
            mimeType: 'image/png',
            fileSize: 1024,
            width: 1920,
            height: 1080,
          },
          metadata: { contextId: 'image-1', contextType: 'image' },
        },
      }]);
      expect(JSON.stringify(requests[0])).not.toContain('data:image');
    } finally {
      unregister();
    }
  });
});
