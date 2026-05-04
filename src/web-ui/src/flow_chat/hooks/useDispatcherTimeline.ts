/**
 * useDispatcherTimeline — aggregates all Agentic OS (Dispatcher) sessions
 * from FlowChatStore into a single timeline organized by date buckets.
 *
 * The dispatcher scene treats independent backend sessions as a continuous
 * "long conversation" for the user; the data structure here is the source
 * of truth for the vertical timeline sidebar.
 *
 * Buckets (top to bottom):
 *   - today
 *   - yesterday
 *   - this_week        (this week, excluding today/yesterday)
 *   - this_month       (this month, excluding the above)
 *   - earlier_<YYYY-MM> (one bucket per earlier month)
 */

import { useEffect, useMemo, useState } from 'react';
import { flowChatStore } from '../store/FlowChatStore';
import type { DialogTurn, FlowChatState, Session } from '../types/flow-chat';
import { compareSessionsForDisplay, getSessionSortTimestamp } from '../utils/sessionOrdering';

export interface DispatcherTimelineTurn {
  turnId: string;
  /** 1-based ordinal in its session. */
  turnIndex: number;
  /** First user-message excerpt. */
  title: string;
  timestamp: number;
}

export interface DispatcherTimelineSession {
  sessionId: string;
  /** Title from session metadata or auto-derived from first user message. */
  title: string;
  /** Sort timestamp (lastFinishedAt ?? createdAt). Used for display "time-of-day". */
  sortTimestamp: number;
  createdAt: number;
  isActive: boolean;
  isHistorical: boolean;
  /** Turns with a non-empty userMessage (renderable as nodes). */
  turns: DispatcherTimelineTurn[];
  raw: Session;
}

export type DispatcherTimelineBucketId =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | `earlier_${string}`;

export interface DispatcherTimelineBucket {
  id: DispatcherTimelineBucketId;
  /** Locale-independent bucket kind for translation lookup. */
  kind: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'month';
  /** YYYY-MM for `month` kind. Empty otherwise. */
  monthKey: string;
  sessions: DispatcherTimelineSession[];
}

export interface DispatcherTimelineData {
  buckets: DispatcherTimelineBucket[];
  totalSessions: number;
  totalTurns: number;
  /** Stable identity for memoization at render-time. */
  signature: string;
}

const EMPTY_TIMELINE: DispatcherTimelineData = {
  buckets: [],
  totalSessions: 0,
  totalTurns: 0,
  signature: 'empty',
};

/**
 * Strict filter: only Agentic OS dispatcher sessions (mode === 'dispatcher').
 *
 * We intentionally do NOT include other agentic_os-scoped sessions such as
 * LiveAppStudio so the timeline reflects only the dispatcher conversation
 * lineage.
 */
