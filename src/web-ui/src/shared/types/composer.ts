import type { ContextItem } from './context';

export interface ComposerTextNode {
  type: 'text';
  text: string;
}

export interface ComposerContextRefNode {
  type: 'context-ref';
  contextId: string;
}

export type ComposerNode = ComposerTextNode | ComposerContextRefNode;

export interface ComposerDocument {
  version: 1;
  nodes: ComposerNode[];
}

export interface ComposerContextSnapshot {
  schemaVersion: 1;
  document: ComposerDocument;
  contexts: ContextItem[];
  createdAt: number;
}

export const EMPTY_COMPOSER_DOCUMENT: ComposerDocument = {
  version: 1,
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

    if (node.contextId) {
      nodes.push({ type: 'context-ref', contextId: node.contextId });
    }
  }

  return { version: 1, nodes };
}

export function createComposerTextDocument(text: string): ComposerDocument {
  return text ? { version: 1, nodes: [{ type: 'text', text }] } : { version: 1, nodes: [] };
}

export function getComposerText(document: ComposerDocument): string {
  return document.nodes
    .filter((node): node is ComposerTextNode => node.type === 'text')
    .map(node => node.text)
    .join('');
}

export function getComposerContextIds(document: ComposerDocument): string[] {
  return document.nodes
    .filter((node): node is ComposerContextRefNode => node.type === 'context-ref')
    .map(node => node.contextId);
}

export function hasComposerContent(document: ComposerDocument): boolean {
  return document.nodes.some(node => node.type === 'context-ref' || node.text.trim().length > 0);
}

export function removeComposerContext(
  document: ComposerDocument,
  contextId: string,
): ComposerDocument {
  return normalizeComposerDocument({
    version: 1,
    nodes: document.nodes.filter(node => node.type !== 'context-ref' || node.contextId !== contextId),
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
      : node.contextId === (other as ComposerContextRefNode).contextId;
  });
}

export function isComposerContextSnapshot(value: unknown): value is ComposerContextSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ComposerContextSnapshot>;
  const validContextTypes = new Set([
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
    'spreadsheet-focus',
  ]);
  return snapshot.schemaVersion === 1
    && snapshot.document?.version === 1
    && Array.isArray(snapshot.document.nodes)
    && snapshot.document.nodes.every(node => (
      node?.type === 'text'
        ? typeof node.text === 'string'
        : node?.type === 'context-ref' && typeof node.contextId === 'string'
    ))
    && Array.isArray(snapshot.contexts)
    && snapshot.contexts.every(context => (
      !!context
      && typeof context === 'object'
      && typeof context.id === 'string'
      && typeof context.type === 'string'
      && validContextTypes.has(context.type)
    ));
}
