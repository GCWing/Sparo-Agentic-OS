import { describe, expect, it } from 'vitest';
import { analyzeMarkdownEditability } from '../tiptap/utils/tiptapMarkdown';
import {
  hasSourceBackedMarkdownIslands,
  shouldUseDocumentSourcePreviewFallback,
} from './markdownEditabilityPolicy';

describe('markdown editability policy', () => {
  it('keeps inline raw HTML in the visual editor as a source-backed island', () => {
    const analysis = analyzeMarkdownEditability('Mix <span data-x="1">inline</span> HTML.');

    expect(analysis.containsRawHtmlInlines).toBe(true);
    expect(hasSourceBackedMarkdownIslands(analysis)).toBe(true);
    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(false);
  });

  it('keeps block raw HTML in the visual editor as a source-backed island', () => {
    const analysis = analyzeMarkdownEditability('<div class="custom">HTML block</div>');

    expect(analysis.containsRawHtmlBlocks).toBe(true);
    expect(hasSourceBackedMarkdownIslands(analysis)).toBe(true);
    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(false);
  });

  it('keeps render-only details in the visual editor as a source-backed island', () => {
    const analysis = analyzeMarkdownEditability([
      '<details>',
      '<summary><kbd>Advanced</kbd></summary>',
      '',
      'Body',
      '',
      '</details>',
    ].join('\n'));

    expect(analysis.containsRenderOnlyBlocks).toBe(true);
    expect(hasSourceBackedMarkdownIslands(analysis)).toBe(true);
    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(false);
  });

  it('still uses document source fallback for truly unsafe documents', () => {
    const analysis = {
      mode: 'unsafe' as const,
      containsRawHtmlBlocks: false,
      containsRenderOnlyBlocks: false,
      containsRawHtmlInlines: false,
    };

    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(true);
  });

  it('keeps frontmatter in the visual editor as a source-backed island', () => {
    const analysis = analyzeMarkdownEditability([
      '---',
      'title: Demo',
      '---',
      '',
      '# Body',
    ].join('\n'));

    expect(analysis.mode).toBe('lossless');
    expect(analysis.containsRenderOnlyBlocks).toBe(true);
    expect(hasSourceBackedMarkdownIslands(analysis)).toBe(true);
    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(false);
  });

  it('keeps footnotes in the visual editor as source-backed islands', () => {
    const analysis = analyzeMarkdownEditability([
      'Text with a footnote.[^1]',
      '',
      '[^1]: Footnote body',
    ].join('\n'));

    expect(analysis.mode).toBe('lossless');
    expect(analysis.containsRenderOnlyBlocks).toBe(true);
    expect(hasSourceBackedMarkdownIslands(analysis)).toBe(true);
    expect(shouldUseDocumentSourcePreviewFallback(analysis, true)).toBe(false);
  });
});
