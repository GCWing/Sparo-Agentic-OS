import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextItem } from '../../shared/types/context';
import { extractComposerDocument, getVisibleRichTextContexts, sanitizeRichText } from './rich-text-input/richTextPlainText';

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

  const createTag = () => {
    const tag = document.createElement('span');
    tag.className = 'rich-text-tag-pill';
    tag.dataset.contextId = fileContext.id;
    return tag;
  };

  it('extracts an ordered document without converting tags to strings', () => {
    const editor = document.createElement('div');
    editor.append('please read ');
    editor.appendChild(createTag());
    editor.append(' now');

    expect(extractComposerDocument(editor)).toEqual({
      version: 1,
      nodes: [
        { type: 'text', text: 'please read ' },
        { type: 'context-ref', contextId: 'file-1' },
        { type: 'text', text: ' now' },
      ],
    });
  });

  it('returns only context tags visible in the editor', () => {
    const editor = document.createElement('div');
    editor.appendChild(createTag());

    const hiddenContext: ContextItem = {
      id: 'file-2',
      type: 'file',
      timestamp: 2,
      fileName: 'hidden.ts',
      filePath: 'D:/workspace/hidden.ts',
    };

    expect(getVisibleRichTextContexts(extractComposerDocument(editor), [fileContext, hiddenContext])).toEqual([fileContext]);
  });

  it('removes invisible control characters while preserving normal whitespace', () => {
    expect(sanitizeRichText('a\u200Bb\tc\nd')).toBe('ab\tc\nd');
  });
});
