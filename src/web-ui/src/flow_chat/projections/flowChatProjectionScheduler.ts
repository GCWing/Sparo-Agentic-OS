import type {
  DialogTurn,
  FlowChatState,
  FlowItem,
  FlowSubagentExecutionProjection,
  FlowToolItem,
  ModelRound,
  Session,
  SessionLoadPhase,
} from '../types/flow-chat';
import {
  EXPLORE_TOOL_CATEGORY_ORDER,
  getExploreToolCategory,
  isCollapsibleTool,
  type ExploreToolCategory,
} from '../tool-cards/collapsibleTools';
import { deriveTextBlockState, deriveThinkingBlockState } from '../runtime/statusModel';
import { measureFlowChat } from '../performance/flowChatPerf';
import { compareSessionsForDisplay, getSessionSortTimestamp } from '../utils/sessionOrdering';
import { isSystemAgenticOsSession } from '../domain/sessionDescriptor';

export interface ExploreToolCategoryCount {
  category: ExploreToolCategory;
  count: number;
  toolNames: Record<string, number>;
}

export interface ExploreGroupStats {
  readCount: number;
  searchCount: number;
  fetchCount: number;
  commandCount: number;
  otherCount: number;
  thinkingCount: number;
  totalToolCount: number;
  toolCounts: ExploreToolCategoryCount[];
}

export interface ExploreGroupData {
  groupId: string;
  rounds: ModelRound[];
  allItems: FlowItem[];
  stats: ExploreGroupStats;
  isGroupStreaming: boolean;
  isLastGroupInTurn: boolean;
}

export type VirtualItem =
  | {
      type: 'user-message';
      data: DialogTurn['userMessage'];
      turnId: string;
      turnIndex: number;
      turnStatus: DialogTurn['status'];
      turnStartMs: number;
      sessionStartMs: number;
    }
  | {
      type: 'follow-up-user-message';
      data: NonNullable<DialogTurn['followUpUserMessages']>[number];
      turnId: string;
      turnIndex: number;
      turnStatus: DialogTurn['status'];
      turnStartMs: number;
      sessionStartMs: number;
    }
  | { type: 'model-round'; data: ModelRound; turnId: string; isLastRound: boolean }
  | { type: 'explore-group'; data: ExploreGroupData; turnId: string }
  | { type: 'image-analyzing'; turnId: string };

interface SessionProjectionCache {
  dialogTurnsRef: DialogTurn[] | null;
  virtualItems: VirtualItem[];
  virtualItemsByKey: Map<string, VirtualItem>;
  turnItemsById: Map<string, { turn: DialogTurn; items: VirtualItem[] }>;
  version: number;
}

export interface AgenticOsTimelineTurn {
  turnId: string;
  /** 1-based ordinal in its session. */
  turnIndex: number;
  /** First user-message excerpt. */
  title: string;
  timestamp: number;
}

export interface AgenticOsTimelineSession {
  sessionId: string;
  /** Title from session metadata or auto-derived from first user message. */
  title: string;
  /** Sort timestamp (lastFinishedAt ?? createdAt). Used for display "time-of-day". */
  sortTimestamp: number;
  createdAt: number;
  isActive: boolean;
  loadPhase: SessionLoadPhase;
  /** Turns with a non-empty userMessage (renderable as nodes). */
  turns: AgenticOsTimelineTurn[];
  raw: Session;
}

export type AgenticOsTimelineBucketId =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | `earlier_${string}`;

export interface AgenticOsTimelineBucket {
  id: AgenticOsTimelineBucketId;
  /** Locale-independent bucket kind for translation lookup. */
  kind: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'month';
  /** YYYY-MM for `month` kind. Empty otherwise. */
  monthKey: string;
  sessions: AgenticOsTimelineSession[];
}

export interface AgenticOsTimelineData {
  buckets: AgenticOsTimelineBucket[];
  totalSessions: number;
  totalTurns: number;
  /** Stable identity for memoization at render-time. */
  signature: string;
}

