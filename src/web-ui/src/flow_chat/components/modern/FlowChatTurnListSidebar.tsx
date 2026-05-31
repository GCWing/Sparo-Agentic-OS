/**
 * Right-side turn list panel — pushes the message area when open.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { IconButton, Input } from '@/design-system';
import './FlowChatTurnListSidebar.scss';

export interface FlowChatTurnListEntry {
  turnId: string;
  turnIndex: number;
  title: string;
}

export interface FlowChatTurnListSidebarProps {
  open: boolean;
  turns: FlowChatTurnListEntry[];
  currentTurn: number;
  onSelectTurn: (turnId: string) => void;
  /** Turn ids that contain at least one search match — highlighted in the list. */
  searchMatchedTurnIds?: ReadonlySet<string>;

  // In-message search controls (routed here while the panel is open)
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  onSearchClose?: () => void;
  /** Increments when parent requests focus (e.g. Ctrl+F while panel is open). */
  searchFocusRequest?: number;
}

export const FlowChatTurnListSidebar = React.forwardRef<HTMLElement, FlowChatTurnListSidebarProps>(
  function FlowChatTurnListSidebar(
    {
      open,
      turns,
      currentTurn,
      onSelectTurn,
      searchMatchedTurnIds,
      searchQuery = '',
      onSearchChange,
      searchMatchCount = 0,
      searchCurrentMatch = 0,
      onSearchNext,
      onSearchPrev,
      onSearchClose,
      searchFocusRequest = 0,
    },
    ref,
  ) {
    const { t } = useTranslation('flow-chat');
    const activeTurnItemRef = useRef<HTMLButtonElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);


    // Focus search input when parent requests it (e.g. Ctrl+F).
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

    // Scroll active turn into view when the panel opens or the active turn changes.
    useEffect(() => {
      if (!open) return;
      const frameId = requestAnimationFrame(() => {
        activeTurnItemRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      return () => cancelAnimationFrame(frameId);
    }, [open, currentTurn, turns.length]);

    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
          onSearchClose?.();
        } else if (e.key === 'Enter') {
          if (e.shiftKey) {
            onSearchPrev?.();
          } else {
            onSearchNext?.();
          }
          e.preventDefault();
        }
      },
      [onSearchClose, onSearchNext, onSearchPrev],
    );

    const hasNoResults = searchQuery.trim().length > 0 && searchMatchCount === 0;

    if (!open) {
      return (
        <aside
          id="flowchat-turn-list-sidebar"
          ref={ref}
          className="flowchat-turn-sidebar"
          aria-hidden="true"
          data-testid="flowchat-turn-list-sidebar"
        />
      );
    }

    return (
      <aside
        id="flowchat-turn-list-sidebar"
        ref={ref}
        className="flowchat-turn-sidebar flowchat-turn-sidebar--open"
        aria-hidden={false}
        data-testid="flowchat-turn-list-sidebar"
      >
        <div className="flowchat-turn-sidebar__inner">
          <div className="flowchat-turn-sidebar__header">
            <div className="flowchat-turn-sidebar__heading">
              <div
                className="flowchat-turn-sidebar__search"
                role="search"
                data-testid="flowchat-turn-list-search-bar"
              >
                <Input
                  ref={searchInputRef}
                  className="flowchat-turn-sidebar__search-field"
                  variant="filled"
                  inputSize="small"
                  prefix={
                    <Search
                      size={11}
                      className="flowchat-turn-sidebar__search-prefix-icon"
                      aria-hidden="true"
                    />
                  }
                  suffix={
                    <span className="flowchat-turn-sidebar__search-inline-controls">
                      <span
                        className="flowchat-turn-sidebar__search-count"
                        aria-live="polite"
                      >
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
                      <span className="flowchat-turn-sidebar__search-nav">
                        <IconButton
                          className="flowchat-turn-sidebar__search-nav-control"
                          onClick={onSearchPrev}
                          disabled={searchMatchCount === 0}
                          aria-label={t('flowChatHeader.searchPrevious', {
                            defaultValue: 'Previous match',
                          })}
                          size="xs"
                          variant="ghost"
                        >
                          <ChevronUp size={10} />
                        </IconButton>
                        <IconButton
                          className="flowchat-turn-sidebar__search-nav-control"
                          onClick={onSearchNext}
                          disabled={searchMatchCount === 0}
                          aria-label={t('flowChatHeader.searchNext', {
                            defaultValue: 'Next match',
                          })}
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
                  placeholder={t('flowChatHeader.searchPlaceholder', {
                    defaultValue: 'Search messages',
                  })}
                  aria-label={t('flowChatHeader.searchPlaceholder', {
                    defaultValue: 'Search messages',
                  })}
                  error={hasNoResults}
                />
              </div>
            </div>
          </div>

          <div className="flowchat-turn-sidebar__list" role="list">
            {turns.map(turn => (
              <button
                key={turn.turnId}
                role="listitem"
                type="button"
                className={[
                  'flowchat-turn-sidebar__item',
                  turn.turnIndex === currentTurn && 'flowchat-turn-sidebar__item--active',
                  searchMatchedTurnIds?.has(turn.turnId) &&
                    'flowchat-turn-sidebar__item--search-match',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectTurn(turn.turnId)}
                ref={turn.turnIndex === currentTurn ? activeTurnItemRef : undefined}
                aria-current={turn.turnIndex === currentTurn ? 'true' : undefined}
                title={turn.title}
              >
                <span className="flowchat-turn-sidebar__item-content">
                  <span className="flowchat-turn-sidebar__item-meta">
                    {t('flowChatHeader.turnBadge', {
                      current: turn.turnIndex,
                      defaultValue: `Turn ${turn.turnIndex}`,
                    })}
                  </span>
                  <span className="flowchat-turn-sidebar__title">{turn.title}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  },
);

FlowChatTurnListSidebar.displayName = 'FlowChatTurnListSidebar';
