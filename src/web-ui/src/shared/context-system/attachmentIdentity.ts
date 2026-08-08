import type {
  ContextAssetIdentity,
  ContextItem,
  ImageAssetSourceRef,
} from '@/shared/types/context';

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC');
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function canonicalizeAttachmentUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = url.hash === '#' ? '' : url.hash;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return value.trim();
  }
}

function hashString(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function imageSourceKey(sourceRef: ImageAssetSourceRef): string | null {
  switch (sourceRef.kind) {
    case 'local-file':
      return `path:${normalizePath(sourceRef.path)}`;
    case 'remote-url':
      return `url:${canonicalizeAttachmentUrl(sourceRef.url)}`;
    case 'memory-asset':
      return null;
  }
}

/**
 * Returns a compact draft-local lookup key. Exact equality is checked again
 * before reuse, so the fast hashes used for large strings cannot merge a
 * collision accidentally.
 */
export function attachmentIdentityKey(asset: ContextItem): string | null {
  if (asset.identity) {
    return `${asset.type}:${asset.identity.version}:${asset.identity.strategy}:${asset.identity.fingerprint}`;
  }

  switch (asset.type) {
    case 'text-fragment': {
      const content = normalizeText(asset.content);
      return `text-fragment:v1:${content.length}:${hashString(content)}`;
    }
    case 'url':
      return `url:v1:${canonicalizeAttachmentUrl(asset.url)}`;
    case 'file':
      return `file:v1:${normalizePath(asset.filePath)}`;
    case 'directory':
      return `directory:v1:${normalizePath(asset.directoryPath)}:${asset.recursive ? 'recursive' : 'direct'}`;
    case 'code-snippet': {
      const locator = `${normalizePath(asset.filePath)}:${asset.startLine}:${asset.endLine}`;
      const content = normalizeText(asset.selectedText);
      return `code-snippet:v1:${locator}:${content.length}:${hashString(content)}`;
    }
    case 'image': {
      const source = imageSourceKey(asset.sourceRef);
      return source ? `image:v1:${source}` : null;
    }
    case 'intent-canvas':
      return [
        'intent-canvas:v1',
        asset.canvasId,
        asset.revision,
        asset.scope,
        asset.rootNodeId || '',
        [...(asset.selectedNodeIds || [])].sort().join(','),
      ].join(':');
    case 'skill-selection':
      return `skill-selection:v1:${asset.targetKind}:${asset.targetKey}`;
    default:
      return null;
  }
}

export function attachmentsAreEquivalent(left: ContextItem, right: ContextItem): boolean {
  if (left.type !== right.type) return false;
  if (left.id === right.id) return true;

  if (left.identity && right.identity) {
    return left.identity.version === right.identity.version
      && left.identity.strategy === right.identity.strategy
      && left.identity.fingerprint === right.identity.fingerprint;
  }

  switch (left.type) {
    case 'text-fragment':
      return right.type === 'text-fragment'
        && normalizeText(left.content) === normalizeText(right.content)
        && left.format === right.format;
    case 'url':
      return right.type === 'url'
        && canonicalizeAttachmentUrl(left.url) === canonicalizeAttachmentUrl(right.url);
    case 'file':
      return right.type === 'file' && normalizePath(left.filePath) === normalizePath(right.filePath);
    case 'directory':
      return right.type === 'directory'
        && normalizePath(left.directoryPath) === normalizePath(right.directoryPath)
        && left.recursive === right.recursive;
    case 'code-snippet':
      return right.type === 'code-snippet'
        && normalizePath(left.filePath) === normalizePath(right.filePath)
        && left.startLine === right.startLine
        && left.endLine === right.endLine
        && normalizeText(left.selectedText) === normalizeText(right.selectedText);
    case 'image': {
      if (right.type !== 'image') return false;
      const leftSource = imageSourceKey(left.sourceRef);
      const rightSource = imageSourceKey(right.sourceRef);
      return Boolean(leftSource && rightSource && leftSource === rightSource);
    }
    case 'intent-canvas':
      return right.type === 'intent-canvas'
        && attachmentIdentityKey(left) === attachmentIdentityKey(right)
        && normalizeText(left.serializedContent) === normalizeText(right.serializedContent);
    case 'skill-selection':
      return right.type === 'skill-selection'
        && left.targetKind === right.targetKind
        && left.targetKey === right.targetKey;
    default:
      return false;
  }
}

function fallbackBytesHash(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${bytes.byteLength}:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export async function createBinaryAttachmentIdentity(blob: Blob): Promise<ContextAssetIdentity> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const fingerprint = Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    return { version: 1, strategy: 'content-sha256', fingerprint };
  }
  return {
    version: 1,
    strategy: 'content-fallback',
    fingerprint: fallbackBytesHash(bytes),
  };
}

export function buildAttachmentIdentityIndex(
  assets: ContextItem[],
): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  assets.forEach(asset => {
    const key = attachmentIdentityKey(asset);
    if (!key) return;
    (index[key] ||= []).push(asset.id);
  });
  return index;
}
