import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../Button';
import { Dialog, type DialogSize } from '../Dialog';
import { IconButton } from '../IconButton';
import './DateRangeDialog.scss';

export interface DateRangeValue {
  startDate: Date;
  endDate: Date;
}

export interface DateRangeDialogLabels {
  hint?: string;
  summary?: (start: string, end: string) => string;
  pickEndHint?: (start: string) => string;
  pickEndError?: string;
  previousMonth?: string;
  nextMonth?: string;
  cancel?: string;
  apply?: string;
}

export interface DateRangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (range: DateRangeValue) => void;
  title?: React.ReactNode;
  initialRange?: DateRangeValue | null;
  defaultRange?: DateRangeValue | null;
  minDate?: Date | null;
  maxDate?: Date | null;
  locale?: string;
  labels?: DateRangeDialogLabels;
  dateFormatOptions?: Intl.DateTimeFormatOptions;
  size?: DialogSize;
  contentClassName?: string;
  className?: string;
  closeLabel?: string;
}

type CellState = 'none' | 'in-range' | 'edge-start' | 'edge-end' | 'single';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function startOfCalendarDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

function startOfLocalToday(): Date {
  return startOfCalendarDay(new Date());
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function compareCalendarDays(a: Date, b: Date): number {
  return startOfCalendarDay(a).getTime() - startOfCalendarDay(b).getTime();
}

function normalizeRange(range: DateRangeValue | null | undefined): DateRangeValue | null {
  if (!range) return null;
  const startDate = startOfCalendarDay(range.startDate);
  const endDate = startOfCalendarDay(range.endDate);
  if (startDate.getTime() <= endDate.getTime()) {
    return { startDate, endDate };
  }
  return { startDate: endDate, endDate: startDate };
}

function fallbackRange(): DateRangeValue {
  const endDate = startOfLocalToday();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);
  return { startDate, endDate };
}

function cellVisualState(day: Date, rangeStart: Date | null, rangeEnd: Date | null): CellState {
  if (!rangeStart) return 'none';
  const t = startOfCalendarDay(day).getTime();
  const s = startOfCalendarDay(rangeStart).getTime();
  if (!rangeEnd) {
    return t === s ? 'edge-start' : 'none';
  }
  const e = startOfCalendarDay(rangeEnd).getTime();
  if (s === e && t === s) return 'single';
  if (t < s || t > e) return 'none';
  if (t === s) return 'edge-start';
  if (t === e) return 'edge-end';
  return 'in-range';
}

function dayParticipatesInRange(day: Date, rangeStart: Date | null, rangeEnd: Date | null): boolean {
  return cellVisualState(day, rangeStart, rangeEnd) !== 'none';
}

function rangeBridgeFlags(
  day: Date,
  rangeStart: Date | null,
  rangeEnd: Date | null,
): { bridgeLeft: boolean; bridgeRight: boolean } {
  const state = cellVisualState(day, rangeStart, rangeEnd);
  if (state === 'none' || state === 'single') return { bridgeLeft: false, bridgeRight: false };
  if (!rangeEnd && state === 'edge-start') return { bridgeLeft: false, bridgeRight: false };

  const prev = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return {
    bridgeLeft: dayParticipatesInRange(prev, rangeStart, rangeEnd),
    bridgeRight: dayParticipatesInRange(next, rangeStart, rangeEnd),
  };
}

