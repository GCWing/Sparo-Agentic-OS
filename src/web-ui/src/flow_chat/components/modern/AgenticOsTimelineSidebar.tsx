/**
 * AgenticOsTimelineSidebar - vertical timeline + anchored main area.
 *
 * Replaces FlowChatTurnListSidebar in the Agentic OS scene.
 * Renders all Agentic OS sessions as a single continuous timeline grouped
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
  AgenticOsTimelineBucket,
  AgenticOsTimelineData,
  AgenticOsTimelineSession,
  AgenticOsTimelineTurn,
} from '../../hooks/useAgenticOsTimeline';
import './AgenticOsTimelineSidebar.scss';

const log = createLogger('AgenticOsTimelineSidebar');

const COLLAPSED_BUCKETS_STORAGE_KEY = 'sparo.agenticOsTimeline.collapsedBuckets';

type AgenticOsTimelineRow =
  | {
      type: 'bucket';
      bucket: AgenticOsTimelineBucket;
      collapsed: boolean;
      label: string;
    }
  | {
      type: 'session';
      session: AgenticOsTimelineSession;
      timeLabel: string;
      isActive: boolean;
      isSearchHighlighted: boolean;
    }
  | {
      type: 'turn';
      sessionId: string;
      turn: AgenticOsTimelineTurn;
      isActive: boolean;
      isSearchMatch: boolean;
    }
  | {
      type: 'empty-turn';
      sessionId: string;
    };

export interface AgenticOsTimelineSidebarProps {
  open: boolean;
  data: AgenticOsTimelineData;

  activeSessionId?: string;
  /** Currently visible (anchored) turn within the active session, if any. */
  activeTurnId?: string;

  /** Click a turn from any session - handler should silent-switch + scroll. */
  onSelectTurn: (sessionId: string, turnId: string) => void;
  /** Click a session header - handler should switch to that session. */
  onSelectSession: (sessionId: string) => void;
  /** Click "+" footer - start a new Agentic OS session. */
  onCreateSession: () => void;

  // Search (turn-title and session-title fuzzy match across all Agentic OS sessions).
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
  bucket: AgenticOsTimelineBucket;
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  sessionCount: number;
}

const BucketHeader: React.FC<BucketHeaderProps> = ({ collapsed, onToggle, label, sessionCount }) => (
  <Button
    variant="ghost"
    size="small"
    className={`agentic-os-timeline__bucket-header${collapsed ? ' is-collapsed' : ''}`}
    onClick={onToggle}
    aria-expanded={!collapsed}
  >
    <ChevronDown
      size={11}
      className="agentic-os-timeline__bucket-chevron"
      aria-hidden
    />
    <span className="agentic-os-timeline__bucket-label">{label}</span>
    <span className="agentic-os-timeline__bucket-count">{sessionCount}</span>
  </Button>
);

interface SessionRowProps {
  session: AgenticOsTimelineSession;
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
      'agentic-os-timeline__session',
      isActive ? 'is-active' : '',
      session.isHistorical ? 'is-historical' : '',
      isSearchHighlighted ? 'is-search-match' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onSelect}
    title={session.title}
  >
    <span className="agentic-os-timeline__session-node" aria-hidden>
      <span className="agentic-os-timeline__session-dot" />
    </span>
    <span className="agentic-os-timeline__session-body">
      <span className="agentic-os-timeline__session-time">{timeLabel}</span>
      <span className="agentic-os-timeline__session-title">{session.title}</span>
      <span className="agentic-os-timeline__session-meta">{turnCountLabel}</span>
    </span>
  </button>
);

interface TurnRowProps {
  turn: AgenticOsTimelineTurn;
  isActive: boolean;
  isSearchMatch: boolean;
  onSelect: () => void;
}

