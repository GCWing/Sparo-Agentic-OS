/**
 * FlowChat header — message search and turn list controls.
 *
 * The session title and the "return to Agentic OS" button have been moved to
 * UnifiedTopBar so the whole application shares a single top chrome.
 * Agentic OS: reset and thinking display live under a "more" menu on
 * the right; other sessions keep the inline thinking toggle. Session files badge
 * stays on the left.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, List, MoreVertical, Search, X } from 'lucide-react';
import { DropdownMenu, IconButton, Input } from '@/design-system';
import type { DropdownMenuEntry } from '@/design-system';
import { useTranslation } from 'react-i18next';
import { SessionFilesBadge } from './SessionFilesBadge';
import { FlowChatSidecarActions } from './FlowChatSidecarActions';
import { aiExperienceConfigService, type AIExperienceSettings } from '@/infrastructure/config/services/AIExperienceConfigService';
import { createLogger } from '@/shared/utils/logger';
import type { FlowChatSidecarActionViewModel } from './useSessionSidecarActions';
import './FlowChatHeader.scss';

const log = createLogger('FlowChatHeader');

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

  /** Turn list sidebar open state (controlled by parent). */
  turnListOpen?: boolean;
  /** Toggle or close the turn list sidebar. */
  onTurnListOpenChange?: (open: boolean) => void;
  /**
   * Force-enable the turn list toggle even when the current session has no
   * turns. Used by the Agentic OS timeline, which aggregates many sessions.
   */
  forceTurnListEnabled?: boolean;
  /** Override the toggle button tooltip (e.g. "Timeline" in Agentic OS mode). */
  turnListTooltipOverride?: string;

  /**
   * Agentic OS: start a new backend session; shown to the user as
   * resetting history rather than "new session".
   */
  onResetHistory?: () => void;

  /** Profile-declared right-panel actions for this session. */
  sidecarActions?: FlowChatSidecarActionViewModel[];
}
export const FlowChatHeader: React.FC<FlowChatHeaderProps> = ({
  visible,
  sessionId,
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
  turnListOpen = false,
  onTurnListOpenChange,
  forceTurnListEnabled = false,
  turnListTooltipOverride,
  onResetHistory,
  sidecarActions = [],
}) => {
  const { t } = useTranslation('flow-chat');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [aiExperienceSettings, setAiExperienceSettings] = useState<AIExperienceSettings>(() =>
    aiExperienceConfigService.getSettings()
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sessionMoreMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const [sessionMoreMenuOpen, setSessionMoreMenuOpen] = useState(false);

  const turnListTooltip =
    turnListTooltipOverride ??
    t('flowChatHeader.turnList', {
      defaultValue: 'Turn list',
    });
  const keepThinkingItemEnabled = aiExperienceSettings.show_completed_thinking_item;
  const thinkingItemToggleTooltip = keepThinkingItemEnabled
    ? t('flowChatHeader.hideCompletedThinkingItems', { defaultValue: 'Hide completed thinking items' })
    : t('flowChatHeader.showCompletedThinkingItems', { defaultValue: 'Show completed thinking items' });
  const hasTurnNavigation = forceTurnListEnabled || (turns.length > 0 && !!onJumpToTurn);
  const moreMenuLabel = t('flowChatHeader.moreMenu', { defaultValue: 'More' });

  useEffect(() => {
    let cancelled = false;
    aiExperienceConfigService.getSettingsAsync().then(settings => {
      if (!cancelled) {
        setAiExperienceSettings(settings);
      }
    });

    const unsubscribe = aiExperienceConfigService.addChangeListener(setAiExperienceSettings);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // When collapsing the turn list with an active query, reopen the header search bar.
  const prevTurnListOpenRef = useRef(turnListOpen);
  useEffect(() => {
    if (prevTurnListOpenRef.current && !turnListOpen && searchQuery.trim().length > 0) {
      setIsSearchOpen(true);
    }
    prevTurnListOpenRef.current = turnListOpen;
  }, [turnListOpen, searchQuery]);

  // Sync open state from parent (e.g. Ctrl+F shortcut).
  // Using a counter so every new request opens the bar, even after a prior close.
  const prevSearchOpenRequestRef = useRef(0);
  useEffect(() => {
    if (turnListOpen) return;
    if (searchOpenRequest > 0 && searchOpenRequest !== prevSearchOpenRequestRef.current) {
      prevSearchOpenRequestRef.current = searchOpenRequest;
      setIsSearchOpen(true);
    }
  }, [searchOpenRequest, turnListOpen]);

  // Focus the search input whenever it opens (header search is hidden while turn list is open).
  useEffect(() => {
    if (turnListOpen || !isSearchOpen) return undefined;
    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, [isSearchOpen, turnListOpen]);

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

  const handleToggleTurnList = () => {
    if (!hasTurnNavigation) return;
    onTurnListOpenChange?.(!turnListOpen);
  };

  const handleToggleCompletedThinkingItems = useCallback(async () => {
    const nextSettings: AIExperienceSettings = {
      ...aiExperienceSettings,
      show_completed_thinking_item: !keepThinkingItemEnabled,
    };
    setAiExperienceSettings(nextSettings);
    try {
      await aiExperienceConfigService.saveSettings(nextSettings);
    } catch (error) {
      log.error('Failed to toggle completed thinking items', error);
      setAiExperienceSettings(aiExperienceSettings);
    }
  }, [aiExperienceSettings, keepThinkingItemEnabled]);

  const agenticOsSessionMenuItems = useMemo((): DropdownMenuEntry[] => {
    if (!onResetHistory) return [];
    return [
      {
        type: 'item',
        id: 'thinking-settings',
        label: t('flowChatHeader.showCompletedThinkingInConversation', {
          defaultValue: 'Show/hide thinking',
        }),
        checked: keepThinkingItemEnabled,
        onClick: () => {
          void handleToggleCompletedThinkingItems();
        },
      },
      { type: 'separator', id: 'agentic-os-session-menu-sep' },
      {
        type: 'item',
        id: 'reset-session',
        label: t('flowChatHeader.resetSession', { defaultValue: 'Reset session' }),
        onClick: onResetHistory,
      },
    ];
  }, [
    onResetHistory,
    keepThinkingItemEnabled,
    t,
    handleToggleCompletedThinkingItems,
  ]);

  useEffect(() => {
    if (!visible) {
      setSessionMoreMenuOpen(false);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className="flowchat-header">
      <div className="flowchat-header__actions flowchat-header__actions--left">
        <SessionFilesBadge sessionId={sessionId} />
      </div>

      <div className="flowchat-header__actions">
        {!turnListOpen && isSearchOpen ? (
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
        {!turnListOpen && !isSearchOpen && !onResetHistory ? (
          <IconButton
            className="flowchat-header__thinking-toggle"
            variant="ghost"
            size="xs"
            onClick={() => {
              void handleToggleCompletedThinkingItems();
            }}
            tooltip={thinkingItemToggleTooltip}
            aria-label={thinkingItemToggleTooltip}
            aria-pressed={keepThinkingItemEnabled}
            data-testid="flowchat-header-thinking-toggle"
          >
            {keepThinkingItemEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconButton>
        ) : null}
        {!turnListOpen && !isSearchOpen && sidecarActions.length > 0 ? (
          <FlowChatSidecarActions actions={sidecarActions} />
        ) : null}
        {!turnListOpen && !isSearchOpen && (
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
        <div className="flowchat-header__turn-nav">
          <IconButton
            className={`flowchat-header__turn-nav-button${turnListOpen ? ' flowchat-header__turn-nav-button--active' : ''}`}
            variant="ghost"
            size="xs"
            onClick={handleToggleTurnList}
            tooltip={turnListTooltip}
            disabled={!hasTurnNavigation}
            aria-label={turnListTooltip}
            aria-expanded={turnListOpen}
            aria-controls="flowchat-turn-list-sidebar"
            data-testid="flowchat-header-turn-list"
          >
            <List size={14} />
          </IconButton>
        </div>
        {onResetHistory ? (
          <div className="flowchat-header__more-wrap" ref={sessionMoreMenuAnchorRef}>
            <IconButton
              className="flowchat-header__more-menu-trigger"
              variant="ghost"
              size="xs"
              onClick={() => setSessionMoreMenuOpen(v => !v)}
              tooltip={moreMenuLabel}
              aria-label={moreMenuLabel}
              aria-haspopup="menu"
              aria-expanded={sessionMoreMenuOpen}
              data-testid="flowchat-header-session-more"
            >
              <MoreVertical size={14} aria-hidden />
            </IconButton>
            <DropdownMenu
              open={sessionMoreMenuOpen}
              anchorRef={sessionMoreMenuAnchorRef}
              items={agenticOsSessionMenuItems}
              onClose={() => setSessionMoreMenuOpen(false)}
              align="right"
              minWidth={180}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

FlowChatHeader.displayName = 'FlowChatHeader';

