import { describe, expect, it } from 'vitest';
import {
  areHostedViewsEqual,
  normalizeHostedView,
  normalizeHostedViewUpdate,
} from './productAppRuntimeHostedViews';

describe('Product App Runtime hosted views', () => {
  it('normalizes a Markdown editor view', () => {
    expect(normalizeHostedView({
      viewId: 'document-main',
      kind: 'markdown-editor',
      rect: { x: 12, y: 20, width: 640, height: 480, visible: true },
      options: { content: '# Draft', fileName: 'draft.md', savedVersion: 3 },
    })).toEqual({
      viewId: 'document-main',
      kind: 'markdown-editor',
      rect: { x: 12, y: 20, width: 640, height: 480, visible: true },
      options: {
        content: '# Draft',
        fileName: 'draft.md',
        readOnly: false,
        showToolbar: true,
        showOutline: true,
        savedVersion: 3,
      },
    });
  });

  it('updates layout without replacing document options', () => {
    const current = normalizeHostedView({
      viewId: 'document-main',
      kind: 'markdown-editor',
      rect: { x: 0, y: 0, width: 640, height: 480, visible: true },
      options: { content: '# Draft', fileName: 'draft.md', showToolbar: false },
    });

    const updated = normalizeHostedViewUpdate({
      viewId: 'document-main',
      rect: { x: 24, y: 40, width: 720, height: 520, visible: true },
    }, current);

    expect(updated.rect).toEqual({ x: 24, y: 40, width: 720, height: 520, visible: true });
    expect(updated.options).toEqual(current.options);
  });

  it('identifies repeated hosted view updates as unchanged', () => {
    const current = normalizeHostedView({
      viewId: 'document-main',
      kind: 'markdown-editor',
      rect: { x: 24, y: 40, width: 720, height: 520, visible: true },
      options: {
        content: '# Draft',
        fileName: 'draft.md',
        showToolbar: false,
        savedVersion: 3,
      },
    });

    const repeated = normalizeHostedViewUpdate({
      viewId: 'document-main',
      rect: { x: 24, y: 40, width: 720, height: 520, visible: true },
      options: {
        content: '# Draft',
        fileName: 'draft.md',
        showToolbar: false,
        savedVersion: 3,
      },
    }, current);

    expect(areHostedViewsEqual(current, repeated)).toBe(true);
    expect(areHostedViewsEqual(current, {
      ...repeated,
      options: { ...repeated.options, content: '# Revised' },
    })).toBe(false);
  });

  it('rejects arbitrary host component kinds', () => {
    expect(() => normalizeHostedView({
      viewId: 'unsafe-view',
      kind: 'react-component',
      rect: { x: 0, y: 0, width: 100, height: 100, visible: true },
      options: {},
    })).toThrow('unsupported hosted view kind');
  });
});
