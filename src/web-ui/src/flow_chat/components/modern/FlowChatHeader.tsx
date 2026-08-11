/**
 * FlowChat header — message search and turn list controls.
 *
 * The session title and the "return to Agentic OS" button have been moved to
 * UnifiedTopBar so the whole application shares a single top chrome.
 * Agentic OS session creation/reset lives in its timeline. Thinking display
 * is controlled from the Chat Input model selector across session types.
 * Session files badge stays on the left.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  List,
  Search,
  X,
} from 'lucide-react';
import {
  IconButton,
  Input,
  PanelRightClosedIcon,
  PanelRightOpenIcon,
  SPARO_ICON_OPTICAL_STROKE_WIDTH,
} from '@/design-system';
import { useTranslation } from 'react-i18next';
import {
  selectActiveAuxiliaryHostState,
  toggleActiveAuxiliarySurface,
  useAuxiliarySurfaceStore,
} from '@/app/auxiliary-surface';
import { SessionFilesBadge } from './SessionFilesBadge';
import { FlowChatSidecarActions } from './FlowChatSidecarActions';
import GoalHeaderControl from '../goal/GoalHeaderControl';
import type { FlowChatSidecarActionViewModel } from './useSessionSidecarActions';
import './FlowChatHeader.scss';

export interface FlowChatHeaderTurnSummary {
  turnId: string;
  turnIndex: number;
  title: string;
  /** User-turn start time (for time filtering in side panel). */
  startedAt?: number;
}

export interface FlowChatHeaderProps {
  /** Whether the header is visible. */
  visible: boolean;
  /** Session ID. */
  sessionId?: string;
  /** Workspace path for session-scoped goal state. */
  workspacePath?: string;
  /** Ordered turn summaries used by header navigation. */
  turns?: FlowChatHeaderTurnSummary[];
  /** Jump to a specific turn (used by turn list sidebar). */
  onJumpToTurn?: (turnId: string) => void;

  // ========== Search ==========
  /** Current search query string. */
  searchQuery?: string;
  /** Called when the user types in the search box. */
  onSearchChange?: (query: string) => void;
  /** Total number of search matches. */
  searchMatchCount?: number;
  /** 1-based index of the currently focused match (0 means no active match). */
  searchCurrentMatch?: number;
  /** Navigate to the next match. */
  onSearchNext?: () => void;
  /** Navigate to the previous match. */
  onSearchPrev?: () => void;
  /** Called when the user closes the search bar. */
  onSearchClose?: () => void;
  /** Increments each time the parent requests to open the search bar (e.g. Ctrl+F). */
  searchOpenRequest?: number;
  /** Whether to render the header-level message search control. */
  showSearchControl?: boolean;

  /** Timeline sidebar open state (controlled by parent). */
  timelineOpen?: boolean;
  /** Toggle or close the timeline sidebar. */
  onTimelineOpenChange?: (open: boolean) => void;
  /**
   * Force-enable the timeline toggle even when the current session has no
   * turns. Used by the Agentic OS timeline, which aggregates many sessions.
   */
  forceTimelineEnabled?: boolean;
  /** Override the toggle button tooltip (e.g. "Timeline" in Agentic OS mode). */
  timelineTooltipOverride?: string;
  /** Whether to render the timeline toggle control. */
  showTimelineControl?: boolean;
  /** DOM id controlled by the timeline toggle. */
  timelinePanelId?: string;
  /** Test id for the timeline toggle. */
  timelineControlTestId?: string;
  /** Whether to render the session-scoped goal control. */
  showGoalControl?: boolean;

