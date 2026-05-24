import type { DocumentScope, DocumentTarget } from './protocol';

const LARGE_DOCUMENT_THRESHOLD = 60_000;
const TARGET_CONTEXT_LIMIT = 12_000;
const DOCUMENT_CONTEXT_LIMIT = 40_000;

function extractHeadings(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter(line => /^#{1,6}\s+/.test(line))
    .slice(0, 80)
    .join('\n');
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  const head = text.slice(0, Math.floor(limit * 0.55));
  const tail = text.slice(text.length - Math.floor(limit * 0.35));
  return `${head}\n\n<!-- coauthor-context-truncated -->\n\n${tail}`;
}

export function buildCoauthorDocumentContext(
  markdown: string,
  scope: DocumentScope,
  target: DocumentTarget,
): string {
  if (markdown.length <= LARGE_DOCUMENT_THRESHOLD) {
    return markdown;
  }

  if (scope !== 'document' && 'markdown' in target) {
    return [
      '<!-- coauthor-large-document-context -->',
      'The full document is large. Use the target slice as the editable source of truth.',
      '',
      '## Document headings',
      extractHeadings(markdown) || '(none)',
      '',
      '## Target slice',
      clipText(target.markdown, TARGET_CONTEXT_LIMIT),
    ].join('\n');
  }

  return [
    '<!-- coauthor-large-document-context -->',
    'The full document is large. This is a bounded review context, not the complete source.',
    '',
    '## Document headings',
    extractHeadings(markdown) || '(none)',
    '',
    '## Document excerpts',
    clipText(markdown, DOCUMENT_CONTEXT_LIMIT),
  ].join('\n');
}
