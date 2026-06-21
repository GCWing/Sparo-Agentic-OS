import { describe, expect, it } from 'vitest';
import {
  clampMarkdownTableColumnWidth,
  getMarkdownTableColumnBoundaries,
  getMarkdownTableColumnMinWidth,
  normalizeMarkdownTableColumnWidths,
  resizeMarkdownTableBoundary,
  resizeMarkdownTableColumn,
  MAX_MARKDOWN_TABLE_COLUMN_WIDTH,
  MIN_MARKDOWN_TABLE_COLUMN_WIDTH,
} from './resizableMarkdownTableUtils';

describe('ResizableMarkdownTable width helpers', () => {
  it('clamps column widths to the supported range', () => {
    expect(clampMarkdownTableColumnWidth(1)).toBe(MIN_MARKDOWN_TABLE_COLUMN_WIDTH);
    expect(clampMarkdownTableColumnWidth(9000)).toBe(MAX_MARKDOWN_TABLE_COLUMN_WIDTH);
    expect(clampMarkdownTableColumnWidth(123.4)).toBe(123);
  });

  it('resizes only the requested column', () => {
    expect(resizeMarkdownTableColumn([100, 200, 300], 1, 40)).toEqual([100, 240, 300]);
  });

  it('relaxes the minimum column width when the container cannot fit every preferred minimum', () => {
    expect(getMarkdownTableColumnMinWidth(900, 4)).toBe(MIN_MARKDOWN_TABLE_COLUMN_WIDTH);
    expect(getMarkdownTableColumnMinWidth(320, 4)).toBeLessThan(MIN_MARKDOWN_TABLE_COLUMN_WIDTH);
  });

  it('normalizes column widths to the fixed table width', () => {
    const widths = normalizeMarkdownTableColumnWidths([300, 200, 100], 900);

    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(900);
    expect(widths).toEqual([450, 300, 150]);
  });

  it('resizes a boundary by sharing space with the next column', () => {
    expect(resizeMarkdownTableBoundary([300, 220], 0, 40)).toEqual([340, 180]);
  });

  it('keeps the table width fixed when the adjacent column is already at minimum width', () => {
    expect(resizeMarkdownTableBoundary([300, MIN_MARKDOWN_TABLE_COLUMN_WIDTH], 0, 40)).toEqual([
      300,
      MIN_MARKDOWN_TABLE_COLUMN_WIDTH,
    ]);
  });

  it('does not move a boundary left when the left column is already at minimum width', () => {
    expect(resizeMarkdownTableBoundary([MIN_MARKDOWN_TABLE_COLUMN_WIDTH, 240], 0, -40)).toEqual([
      MIN_MARKDOWN_TABLE_COLUMN_WIDTH,
      240,
    ]);
  });

  it('keeps an unchanged copy for invalid column indexes', () => {
    const widths = [100, 200, 300];
    const next = resizeMarkdownTableColumn(widths, 4, 40);

    expect(next).toEqual(widths);
    expect(next).not.toBe(widths);
  });

  it('computes handle boundaries from cumulative widths', () => {
    expect(getMarkdownTableColumnBoundaries([100, 80, 120])).toEqual([100, 180, 300]);
  });
});
