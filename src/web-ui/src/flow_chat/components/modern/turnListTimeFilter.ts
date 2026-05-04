/**
 * Shared time-range presets for turn list and dispatcher timeline panels.
 */

export type TurnListTimePreset = 'all' | 'today' | 'last7' | 'this_month' | 'custom';

export interface TurnListCustomTimeRange {
  startMs: number;
  endMs: number;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonthMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local midnight for the calendar day containing `ms`. */
export function msToLocalCalendarDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Full-day range from inclusive local calendar start/end days. */
export function localCalendarDaysToCustomRange(startDay: Date, endDay: Date): TurnListCustomTimeRange {
  const s = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate(), 0, 0, 0, 0);
  const e = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 23, 59, 59, 999);
  return { startMs: s.getTime(), endMs: e.getTime() };
}

/** Default range when opening the custom picker: last 7 local days through end of today. */
export function defaultCustomTimeRange(): TurnListCustomTimeRange {
  const now = new Date();
  const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  start.setDate(start.getDate() - 7);
  return { startMs: start.getTime(), endMs: endDay.getTime() };
}

export function timestampMatchesTimePreset(
  timestamp: number,
  preset: TurnListTimePreset,
  customRange?: TurnListCustomTimeRange | null,
): boolean {
  if (preset === 'all') return true;
  const ts = timestamp ?? 0;
  if (!ts) return false;

  if (preset === 'custom') {
    if (!customRange) return false;
    return ts >= customRange.startMs && ts <= customRange.endMs;
  }

  const t0 = startOfTodayMs();
  const last7 = t0 - 7 * 86_400_000;
  const month0 = startOfMonthMs();
  switch (preset) {
    case 'today':
      return ts >= t0;
    case 'last7':
      return ts >= last7;
    case 'this_month':
      return ts >= month0;
    default:
      return true;
  }
}
