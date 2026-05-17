import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextItem } from '../../shared/types/context';
import { createContextTagElement } from './rich-text-input/richTextContextTags';
import { extractRichTextContent, getVisibleRichTextContexts, sanitizeRichText } from './rich-text-input/richTextPlainText';

let JSDOMCtor: (new (html?: string) => { window: Window & typeof globalThis }) | null = null;

try {
  const jsdom = await import('jsdom');
  JSDOMCtor = jsdom.JSDOM as typeof JSDOMCtor;
} catch {
  JSDOMCtor = null;
}

const describeWithJsdom = JSDOMCtor ? describe : describe.skip;

const fileContext: ContextItem = {
  id: 'file-1',
  type: 'file',
  timestamp: 1,
  fileName: 'agent.ts',
  filePath: 'D:/workspace/agent.ts',
};

describeWithJsdom('rich text input utilities', () => {
  beforeEach(() => {
    const dom = new JSDOMCtor!('<!doctype html><html><body></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  });

  it('extracts plain text with context tag formats', () => {
    const editor = document.createElement('div');
    editor.append('please read ');
    editor.appendChild(createContextTagElement(fileContext, () => {}));
    editor.append(' now');

    expect(extractRichTextContent(editor)).toBe('please read #file:agent.ts now');
  });

  it('returns only context tags visible in the editor', () => {
    const editor = document.createElement('div');
    editor.appendChild(createContextTagElement(fileContext, () => {}));

    const hiddenContext: ContextItem = {
      id: 'file-2',
      type: 'file',
      timestamp: 2,
      fileName: 'hidden.ts',
      filePath: 'D:/workspace/hidden.ts',
    };

    expect(getVisibleRichTextContexts(editor, [fileContext, hiddenContext])).toEqual([fileContext]);
  });

  it('removes invisible control characters while preserving normal whitespace', () => {
    expect(sanitizeRichText('a\u200Bb\tc\nd')).toBe('ab\tc\nd');
  });
});
