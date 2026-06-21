import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useI18n } from '@/infrastructure/i18n';
import {
  clampMarkdownTableColumnWidth,
  getMarkdownTableColumnBoundaries,
  normalizeMarkdownTableColumnWidths,
  resizeMarkdownTableBoundary,
} from './resizableMarkdownTableUtils';
import './ResizableMarkdownTable.scss';

export type MarkdownLayoutMutationPriority = 'normal' | 'high';

export interface MarkdownLayoutMutationDetail {
  reason: string;
  priority?: MarkdownLayoutMutationPriority;
  source?: string;
  [key: string]: unknown;
}

interface ResizableMarkdownTableProps {
  children: React.ReactNode;
  onLayoutMutation?: (detail: MarkdownLayoutMutationDetail) => void;
}

interface DragState {
  index: number;
  startX: number;
  startWidths: number[];
  tableWidth: number;
  pendingDelta: number;
  frameId: number | null;
}

const KEYBOARD_RESIZE_STEP = 12;
const KEYBOARD_RESIZE_LARGE_STEP = 48;

function widthsEqual(left: readonly number[] | null, right: readonly number[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((width, index) => Math.abs(width - right[index]) < 0.5);
}

function getTableMeasurementCells(table: HTMLTableElement | null): HTMLTableCellElement[] | null {
  if (!table) return null;
  const row = table.tHead?.rows[0] ?? table.tBodies[0]?.rows[0] ?? table.rows[0] ?? null;
  if (!row) return null;

  const cells = Array.from(row.cells);
  if (cells.length < 2 || cells.some((cell) => cell.colSpan !== 1)) {
    return null;
  }

  return cells;
}

function measureTableColumns(table: HTMLTableElement | null): number[] | null {
  const cells = getTableMeasurementCells(table);
  if (!cells) return null;

  const widths = cells.map((cell) => cell.getBoundingClientRect().width);
  if (widths.some((width) => !Number.isFinite(width) || width <= 0)) {
    return null;
  }

  return widths.map((width) => Math.max(1, Math.round(width)));
}

function measureTableColumnBoundaries(
  wrapper: HTMLDivElement | null,
  table: HTMLTableElement | null,
): number[] | null {
  const cells = getTableMeasurementCells(table);
  if (!wrapper || !table || !cells) return null;

  const wrapperRect = wrapper.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const styles = window.getComputedStyle(wrapper);
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const originLeft = wrapperRect.left + borderLeft + paddingLeft;
  const fallbackWidth = Math.round(tableRect.width);
  const containerWidth = wrapper.clientWidth || fallbackWidth;

  const boundaries = cells.slice(0, -1).map((cell) => {
    const rawBoundary = cell.getBoundingClientRect().right - originLeft;
    return Math.max(0, Math.min(containerWidth, Math.round(rawBoundary)));
  });

  return boundaries.every((boundary) => Number.isFinite(boundary)) ? boundaries : null;
}

function measureTableContainerWidth(
  wrapper: HTMLDivElement | null,
  table: HTMLTableElement | null,
): number | null {
  const wrapperWidth = wrapper?.clientWidth ?? 0;
  if (wrapperWidth > 0) {
    return Math.round(wrapperWidth);
  }
  const tableWidth = table?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 ? Math.round(tableWidth) : null;
}

export const ResizableMarkdownTable: React.FC<ResizableMarkdownTableProps> = ({
  children,
  onLayoutMutation,
}) => {
  const { t } = useI18n('components');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const measureFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [measuredWidths, setMeasuredWidths] = useState<number[] | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[] | null>(null);
  const [handleBoundaries, setHandleBoundaries] = useState<number[] | null>(null);
  const [tableWidth, setTableWidth] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const notifyLayoutMutation = useCallback((
    reason: string,
    priority: MarkdownLayoutMutationPriority = 'normal',
  ) => {
    onLayoutMutation?.({
      reason,
      priority,
      source: 'markdown-table-resize',
    });
  }, [onLayoutMutation]);

  const syncHandleBoundaries = useCallback(() => {
    const nextBoundaries = measureTableColumnBoundaries(wrapperRef.current, tableRef.current);
    setHandleBoundaries((current) => widthsEqual(current, nextBoundaries) ? current : nextBoundaries);
  }, []);

  const measureNaturalLayout = useCallback(() => {
    syncHandleBoundaries();
    const nextTableWidth = measureTableContainerWidth(wrapperRef.current, tableRef.current);

    if (columnWidths) {
      if (nextTableWidth) {
        setColumnWidths((current) => {
          if (!current) return current;
          const normalizedWidths = normalizeMarkdownTableColumnWidths(current, nextTableWidth);
          return widthsEqual(current, normalizedWidths) ? current : normalizedWidths;
        });
        setTableWidth((current) => current === nextTableWidth ? current : nextTableWidth);
      }
      return;
    }

    if (isResizing) return;

    const measured = measureTableColumns(tableRef.current);
    const nextWidths = measured && nextTableWidth
      ? normalizeMarkdownTableColumnWidths(measured, nextTableWidth)
      : measured;

    setMeasuredWidths((current) => widthsEqual(current, nextWidths) ? current : nextWidths);
    setTableWidth((current) => {
      if (current === nextTableWidth) return current;
      if (current !== null && nextTableWidth !== null && Math.abs(current - nextTableWidth) < 0.5) {
        return current;
      }
      return nextTableWidth;
    });
  }, [columnWidths, isResizing, syncHandleBoundaries]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      measureNaturalLayout();
    });
  }, [measureNaturalLayout]);

  useLayoutEffect(() => {
    measureNaturalLayout();
  }, [children, measureNaturalLayout]);

  useLayoutEffect(() => {
    syncHandleBoundaries();
  }, [children, columnWidths, measuredWidths, syncHandleBoundaries, tableWidth]);

  useLayoutEffect(() => {
    if (!columnWidths) return;
    const nextWidths = measureTableColumns(tableRef.current);
    if (nextWidths && nextWidths.length !== columnWidths.length) {
      const nextTableWidth = measureTableContainerWidth(wrapperRef.current, tableRef.current);
      setColumnWidths(null);
      setMeasuredWidths(nextTableWidth
        ? normalizeMarkdownTableColumnWidths(nextWidths, nextTableWidth)
        : nextWidths);
      setTableWidth(nextTableWidth);
    }
  }, [children, columnWidths]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const table = tableRef.current;
    const wrapper = wrapperRef.current;
    if (!table || !wrapper) return undefined;

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(table);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [scheduleMeasure]);

  useEffect(() => () => {
    if (measureFrameRef.current !== null) {
      window.cancelAnimationFrame(measureFrameRef.current);
    }
    const drag = dragRef.current;
    if (drag?.frameId !== null && drag?.frameId !== undefined) {
      window.cancelAnimationFrame(drag.frameId);
    }
  }, []);

  const visibleWidths = columnWidths ?? measuredWidths;
  const fallbackBoundaries = useMemo(
    () => visibleWidths ? getMarkdownTableColumnBoundaries(visibleWidths).slice(0, -1) : [],
    [visibleWidths],
  );
  const boundaries = handleBoundaries?.length === fallbackBoundaries.length
    ? handleBoundaries
    : fallbackBoundaries;
  const resolvedTableWidth = tableWidth ?? measureTableContainerWidth(wrapperRef.current, tableRef.current);
  const tableStyle = useMemo<CSSProperties | undefined>(() => {
    if (!columnWidths) return undefined;
    return {
      tableLayout: 'fixed',
      width: '100%',
    };
  }, [columnWidths]);
  const handleLayerStyle = useMemo<CSSProperties | undefined>(() => {
    if (!resolvedTableWidth) return undefined;
    return {
      width: `${resolvedTableWidth}px`,
    };
  }, [resolvedTableWidth]);

  const getCurrentWidths = useCallback((): number[] | null => {
    const nextWidths = columnWidths ?? measuredWidths ?? measureTableColumns(tableRef.current);
    if (!nextWidths || nextWidths.length < 2) return null;
    return nextWidths;
  }, [columnWidths, measuredWidths]);

  const freezeWidths = useCallback((): { widths: number[]; tableWidth: number } | null => {
    const nextWidths = getCurrentWidths();
    if (!nextWidths) return null;
    const nextTableWidth = measureTableContainerWidth(wrapperRef.current, tableRef.current)
      ?? nextWidths.reduce((sum, width) => sum + width, 0);
    const clampedWidths = normalizeMarkdownTableColumnWidths(
      nextWidths.map((width) => clampMarkdownTableColumnWidth(width)),
      nextTableWidth,
    );
    setColumnWidths(clampedWidths);
    setTableWidth(nextTableWidth);
    return {
      widths: clampedWidths,
      tableWidth: nextTableWidth,
    };
  }, [getCurrentWidths]);

  const applyDragDelta = useCallback((drag: DragState, delta: number, priority: MarkdownLayoutMutationPriority) => {
    const nextWidths = resizeMarkdownTableBoundary(drag.startWidths, drag.index, delta, drag.tableWidth);
    setColumnWidths(nextWidths);
    setTableWidth(drag.tableWidth);
    notifyLayoutMutation(priority === 'high' ? 'table-column-resize-end' : 'table-column-resize', priority);
  }, [notifyLayoutMutation]);

  const scheduleDragDelta = useCallback((delta: number) => {
    const drag = dragRef.current;
    if (!drag) return;

    drag.pendingDelta = delta;
    if (drag.frameId !== null) return;

    drag.frameId = window.requestAnimationFrame(() => {
      const currentDrag = dragRef.current;
      if (!currentDrag) return;
      currentDrag.frameId = null;
      applyDragDelta(currentDrag, currentDrag.pendingDelta, 'normal');
    });
  }, [applyDragDelta]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.frameId !== null) {
      window.cancelAnimationFrame(drag.frameId);
    }

    applyDragDelta(drag, event.clientX - drag.startX, 'high');
    dragRef.current = null;
    setActiveIndex(null);
    setIsResizing(false);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, [applyDragDelta]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (event.button !== 0) return;
    const frozen = freezeWidths();
    if (!frozen || index < 0 || index >= frozen.widths.length - 1) return;

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      index,
      startX: event.clientX,
      startWidths: frozen.widths,
      tableWidth: frozen.tableWidth,
      pendingDelta: 0,
      frameId: null,
    };
    setActiveIndex(index);
    setIsResizing(true);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic events; drag still works in tests.
    }
  }, [freezeWidths]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    scheduleDragDelta(event.clientX - drag.startX);
  }, [scheduleDragDelta]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag(event);
  }, [finishDrag]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.shiftKey ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP;
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (direction !== 0) {
      const frozen = freezeWidths();
      if (!frozen) return;
      event.preventDefault();
      event.stopPropagation();
      const nextWidths = resizeMarkdownTableBoundary(
        frozen.widths,
        index,
        direction * step,
        frozen.tableWidth,
      );
      setColumnWidths(nextWidths);
      setTableWidth(frozen.tableWidth);
      notifyLayoutMutation('table-column-keyboard-resize', 'high');
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      setColumnWidths(null);
      setActiveIndex(null);
      setIsResizing(false);
      scheduleMeasure();
      notifyLayoutMutation('table-column-resize-reset', 'high');
    }
  }, [freezeWidths, notifyLayoutMutation, scheduleMeasure]);

  const handleReset = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setColumnWidths(null);
    setActiveIndex(null);
    setIsResizing(false);
    scheduleMeasure();
    notifyLayoutMutation('table-column-resize-reset', 'high');
  }, [notifyLayoutMutation, scheduleMeasure]);

  const wrapperClassName = [
    'table-wrapper',
    'markdown-resizable-table',
    columnWidths ? 'markdown-resizable-table--custom-widths' : '',
    isResizing ? 'markdown-resizable-table--resizing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={wrapperRef} className={wrapperClassName}>
      <table ref={tableRef} style={tableStyle}>
        {columnWidths && (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={index} style={{ width: `${width}px` }} />
            ))}
          </colgroup>
        )}
        {children}
      </table>

      {visibleWidths && visibleWidths.length > 1 && (
        <div className="markdown-resizable-table__handles" style={handleLayerStyle}>
          {boundaries.map((left, index) => (
            <button
              key={index}
              type="button"
              className={[
                'markdown-resizable-table__handle',
                activeIndex === index ? 'markdown-resizable-table__handle--active' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${left}px` }}
              aria-label={t('markdown.resizeColumn', { index: index + 1 })}
              title={t('markdown.resetColumnWidths')}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={handleReset}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onPointerCancel={handlePointerEnd}
              onPointerDown={(event) => handlePointerDown(event, index)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
};
