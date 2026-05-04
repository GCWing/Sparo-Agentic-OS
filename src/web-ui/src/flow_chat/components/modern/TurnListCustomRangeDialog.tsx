/**
 * Modal with a single calendar-style date range picker (two clicks: start → end).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, Button, IconButton } from '@/component-library';
import {
  defaultCustomTimeRange,
  localCalendarDaysToCustomRange,
  msToLocalCalendarDay,
  type TurnListCustomTimeRange,
} from './turnListTimeFilter';
import './TurnListCustomRangeDialog.scss';

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalToday(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function isFutureCalendarDay(day: Date): boolean {
  return day.getTime() > startOfLocalToday().getTime();
}

export interface TurnListCustomRangeDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (range: TurnListCustomTimeRange) => void;
  initialRange?: TurnListCustomTimeRange | null;
}

type CellState = 'none' | 'in-range' | 'edge-start' | 'edge-end' | 'single';

function cellVisualState(day: Date, rangeStart: Date | null, rangeEnd: Date | null): CellState {
  if (!rangeStart) return 'none';
  const t = day.getTime();
  const s = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
  if (!rangeEnd) {
    return t === s ? 'edge-start' : 'none';
  }
  const e = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate()).getTime();
  if (s === e && t === s) return 'single';
  if (t < s || t > e) return 'none';
  if (t === s) return 'edge-start';
  if (t === e) return 'edge-end';
  return 'in-range';
}

function dayParticipatesInRange(day: Date, rangeStart: Date | null, rangeEnd: Date | null): boolean {
  return cellVisualState(day, rangeStart, rangeEnd) !== 'none';
}

/** Join adjacent selected days into one continuous pill per row (calendar continuity, not grid adjacency). */
function rangeBridgeFlags(
  day: Date,
  rangeStart: Date | null,
  rangeEnd: Date | null,
): { bridgeLeft: boolean; bridgeRight: boolean } {
  const st = cellVisualState(day, rangeStart, rangeEnd);
  if (st === 'none' || st === 'single') return { bridgeLeft: false, bridgeRight: false };
  if (!rangeEnd && st === 'edge-start') return { bridgeLeft: false, bridgeRight: false };

  const prev = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const bridgeLeft = dayParticipatesInRange(prev, rangeStart, rangeEnd);
  const bridgeRight = dayParticipatesInRange(next, rangeStart, rangeEnd);
  return { bridgeLeft, bridgeRight };
}