export const DateRangeDialog: React.FC<DateRangeDialogProps> = ({
  open,
  onOpenChange,
  onApply,
  title = 'Date range',
  initialRange,
  defaultRange,
  minDate,
  maxDate,
  locale,
  labels,
  dateFormatOptions,
  size = 'small',
  contentClassName,
  className,
  closeLabel,
}) => {
  const resolvedLocale =
    locale || (typeof navigator !== 'undefined' ? navigator.language : undefined) || 'en-US';

  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const today = startOfLocalToday();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const normalized = normalizeRange(initialRange) ?? normalizeRange(defaultRange) ?? fallbackRange();
    setRangeStart(normalized.startDate);
    setRangeEnd(normalized.endDate);
    setViewMonth(new Date(normalized.startDate.getFullYear(), normalized.startDate.getMonth(), 1));
  }, [defaultRange, initialRange, open]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(resolvedLocale, { year: 'numeric', month: 'long' }).format(viewMonth),
    [resolvedLocale, viewMonth]
  );

  const weekdayLabels = useMemo(() => {
    const narrow = new Intl.DateTimeFormat(resolvedLocale, { weekday: 'narrow' });
    const labels: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      labels.push(narrow.format(new Date(2024, 0, 1 + i)));
    }
    return labels;
  }, [resolvedLocale]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(resolvedLocale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...dateFormatOptions,
      }),
    [dateFormatOptions, resolvedLocale]
  );

  const calendarCells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const first = new Date(year, month, 1);
    const lastDate = new Date(year, month + 1, 0).getDate();
    const padMondayFirst = (first.getDay() + 6) % 7;
    const cells: { key: string; date: Date | null }[] = [];

    for (let i = 0; i < padMondayFirst; i += 1) {
      cells.push({ key: `p-${i}`, date: null });
    }
    for (let day = 1; day <= lastDate; day += 1) {
      cells.push({ key: `d-${day}`, date: new Date(year, month, day) });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `t-${cells.length}`, date: null });
    }
    return cells;
  }, [viewMonth]);

  const isDateDisabled = useCallback(
    (date: Date) => {
      if (minDate && compareCalendarDays(date, minDate) < 0) return true;
      if (maxDate && compareCalendarDays(date, maxDate) > 0) return true;
      return false;
    },
    [maxDate, minDate]
  );

  const summaryText = useMemo(() => {
    if (!rangeStart) {
      return labels?.hint ?? 'Click a start date, then an end date.';
    }

    const startLabel = dateFormatter.format(rangeStart);
    if (rangeStart && rangeEnd) {
      const endLabel = dateFormatter.format(rangeEnd);
      return labels?.summary?.(startLabel, endLabel) ?? `${startLabel} - ${endLabel}`;
    }

    return labels?.pickEndHint?.(startLabel) ?? `Now choose an end date (from ${startLabel}).`;
  }, [dateFormatter, labels, rangeEnd, rangeStart]);

  const handleDayClick = useCallback(
    (day: Date) => {
      if (isDateDisabled(day)) return;
      const selectedDay = startOfCalendarDay(day);
      setError(null);

      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(selectedDay);
        setRangeEnd(null);
        return;
      }

      if (compareCalendarDays(selectedDay, rangeStart) < 0) {
        setRangeEnd(startOfCalendarDay(rangeStart));
        setRangeStart(selectedDay);
      } else {
        setRangeEnd(selectedDay);
      }
    },
    [isDateDisabled, rangeEnd, rangeStart]
  );

  const handlePrevMonth = useCallback(() => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const handleApply = useCallback(() => {
    if (!rangeStart || !rangeEnd) {
      setError(labels?.pickEndError ?? 'Select an end date to complete the range.');
      return;
    }
    onApply({ startDate: startOfCalendarDay(rangeStart), endDate: startOfCalendarDay(rangeEnd) });
    onOpenChange(false);
  }, [labels?.pickEndError, onApply, onOpenChange, rangeEnd, rangeStart]);

  const today = startOfLocalToday();
  const previousMonthLabel = labels?.previousMonth ?? 'Previous month';
  const nextMonthLabel = labels?.nextMonth ?? 'Next month';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size={size}
      contentInset
      showCloseButton
      contentClassName={cx('ds-date-range-dialog__content', contentClassName)}
      className={className}
      closeLabel={closeLabel}
    >
      <div className="ds-date-range-dialog">
        <p className="ds-date-range-dialog__summary" aria-live="polite">
          {summaryText}
        </p>

        <div className="ds-date-range-dialog__calendar">
          <div className="ds-date-range-dialog__calendar-nav">
            <IconButton
              variant="ghost"
              size="xs"
              type="button"
              onClick={handlePrevMonth}
              aria-label={previousMonthLabel}
              tooltip={previousMonthLabel}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="ds-date-range-dialog__calendar-title">{monthTitle}</span>
            <IconButton
              variant="ghost"
              size="xs"
              type="button"
              onClick={handleNextMonth}
              aria-label={nextMonthLabel}
              tooltip={nextMonthLabel}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>

          <div className="ds-date-range-dialog__dow-row" aria-hidden>
            {weekdayLabels.map((label, index) => (
              <span key={index} className="ds-date-range-dialog__dow">
                {label}
              </span>
            ))}
          </div>

          <div className="ds-date-range-dialog__grid" role="grid" aria-label={monthTitle}>
            {calendarCells.map(({ key, date }) => {
              if (!date) {
                return (
                  <div
                    key={key}
                    className="ds-date-range-dialog__cell ds-date-range-dialog__cell--empty"
                  />
                );
              }

              const disabled = isDateDisabled(date);
              const state = cellVisualState(date, rangeStart, rangeEnd);
              const isToday = sameCalendarDay(date, today);
              const { bridgeLeft, bridgeRight } = rangeBridgeFlags(date, rangeStart, rangeEnd);
              const selected = state !== 'none';
              return (
                <Button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={dateFormatter.format(date)}
                  aria-selected={selected}
                  disabled={disabled}
                  variant="ghost"
                  size="small"
                  className={cx(
                    'ds-date-range-dialog__cell',
                    disabled && 'ds-date-range-dialog__cell--disabled',
                    state === 'in-range' && 'ds-date-range-dialog__cell--in-range',
                    state === 'edge-start' && 'ds-date-range-dialog__cell--edge-start',
                    state === 'edge-end' && 'ds-date-range-dialog__cell--edge-end',
                    state === 'single' && 'ds-date-range-dialog__cell--single',
                    bridgeLeft && 'ds-date-range-dialog__cell--bridge-left',
                    bridgeRight && 'ds-date-range-dialog__cell--bridge-right',
                    isToday && 'ds-date-range-dialog__cell--today'
                  )}
                  onClick={() => handleDayClick(date)}
                >
                  {date.getDate()}
                </Button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p className="ds-date-range-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ds-date-range-dialog__actions">
          <Button variant="secondary" size="small" onClick={() => onOpenChange(false)} type="button">
            {labels?.cancel ?? 'Cancel'}
          </Button>
          <Button variant="primary" size="small" onClick={handleApply} type="button">
            {labels?.apply ?? 'Apply'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

DateRangeDialog.displayName = 'DateRangeDialog';
