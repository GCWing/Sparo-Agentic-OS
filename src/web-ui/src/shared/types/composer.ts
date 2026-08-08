import type { ContextItem } from './context';

/** `turn` and `ambient` are retained only for decoding historical snapshots. */
export type ContextReferenceScope = 'inline' | 'turn' | 'ambient';
export type ContextReferenceRole = 'reference' | 'target' | 'example' | 'constraint' | 'output';

export interface ContextReference {
  id: string;
  assetId: string;
  scope: ContextReferenceScope;
  role: ContextReferenceRole;
  snapshotPolicy: 'current' | 'selection' | 'locator-only';
  createdAt: number;
}

export interface ComposerTextNode {
  type: 'text';
  text: string;
}

export interface ComposerContextRefNode {
  type: 'context-ref';
  referenceId: string;
}

export type ComposerNode = ComposerTextNode | ComposerContextRefNode;

export interface ComposerDocument {
  version: 2;
  nodes: ComposerNode[];
}

export interface ComposerContextSnapshot {
  schemaVersion: 2;
  document: ComposerDocument;
  references: ContextReference[];
  assets: ContextItem[];
  createdAt: number;
}

export type ComposerSubmissionIntent = 'normal' | 'goal' | 'btw' | 'mcp_prompt';

export interface ComposerSubmissionTextNode {
  type: 'text';
  text: string;
}

export interface ComposerSubmissionAttachmentRefNode {
  type: 'attachment_ref';
  attachmentId: string;
}

export type ComposerSubmissionNode =
  | ComposerSubmissionTextNode
  | ComposerSubmissionAttachmentRefNode;

export interface ComposerSubmissionAttachment {
  /** Stable resource identity. Ordinal is presentation only and may change between drafts. */
  id: string;
  ordinal: number;
  type: ContextItem['type'];
  title: string;
  modelContent?: string;
  mimeType?: string;
}

/**
 * Canonical payload crossing the Composer -> Runtime boundary.
 *
 * The document owns reference position, attachments own content, and the Runtime
 * owns provider-specific compilation. UI display snapshots are derived from the
 * same draft but are not model input.
 */
export interface ComposerSubmissionEnvelope {
  schemaVersion: 1;
  intent: ComposerSubmissionIntent;
  document: {
    nodes: ComposerSubmissionNode[];
  };
  attachments: ComposerSubmissionAttachment[];
  createdAt: number;
}

export function hasSendableComposerSubmission(
  submission: ComposerSubmissionEnvelope,
): boolean {
  return submission.attachments.length > 0
    || submission.document.nodes.some(node => node.type === 'attachment_ref' || node.text.trim().length > 0);
}

export function estimateComposerSubmissionCharacters(
  submission: ComposerSubmissionEnvelope,
): number {
  return submission.document.nodes.reduce((total, node) => (
    total + (node.type === 'text' ? Array.from(node.text).length : node.attachmentId.length)
  ), 0) + submission.attachments.reduce((total, attachment) => (
    total + Array.from(attachment.modelContent || '').length + Array.from(attachment.title).length
  ), 0);
}

export const EMPTY_COMPOSER_DOCUMENT: ComposerDocument = {
  version: 2,
  nodes: [],
};

export function normalizeComposerDocument(document: ComposerDocument): ComposerDocument {
  const nodes: ComposerNode[] = [];

  for (const node of document.nodes) {
    if (node.type === 'text') {
      if (!node.text) continue;
      const previous = nodes[nodes.length - 1];
      if (previous?.type === 'text') {
        previous.text += node.text;
      } else {
        nodes.push({ type: 'text', text: node.text });
      }
      continue;
    }

    if (node.referenceId) {
      nodes.push({ type: 'context-ref', referenceId: node.referenceId });
    }
  }

  return { version: 2, nodes };
}

export function createComposerTextDocument(text: string): ComposerDocument {
  return text ? { version: 2, nodes: [{ type: 'text', text }] } : { version: 2, nodes: [] };
}

export function getComposerText(document: ComposerDocument): string {
  return document.nodes
    .filter((node): node is ComposerTextNode => node.type === 'text')
    .map(node => node.text)
    .join('');
}

export function getComposerReferenceIds(document: ComposerDocument): string[] {
  return document.nodes
    .filter((node): node is ComposerContextRefNode => node.type === 'context-ref')
    .map(node => node.referenceId);
}

export function hasComposerContent(document: ComposerDocument): boolean {
  return document.nodes.some(node => node.type === 'context-ref' || node.text.trim().length > 0);
}

export function hasSendableComposerDraft(
  document: ComposerDocument,
  assets: ContextItem[],
): boolean {
  return assets.length > 0 || hasComposerContent(document);
}

export function removeComposerContext(
  document: ComposerDocument,
  referenceId: string,
): ComposerDocument {
  return normalizeComposerDocument({
    version: 2,
    nodes: document.nodes.filter(node => node.type !== 'context-ref' || node.referenceId !== referenceId),
  });
}

