import type { ComposerDocument, ComposerNode } from '@/shared/types/composer';
import { normalizeComposerDocument } from '@/shared/types/composer';
import type { ContextItem } from '@/shared/types/context';

export function sanitizeRichText(text: string): string {
  // Strip invisible/control characters WebKit may inject while preserving
  // ordinary spaces, tabs and line breaks authored by the user.
  // eslint-disable-next-line no-control-regex -- intentional control-character ranges
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028\u2029\uFEFF\u2060\u00AD]/g, '');
}

export function extractComposerDocument(editor: HTMLElement | null): ComposerDocument {
  if (!editor) return { version: 1, nodes: [] };

  const nodes: ComposerNode[] = [];
  const appendText = (text: string) => {
    const clean = sanitizeRichText(text);
    if (!clean) return;
    nodes.push({ type: 'text', text: clean });
  };
  const endsWithNewline = () => {
    const last = nodes[nodes.length - 1];
    return last?.type === 'text' && last.text.endsWith('\n');
  };

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    if (element.classList.contains('rich-text-tag-pill')) {
      const contextId = element.dataset.contextId;
      if (contextId) nodes.push({ type: 'context-ref', contextId });
      return;
    }
    if (element.tagName === 'BR') {
      appendText('\n');
      return;
    }

    const isBlock = element.tagName === 'DIV' || element.tagName === 'P';
    if (isBlock && nodes.length > 0 && !endsWithNewline()) appendText('\n');
    element.childNodes.forEach(traverse);
  };

  editor.childNodes.forEach(traverse);
  return normalizeComposerDocument({ version: 1, nodes });
}

export function getVisibleRichTextContexts(
  document: ComposerDocument,
  contexts: ContextItem[],
): ContextItem[] {
  const visibleContextIds = new Set(
    document.nodes
      .filter(node => node.type === 'context-ref')
      .map(node => node.contextId),
  );
  return contexts.filter(context => context.type === 'image' || visibleContextIds.has(context.id));
}