export const TurnListCustomRangeDialog: React.FC<TurnListCustomRangeDialogProps> = ({
  open,
  onClose,
  onApply,
  initialRange,
}) => {
  const { t, i18n } = useTranslation('flow-chat');
  const locale = i18n.language || 'en-US';

  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initialRange && initialRange.startMs <= initialRange.endMs) {
      const s = msToLocalCalendarDay(initialRange.startMs);
      const e = msToLocalCalendarDay(initialRange.endMs);
      setRangeStart(s);
      setRangeEnd(e);
      setViewMonth(new Date(s.getFullYear(), s.getMonth(), 1));
    } else {
      const d = defaultCustomTimeRange();
      const s = msToLocalCalendarDay(d.startMs);
      const e = msToLocalCalendarDay(d.endMs);
      setRangeStart(s);
      setRangeEnd(e);
      setViewMonth(new Date(s.getFullYear(), s.getMonth(), 1));
    }
  }, [open, initialRange]);

  const monthTitle = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(viewMonth),
    [locale, viewMonth]
  );

  const weekdayLabels = useMemo(() => {
    const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    const labels: string[] = [];
    // Week of 2024-01-01 (Monday) for stable Mon–Sun labels
    for (let i = 0; i < 7; i++) {
      labels.push(narrow.format(new Date(2024, 0, 1 + i)));
    }
    return labels;
  }, [locale]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [locale]
  );

  const calendarCells = useMemo(() => {
    const y = viewMonth.getFullYear();
    const m = viewMonth.getMonth();
    const first = new Date(y, m, 1);
    const lastDate = new Date(y, m + 1, 0).getDate();
    const padMonFirst = (first.getDay() + 6) % 7;
    const cells: { key: string; date: Date | null }[] = [];
    for (let i = 0; i < padMonFirst; i++) {
      cells.push({ key: `p-${i}`, date: null });
    }
    for (let d = 1; d <= lastDate; d++) {
      cells.push({ key: `d-${d}`, date: new Date(y, m, d) });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `t-${cells.length}`, date: null });
    }
    return cells;
  }, [viewMonth]);

  const summaryText = useMemo(() => {
    if (!rangeStart) {
      return t('turnList.timeFilterCustomHint', {
        defaultValue: 'Click a start date, then an end date.',
      });
    }
    if (rangeStart && rangeEnd) {
      return t('turnList.timeFilterCustomSummary', {
        start: dateFmt.format(rangeStart),
        end: dateFmt.format(rangeEnd),
        defaultValue: '{{start}} – {{end}}',
      });
    }
    return t('turnList.timeFilterCustomPickEndHint', {
      start: dateFmt.format(rangeStart),
      defaultValue: 'Now choose an end date (from {{start}}).',
    });
  }, [rangeStart, rangeEnd, dateFmt, t]);

  const handleDayClick = useCallback(
    (day: Date) => {
      if (isFutureCalendarDay(day)) return;
      const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      setError(null);

      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(d);
        setRangeEnd(null);
        return;
      }

      const sT = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
      const dT = d.getTime();
      if (dT < sT) {
        setRangeEnd(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()));
        setRangeStart(d);
      } else {
        setRangeEnd(d);
      }
    },
    [rangeStart, rangeEnd]
  );

  const handlePrevMonth = useCallback(() => {
    setViewMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setViewMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }, []);

  const handleApply = useCallback(() => {
    if (!rangeStart || !rangeEnd) {
      setError(
        t('turnList.timeFilterCustomPickEnd', {
          defaultValue: 'Select an end date to complete the range.',
        })
      );
      return;
    }
    onApply(localCalendarDaysToCustomRange(rangeStart, rangeEnd));
    onClose();
  }, [rangeStart, rangeEnd, onApply, onClose, t]);

  const title = t('turnList.timeFilterCustomTitle', {
    defaultValue: 'Custom date range',
  });

  const today = startOfLocalToday();

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={title}
      size="small"
      contentInset
      showCloseButton
      contentClassName="turn-list-custom-range-modal__content"
    >
      <div className="turn-list-custom-range">
        <p className="turn-list-custom-range__summary" aria-live="polite">
          {summaryText}
        </p>

        <div className="turn-list-custom-range__cal">
          <div className="turn-list-custom-range__cal-nav">
            <IconButton
              variant="ghost"
              size="xs"
              type="button"
              onClick={handlePrevMonth}
              aria-label={t('turnList.timeFilterCustomPrevMonth', {
                defaultValue: 'Previous month',
              })}
              tooltip={t('turnList.timeFilterCustomPrevMonth', {
                defaultValue: 'Previous month',
              })}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span className="turn-list-custom-range__cal-title">{monthTitle}</span>
            <IconButton
              variant="ghost"
              size="xs"
              type="button"
              onClick={handleNextMonth}
              aria-label={t('turnList.timeFilterCustomNextMonth', {
                defaultValue: 'Next month',
              })}
              tooltip={t('turnList.timeFilterCustomNextMonth', {
                defaultValue: 'Next month',
              })}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>

          <div className="turn-list-custom-range__dow-row" aria-hidden>
            {weekdayLabels.map((label, i) => (
              <span key={i} className="turn-list-custom-range__dow">
                {label}
              </span>
            ))}
          </div>

          <div className="turn-list-custom-range__grid" role="grid" aria-label={monthTitle}>
            {calendarCells.map(({ key, date }) => {
              if (!date) {
                return <div key={key} className="turn-list-custom-range__cell turn-list-custom-range__cell--empty" />;
              }
              const future = isFutureCalendarDay(date);
              const state = cellVisualState(date, rangeStart, rangeEnd);
              const isToday = sameCalendarDay(date, today);
              const { bridgeLeft, bridgeRight } = rangeBridgeFlags(date, rangeStart, rangeEnd);
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  disabled={future}
                  className={[
                    'turn-list-custom-range__cell',
                    future ? 'turn-list-custom-range__cell--disabled' : '',
                    state === 'in-range' ? 'turn-list-custom-range__cell--in-range' : '',
                    state === 'edge-start' ? 'turn-list-custom-range__cell--edge-start' : '',
                    state === 'edge-end' ? 'turn-list-custom-range__cell--edge-end' : '',
                    state === 'single' ? 'turn-list-custom-range__cell--single' : '',
                    bridgeLeft ? 'turn-list-custom-range__cell--bridge-left' : '',
                    bridgeRight ? 'turn-list-custom-range__cell--bridge-right' : '',
                    isToday ? 'turn-list-custom-range__cell--today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => handleDayClick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p className="turn-list-custom-range__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="turn-list-custom-range__actions">
          <Button variant="secondary" size="small" onClick={onClose} type="button">
            {t('turnList.timeFilterCustomCancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" size="small" onClick={handleApply} type="button">
            {t('turnList.timeFilterCustomApply', { defaultValue: 'Apply' })}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

TurnListCustomRangeDialog.displayName = 'TurnListCustomRangeDialog';