function isDispatcherSession(session: Session): boolean {
  if (session.parentSessionId) return false;
  return session.mode?.toLowerCase() === 'dispatcher';
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date): Date {
  const next = startOfDay(date);
  // Treat Monday as first day of week (locale-neutral; affects bucketing only).
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfMonth(date: Date): Date {
  const next = new Date(date);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function bucketForTimestamp(
  timestamp: number,
  todayStart: number,
  yesterdayStart: number,
  weekStart: number,
  monthStart: number
): { id: DispatcherTimelineBucketId; kind: DispatcherTimelineBucket['kind']; monthKey: string } {
  if (timestamp >= todayStart) {
    return { id: 'today', kind: 'today', monthKey: '' };
  }
  if (timestamp >= yesterdayStart) {
    return { id: 'yesterday', kind: 'yesterday', monthKey: '' };
  }
  if (timestamp >= weekStart) {
    return { id: 'this_week', kind: 'this_week', monthKey: '' };
  }
  if (timestamp >= monthStart) {
    return { id: 'this_month', kind: 'this_month', monthKey: '' };
  }
  const key = monthKey(new Date(timestamp));
  return { id: `earlier_${key}` as DispatcherTimelineBucketId, kind: 'month', monthKey: key };
}

function deriveTurnTitle(turn: DialogTurn): string {
  const raw = turn.userMessage?.content ?? '';
  return raw.replace(/\s+/g, ' ').trim();
}

function deriveSessionTitle(session: Session): string {
  const titleFromMeta = session.title?.trim();
  if (titleFromMeta) return titleFromMeta;
  const firstUserTurn = session.dialogTurns.find(turn => !!turn.userMessage?.content?.trim());
  const firstTitle = firstUserTurn ? deriveTurnTitle(firstUserTurn) : '';
  if (firstTitle) return firstTitle;
  return `#${session.sessionId.slice(0, 6)}`;
}

function buildSessionEntry(session: Session, activeSessionId: string | null): DispatcherTimelineSession {
  const renderableTurns = session.dialogTurns.filter(turn => !!turn.userMessage);
  const turns: DispatcherTimelineTurn[] = renderableTurns.map((turn, index) => ({
    turnId: turn.id,
    turnIndex: index + 1,
    title: deriveTurnTitle(turn),
    timestamp: turn.startTime ?? turn.userMessage.timestamp ?? 0,
  }));

  return {
    sessionId: session.sessionId,
    title: deriveSessionTitle(session),
    sortTimestamp: getSessionSortTimestamp(session),
    createdAt: session.createdAt,
    isActive: session.sessionId === activeSessionId,
    isHistorical: session.isHistorical === true,
    turns,
    raw: session,
  };
}

function computeTimeline(state: FlowChatState): DispatcherTimelineData {
  const dispatcherSessions: Session[] = [];
  for (const session of state.sessions.values()) {
    if (isDispatcherSession(session)) {
      dispatcherSessions.push(session);
    }
  }

  if (dispatcherSessions.length === 0) {
    return EMPTY_TIMELINE;
  }

  dispatcherSessions.sort(compareSessionsForDisplay);

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = startOfWeek(now).getTime();
  const monthStart = startOfMonth(now).getTime();

  const bucketMap = new Map<DispatcherTimelineBucketId, DispatcherTimelineBucket>();
  const bucketOrder: DispatcherTimelineBucketId[] = [];

  let totalTurns = 0;

  for (const session of dispatcherSessions) {
    const entry = buildSessionEntry(session, state.activeSessionId);
    totalTurns += entry.turns.length;

    const bucketInfo = bucketForTimestamp(
      entry.sortTimestamp,
      todayStart,
      yesterdayStart,
      weekStart,
      monthStart
    );

    let bucket = bucketMap.get(bucketInfo.id);
    if (!bucket) {
      bucket = {
        id: bucketInfo.id,
        kind: bucketInfo.kind,
        monthKey: bucketInfo.monthKey,
        sessions: [],
      };
      bucketMap.set(bucketInfo.id, bucket);
      bucketOrder.push(bucketInfo.id);
    }
    bucket.sessions.push(entry);
  }

  const buckets = bucketOrder.map(id => bucketMap.get(id)!).filter(Boolean);

  const signatureParts: string[] = [String(state.activeSessionId ?? '')];
  for (const bucket of buckets) {
    signatureParts.push(bucket.id);
    for (const s of bucket.sessions) {
      signatureParts.push(`${s.sessionId}:${s.turns.length}:${s.sortTimestamp}`);
    }
  }

  return {
    buckets,
    totalSessions: dispatcherSessions.length,
    totalTurns,
    signature: signatureParts.join('|'),
  };
}

export function useDispatcherTimeline(): DispatcherTimelineData {
  const [snapshot, setSnapshot] = useState<DispatcherTimelineData>(() =>
    computeTimeline(flowChatStore.getState())
  );

  useEffect(() => {
    let lastSignature = snapshot.signature;
    const unsubscribe = flowChatStore.subscribe(state => {
      const next = computeTimeline(state);
      if (next.signature !== lastSignature) {
        lastSignature = next.signature;
        setSnapshot(next);
      }
    });
    // Reconcile in case the store changed between initial compute and subscribe.
    const current = computeTimeline(flowChatStore.getState());
    if (current.signature !== lastSignature) {
      lastSignature = current.signature;
      setSnapshot(current);
    }
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => snapshot, [snapshot]);
}
