import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ImageContext,
  IntentCanvasContext,
  TextFragmentContext,
  URLContext,
} from '../types/context';
import { useContextStore } from './contextStore';

const asset: TextFragmentContext = {
  id: 'shared-text-asset',
  type: 'text-fragment',
  content: 'Shared content',
  charCount: 14,
  source: 'clipboard',
  format: 'markdown',
  timestamp: 1,
};

describe('contextStore attachments and references', () => {
  beforeEach(() => {
    const store = useContextStore.getState();
    store.setActiveDraft('context-store-v2-test');
    useContextStore.getState().clearDraft();
  });

  it('keeps one attachment independently from any number of positional references', () => {
    useContextStore.getState().addAttachment(asset);
    const first = useContextStore.getState().createAttachmentReference(asset.id);
    const second = useContextStore.getState().createAttachmentReference(asset.id);

    expect(first?.id).not.toBe(second?.id);
    expect(useContextStore.getState().assets).toEqual([asset]);
    expect(useContextStore.getState().references).toHaveLength(2);

    useContextStore.getState().removeReference(first!.id);
    expect(useContextStore.getState().assets).toEqual([asset]);
    expect(useContextStore.getState().references).toEqual([second]);

    useContextStore.getState().removeReference(second!.id);
    expect(useContextStore.getState().assets).toEqual([asset]);
    expect(useContextStore.getState().references).toEqual([]);
  });

  it('replaces draft text without discarding attachments', () => {
    const reference = useContextStore.getState().addAttachmentReference(asset);
    useContextStore.getState().setDocument({
      version: 2,
      nodes: [{ type: 'context-ref', referenceId: reference.id }],
    });

    useContextStore.getState().replaceDraftText('Replacement');

    expect(useContextStore.getState().document).toEqual({
      version: 2,
      nodes: [{ type: 'text', text: 'Replacement' }],
    });
    expect(useContextStore.getState().references).toEqual([]);
    expect(useContextStore.getState().assets).toEqual([asset]);
  });

  it('removes an attachment and cascades all of its document references', () => {
    const first = useContextStore.getState().addAttachmentReference(asset);
    const second = useContextStore.getState().createAttachmentReference(asset.id)!;
    useContextStore.getState().setDocument({
      version: 2,
      nodes: [
        { type: 'text', text: 'before' },
        { type: 'context-ref', referenceId: first.id },
        { type: 'context-ref', referenceId: second.id },
        { type: 'text', text: 'after' },
      ],
    });

    useContextStore.getState().removeAttachment(asset.id);

    expect(useContextStore.getState().assets).toEqual([]);
    expect(useContextStore.getState().references).toEqual([]);
    expect(useContextStore.getState().document).toEqual({
      version: 2,
      nodes: [{ type: 'text', text: 'beforeafter' }],
    });
  });

  it('reuses one text asset while creating references for distinct positions', () => {
    const first = useContextStore.getState().resolveAttachmentReference(asset);
    const second = useContextStore.getState().resolveAttachmentReference({
      ...asset,
      id: 'duplicate-text-asset',
      timestamp: 2,
    });

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('reused');
    if (first.kind === 'rejected' || second.kind === 'rejected') return;
    expect(second.asset).toBe(first.asset);
    expect(second.reference.id).not.toBe(first.reference.id);
    expect(second.reference.assetId).toBe(asset.id);
    expect(useContextStore.getState().assets).toEqual([asset]);
    expect(useContextStore.getState().references).toHaveLength(2);
    expect(useContextStore.getState().attachmentActivity?.assetId).toBe(asset.id);
  });

  it('treats tracking variants of the same URL as one attachment', () => {
    const firstUrl: URLContext = {
      id: 'url-original',
      type: 'url',
      url: 'https://example.com/reference?z=2&id=7&utm_source=clipboard',
      title: 'Original',
      timestamp: 1,
    };
    const trackedVariant: URLContext = {
      ...firstUrl,
      id: 'url-variant',
      url: 'https://EXAMPLE.com/reference?id=7&fbclid=ignored&z=2',
      timestamp: 2,
    };

    expect(useContextStore.getState().resolveAttachment(firstUrl).kind).toBe('created');
    const duplicate = useContextStore.getState().resolveAttachment(trackedVariant);

    expect(duplicate.kind).toBe('reused');
    expect(useContextStore.getState().assets).toEqual([firstUrl]);
  });

  it('checks the image limit after content reuse', () => {
    const firstImage: ImageContext = {
      id: 'image-original',
      type: 'image',
      imageName: 'first.png',
      fileSize: 4,
      mimeType: 'image/png',
      sourceRef: { kind: 'memory-asset', assetId: 'memory-original' },
      source: 'clipboard',
      timestamp: 1,
      identity: {
        version: 1,
        strategy: 'content-sha256',
        fingerprint: 'same-image-bytes',
      },
    };
    const duplicateImage: ImageContext = {
      ...firstImage,
      id: 'image-duplicate',
      sourceRef: { kind: 'memory-asset', assetId: 'memory-duplicate' },
      timestamp: 2,
    };
    const uniqueImage: ImageContext = {
      ...firstImage,
      id: 'image-unique',
      sourceRef: { kind: 'memory-asset', assetId: 'memory-unique' },
      timestamp: 3,
      identity: { ...firstImage.identity!, fingerprint: 'different-image-bytes' },
    };

    expect(useContextStore.getState().resolveAttachment(firstImage, { maxAssetsOfType: 1 }).kind)
      .toBe('created');
    expect(useContextStore.getState().resolveAttachment(duplicateImage, { maxAssetsOfType: 1 }).kind)
      .toBe('reused');
    expect(useContextStore.getState().resolveAttachment(uniqueImage, { maxAssetsOfType: 1 }))
      .toEqual({ kind: 'rejected', reason: 'type-limit' });
    expect(useContextStore.getState().assets).toEqual([firstImage]);
  });

  it('treats a new canvas revision as a new attachment', () => {
    const canvas: IntentCanvasContext = {
      id: 'canvas-r1',
      type: 'intent-canvas',
      canvasId: 'canvas-a',
      title: 'Plan',
      revision: '1',
      scope: 'canvas',
      nodeCount: 2,
      serializedContent: '{"nodes":[1,2]}',
      timestamp: 1,
    };

    expect(useContextStore.getState().resolveAttachment(canvas).kind).toBe('created');
    expect(useContextStore.getState().resolveAttachment({
      ...canvas,
      id: 'canvas-r1-copy',
      timestamp: 2,
    }).kind).toBe('reused');
    expect(useContextStore.getState().resolveAttachment({
      ...canvas,
      id: 'canvas-r2',
      revision: '2',
      serializedContent: '{"nodes":[1,2,3]}',
      timestamp: 3,
    }).kind).toBe('created');
    expect(useContextStore.getState().assets).toHaveLength(2);
  });

  it('repairs duplicate assets in a restored legacy draft', () => {
    useContextStore.getState().restoreDraft(
      {
        version: 2,
        nodes: [
          { type: 'context-ref', referenceId: 'reference-original' },
          { type: 'context-ref', referenceId: 'reference-duplicate' },
        ],
      },
      [asset, { ...asset, id: 'legacy-duplicate', timestamp: 2 }],
      [
        {
          id: 'reference-original',
          assetId: asset.id,
          scope: 'inline',
          role: 'reference',
          snapshotPolicy: 'current',
          createdAt: 1,
        },
        {
          id: 'reference-duplicate',
          assetId: 'legacy-duplicate',
          scope: 'inline',
          role: 'reference',
          snapshotPolicy: 'current',
          createdAt: 2,
        },
      ],
    );

    expect(useContextStore.getState().assets).toEqual([asset]);
    expect(useContextStore.getState().references.map(reference => reference.assetId))
      .toEqual([asset.id, asset.id]);
  });

  it('keeps content identity local to each draft', () => {
    expect(useContextStore.getState().resolveAttachment(asset).kind).toBe('created');

    useContextStore.getState().setActiveDraft('context-store-v2-other-draft');
    useContextStore.getState().clearDraft();
    const secondDraftAsset = { ...asset, id: 'same-content-other-draft', timestamp: 2 };

    expect(useContextStore.getState().resolveAttachment(secondDraftAsset).kind).toBe('created');
    expect(useContextStore.getState().assets).toEqual([secondDraftAsset]);
  });
});
