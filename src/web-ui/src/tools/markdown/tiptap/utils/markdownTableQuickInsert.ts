import type { JSONContent } from '@tiptap/core';

export type MarkdownTableQuickInsertKind = 'row' | 'column';

export interface MarkdownTableQuickInsertResult {
  table: JSONContent;
  focusRowIndex: number;
  focusColumnIndex: number;
}

function getRowCells(row: JSONContent | undefined): JSONContent[] {
  return Array.isArray(row?.content) ? row.content : [];
}

function getColumnCount(table: JSONContent): number {
  const rows = Array.isArray(table.content) ? table.content : [];
  const rowColumnCount = rows.reduce((max, row) => Math.max(max, getRowCells(row).length), 0);
  const alignColumnCount = Array.isArray(table.attrs?.align) ? table.attrs.align.length : 0;
  return Math.max(rowColumnCount, alignColumnCount);
}

function createEmptyCell(type: 'markdownTableHeader' | 'markdownTableCell'): JSONContent {
  return { type };
}

function getCellTypeForRow(rowIndex: number): 'markdownTableHeader' | 'markdownTableCell' {
  return rowIndex === 0 ? 'markdownTableHeader' : 'markdownTableCell';
}

function normalizeRowCells(row: JSONContent, rowIndex: number, columnCount: number): JSONContent[] {
  const cells = getRowCells(row);
  const cellType = getCellTypeForRow(rowIndex);
  if (cells.length >= columnCount) {
    return [...cells];
  }

  return [
    ...cells,
    ...Array.from({ length: columnCount - cells.length }, () => createEmptyCell(cellType)),
  ];
}

function createEmptyRow(columnCount: number): JSONContent {
  return {
    type: 'markdownTableRow',
    content: Array.from({ length: columnCount }, () => createEmptyCell('markdownTableCell')),
  };
}

function insertAlignment(attrs: JSONContent['attrs'], columnIndex: number, columnCount: number): JSONContent['attrs'] {
  const align = Array.isArray(attrs?.align) ? attrs.align : [];
  if (align.length === 0) {
    return attrs;
  }

  const nextAlign = Array.from({ length: columnCount }, (_, index) => align[index] ?? null);
  nextAlign.splice(columnIndex, 0, null);

  return {
    ...attrs,
    align: nextAlign,
  };
}

export function insertMarkdownTableColumn(
  table: JSONContent,
  columnIndex: number,
): MarkdownTableQuickInsertResult | null {
  if (table.type !== 'markdownTable') {
    return null;
  }

  const rows = Array.isArray(table.content) ? table.content : [];
  const columnCount = getColumnCount(table);
  if (rows.length === 0 || columnCount === 0) {
    return null;
  }

  const nextColumnIndex = Math.max(0, Math.min(columnIndex, columnCount));
  const nextRows = rows.map((row, rowIndex) => {
    const cells = normalizeRowCells(row, rowIndex, columnCount);
    cells.splice(nextColumnIndex, 0, createEmptyCell(getCellTypeForRow(rowIndex)));
    return {
      ...row,
      content: cells,
    };
  });

  return {
    table: {
      ...table,
      attrs: insertAlignment(table.attrs, nextColumnIndex, columnCount),
      content: nextRows,
    },
    focusRowIndex: 0,
    focusColumnIndex: nextColumnIndex,
  };
}

export function insertMarkdownTableRow(
  table: JSONContent,
  rowIndex: number,
): MarkdownTableQuickInsertResult | null {
  if (table.type !== 'markdownTable') {
    return null;
  }

  const rows = Array.isArray(table.content) ? table.content : [];
  const columnCount = getColumnCount(table);
  if (rows.length === 0 || columnCount === 0) {
    return null;
  }

  const nextRows: JSONContent[] = rows.map((row, rowIndex) => ({
    ...row,
    content: normalizeRowCells(row, rowIndex, columnCount),
  }));
  const nextRowIndex = Math.max(1, Math.min(rowIndex, nextRows.length));
  nextRows.splice(nextRowIndex, 0, createEmptyRow(columnCount));

  return {
    table: {
      ...table,
      content: nextRows,
    },
    focusRowIndex: nextRowIndex,
    focusColumnIndex: 0,
  };
}