  /** Profile-declared right-panel actions for this session. */
  sidecarActions?: FlowChatSidecarActionViewModel[];
}
export const FlowChatHeader: React.FC<FlowChatHeaderProps> = ({
  visible,
  sessionId,
  workspacePath,
  turns = [],
  onJumpToTurn,
  searchQuery = '',
  onSearchChange,
  searchMatchCount = 0,
  searchCurrentMatch = 0,
  onSearchNext,
  onSearchPrev,
  onSearchClose,
  searchOpenRequest = 0,
  showSearchControl = true,
  timelineOpen = false,
  onTimelineOpenChange,
  forceTimelineEnabled = false,
  timelineTooltipOverride,
  showTimelineControl = true,
  timelinePanelId = 'agentic-os-timeline-sidebar',
  timelineControlTestId = 'flowchat-header-timeline',
  showGoalControl = true,
  sidecarActions = [],
}) => {
  const { t } = useTranslation('flow-chat');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeAuxiliaryHost = useAuxiliarySurfaceStore(selectActiveAuxiliaryHostState);

  const timelineTooltip =
    timelineTooltipOverride ??
    t('flowChatHeader.timeline', {
      defaultValue: 'Timeline',
    });
  const hasTimelineNavigation =
    showTimelineControl && (forceTimelineEnabled || (turns.length > 0 && !!onJumpToTurn));
  const rightPanelOpen = activeAuxiliaryHost?.presentation === 'docked';
  const rightPanelLabel = rightPanelOpen
    ? t('flowChatHeader.collapseRightPanel', { defaultValue: 'Collapse right panel' })
    : t('flowChatHeader.expandRightPanel', { defaultValue: 'Expand right panel' });

  // When collapsing the turn list with an active query, reopen the header search bar.
  const prevTimelineOpenRef = useRef(timelineOpen);
  useEffect(() => {
    if (prevTimelineOpenRef.current && !timelineOpen && searchQuery.trim().length > 0) {
      setIsSearchOpen(true);
    }
    prevTimelineOpenRef.current = timelineOpen;
  }, [timelineOpen, searchQuery]);

  // Sync open state from parent (e.g. Ctrl+F shortcut).
  // Using a counter so every new request opens the bar, even after a prior close.
  const prevSearchOpenRequestRef = useRef(0);
  useEffect(() => {
    if (timelineOpen) return;
    if (searchOpenRequest > 0 && searchOpenRequest !== prevSearchOpenRequestRef.current) {
      prevSearchOpenRequestRef.current = searchOpenRequest;
      setIsSearchOpen(true);
    }
  }, [searchOpenRequest, timelineOpen]);

  // Focus the search input whenever it opens (header search is hidden while timeline is open).
  useEffect(() => {
    if (timelineOpen || !isSearchOpen) return undefined;
    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [isSearchOpen, timelineOpen]);

  const handleOpenSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    onSearchClose?.();
  }, [onSearchClose]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleCloseSearch();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          onSearchPrev?.();
        } else {
          onSearchNext?.();
        }
        e.preventDefault();
      }
    },
    [handleCloseSearch, onSearchNext, onSearchPrev],
  );

  const hasNoResults = searchQuery.trim().length > 0 && searchMatchCount === 0;

  const handleToggleTimeline = () => {
    if (!hasTimelineNavigation) return;
    onTimelineOpenChange?.(!timelineOpen);
  };

  if (!visible) {
    return null;
  }

  return (
    <div className="flowchat-header">
      <div className="flowchat-header__actions flowchat-header__actions--left">
        <SessionFilesBadge sessionId={sessionId} />
      </div>

      {!timelineOpen && !isSearchOpen && showGoalControl ? (
        <GoalHeaderControl sessionId={sessionId} workspacePath={workspacePath} />
      ) : null}

      <div className="flowchat-header__actions">
        {showSearchControl && !timelineOpen && isSearchOpen ? (
          <div className="flowchat-header__search" role="search" data-testid="flowchat-header-search-bar">
            <Input
              ref={searchInputRef}
              className="flowchat-header__search-field"
              variant="filled"
              inputSize="small"
              prefix={<Search size={12} className="flowchat-header__search-prefix-icon" aria-hidden="true" />}
              suffix={
                <span className="flowchat-header__search-inline-controls">
                  <span className="flowchat-header__search-count" aria-live="polite">
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
                  <span className="flowchat-header__search-nav">
                    <IconButton
                      className="flowchat-header__search-nav-control"
                      onClick={onSearchPrev}
                      disabled={searchMatchCount === 0}
                      tooltip={t('flowChatHeader.searchPrevious', { defaultValue: 'Previous match' })}
                      aria-label={t('flowChatHeader.searchPrevious', { defaultValue: 'Previous match' })}
                      size="xs"
                      variant="ghost"
                    >
                      <ChevronUp size={10} />
                    </IconButton>
                    <IconButton
                      className="flowchat-header__search-nav-control"
                      onClick={onSearchNext}
                      disabled={searchMatchCount === 0}
                      tooltip={t('flowChatHeader.searchNext', { defaultValue: 'Next match' })}
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
              placeholder={t('flowChatHeader.searchPlaceholder', { defaultValue: 'Search messages' })}
              aria-label={t('flowChatHeader.searchPlaceholder', { defaultValue: 'Search messages' })}
              error={hasNoResults}
            />
            <IconButton
              variant="ghost"
              size="xs"
              onClick={handleCloseSearch}
              tooltip={t('flowChatHeader.searchClose', { defaultValue: 'Close search' })}
              aria-label={t('flowChatHeader.searchClose', { defaultValue: 'Close search' })}
            >
              <X size={14} />
            </IconButton>
          </div>
        ) : null}
        {!timelineOpen && !isSearchOpen && sidecarActions.length > 0 ? (
          <FlowChatSidecarActions actions={sidecarActions} />
        ) : null}
        {showSearchControl && !timelineOpen && !isSearchOpen && (
          <IconButton
            className="flowchat-header__search-action"
            variant="ghost"
            size="xs"
            onClick={handleOpenSearch}
            tooltip={t('flowChatHeader.searchOpen', { defaultValue: 'Search messages' })}
            aria-label={t('flowChatHeader.searchOpen', { defaultValue: 'Search messages' })}
            data-testid="flowchat-header-search"
          >
            <Search size={14} />
          </IconButton>
        )}
        {showTimelineControl ? (
          <div className="flowchat-header__timeline-nav">
            <IconButton
              className={`flowchat-header__timeline-nav-button${timelineOpen ? ' flowchat-header__timeline-nav-button--active' : ''}`}
              variant="ghost"
              size="xs"
              onClick={handleToggleTimeline}
              tooltip={timelineTooltip}
              disabled={!hasTimelineNavigation}
              aria-label={timelineTooltip}
              aria-expanded={timelineOpen}
              aria-controls={timelinePanelId}
              data-testid={timelineControlTestId}
            >
              <List size={14} />
            </IconButton>
          </div>
        ) : null}
        <IconButton
          className="flowchat-header__right-panel-toggle"
          variant="ghost"
          size="xs"
          onClick={toggleActiveAuxiliarySurface}
          disabled={!activeAuxiliaryHost}
          tooltip={rightPanelLabel}
          aria-label={rightPanelLabel}
          aria-expanded={rightPanelOpen}
          aria-controls="session-auxiliary-surface"
          data-testid="flowchat-header-right-panel-toggle"
        >
          {rightPanelOpen ? (
            <PanelRightOpenIcon
              size={14}
              strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
              absoluteStrokeWidth
              aria-hidden="true"
            />
          ) : (
            <PanelRightClosedIcon
              size={14}
              strokeWidth={SPARO_ICON_OPTICAL_STROKE_WIDTH.compact}
              absoluteStrokeWidth
              aria-hidden="true"
            />
          )}
        </IconButton>
      </div>
    </div>
  );
};

FlowChatHeader.displayName = 'FlowChatHeader';

