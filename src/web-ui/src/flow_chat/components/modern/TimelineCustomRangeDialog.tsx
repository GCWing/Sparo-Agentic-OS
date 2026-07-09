import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateRangeDialog, type DateRangeValue } from '@/design-system';
import {
  defaultCustomTimeRange,
  localCalendarDaysToCustomRange,
  msToLocalCalendarDay,
  type TimelineCustomTimeRange,
} from './timelineTimeFilter';

export interface TimelineCustomRangeDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (range: TimelineCustomTimeRange) => void;
  initialRange?: TimelineCustomTimeRange | null;
}

function timelineRangeToDateRange(range: TimelineCustomTimeRange): DateRangeValue {
  return {
    startDate: msToLocalCalendarDay(range.startMs),
    endDate: msToLocalCalendarDay(range.endMs),
  };
}

function startOfLocalToday(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export const TimelineCustomRangeDialog: React.FC<TimelineCustomRangeDialogProps> = ({
  open,
  onClose,
  onApply,
  initialRange,
}) => {
  const { t, i18n } = useTranslation('flow-chat');

  const resolvedInitialRange = useMemo(
    () => (initialRange && initialRange.startMs <= initialRange.endMs
      ? timelineRangeToDateRange(initialRange)
      : null),
    [initialRange]
  );

  const defaultRange = useMemo(
    () => timelineRangeToDateRange(defaultCustomTimeRange()),
    []
  );

  const maxDate = useMemo(() => startOfLocalToday(), []);

  return (
    <DateRangeDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      onApply={(range) => {
        onApply(localCalendarDaysToCustomRange(range.startDate, range.endDate));
      }}
      title={t('timelineTimeFilter.timeFilterCustomTitle', {
        defaultValue: 'Custom date range',
      })}
      initialRange={resolvedInitialRange}
      defaultRange={defaultRange}
      maxDate={maxDate}
      locale={i18n.language || 'en-US'}
      labels={{
        hint: t('timelineTimeFilter.timeFilterCustomHint', {
          defaultValue: 'Click a start date, then an end date.',
        }),
        summary: (start, end) =>
          t('timelineTimeFilter.timeFilterCustomSummary', {
            start,
            end,
            defaultValue: '{{start}} - {{end}}',
          }),
        pickEndHint: (start) =>
          t('timelineTimeFilter.timeFilterCustomPickEndHint', {
            start,
            defaultValue: 'Now choose an end date (start: {{start}}).',
          }),
        pickEndError: t('timelineTimeFilter.timeFilterCustomPickEnd', {
          defaultValue: 'Select an end date to complete the range.',
        }),
        previousMonth: t('timelineTimeFilter.timeFilterCustomPrevMonth', {
          defaultValue: 'Previous month',
        }),
        nextMonth: t('timelineTimeFilter.timeFilterCustomNextMonth', {
          defaultValue: 'Next month',
        }),
        cancel: t('timelineTimeFilter.timeFilterCustomCancel', { defaultValue: 'Cancel' }),
        apply: t('timelineTimeFilter.timeFilterCustomApply', { defaultValue: 'Apply' }),
      }}
      closeLabel={t('timelineTimeFilter.timeFilterCustomCancel', { defaultValue: 'Cancel' })}
    />
  );
};

TimelineCustomRangeDialog.displayName = 'TimelineCustomRangeDialog';