export function areComposerDocumentsEqual(
  left: ComposerDocument,
  right: ComposerDocument,
): boolean {
  const a = normalizeComposerDocument(left).nodes;
  const b = normalizeComposerDocument(right).nodes;
  return a.length === b.length && a.every((node, index) => {
    const other = b[index];
    if (!other || node.type !== other.type) return false;
    return node.type === 'text'
      ? node.text === (other as ComposerTextNode).text
      : node.referenceId === (other as ComposerContextRefNode).referenceId;
  });
}

export function createContextReference(
  assetId: string,
  scope: ContextReferenceScope = 'inline',
  overrides: Partial<Omit<ContextReference, 'id' | 'assetId' | 'scope'>> = {},
): ContextReference {
  return {
    id: typeof globalThis.crypto?.randomUUID === 'function'
      ? `context-ref-${globalThis.crypto.randomUUID()}`
      : `context-ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    assetId,
    scope,
    role: 'reference',
    snapshotPolicy: 'current',
    createdAt: Date.now(),
    ...overrides,
  };
}

interface ComposerContextSnapshotV1 {
  schemaVersion: 1;
  document: {
    version: 1;
    nodes: Array<{ type: 'text'; text: string } | { type: 'context-ref'; contextId: string }>;
  };
  contexts: ContextItem[];
  createdAt: number;
}

const VALID_CONTEXT_TYPES = new Set([
  'text-fragment',
  'skill-selection',
  'file',
  'directory',
  'code-snippet',
  'image',
  'terminal-command',
  'git-ref',
  'url',
  'web-element',
  'product-app-preview-element-selection',
  'intent-canvas',
  'spreadsheet-focus',
]);

function isContextAsset(value: unknown): value is ContextItem {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Partial<ContextItem>;
  return typeof asset.id === 'string'
    && typeof asset.type === 'string'
    && VALID_CONTEXT_TYPES.has(asset.type);
}

function isContextReference(value: unknown): value is ContextReference {
  if (!value || typeof value !== 'object') return false;
  const reference = value as Partial<ContextReference>;
  return typeof reference.id === 'string'
    && typeof reference.assetId === 'string'
    && ['inline', 'turn', 'ambient'].includes(reference.scope || '')
    && ['reference', 'target', 'example', 'constraint', 'output'].includes(reference.role || '')
    && ['current', 'selection', 'locator-only'].includes(reference.snapshotPolicy || '');
}

export function isComposerContextSnapshot(value: unknown): value is ComposerContextSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ComposerContextSnapshot>;
  return snapshot.schemaVersion === 2
    && snapshot.document?.version === 2
    && Array.isArray(snapshot.document.nodes)
    && snapshot.document.nodes.every(node => (
      node?.type === 'text'
        ? typeof node.text === 'string'
        : node?.type === 'context-ref' && typeof node.referenceId === 'string'
    ))
    && Array.isArray(snapshot.references)
    && snapshot.references.every(isContextReference)
    && Array.isArray(snapshot.assets)
    && snapshot.assets.every(isContextAsset);
}

function isComposerContextSnapshotV1(value: unknown): value is ComposerContextSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ComposerContextSnapshotV1>;
  return snapshot.schemaVersion === 1
    && snapshot.document?.version === 1
    && Array.isArray(snapshot.document.nodes)
    && snapshot.document.nodes.every(node => (
      node?.type === 'text'
        ? typeof node.text === 'string'
        : node?.type === 'context-ref' && typeof node.contextId === 'string'
    ))
    && Array.isArray(snapshot.contexts)
    && snapshot.contexts.every(isContextAsset);
}

/** Read-only codec for persisted V1 turns and queued drafts. */
export function parseComposerContextSnapshot(value: unknown): ComposerContextSnapshot | null {
  if (isComposerContextSnapshot(value)) return value;
  if (!isComposerContextSnapshotV1(value)) return null;

  const assetById = new Map(value.contexts.map(asset => [asset.id, asset]));
  const referenceByLegacyId = new Map<string, ContextReference>();
  value.document.nodes.forEach(node => {
    if (node.type !== 'context-ref' || referenceByLegacyId.has(node.contextId)) return;
    const asset = assetById.get(node.contextId);
    referenceByLegacyId.set(node.contextId, {
      id: `migrated-ref-${node.contextId}`,
      assetId: node.contextId,
      scope: asset?.type === 'spreadsheet-focus' ? 'ambient' : 'inline',
      role: 'reference',
      snapshotPolicy: 'current',
      createdAt: value.createdAt,
    });
  });
  value.contexts.forEach(asset => {
    if (referenceByLegacyId.has(asset.id)) return;
    referenceByLegacyId.set(asset.id, {
      id: `migrated-ref-${asset.id}`,
      assetId: asset.id,
      scope: asset.type === 'spreadsheet-focus' ? 'ambient' : 'turn',
      role: 'reference',
      snapshotPolicy: 'current',
      createdAt: value.createdAt,
    });
  });

  return {
    schemaVersion: 2,
    document: normalizeComposerDocument({
      version: 2,
      nodes: value.document.nodes.map(node => node.type === 'text'
        ? node
        : {
            type: 'context-ref' as const,
            referenceId: referenceByLegacyId.get(node.contextId)!.id,
          }),
    }),
    references: Array.from(referenceByLegacyId.values()),
    assets: structuredClone(value.contexts),
    createdAt: value.createdAt,
  };
}
