import type { ContextItem } from '../../../shared/types/context';

export function sanitizeRichText(text: string): string {
  // Strip zero-width and control characters that WebKit/WebView may inject.
  // Preserve normal whitespace: space, tab, newline, and carriage return.
  // eslint-disable-next-line no-control-regex -- This intentionally removes specific ASCII control-character ranges.
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028\u2029\uFEFF\u2060\u00AD]/g, '');
}

export function extractRichTextContent(editor: HTMLElement | null): string {
  if (!editor) return '';

  let text = '';
  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    const isBlock = element.tagName === 'DIV' || element.tagName === 'P';
    if (isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }

    if (element.classList.contains('rich-text-tag-pill')) {
      const tagFormat = element.getAttribute('data-tag-format');
      if (tagFormat) {
        text += tagFormat;
      }
      return;
    }

    if (element.tagName === 'BR') {
      text += '\n';
      return;
    }

    node.childNodes.forEach(traverse);
  };

  editor.childNodes.forEach(traverse);
  return sanitizeRichText(text).trim();
}

export function getVisibleRichTextContexts(
  editor: HTMLElement | null,
  contexts: ContextItem[],
): ContextItem[] {
  const visibleContextIds = new Set(
    Array.from(editor?.querySelectorAll<HTMLElement>('[data-context-id]') ?? [])
      .map(element => element.dataset.contextId)
      .filter((id): id is string => !!id),
  );

  return contexts.filter(context => visibleContextIds.has(context.id));
}
