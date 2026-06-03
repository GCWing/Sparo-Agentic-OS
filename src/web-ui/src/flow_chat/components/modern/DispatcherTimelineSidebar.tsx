/**
 * DispatcherTimelineSidebar - vertical timeline + anchored main area.
 *
 * Replaces FlowChatTurnListSidebar in the Agentic OS (Dispatcher) scene.
 * Renders all dispatcher sessions as a single continuous timeline grouped
 * by date buckets ("today", "yesterday", "this week", "this month",
 * earlier months). Sessions are nodes on a vertical rail; each session's
 * turns appear as sub-nodes when expanded.
 *
 * Selecting a turn from a non-active session triggers a silent session
 * switch in the parent container; the parent then anchors the message area
 * to the chosen turn (see ModernFlowChatContainer).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronDown, ChevronUp, Plus, Search } from 'lucide-react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Button, IconButton, Input, Tooltip, DropdownMenu } from '@/design-system';
import type { DropdownMenuEntry } from '@/design-system';
import {
  timestampMatchesTimePreset,
  type TurnListTimePreset,
  type TurnListCustomTimeRange,
} from './turnListTimeFilter';
import { TurnListCustomRangeDialog } from './TurnListCustomRangeDialog';
import { createLogger } from '@/shared/utils/logger';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type {
  DispatcherTimelineBucket,
  DispatcherTimelineData,
  DispatcherTimelineSession,
  DispatcherTimelineTurn,
} from '../../hooks/useDispatcherTimeline';
import './DispatcherTimelineSidebar.scss';

const log = createLogger('DispatcherTimelineSidebar');

const COLLAPSED_BUCKETS_STORAGE_KEY = 'sparo.dispatcherTimeline.collapsedBuckets';

type DispatcherTimelineRow =
  | {
      type: 'bucket';
      bucket: DispatcherTimelineBucket;
      collapsed: boolean;
      label: string;
    }
  | {
      type: 'session';
      session: DispatcherTimelineSession;
      timeLabel: string;
      isActive: boolean;
      isSearchHighlighted: boolean;
    }
  | {
      type: 'turn';
      sessionId: string;
      turn: DispatcherTimelineTurn;
      isActive: boolean;
      isSearchMatch: boolean;
    }
  | {
      type: 'empty-turn';
      sessionId: string;
    };

export interface DispatcherTimelineSidebarProps {
  open: boolean;
  data: DispatcherTimelineData;

  activeSessionId?: string;
  /** Currently visible (anchored) turn within the active session, if any. */
  activeTurnId?: string;

  /** Click a turn from any session - handler should silent-switch + scroll. */
  onSelectTurn: (sessionId: string, turnId: string) => void;
  /** Click a session header - handler should switch to that session. */
  onSelectSession: (sessionId: string) => void;
  /** Click "+" footer - start a new dispatcher session. */
  onCreateSession: () => void;

  // Search (turn-title and session-title fuzzy match across all dispatcher sessions).
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClose?: () => void;
  searchFocusRequest?: number;
  /** Turn ids matched by the active query - get a glow ring. */
  searchMatchedTurnIds?: ReadonlySet<string>;
  /** Session ids whose title matched the query - get a soft highlight. */
  searchMatchedSessionIds?: ReadonlySet<string>;
}

function readJsonStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter(v => typeof v === 'string'));
  } catch {
    /* ignore */
  }
  return new Set();
}

function writeJsonStringSet(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {
    /* ignore */
  }
}

