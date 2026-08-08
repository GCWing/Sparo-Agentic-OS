import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauriRuntime } from '@/infrastructure/runtime';
import type { ImageAssetSourceRef, ImageContext } from '@/shared/types/context';

interface MemoryImageAsset {
  blob: Blob;
  objectUrl: string;
  dataUrlPromise?: Promise<string>;
  lastAccessedAt: number;
}

interface DecodedImageAsset {
  url: string;
  width: number;
  height: number;
}

const MAX_MEMORY_ASSETS = 32;
const memoryAssets = new Map<string, MemoryImageAsset>();
const localDisplayUrlPromises = new Map<string, Promise<string>>();
const decodedImagePromises = new Map<string, Promise<DecodedImageAsset>>();

function sourceKey(sourceRef: ImageAssetSourceRef): string {
  switch (sourceRef.kind) {
    case 'local-file':
      return `local:${sourceRef.path}`;
    case 'remote-url':
      return `remote:${sourceRef.url}`;
    case 'memory-asset':
      return `memory:${sourceRef.assetId}`;
  }
}

function touchMemoryAsset(assetId: string): MemoryImageAsset | undefined {
  const entry = memoryAssets.get(assetId);
  if (entry) entry.lastAccessedAt = Date.now();
  return entry;
}

function trimMemoryAssets(): void {
  if (memoryAssets.size <= MAX_MEMORY_ASSETS) return;
  const entries = [...memoryAssets.entries()]
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);
  entries.slice(0, memoryAssets.size - MAX_MEMORY_ASSETS).forEach(([assetId]) => {
    releaseImageAsset({ kind: 'memory-asset', assetId });
  });
}

export function registerMemoryImageAsset(assetId: string, blob: Blob): ImageAssetSourceRef {
  const existing = memoryAssets.get(assetId);
  if (existing) URL.revokeObjectURL(existing.objectUrl);
  decodedImagePromises.delete(sourceKey({ kind: 'memory-asset', assetId }));
  memoryAssets.set(assetId, {
    blob,
    objectUrl: URL.createObjectURL(blob),
    lastAccessedAt: Date.now(),
  });
  trimMemoryAssets();
  return { kind: 'memory-asset', assetId };
}

export function releaseImageAsset(sourceRef: ImageAssetSourceRef): void {
  const key = sourceKey(sourceRef);
  decodedImagePromises.delete(key);
  if (sourceRef.kind !== 'memory-asset') return;
  const existing = memoryAssets.get(sourceRef.assetId);
  if (!existing) return;
  URL.revokeObjectURL(existing.objectUrl);
  memoryAssets.delete(sourceRef.assetId);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image asset'));
    reader.readAsDataURL(blob);
  });
}

async function localFileDisplayUrl(path: string, mimeType: string): Promise<string> {
  if (isTauriRuntime()) return convertFileSrc(path);
  let pending = localDisplayUrlPromises.get(path);
  if (!pending) {
    pending = import('@/infrastructure/api').then(async ({ workspaceAPI }) => {
      const base64 = await workspaceAPI.readFileContent(path);
      return `data:${mimeType};base64,${base64}`;
    }).catch(error => {
      localDisplayUrlPromises.delete(path);
      throw error;
    });
    localDisplayUrlPromises.set(path, pending);
  }
  return pending;
}

export function getImageAssetPreviewUrl(context: ImageContext): string | undefined {
  if (context.thumbnailUrl) return context.thumbnailUrl;
  switch (context.sourceRef.kind) {
    case 'memory-asset':
      return touchMemoryAsset(context.sourceRef.assetId)?.objectUrl;
    case 'remote-url':
      return context.sourceRef.url;
    case 'local-file':
      return isTauriRuntime() ? convertFileSrc(context.sourceRef.path) : undefined;
  }
}

export async function resolveImageAssetDisplayUrl(
  sourceRef: ImageAssetSourceRef,
  mimeType: string,
): Promise<string> {
  switch (sourceRef.kind) {
    case 'memory-asset': {
      const entry = touchMemoryAsset(sourceRef.assetId);
      if (!entry) throw new Error(`Image asset is unavailable: ${sourceRef.assetId}`);
      return entry.objectUrl;
    }
    case 'remote-url':
      return sourceRef.url;
    case 'local-file':
      return localFileDisplayUrl(sourceRef.path, mimeType);
  }
}

export async function resolveImageAssetDataUrl(context: ImageContext): Promise<string | undefined> {
  switch (context.sourceRef.kind) {
    case 'local-file':
      return undefined;
    case 'memory-asset': {
      const entry = touchMemoryAsset(context.sourceRef.assetId);
      if (!entry) throw new Error(`Image asset is unavailable: ${context.sourceRef.assetId}`);
      entry.dataUrlPromise ??= blobToDataUrl(entry.blob);
      return entry.dataUrlPromise;
    }
    case 'remote-url': {
      const response = await fetch(context.sourceRef.url);
      if (!response.ok) throw new Error(`Failed to load image asset: ${response.status}`);
      return blobToDataUrl(await response.blob());
    }
  }
}

export function imageAssetFilePath(context: ImageContext): string | undefined {
  return context.sourceRef.kind === 'local-file' ? context.sourceRef.path : undefined;
}

export async function decodeImageAsset(
  sourceRef: ImageAssetSourceRef,
  mimeType: string,
): Promise<DecodedImageAsset> {
  const key = sourceKey(sourceRef);
  let pending = decodedImagePromises.get(key);
  if (!pending) {
    pending = resolveImageAssetDisplayUrl(sourceRef, mimeType).then(url => (
      new Promise<DecodedImageAsset>((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve({ url, width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Image decoding failed'));
        image.src = url;
        if (typeof image.decode === 'function') {
          void image.decode()
            .then(() => resolve({ url, width: image.naturalWidth, height: image.naturalHeight }))
            .catch(() => undefined);
        }
      })
    ));
    pending.catch(() => {
      if (decodedImagePromises.get(key) === pending) decodedImagePromises.delete(key);
    });
    decodedImagePromises.set(key, pending);
  }
  return pending;
}