interface AgenticOsTimelineProjectionCache {
  signature: string;
  timeline: AgenticOsTimelineData;
  version: number;
}

interface TaskExecutionProjectionCache {
  itemsRef: FlowSubagentExecutionProjection['items'] | null;
  items: FlowSubagentExecutionProjection['items'];
  version: number;
}

const sessionProjectionCaches = new Map<string, SessionProjectionCache>();
const taskExecutionProjectionCaches = new Map<string, TaskExecutionProjectionCache>();
const emptyVirtualItems: VirtualItem[] = [];
const emptyTaskExecutionItems: FlowSubagentExecutionProjection['items'] = [];
const EMPTY_TIMELINE: AgenticOsTimelineData = {
  buckets: [],
  totalSessions: 0,
  totalTurns: 0,
  signature: 'empty',
};
let agenticOsTimelineCache: AgenticOsTimelineProjectionCache = {
  signature: '',
  timeline: EMPTY_TIMELINE,
  version: 0,
};

/**
 * Strict filter: only Agentic OS home sessions.
 *
 * We intentionally do NOT include other agentic_os-scoped sessions such as
 * LiveAppStudio so the timeline reflects only the Agentic OS conversation
 * lineage.
 */
function isAgenticOsSession(session: Session): boolean {
  if (session.parentSessionId) return false;
  return isSystemAgenticOsSession(session.descriptor);
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
): { id: AgenticOsTimelineBucketId; kind: AgenticOsTimelineBucket['kind']; monthKey: string } {
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
  return { id: `earlier_${key}` as AgenticOsTimelineBucketId, kind: 'month', monthKey: key };
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

function buildAgenticOsTimelineSession(
  session: Session,
  activeSessionId: string | null
): AgenticOsTimelineSession {
  const renderableTurns = session.dialogTurns.filter(turn => !!turn.userMessage);
  const turns: AgenticOsTimelineTurn[] = renderableTurns.map((turn, index) => ({
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
    loadPhase: session.loadPhase,
    turns,
    raw: session,
  };
}

export function getAgenticOsTimelineSignature(
  state: FlowChatState,
  focusedSessionId: string | null = null
): string {
  const parts = [String(focusedSessionId ?? '')];
  for (const session of state.sessions.values()) {
    if (!isAgenticOsSession(session)) {
      continue;
    }
    parts.push([
      session.sessionId,
      session.title ?? '',
      session.titleStatus ?? '',
      session.status,
      session.lastActiveAt ?? 0,
      session.lastFinishedAt ?? 0,
      session.dialogTurns.length,
      session.loadPhase,
    ].join(':'));
  }
  return parts.join('|');
}

export function getAgenticOsTimelineProjection(
  state: FlowChatState,
  focusedSessionId: string | null = null
): AgenticOsTimelineData {
  const signature = getAgenticOsTimelineSignature(state, focusedSessionId);
  if (agenticOsTimelineCache.signature === signature) {
    return agenticOsTimelineCache.timeline;
  }

  const timeline = measureFlowChat('projection.agenticOsTimeline', () => {
    const agenticOsSessions: Session[] = [];
    for (const session of state.sessions.values()) {
      if (isAgenticOsSession(session)) {
        agenticOsSessions.push(session);
      }
    }

    if (agenticOsSessions.length === 0) {
      return EMPTY_TIMELINE;
    }

    agenticOsSessions.sort(compareSessionsForDisplay);

    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = startOfWeek(now).getTime();
    const monthStart = startOfMonth(now).getTime();

    const bucketMap = new Map<AgenticOsTimelineBucketId, AgenticOsTimelineBucket>();
    const bucketOrder: AgenticOsTimelineBucketId[] = [];

    let totalTurns = 0;

    for (const session of agenticOsSessions) {
      const entry = buildAgenticOsTimelineSession(session, focusedSessionId);
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

    const signatureParts: string[] = [String(focusedSessionId ?? '')];
    for (const bucket of buckets) {
      signatureParts.push(bucket.id);
      for (const s of bucket.sessions) {
        signatureParts.push(`${s.sessionId}:${s.turns.length}:${s.sortTimestamp}`);
      }
    }

    return {
      buckets,
      totalSessions: agenticOsSessions.length,
      totalTurns,
      signature: signatureParts.join('|'),
    };
  });

  agenticOsTimelineCache = {
    signature,
    timeline,
    version: agenticOsTimelineCache.version + 1,
  };
  return timeline;
}

function hasActiveStreamingNarrative(round: ModelRound): boolean {
  return round.items.some(item => {
    if (item.type === 'text') return deriveTextBlockState(item as any) === 'streaming';
    if (item.type === 'thinking') return deriveThinkingBlockState(item as any) === 'streaming';
    return false;
  });
}

function isExploreOnlyRound(round: ModelRound): boolean {
  if (!round.items || round.items.length === 0) return false;

  if (round.isStreaming && hasActiveStreamingNarrative(round)) {
    return false;
  }

  const hasCollapsibleTool = round.items.some(item =>
    item.type === 'tool' && isCollapsibleTool((item as FlowToolItem).toolName)
  );
  if (!hasCollapsibleTool) return false;

  const hasAnyTool = round.items.some(item => item.type === 'tool');
  if (!hasAnyTool) return false;

  return round.items.every(item => {
    if (item.type === 'tool') {
      return isCollapsibleTool((item as FlowToolItem).toolName);
    }
    return item.type === 'text' || item.type === 'thinking';
  });
}

function computeRoundStats(round: ModelRound): ExploreGroupStats {
  const stats = createEmptyExploreGroupStats();

  for (const item of round.items) {
    if (item.type === 'tool') {
      const toolName = (item as FlowToolItem).toolName;
      addToolToExploreStats(stats, toolName);
    } else if (item.type === 'thinking') {
      stats.thinkingCount++;
    }
  }

  return finalizeExploreGroupStats(stats);
}

function createEmptyExploreGroupStats(): ExploreGroupStats {
  return {
    readCount: 0,
    searchCount: 0,
    fetchCount: 0,
    commandCount: 0,
    otherCount: 0,
    thinkingCount: 0,
    totalToolCount: 0,
    toolCounts: [],
  };
}

function addToolToExploreStats(stats: ExploreGroupStats, toolName: string): void {
  const category = getExploreToolCategory(toolName);
  stats.totalToolCount++;

  switch (category) {
    case 'read':
      stats.readCount++;
      break;
    case 'search':
      stats.searchCount++;
      break;
    case 'fetch':
      stats.fetchCount++;
      break;
    case 'command':
      stats.commandCount++;
      break;
    case 'other':
      stats.otherCount++;
      break;
  }

  const existing = stats.toolCounts.find(item => item.category === category);
  if (existing) {
    existing.count++;
    existing.toolNames[toolName] = (existing.toolNames[toolName] ?? 0) + 1;
    return;
  }

  stats.toolCounts.push({
    category,
    count: 1,
    toolNames: { [toolName]: 1 },
  });
}

function mergeExploreGroupStats(target: ExploreGroupStats, source: ExploreGroupStats): void {
  target.readCount += source.readCount;
  target.searchCount += source.searchCount;
  target.fetchCount += source.fetchCount;
  target.commandCount += source.commandCount;
  target.otherCount += source.otherCount;
  target.thinkingCount += source.thinkingCount;
  target.totalToolCount += source.totalToolCount;

  for (const sourceEntry of source.toolCounts) {
    const targetEntry = target.toolCounts.find(item => item.category === sourceEntry.category);
    if (targetEntry) {
      targetEntry.count += sourceEntry.count;
      for (const [toolName, count] of Object.entries(sourceEntry.toolNames)) {
        targetEntry.toolNames[toolName] = (targetEntry.toolNames[toolName] ?? 0) + count;
      }
      continue;
    }

    target.toolCounts.push({
      category: sourceEntry.category,
      count: sourceEntry.count,
      toolNames: { ...sourceEntry.toolNames },
    });
  }
}

function finalizeExploreGroupStats(stats: ExploreGroupStats): ExploreGroupStats {
  stats.toolCounts.sort((left, right) => (
    EXPLORE_TOOL_CATEGORY_ORDER.indexOf(left.category) - EXPLORE_TOOL_CATEGORY_ORDER.indexOf(right.category)
  ));
  return stats;
}

function areExploreGroupStatsEqual(left: ExploreGroupStats, right: ExploreGroupStats): boolean {
  if (
    left.thinkingCount !== right.thinkingCount ||
    left.totalToolCount !== right.totalToolCount ||
    left.toolCounts.length !== right.toolCounts.length
  ) {
    return false;
  }

  for (let index = 0; index < left.toolCounts.length; index += 1) {
    const leftEntry = left.toolCounts[index];
    const rightEntry = right.toolCounts[index];
    if (leftEntry.category !== rightEntry.category || leftEntry.count !== rightEntry.count) {
      return false;
    }
  }

  return true;
}

function getVirtualItemCacheKey(item: VirtualItem): string {
  switch (item.type) {
    case 'user-message':
      return `user-message:${item.turnId}`;
    case 'follow-up-user-message':
      return `follow-up-user-message:${item.turnId}:${item.data.id}`;
    case 'model-round':
      return `model-round:${item.data.id}`;
    case 'explore-group':
      return `explore-group:${item.data.groupId}`;
    case 'image-analyzing':
      return `image-analyzing:${item.turnId}`;
  }
}

function areFlowItemArraysReferentiallyEqual(left: FlowItem[], right: FlowItem[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function areRoundArraysReferentiallyEqual(left: ModelRound[], right: ModelRound[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function canReuseVirtualItem(previous: VirtualItem | undefined, next: VirtualItem): previous is VirtualItem {
  if (!previous || previous.type !== next.type || previous.turnId !== next.turnId) {
    return false;
  }

  switch (next.type) {
    case 'user-message': {
      const previousUserMessage = previous as Extract<VirtualItem, { type: 'user-message' }>;
      const nextUserMessage = next as Extract<VirtualItem, { type: 'user-message' }>;
      return (
        previousUserMessage.data === nextUserMessage.data &&
        previousUserMessage.turnIndex === nextUserMessage.turnIndex &&
        previousUserMessage.turnStatus === nextUserMessage.turnStatus &&
        previousUserMessage.turnStartMs === nextUserMessage.turnStartMs &&
        previousUserMessage.sessionStartMs === nextUserMessage.sessionStartMs
      );
    }
    case 'follow-up-user-message': {
      const previousUserMessage = previous as Extract<VirtualItem, { type: 'follow-up-user-message' }>;
      const nextUserMessage = next as Extract<VirtualItem, { type: 'follow-up-user-message' }>;
      return (
        previousUserMessage.data === nextUserMessage.data &&
        previousUserMessage.turnIndex === nextUserMessage.turnIndex &&
        previousUserMessage.turnStatus === nextUserMessage.turnStatus &&
        previousUserMessage.turnStartMs === nextUserMessage.turnStartMs &&
        previousUserMessage.sessionStartMs === nextUserMessage.sessionStartMs
      );
    }
    case 'model-round': {
      const previousModelRound = previous as Extract<VirtualItem, { type: 'model-round' }>;
      return previousModelRound.data === next.data && previousModelRound.isLastRound === next.isLastRound;
    }
    case 'image-analyzing':
      return true;
    case 'explore-group': {
      const previousExploreGroup = previous as Extract<VirtualItem, { type: 'explore-group' }>;
      return (
        previousExploreGroup.data.groupId === next.data.groupId &&
        previousExploreGroup.data.isGroupStreaming === next.data.isGroupStreaming &&
        previousExploreGroup.data.isLastGroupInTurn === next.data.isLastGroupInTurn &&
        areExploreGroupStatsEqual(previousExploreGroup.data.stats, next.data.stats) &&
        areRoundArraysReferentiallyEqual(previousExploreGroup.data.rounds, next.data.rounds) &&
        areFlowItemArraysReferentiallyEqual(previousExploreGroup.data.allItems, next.data.allItems)
      );
    }
  }
}

function reuseStableVirtualItems(items: VirtualItem[], cache: SessionProjectionCache): VirtualItem[] {
  const nextCache = new Map<string, VirtualItem>();
  const stabilizedItems = items.map(item => {
    const cacheKey = getVirtualItemCacheKey(item);
    const previous = cache.virtualItemsByKey.get(cacheKey);
    const stabilized = canReuseVirtualItem(previous, item) ? previous : item;
    nextCache.set(cacheKey, stabilized);
    return stabilized;
  });
  cache.virtualItemsByKey = nextCache;
  return stabilizedItems;
}

function buildVirtualItemsForTurn(
  turn: DialogTurn,
  context: {
    turnIndex: number;
    sessionStartMs: number;
  },
): VirtualItem[] {
  const items: VirtualItem[] = [];

  if (turn.userMessage) {
    items.push({
      type: 'user-message',
      data: turn.userMessage,
      turnId: turn.id,
      turnIndex: context.turnIndex,
      turnStatus: turn.status,
      turnStartMs: turn.startTime ?? turn.userMessage.timestamp ?? 0,
      sessionStartMs: context.sessionStartMs,
    });
  }

  if (turn.status === 'image_analyzing' && turn.modelRounds.length === 0) {
    items.push({ type: 'image-analyzing', turnId: turn.id });
    return items;
  }

  const nonEmptyRounds = turn.modelRounds.filter(round => round.items && round.items.length > 0);

  interface TempExploreGroup {
    rounds: ModelRound[];
    allItems: FlowItem[];
    stats: ExploreGroupStats;
    startIndex: number;
    endIndex: number;
  }

  const tempGroups: TempExploreGroup[] = [];
  let currentGroup: TempExploreGroup | null = null;

  nonEmptyRounds.forEach((round, index) => {
    const exploreOnly = isExploreOnlyRound(round);
    if (exploreOnly) {
      const stats = computeRoundStats(round);
      if (currentGroup) {
        currentGroup.rounds.push(round);
        currentGroup.allItems.push(...round.items);
        mergeExploreGroupStats(currentGroup.stats, stats);
        currentGroup.endIndex = index;
      } else {
        currentGroup = {
          rounds: [round],
          allItems: [...round.items],
          stats,
          startIndex: index,
          endIndex: index,
        };
      }
    } else if (currentGroup) {
      tempGroups.push(currentGroup);
      currentGroup = null;
    }
  });
  if (currentGroup) {
    tempGroups.push(currentGroup);
  }

  const followUpMessages = [...(turn.followUpUserMessages ?? [])].sort((left, right) => (
    left.timestamp - right.timestamp
  ));
  let followUpIndex = 0;
  const pushFollowUpsBefore = (timestamp: number | null) => {
    while (followUpIndex < followUpMessages.length) {
      const message = followUpMessages[followUpIndex];
      if (timestamp !== null && message.timestamp > timestamp) {
        break;
      }

      items.push({
        type: 'follow-up-user-message',
        data: message,
        turnId: turn.id,
        turnIndex: context.turnIndex,
        turnStatus: turn.status,
        turnStartMs: message.timestamp,
        sessionStartMs: context.sessionStartMs,
      });
      followUpIndex += 1;
    }
  };

  let roundIndex = 0;
  let groupIndex = 0;

  while (roundIndex < nonEmptyRounds.length) {
    const round = nonEmptyRounds[roundIndex];
    const group = tempGroups[groupIndex];

    if (group && group.startIndex === roundIndex) {
      pushFollowUpsBefore(group.rounds[0]?.startTime ?? null);
      const isLastGroup = groupIndex === tempGroups.length - 1;
      const isGroupStreaming = group.rounds.some(r => r.isStreaming);

      items.push({
        type: 'explore-group',
        turnId: turn.id,
        data: {
          groupId: group.rounds.map(r => r.id).join('-'),
          rounds: group.rounds,
          allItems: group.allItems,
          stats: finalizeExploreGroupStats(group.stats),
          isGroupStreaming,
          isLastGroupInTurn: isLastGroup,
        },
      });

      roundIndex = group.endIndex + 1;
      groupIndex++;
    } else {
      pushFollowUpsBefore(round.startTime);
      const isLastRound = roundIndex === nonEmptyRounds.length - 1;
      items.push({
        type: 'model-round',
        data: round,
        turnId: turn.id,
        isLastRound,
      });
      roundIndex++;
    }
  }
  pushFollowUpsBefore(null);

  return items;
}

export function sessionToVirtualItems(session: Session | null): VirtualItem[] {
  if (!session) {
    return emptyVirtualItems;
  }

  let cache = sessionProjectionCaches.get(session.sessionId);
  if (!cache) {
    cache = {
      dialogTurnsRef: null,
      virtualItems: [],
      virtualItemsByKey: new Map(),
      turnItemsById: new Map(),
      version: 0,
    };
    sessionProjectionCaches.set(session.sessionId, cache);
  }

  if (cache.dialogTurnsRef === session.dialogTurns) {
    return cache.virtualItems;
  }

  const items: VirtualItem[] = [];
  const nextTurnItemsById = new Map<string, { turn: DialogTurn; items: VirtualItem[] }>();
  measureFlowChat('projection.sessionToVirtualItems', () => {
    session.dialogTurns.forEach((turn, turnIndex) => {
      const cachedTurnItems = cache.turnItemsById.get(turn.id);
      const turnItems = cachedTurnItems?.turn === turn
        ? cachedTurnItems.items
        : buildVirtualItemsForTurn(turn, {
            turnIndex,
            sessionStartMs: session.createdAt ?? turn.startTime ?? turn.userMessage?.timestamp ?? 0,
          });
      nextTurnItemsById.set(turn.id, { turn, items: turnItems });
      items.push(...turnItems);
    });
  });
  cache.turnItemsById = nextTurnItemsById;

  cache.dialogTurnsRef = session.dialogTurns;
  cache.virtualItems = reuseStableVirtualItems(items, cache);
  cache.version += 1;
  return cache.virtualItems;
}

export function getSessionVirtualItems(session: Session | null): VirtualItem[] {
  return sessionToVirtualItems(session);
}

export function getTaskExecutionVirtualItems(
  projection: FlowSubagentExecutionProjection | null | undefined
): FlowSubagentExecutionProjection['items'] {
  if (!projection) {
    return emptyTaskExecutionItems;
  }

  let cache = taskExecutionProjectionCaches.get(projection.id);
  if (!cache) {
    cache = {
      itemsRef: null,
      items: [],
      version: 0,
    };
    taskExecutionProjectionCaches.set(projection.id, cache);
  }

  if (cache.itemsRef === projection.items) {
    return cache.items;
  }

  cache.itemsRef = projection.items;
  cache.items = projection.items;
  cache.version += 1;
  return cache.items;
}

export function getProjectionVersion(surfaceId: string | null | undefined): number {
  if (!surfaceId) {
    return 0;
  }

  if (surfaceId === 'agenticOsTimeline') {
    return agenticOsTimelineCache.version;
  }

  if (surfaceId.startsWith('taskExecution:')) {
    return taskExecutionProjectionCaches.get(surfaceId.slice('taskExecution:'.length))?.version ?? 0;
  }

  return sessionProjectionCaches.get(surfaceId)?.version ?? 0;
}

export function clearProjectionScheduler(): void {
  sessionProjectionCaches.clear();
  taskExecutionProjectionCaches.clear();
  agenticOsTimelineCache = {
    signature: '',
    timeline: EMPTY_TIMELINE,
    version: 0,
  };
}