function formatSessionDateTime(timestamp: number, locale: string): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const includeYear = d.getFullYear() !== now.getFullYear();
  try {
    const options: Intl.DateTimeFormatOptions = {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    if (includeYear) {
      options.year = 'numeric';
    }
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    const y = includeYear ? `${d.getFullYear()}/` : '';
    return `${y}${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function formatMonthHeader(monthKey: string, locale: string): string {
  if (!monthKey) return '';
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
      new Date(year, month - 1, 1)
    );
  } catch {
    return monthKey;
  }
}

interface BucketHeaderProps {
  bucket: DispatcherTimelineBucket;
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  sessionCount: number;
}

const BucketHeader: React.FC<BucketHeaderProps> = ({ collapsed, onToggle, label, sessionCount }) => (
  <Button
    variant="ghost"
    size="small"
    className={`dispatcher-timeline__bucket-header${collapsed ? ' is-collapsed' : ''}`}
    onClick={onToggle}
    aria-expanded={!collapsed}
  >
    <ChevronDown
      size={11}
      className="dispatcher-timeline__bucket-chevron"
      aria-hidden
    />
    <span className="dispatcher-timeline__bucket-label">{label}</span>
    <span className="dispatcher-timeline__bucket-count">{sessionCount}</span>
  </Button>
);

interface SessionRowProps {
  session: DispatcherTimelineSession;
  isActive: boolean;
  isSearchHighlighted: boolean;
  timeLabel: string;
  turnCountLabel: string;
  onSelect: () => void;
}

const SessionRow: React.FC<SessionRowProps> = ({
  session,
  isActive,
  isSearchHighlighted,
  timeLabel,
  turnCountLabel,
  onSelect,
}) => (
  <button
    type="button"
    className={[
      'dispatcher-timeline__session',
      isActive ? 'is-active' : '',
      session.isHistorical ? 'is-historical' : '',
      isSearchHighlighted ? 'is-search-match' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onSelect}
    title={session.title}
  >
    <span className="dispatcher-timeline__session-node" aria-hidden>
      <span className="dispatcher-timeline__session-dot" />
    </span>
    <span className="dispatcher-timeline__session-body">
      <span className="dispatcher-timeline__session-time">{timeLabel}</span>
      <span className="dispatcher-timeline__session-title">{session.title}</span>
      <span className="dispatcher-timeline__session-meta">{turnCountLabel}</span>
    </span>
  </button>
);

interface TurnRowProps {
  turn: DispatcherTimelineTurn;
  isActive: boolean;
  isSearchMatch: boolean;
  onSelect: () => void;
}

const TurnRow: React.FC<TurnRowProps> = ({ turn, isActive, isSearchMatch, onSelect }) => (
  <button
    type="button"
    className={[
      'dispatcher-timeline__turn',
      isActive ? 'is-active' : '',
      isSearchMatch ? 'is-search-match' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onSelect}
    title={turn.title || `Turn ${turn.turnIndex}`}
  >
    <span className="dispatcher-timeline__turn-index">#{turn.turnIndex}</span>
    <span className="dispatcher-timeline__turn-title">{turn.title || 'Untitled'}</span>
  </button>
);

export const DispatcherTimelineSidebar = React.forwardRef<HTMLElement, DispatcherTimelineSidebarProps>(
  function DispatcherTimelineSidebar(
    {
      open,
      data,
      activeSessionId,
      activeTurnId,
      onSelectTurn,
      onSelectSession,
      onCreateSession,
      searchQuery = '',
      onSearchChange,
      searchMatchCount = 0,
      searchCurrentMatch = 0,
      onSearchNext,
      onSearchPrev,
      onSearchClose,
      searchFocusRequest = 0,
      searchMatchedTurnIds,
      searchMatchedSessionIds,
    },
    ref
  ) {
    const { t, i18n } = useTranslation('flow-chat');
    const locale = i18n.language || 'en-US';
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const timeFilterAnchorRef = useRef<HTMLButtonElement | null>(null);
    const activeNodeRef = useRef<HTMLDivElement | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const rowHover = useMovingHoverHighlight<HTMLDivElement>();
    const [timeMenuOpen, setTimeMenuOpen] = useState(false);
    const [timePreset, setTimePreset] = useState<TurnListTimePreset>('all');
    const [customTimeRange, setCustomTimeRange] = useState<TurnListCustomTimeRange | null>(null);
    const [customRangeDialogOpen, setCustomRangeDialogOpen] = useState(false);

    const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(() =>
      readJsonStringSet(COLLAPSED_BUCKETS_STORAGE_KEY)
    );

    const toggleBucket = useCallback((bucketId: string) => {
      setCollapsedBuckets(prev => {
        const next = new Set(prev);
        if (next.has(bucketId)) next.delete(bucketId);
        else next.add(bucketId);
        writeJsonStringSet(COLLAPSED_BUCKETS_STORAGE_KEY, next);
        return next;
      });
    }, []);

    // Focus the search input on Ctrl+F (parent increments searchFocusRequest).
    const prevFocusRequestRef = useRef(0);
    useEffect(() => {
      if (!open) return;
      if (searchFocusRequest > 0 && searchFocusRequest !== prevFocusRequestRef.current) {
        prevFocusRequestRef.current = searchFocusRequest;
        const frameId = requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return () => cancelAnimationFrame(frameId);
      }
      return undefined;
    }, [open, searchFocusRequest]);

    const activeRowIndexRef = useRef<number | null>(null);

    // Auto-scroll the active turn / active session into view.
    useEffect(() => {
      if (!open) return;
      const frameId = requestAnimationFrame(() => {
        if (typeof activeRowIndexRef.current === 'number') {
          virtuosoRef.current?.scrollToIndex({
            index: activeRowIndexRef.current,
            align: 'center',
            behavior: 'auto',
          });
        } else {
          activeNodeRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
      });
      return () => cancelAnimationFrame(frameId);
    }, [open, activeSessionId, activeTurnId, data.signature, timePreset, customTimeRange]);

    const filteredBuckets = useMemo(() => {
      if (timePreset === 'all') return data.buckets;
      return data.buckets
        .map(bucket => ({
          ...bucket,
          sessions: bucket.sessions.filter(s =>
            timestampMatchesTimePreset(s.sortTimestamp, timePreset, customTimeRange)
          ),
        }))
        .filter(b => b.sessions.length > 0);
    }, [data.buckets, timePreset, customTimeRange]);

    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
          onSearchClose?.();
        } else if (e.key === 'Enter') {
          if (e.shiftKey) onSearchPrev?.();
          else onSearchNext?.();
          e.preventDefault();
        }
      },
      [onSearchClose, onSearchNext, onSearchPrev]
    );

    const hasNoResults = searchQuery.trim().length > 0 && searchMatchCount === 0;

    const bucketLabel = useCallback(
      (bucket: DispatcherTimelineBucket): string => {
        switch (bucket.kind) {
          case 'today':
            return t('dispatcherTimeline.bucket.today', { defaultValue: 'Today' });
          case 'yesterday':
            return t('dispatcherTimeline.bucket.yesterday', { defaultValue: 'Yesterday' });
          case 'this_week':
            return t('dispatcherTimeline.bucket.thisWeek', { defaultValue: 'Earlier this week' });
          case 'this_month':
            return t('dispatcherTimeline.bucket.thisMonth', { defaultValue: 'Earlier this month' });
          case 'month':
          default:
            return formatMonthHeader(bucket.monthKey, locale);
        }
      },
      [t, locale]
    );

    const turnCountLabel = useCallback(
      (count: number): string =>
        t('dispatcherTimeline.turnCount', {
          count,
          defaultValue: count === 1 ? '1 turn' : `${count} turns`,
        }),
      [t]
    );

    const timeFilterTooltip = t('turnList.timeFilterTooltip', {
      defaultValue: 'Filter by time',
    });

    const timeFilterMenuItems = useMemo<DropdownMenuEntry[]>(
      () => [
        {
          type: 'item',
          id: 'all',
          label: t('turnList.timeFilterAll', { defaultValue: 'All time' }),
          checked: timePreset === 'all',
          onClick: () => {
            setTimePreset('all');
            setCustomTimeRange(null);
            setTimeMenuOpen(false);
          },
        },
        {
          type: 'item',
          id: 'today',
          label: t('turnList.timeFilterToday', { defaultValue: 'Today' }),
          checked: timePreset === 'today',
          onClick: () => {
            setTimePreset('today');
            setCustomTimeRange(null);
            setTimeMenuOpen(false);
          },
        },
        {
          type: 'item',
          id: 'last7',
          label: t('turnList.timeFilterLast7', { defaultValue: 'Last 7 days' }),
          checked: timePreset === 'last7',
          onClick: () => {
            setTimePreset('last7');
            setCustomTimeRange(null);
            setTimeMenuOpen(false);
          },
        },
        {
          type: 'item',
          id: 'this_month',
          label: t('turnList.timeFilterThisMonth', { defaultValue: 'This month' }),
          checked: timePreset === 'this_month',
          onClick: () => {
            setTimePreset('this_month');
            setCustomTimeRange(null);
            setTimeMenuOpen(false);
          },
        },
        { type: 'separator', id: 'sep-custom' },
        {
          type: 'item',
          id: 'custom',
          label: t('turnList.timeFilterCustomRange', {
            defaultValue: 'Custom range',
          }),
          checked: timePreset === 'custom',
          onClick: () => {
            setCustomRangeDialogOpen(true);
          },
        },
      ],
      [t, timePreset],
    );
    const newSessionTooltip = t('dispatcherTimeline.newSession', {
      defaultValue: 'Start a new chapter',
    });

    const timelineRows = useMemo<DispatcherTimelineRow[]>(() => {
      const rows: DispatcherTimelineRow[] = [];
      for (const bucket of filteredBuckets) {
        const collapsed = collapsedBuckets.has(bucket.id);
        rows.push({
          type: 'bucket',
          bucket,
          collapsed,
          label: bucketLabel(bucket),
        });

        if (collapsed) {
          continue;
        }

        for (const session of bucket.sessions) {
          const isActive = session.sessionId === activeSessionId;
          rows.push({
            type: 'session',
            session,
            timeLabel: formatSessionDateTime(session.sortTimestamp, locale),
            isActive,
            isSearchHighlighted: searchMatchedSessionIds?.has(session.sessionId) ?? false,
          });

          if (!isActive) {
            continue;
          }

          if (session.turns.length === 0) {
            rows.push({
              type: 'empty-turn',
              sessionId: session.sessionId,
            });
            continue;
          }

          for (const turn of session.turns) {
            rows.push({
              type: 'turn',
              sessionId: session.sessionId,
              turn,
              isActive: turn.turnId === activeTurnId,
              isSearchMatch: searchMatchedTurnIds?.has(turn.turnId) ?? false,
            });
          }
        }
      }
      return rows;
    }, [
      activeSessionId,
      activeTurnId,
      bucketLabel,
      collapsedBuckets,
      filteredBuckets,
      locale,
      searchMatchedSessionIds,
      searchMatchedTurnIds,
    ]);

    activeRowIndexRef.current = useMemo(() => {
      const index = timelineRows.findIndex(row => {
        if (row.type === 'turn') {
          return row.isActive;
        }
        if (row.type === 'session') {
          return row.isActive && !activeTurnId;
        }
        return false;
      });
      return index === -1 ? null : index;
    }, [activeTurnId, timelineRows]);

    const renderTimelineRow = useCallback(
      (_index: number, row: DispatcherTimelineRow) => {
        if (row.type === 'bucket') {
          return (
            <div className="dispatcher-timeline__virtual-row dispatcher-timeline__virtual-row--bucket">
              <BucketHeader
                bucket={row.bucket}
                collapsed={row.collapsed}
                onToggle={() => toggleBucket(row.bucket.id)}
                label={row.label}
                sessionCount={row.bucket.sessions.length}
              />
            </div>
          );
        }

        if (row.type === 'session') {
          const sessionAttachActiveRef = row.isActive && !activeTurnId;
          return (
            <div
              className="dispatcher-timeline__virtual-row dispatcher-timeline__session-block"
              ref={
                sessionAttachActiveRef
                  ? (node => {
                      activeNodeRef.current = node;
                    }) as React.RefCallback<HTMLDivElement>
                  : undefined
              }
            >
              <SessionRow
                session={row.session}
                isActive={row.isActive}
                isSearchHighlighted={row.isSearchHighlighted}
                timeLabel={row.timeLabel}
                turnCountLabel={turnCountLabel(row.session.turns.length)}
                onSelect={() => {
                  log.debug('Select session from timeline', {
                    sessionId: row.session.sessionId,
                  });
                  onSelectSession(row.session.sessionId);
                }}
              />
            </div>
          );
        }

        if (row.type === 'empty-turn') {
          return (
            <div className="dispatcher-timeline__virtual-row dispatcher-timeline__turns dispatcher-timeline__turns--virtual">
              <div className="dispatcher-timeline__turn is-empty">
                <span className="dispatcher-timeline__turn-title">
                  {t('dispatcherTimeline.sessionEmpty', {
                    defaultValue: 'No turns yet',
                  })}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div
            className="dispatcher-timeline__virtual-row dispatcher-timeline__turns dispatcher-timeline__turns--virtual"
            ref={
              row.isActive
                ? (node => {
                    activeNodeRef.current = node;
                  }) as React.RefCallback<HTMLDivElement>
                : undefined
            }
          >
            <TurnRow
              turn={row.turn}
              isActive={row.isActive}
              isSearchMatch={row.isSearchMatch}
              onSelect={() => onSelectTurn(row.sessionId, row.turn.turnId)}
            />
          </div>
        );
      },
      [activeTurnId, onSelectSession, onSelectTurn, t, toggleBucket, turnCountLabel]
    );

    const isEmpty = data.buckets.length === 0;
    const showEmptyTimeFilter = !isEmpty && filteredBuckets.length === 0 && timePreset !== 'all';

    if (!open) {
      return (
        <aside
          id="flowchat-turn-list-sidebar"
          ref={ref}
          className="dispatcher-timeline"
          aria-hidden="true"
          data-testid="dispatcher-timeline-sidebar"
        />
      );
    }

    return (
      <aside
        id="flowchat-turn-list-sidebar"
        ref={ref}
        className="dispatcher-timeline dispatcher-timeline--open"
        aria-hidden={false}
        data-testid="dispatcher-timeline-sidebar"
      >
        <div className="dispatcher-timeline__inner">
          <div className="dispatcher-timeline__header">
            <div className="dispatcher-timeline__heading">
                <div className="dispatcher-timeline__search" role="search">
                  <Input
                    ref={searchInputRef}
                    className="dispatcher-timeline__search-field"
                    variant="filled"
                    inputSize="small"
                    prefix={
                      <Search
                        size={12}
                        className="dispatcher-timeline__search-prefix-icon"
                        aria-hidden="true"
                      />
                    }
                    suffix={
                      <span className="dispatcher-timeline__search-inline-controls">
                        <span className="dispatcher-timeline__search-count" aria-live="polite">
                          {searchQuery.trim()
                            ? hasNoResults
                              ? t('flowChatHeader.searchNoResults', { defaultValue: 'No results' })
                              : t('flowChatHeader.searchResult', {
                                  current: searchCurrentMatch,
                                  total: searchMatchCount,
                                  defaultValue: `${searchCurrentMatch} / ${searchMatchCount}`,
                                })
                            : null}
                        </span>
                        <span className="dispatcher-timeline__search-nav">
                          <IconButton
                            className="dispatcher-timeline__search-nav-control"
                            onClick={onSearchPrev}
                            disabled={searchMatchCount === 0}
                            aria-label={t('flowChatHeader.searchPrevious', { defaultValue: 'Previous match' })}
                            size="xs"
                            variant="ghost"
                          >
                            <ChevronUp size={10} />
                          </IconButton>
                          <IconButton
                            className="dispatcher-timeline__search-nav-control"
                            onClick={onSearchNext}
                            disabled={searchMatchCount === 0}
                            aria-label={t('flowChatHeader.searchNext', { defaultValue: 'Next match' })}
                            size="xs"
                            variant="ghost"
                          >
                            <ChevronDown size={10} />
                          </IconButton>
                        </span>
                      </span>
                    }
                    type="text"
                    value={searchQuery}
                    onChange={e => onSearchChange?.(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t('dispatcherTimeline.searchPlaceholder', {
                      defaultValue: 'Search across sessions',
                    })}
                    aria-label={t('dispatcherTimeline.searchPlaceholder', {
                      defaultValue: 'Search across sessions',
                    })}
                    error={hasNoResults}
                  />
                <IconButton
                  ref={timeFilterAnchorRef}
                  variant="ghost"
                  size="xs"
                  onClick={() => setTimeMenuOpen(v => !v)}
                  tooltip={timeFilterTooltip}
                  aria-label={timeFilterTooltip}
                  aria-expanded={timeMenuOpen}
                  aria-haspopup="menu"
                  className={timePreset !== 'all' ? 'dispatcher-timeline__time-filter--active' : undefined}
                >
                  <CalendarClock size={14} />
                </IconButton>
                <DropdownMenu
                  open={timeMenuOpen}
                  anchorRef={timeFilterAnchorRef}
                  items={timeFilterMenuItems}
                  onClose={() => setTimeMenuOpen(false)}
                  align="right"
                  minWidth={200}
                />
              </div>
            </div>
          </div>

          <div
            ref={rowHover.surfaceRef}
            className="dispatcher-timeline__body dispatcher-timeline__body--motion"
            role="list"
            {...rowHover.getSurfaceHandlers('.dispatcher-timeline__session, .dispatcher-timeline__turn:not(.is-empty)')}
          >
            <div
              className={`dispatcher-timeline__hover-highlight ${rowHover.highlight.visible ? 'dispatcher-timeline__hover-highlight--visible' : ''}`}
              style={{
                '--dispatcher-timeline-hover-top': `${rowHover.highlight.top}px`,
                '--dispatcher-timeline-hover-left': `${rowHover.highlight.left}px`,
                '--dispatcher-timeline-hover-width': `${rowHover.highlight.width}px`,
                '--dispatcher-timeline-hover-height': `${rowHover.highlight.height}px`,
                '--dispatcher-timeline-hover-stretch-x': rowHover.highlight.stretchX,
                '--dispatcher-timeline-hover-stretch-y': rowHover.highlight.stretchY,
              } as React.CSSProperties}
              aria-hidden
            />
            {isEmpty ? (
              <div className="dispatcher-timeline__empty">
                {t('dispatcherTimeline.empty', {
                  defaultValue:
                    'No conversations yet. Send a message below to start the first chapter.',
                })}
              </div>
            ) : showEmptyTimeFilter ? (
              <div className="dispatcher-timeline__empty">
                {t('dispatcherTimeline.emptyTimeFilter', {
                  defaultValue: 'No sessions in this time range. Change the filter or pick All time.',
                })}
              </div>
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                className="dispatcher-timeline__virtual-list"
                data={timelineRows}
                increaseViewportBy={{ top: 160, bottom: 240 }}
                initialItemCount={Math.min(timelineRows.length, 24)}
                computeItemKey={(index, row) => {
                  if (row.type === 'bucket') return `bucket:${row.bucket.id}`;
                  if (row.type === 'session') return `session:${row.session.sessionId}`;
                  if (row.type === 'turn') return `turn:${row.sessionId}:${row.turn.turnId}`;
                  return `empty-turn:${row.sessionId}:${index}`;
                }}
                itemContent={renderTimelineRow}
              />
            )}
          </div>

          <div className="dispatcher-timeline__footer">
            <Tooltip content={newSessionTooltip} placement="top">
              <Button
                className="dispatcher-timeline__new-action"
                onClick={onCreateSession}
                aria-label={newSessionTooltip}
                size="small"
                variant="dashed"
              >
                <Plus size={13} strokeWidth={2.25} />
                <span>
                  {t('dispatcherTimeline.newSessionLabel', {
                    defaultValue: 'New chapter',
                  })}
                </span>
              </Button>
            </Tooltip>
          </div>
        </div>
        <TurnListCustomRangeDialog
          open={customRangeDialogOpen}
          onClose={() => setCustomRangeDialogOpen(false)}
          initialRange={timePreset === 'custom' ? customTimeRange : null}
          onApply={range => {
            setCustomTimeRange(range);
            setTimePreset('custom');
          }}
        />
      </aside>
    );
  }
);

DispatcherTimelineSidebar.displayName = 'DispatcherTimelineSidebar';
