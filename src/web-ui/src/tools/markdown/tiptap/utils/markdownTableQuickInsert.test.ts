import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { markdownToTiptapDoc, tiptapDocToMarkdown } from './tiptapMarkdown';
import {
  insertMarkdownTableColumn,
  insertMarkdownTableRow,
} from './markdownTableQuickInsert';

function getFirstTable(doc: JSONContent): JSONContent {
  const table = (doc.content ?? []).find(node => node.type === 'markdownTable');
  expect(table).toBeDefined();
  return table as JSONContent;
}

function replaceFirstTable(doc: JSONContent, table: JSONContent): JSONContent {
  return {
    ...doc,
    content: (doc.content ?? []).map(node => (node.type === 'markdownTable' ? table : node)),
  };
}

describe('markdown table quick insert', () => {
  it('inserts an empty column into every row', () => {
    const markdown = [
      '| name | value |',
      '| --- | --- |',
      '| foo | bar |',
    ].join('\n');
    const doc = markdownToTiptapDoc(markdown);
    const result = insertMarkdownTableColumn(getFirstTable(doc), 1);

    expect(result).not.toBeNull();
    expect(tiptapDocToMarkdown(replaceFirstTable(doc, result!.table))).toBe([
      '| name |  | value |',
      '| --- | --- | --- |',
      '| foo |  | bar |',
    ].join('\n'));
    expect(result!.focusRowIndex).toBe(0);
    expect(result!.focusColumnIndex).toBe(1);
  });

  it('preserves table alignment when inserting a column', () => {
    const markdown = [
      '| left | right |',
      '| :--- | ---: |',
      '| a | b |',
    ].join('\n');
    const doc = markdownToTiptapDoc(markdown);
    const result = insertMarkdownTableColumn(getFirstTable(doc), 1);

    expect(result).not.toBeNull();
    expect(tiptapDocToMarkdown(replaceFirstTable(doc, result!.table))).toBe([
      '| left |  | right |',
      '| :--- | --- | ---: |',
      '| a |  | b |',
    ].join('\n'));
  });

  it('inserts an empty body row without changing the header', () => {
    const markdown = [
      '| name | value |',
      '| --- | --- |',
      '| foo | bar |',
    ].join('\n');
    const doc = markdownToTiptapDoc(markdown);
    const result = insertMarkdownTableRow(getFirstTable(doc), 1);

    expect(result).not.toBeNull();
    expect(tiptapDocToMarkdown(replaceFirstTable(doc, result!.table))).toBe([
      '| name | value |',
      '| --- | --- |',
      '|  |  |',
      '| foo | bar |',
    ].join('\n'));
    expect(result!.focusRowIndex).toBe(1);
    expect(result!.focusColumnIndex).toBe(0);
  });

  it('ignores non-table nodes', () => {
    expect(insertMarkdownTableColumn({ type: 'paragraph' }, 0)).toBeNull();
    expect(insertMarkdownTableRow({ type: 'paragraph' }, 1)).toBeNull();
  });
});
