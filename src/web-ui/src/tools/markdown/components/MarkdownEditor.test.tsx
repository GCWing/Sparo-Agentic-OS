/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeMarkdownEditability } from '../tiptap/utils/tiptapMarkdown';
import MarkdownEditor from './MarkdownEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const editorHarness = vi.hoisted(() => ({
  setInitialContent: vi.fn(),
  markSaved: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../tiptap', async () => {
  const ReactModule = await import('react');
  return {
    MarkdownEditingSurface: ReactModule.forwardRef((props: { value?: string }, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        getValue: () => props.value ?? '',
        setValue: vi.fn(),
        insertValue: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
        setMode: vi.fn(),
        setTheme: vi.fn(),
        getSelection: () => ({ start: 0, end: 0, text: '' }),
        destroy: editorHarness.destroy,
        setInitialContent: editorHarness.setInitialContent,
        markSaved: editorHarness.markSaved,
      }));
      return ReactModule.createElement('div', {
        'data-markdown-value': props.value,
      });
    }),
  };
});

vi.mock('@/design-system', async () => {
  const ReactModule = await import('react');
  return {
    CubeLoading: () => null,
    Button: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('button', null, children),
    DropdownMenu: () => null,
    IconButton: () => null,
    confirmDialog: vi.fn(),
  };
});

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/infrastructure/theme/hooks/useTheme', () => ({
  useTheme: () => ({ isLight: true }),
}));

vi.mock('@/infrastructure/event-bus', () => ({
  globalEventBus: { emit: vi.fn() },
}));

vi.mock('@/tools/editor/components/CodeEditor', () => ({
  default: () => null,
}));

vi.mock('../export', () => ({
  exportMarkdownDocument: vi.fn(),
}));

describe('MarkdownEditor virtual document synchronization', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('applies each canonicalizable external snapshot exactly once', () => {
    const initialRaw = '# Draft\n## Brief\n- first\n- second\n';
    const updatedRaw = '# Revised\n## Brief\n- alpha\n- beta\n';
    const initialAnalysis = analyzeMarkdownEditability(initialRaw);
    const updatedAnalysis = analyzeMarkdownEditability(updatedRaw);
    const onContentChange = vi.fn();

    expect(initialAnalysis.mode).toBe('canonicalizable');
    expect(updatedAnalysis.mode).toBe('canonicalizable');
    expect(updatedAnalysis.canonicalMarkdown).not.toBe(updatedRaw);

    act(() => {
      root.render(
        <MarkdownEditor
          fileName="manuscript.md"
          initialContent={initialRaw}
          onContentChange={onContentChange}
        />,
      );
    });

    expect(container.querySelector('[data-markdown-value]')?.getAttribute('data-markdown-value'))
      .toBe(initialAnalysis.canonicalMarkdown);
    expect(editorHarness.setInitialContent).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <MarkdownEditor
          fileName="manuscript.md"
          initialContent={updatedRaw}
          onContentChange={onContentChange}
        />,
      );
    });

    expect(container.querySelector('[data-markdown-value]')?.getAttribute('data-markdown-value'))
      .toBe(updatedAnalysis.canonicalMarkdown);
    expect(editorHarness.setInitialContent).toHaveBeenCalledTimes(1);
    expect(editorHarness.setInitialContent).toHaveBeenLastCalledWith(updatedAnalysis.canonicalMarkdown);

    act(() => {
      root.render(
        <MarkdownEditor
          fileName="manuscript.md"
          initialContent={updatedRaw}
          onContentChange={onContentChange}
        />,
      );
    });
    expect(editorHarness.setInitialContent).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <MarkdownEditor
          fileName="manuscript.md"
          initialContent={updatedAnalysis.canonicalMarkdown}
          onContentChange={onContentChange}
        />,
      );
    });
    expect(editorHarness.setInitialContent).toHaveBeenCalledTimes(1);
    expect(onContentChange).not.toHaveBeenCalled();
  });
});