const TurnRow: React.FC<TurnRowProps> = ({ turn, isActive, isSearchMatch, onSelect }) => (
  <button
    type="button"
    className={[
      'agentic-os-timeline__turn',
      isActive ? 'is-active' : '',
      isSearchMatch ? 'is-search-match' : '',
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onSelect}
    title={turn.title || `Turn ${turn.turnIndex}`}
  >
    <span className="agentic-os-timeline__turn-index">#{turn.turnIndex}</span>
    <span className="agentic-os-timeline__turn-title">{turn.title || 'Untitled'}</span>
  </button>
);

export const AgenticOsTimelineSidebar = React.forwardRef<HTMLElement, AgenticOsTimelineSidebarProps>(
  function AgenticOsTimelineSidebar(
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
      (bucket: AgenticOsTimelineBucket): string => {
        switch (bucket.kind) {
          case 'today':
            return t('agenticOsTimeline.bucket.today', { defaultValue: 'Today' });
          case 'yesterday':
            return t('agenticOsTimeline.bucket.yesterday', { defaultValue: 'Yesterday' });
          case 'this_week':
            return t('agenticOsTimeline.bucket.thisWeek', { defaultValue: 'Earlier this week' });
          case 'this_month':
            return t('agenticOsTimeline.bucket.thisMonth', { defaultValue: 'Earlier this month' });
          case 'month':
          default:
            return formatMonthHeader(bucket.monthKey, locale);
        }
      },
      [t, locale]
    );

    const turnCountLabel = useCallback(
      (count: number): string =>
        t('agenticOsTimeline.turnCount', {
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
    const newSessionTooltip = t('agenticOsTimeline.newSession', {
      defaultValue: 'Start a new chapter',
    });

    const timelineRows = useMemo<AgenticOsTimelineRow[]>(() => {
      const rows: AgenticOsTimelineRow[] = [];
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
      (_index: number, row: AgenticOsTimelineRow) => {
        if (row.type === 'bucket') {
          return (
            <div className="agentic-os-timeline__virtual-row agentic-os-timeline__virtual-row--bucket">
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
              className="agentic-os-timeline__virtual-row agentic-os-timeline__session-block"
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
            <div className="agentic-os-timeline__virtual-row agentic-os-timeline__turns agentic-os-timeline__turns--virtual">
              <div className="agentic-os-timeline__turn is-empty">
                <span className="agentic-os-timeline__turn-title">
                  {t('agenticOsTimeline.sessionEmpty', {
                    defaultValue: 'No turns yet',
                  })}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div
            className="agentic-os-timeline__virtual-row agentic-os-timeline__turns agentic-os-timeline__turns--virtual"
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
          className="agentic-os-timeline"
          aria-hidden="true"
          data-testid="agentic-os-timeline-sidebar"
        />
      );
    }

    return (
      <aside
        id="flowchat-turn-list-sidebar"
        ref={ref}
        className="agentic-os-timeline agentic-os-timeline--open"
        aria-hidden={false}
        data-testid="agentic-os-timeline-sidebar"
      >
        <div className="agentic-os-timeline__inner">
          <div className="agentic-os-timeline__header">
            <div className="agentic-os-timeline__heading">
                <div className="agentic-os-timeline__search" role="search">
                  <Input
                    ref={searchInputRef}
                    className="agentic-os-timeline__search-field"
                    variant="filled"
                    inputSize="small"
                    prefix={
                      <Search
                        size={12}
                        className="agentic-os-timeline__search-prefix-icon"
                        aria-hidden="true"
                      />
                    }
                    suffix={
                      <span className="agentic-os-timeline__search-inline-controls">
                        <span className="agentic-os-timeline__search-count" aria-live="polite">
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
                        <span className="agentic-os-timeline__search-nav">
                          <IconButton
                            className="agentic-os-timeline__search-nav-control"
                            onClick={onSearchPrev}
                            disabled={searchMatchCount === 0}
                            aria-label={t('flowChatHeader.searchPrevious', { defaultValue: 'Previous match' })}
                            size="xs"
                            variant="ghost"
                          >
                            <ChevronUp size={10} />
                          </IconButton>
                          <IconButton
                            className="agentic-os-timeline__search-nav-control"
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
                    placeholder={t('agenticOsTimeline.searchPlaceholder', {
                      defaultValue: 'Search across sessions',
                    })}
                    aria-label={t('agenticOsTimeline.searchPlaceholder', {
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
                  className={timePreset !== 'all' ? 'agentic-os-timeline__time-filter--active' : undefined}
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
            className="agentic-os-timeline__body agentic-os-timeline__body--motion"
            role="list"
            {...rowHover.getSurfaceHandlers('.agentic-os-timeline__session, .agentic-os-timeline__turn:not(.is-empty)')}
          >
            <div
              className={`agentic-os-timeline__hover-highlight ${rowHover.highlight.visible ? 'agentic-os-timeline__hover-highlight--visible' : ''}`}
              style={{
                '--agentic-os-timeline-hover-top': `${rowHover.highlight.top}px`,
                '--agentic-os-timeline-hover-left': `${rowHover.highlight.left}px`,
                '--agentic-os-timeline-hover-width': `${rowHover.highlight.width}px`,
                '--agentic-os-timeline-hover-height': `${rowHover.highlight.height}px`,
                '--agentic-os-timeline-hover-stretch-x': rowHover.highlight.stretchX,
                '--agentic-os-timeline-hover-stretch-y': rowHover.highlight.stretchY,
              } as React.CSSProperties}
              aria-hidden
            />
            {isEmpty ? (
              <div className="agentic-os-timeline__empty">
                {t('agenticOsTimeline.empty', {
                  defaultValue:
                    'No conversations yet. Send a message below to start the first chapter.',
                })}
              </div>
            ) : showEmptyTimeFilter ? (
              <div className="agentic-os-timeline__empty">
                {t('agenticOsTimeline.emptyTimeFilter', {
                  defaultValue: 'No sessions in this time range. Change the filter or pick All time.',
                })}
              </div>
            ) : (
              <Virtuoso
                ref={virtuosoRef}
                className="agentic-os-timeline__virtual-list"
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

          <div className="agentic-os-timeline__footer">
            <Tooltip content={newSessionTooltip} placement="top">
              <Button
                className="agentic-os-timeline__new-action"
                onClick={onCreateSession}
                aria-label={newSessionTooltip}
                size="small"
                variant="dashed"
              >
                <Plus size={13} strokeWidth={2.25} />
                <span>
                  {t('agenticOsTimeline.newSessionLabel', {
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

AgenticOsTimelineSidebar.displayName = 'AgenticOsTimelineSidebar';
