import type { JSONContent } from '@tiptap/core';
import type { ComposerDocument, ComposerNode } from '@/shared/types/composer';
import { normalizeComposerDocument } from '@/shared/types/composer';

export const COMPOSER_CONTEXT_REFERENCE_NODE = 'contextReference';
export const COMPOSER_HARD_BREAK_NODE = 'hardBreak';
export const COMPOSER_PARAGRAPH_NODE = 'composerParagraph';

function appendTextContent(content: JSONContent[], text: string): void {
  const parts = text.split('\n');
  parts.forEach((part, index) => {
    if (part) content.push({ type: 'text', text: part });
    if (index < parts.length - 1) content.push({ type: COMPOSER_HARD_BREAK_NODE });
  });
}

export function composerDocumentToTiptap(document: ComposerDocument): JSONContent {
  const content: JSONContent[] = [];
  document.nodes.forEach(node => {
    if (node.type === 'text') {
      appendTextContent(content, node.text);
      return;
    }
    content.push({
      type: COMPOSER_CONTEXT_REFERENCE_NODE,
      attrs: { referenceId: node.referenceId },
    });
  });
  return {
    type: 'doc',
    content: [{ type: COMPOSER_PARAGRAPH_NODE, content }],
  };
}

export function composerTextToTiptapContent(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  appendTextContent(content, text);
  return content;
}

export function tiptapToComposerDocument(content: JSONContent): ComposerDocument {
  const nodes: ComposerNode[] = [];
  const appendText = (text: string) => {
    if (!text) return;
    nodes.push({ type: 'text', text });
  };

  const inlineContent = content.content?.find(node => node.type === COMPOSER_PARAGRAPH_NODE)?.content || [];
  inlineContent.forEach(node => {
    if (node.type === 'text') {
      appendText(node.text || '');
      return;
    }
    if (node.type === COMPOSER_HARD_BREAK_NODE) {
      appendText('\n');
      return;
    }
    if (node.type === COMPOSER_CONTEXT_REFERENCE_NODE) {
      const referenceId = node.attrs?.referenceId;
      if (typeof referenceId === 'string' && referenceId) {
        nodes.push({ type: 'context-ref', referenceId });
      }
    }
  });

  return normalizeComposerDocument({ version: 2, nodes });
}
