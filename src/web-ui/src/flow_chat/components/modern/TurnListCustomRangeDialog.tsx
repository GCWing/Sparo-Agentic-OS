import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DateRangeDialog, type DateRangeValue } from '@/design-system';
import {
  defaultCustomTimeRange,
  localCalendarDaysToCustomRange,
  msToLocalCalendarDay,
  type TurnListCustomTimeRange,
} from './turnListTimeFilter';

export interface TurnListCustomRangeDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (range: TurnListCustomTimeRange) => void;
  initialRange?: TurnListCustomTimeRange | null;
}

function turnListRangeToDateRange(range: TurnListCustomTimeRange): DateRangeValue {
  return {
    startDate: msToLocalCalendarDay(range.startMs),
    endDate: msToLocalCalendarDay(range.endMs),
  };
}

function startOfLocalToday(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

export const TurnListCustomRangeDialog: React.FC<TurnListCustomRangeDialogProps> = ({
  open,
  onClose,
  onApply,
  initialRange,
}) => {
  const { t, i18n } = useTranslation('flow-chat');

  const resolvedInitialRange = useMemo(
    () => (initialRange && initialRange.startMs <= initialRange.endMs
      ? turnListRangeToDateRange(initialRange)
      : null),
    [initialRange]
  );

  const defaultRange = useMemo(
    () => turnListRangeToDateRange(defaultCustomTimeRange()),
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
      title={t('turnList.timeFilterCustomTitle', {
        defaultValue: 'Custom date range',
      })}
      initialRange={resolvedInitialRange}
      defaultRange={defaultRange}
      maxDate={maxDate}
      locale={i18n.language || 'en-US'}
      labels={{
        hint: t('turnList.timeFilterCustomHint', {
          defaultValue: 'Click a start date, then an end date.',
        }),
        summary: (start, end) =>
          t('turnList.timeFilterCustomSummary', {
            start,
            end,
            defaultValue: '{{start}} - {{end}}',
          }),
        pickEndHint: (start) =>
          t('turnList.timeFilterCustomPickEndHint', {
            start,
            defaultValue: 'Now choose an end date (start: {{start}}).',
          }),
        pickEndError: t('turnList.timeFilterCustomPickEnd', {
          defaultValue: 'Select an end date to complete the range.',
        }),
        previousMonth: t('turnList.timeFilterCustomPrevMonth', {
          defaultValue: 'Previous month',
        }),
        nextMonth: t('turnList.timeFilterCustomNextMonth', {
          defaultValue: 'Next month',
        }),
        cancel: t('turnList.timeFilterCustomCancel', { defaultValue: 'Cancel' }),
        apply: t('turnList.timeFilterCustomApply', { defaultValue: 'Apply' }),
      }}
      closeLabel={t('turnList.timeFilterCustomCancel', { defaultValue: 'Cancel' })}
    />
  );
};

TurnListCustomRangeDialog.displayName = 'TurnListCustomRangeDialog';
