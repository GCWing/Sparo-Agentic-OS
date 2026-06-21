export const MIN_MARKDOWN_TABLE_COLUMN_WIDTH = 112;
export const MIN_MARKDOWN_TABLE_COLUMN_FALLBACK_WIDTH = 48;
export const MAX_MARKDOWN_TABLE_COLUMN_WIDTH = 1200;
const MIN_COLUMN_WIDTH_LOAD_FACTOR = 1.35;

export function clampMarkdownTableColumnWidth(
  width: number,
  minWidth = MIN_MARKDOWN_TABLE_COLUMN_WIDTH,
  maxWidth = MAX_MARKDOWN_TABLE_COLUMN_WIDTH,
): number {
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

export function resizeMarkdownTableColumn(
  widths: readonly number[],
  index: number,
  delta: number,
): number[] {
  if (index < 0 || index >= widths.length) {
    return [...widths];
  }

  const next = [...widths];
  next[index] = clampMarkdownTableColumnWidth(next[index] + delta);
  return next;
}

export function getMarkdownTableColumnMinWidth(
  tableWidth: number,
  columnCount: number,
  preferredMinWidth = MIN_MARKDOWN_TABLE_COLUMN_WIDTH,
): number {
  if (!Number.isFinite(tableWidth) || tableWidth <= 0 || columnCount <= 0) {
    return preferredMinWidth;
  }

  const evenColumnWidth = Math.max(1, Math.floor(tableWidth / columnCount));
  if (preferredMinWidth * columnCount <= tableWidth) {
    return Math.min(preferredMinWidth, evenColumnWidth);
  }

  const relaxedMinWidth = Math.max(
    MIN_MARKDOWN_TABLE_COLUMN_FALLBACK_WIDTH,
    Math.floor(tableWidth / (columnCount * MIN_COLUMN_WIDTH_LOAD_FACTOR)),
  );
  return Math.max(1, Math.min(preferredMinWidth, relaxedMinWidth, evenColumnWidth));
}

function balanceRoundedWidths(widths: readonly number[], targetWidth: number, minWidth: number): number[] {
  const next = widths.map((width) => Math.max(minWidth, Math.round(width)));
  let diff = Math.round(targetWidth) - next.reduce((sum, width) => sum + width, 0);

  if (diff === 0 || next.length === 0) {
    return next;
  }

  let cursor = 0;
  let guard = 0;
  const maxIterations = Math.max(next.length * Math.abs(diff) * 2, next.length * 2);

  while (diff !== 0 && guard < maxIterations) {
    const index = cursor % next.length;
    cursor += 1;
    guard += 1;

    if (diff > 0) {
      next[index] += 1;
      diff -= 1;
      continue;
    }

    if (next[index] > minWidth) {
      next[index] -= 1;
      diff += 1;
    }
  }

  return next;
}

export function normalizeMarkdownTableColumnWidths(
  widths: readonly number[],
  tableWidth: number,
): number[] {
  const columnCount = widths.length;
  if (columnCount === 0) {
    return [];
  }

  const targetWidth = Math.max(columnCount, Math.round(tableWidth));
  const minWidth = getMarkdownTableColumnMinWidth(targetWidth, columnCount);
  const sourceWidths = widths.map((width) => Math.max(1, width));
  const sourceTotal = sourceWidths.reduce((sum, width) => sum + width, 0);

  if (!Number.isFinite(sourceTotal) || sourceTotal <= 0) {
    return balanceRoundedWidths(
      Array.from({ length: columnCount }, () => targetWidth / columnCount),
      targetWidth,
      minWidth,
    );
  }

  const next = new Array<number>(columnCount).fill(0);
  const fixedIndexes = new Set<number>();
  let remainingWidth = targetWidth;

  while (fixedIndexes.size < columnCount) {
    const flexibleIndexes = sourceWidths
      .map((_width, index) => index)
      .filter((index) => !fixedIndexes.has(index));
    const flexibleTotal = flexibleIndexes.reduce((sum, index) => sum + sourceWidths[index], 0);
    let promoted = false;

    for (const index of flexibleIndexes) {
      const proportionalWidth = flexibleTotal > 0
        ? (sourceWidths[index] / flexibleTotal) * remainingWidth
        : remainingWidth / flexibleIndexes.length;

      if (proportionalWidth < minWidth) {
        next[index] = minWidth;
        fixedIndexes.add(index);
        remainingWidth -= minWidth;
        promoted = true;
      }
    }

    if (!promoted) {
      for (const index of flexibleIndexes) {
        next[index] = flexibleTotal > 0
          ? (sourceWidths[index] / flexibleTotal) * remainingWidth
          : remainingWidth / flexibleIndexes.length;
      }
      break;
    }
  }

  return balanceRoundedWidths(next, targetWidth, minWidth);
}

export function resizeMarkdownTableBoundary(
  widths: readonly number[],
  boundaryIndex: number,
  delta: number,
  tableWidth = widths.reduce((sum, width) => sum + width, 0),
): number[] {
  if (boundaryIndex < 0 || boundaryIndex >= widths.length - 1) {
    return [...widths];
  }

  const next = normalizeMarkdownTableColumnWidths(widths, tableWidth);
  const minWidth = getMarkdownTableColumnMinWidth(tableWidth, next.length);
  const leftWidth = next[boundaryIndex];
  const rightWidth = next[boundaryIndex + 1];

  if (delta > 0) {
    const move = Math.min(delta, Math.max(0, rightWidth - minWidth));
    next[boundaryIndex] = leftWidth + move;
    next[boundaryIndex + 1] = rightWidth - move;
    return balanceRoundedWidths(next, tableWidth, minWidth);
  }

  if (delta < 0) {
    const amount = Math.abs(delta);
    const move = Math.min(amount, Math.max(0, leftWidth - minWidth));
    next[boundaryIndex] = leftWidth - move;
    next[boundaryIndex + 1] = rightWidth + move;
    return balanceRoundedWidths(next, tableWidth, minWidth);
  }

  return next;
}

export function getMarkdownTableColumnBoundaries(widths: readonly number[]): number[] {
  let offset = 0;
  return widths.map((width) => {
    offset += width;
    return offset;
  });
}
