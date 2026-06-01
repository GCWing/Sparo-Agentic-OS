/**
 * Agentic OS FlowChat container — for Dispatcher (Agentic OS) sessions.
 *
 * Handles: cross-session timeline navigation, dispatcher search, session
 * switching banners, and the DispatcherTimelineSidebar. Evolves
 * independently from StandardFlowChatContainer.
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import { flowChatManager } from '../../services/FlowChatManager';
import { VirtualMessageList } from './VirtualMessageList';
import { FlowChatHeader } from './FlowChatHeader';
import { DispatcherTimelineSidebar } from './DispatcherTimelineSidebar';
import { FlowChatSelectionAddButton } from './FlowChatSelectionAddButton';
import { WelcomePanel } from '../WelcomePanel';
import {
  FlowChatContext,
  FlowChatStaticContext,
  FlowChatViewContext,
  type FlowChatContextValue,
} from './FlowChatContext';
import { useDispatcherTimeline } from '../../hooks/useDispatcherTimeline';
import { useFlowChatCore, type UseFlowChatCoreOptions } from './useFlowChatCore';
import { createLogger } from '@/shared/utils/logger';
import { getDispatcherSessionDescriptor } from '../../domain/sessionDescriptor';
import './ModernFlowChatContainer.scss';

const log = createLogger('AgenticOSFlowChatContainer');

type AgenticOSFlowChatContainerProps = UseFlowChatCoreOptions & {
  className?: string;
};

export const AgenticOSFlowChatContainer: React.FC<AgenticOSFlowChatContainerProps> = ({
  className = '',
  config,
  onFileViewRequest,
  onTabOpen,
  onOpenVisualization,
  onSwitchToChatPanel,
}) => {
  const { t } = useTranslation('flow-chat');

  const core = useFlowChatCore({
    initialTurnListOpen: false,
    config,
    onFileViewRequest,
    onTabOpen,
    onOpenVisualization,
    onSwitchToChatPanel,
  });

  const {
    virtualItems,
    activeSession,
    effectiveVisibleTurnInfo,
    virtualListRef,
    chatScopeRef,
    turnListSidebarRef,
    turnSummaries,
    handleJumpToTurn,
    turnListOpen,
    setTurnListOpen,
    turnListSearchFocusRequest,
    setTurnListSearchFocusRequest,
    staticContextValue,
    viewContextValue,
    setPendingHeaderTurnId,
  } = core;

  const contextValue: FlowChatContextValue = useMemo(
    () => ({ ...staticContextValue, ...viewContextValue }),
    [staticContextValue, viewContextValue],
  );

  // ── Dispatcher-specific state ─────────────────────────────────────────────
  const dispatcherTimeline = useDispatcherTimeline();

  const [dispatcherTimelineQuery, setDispatcherTimelineQuery] = useState('');
  const [dispatcherTimelineMatchCursor, setDispatcherTimelineMatchCursor] = useState(0);
  const [dispatcherSwitchBanner, setDispatcherSwitchBanner] = useState<{
    key: number;
    title: string;
    timeLabel: string;
    direction: 'older' | 'newer';
  } | null>(null);
  const [dispatcherFadeKey, setDispatcherFadeKey] = useState(0);

  // Refs tracking cross-session navigation state.
  const autoPinnedSessionIdRef = useRef<string | null>(null);
  const pendingCrossSessionTargetRef = useRef<{ sessionId: string; turnId: string } | null>(null);
  const pendingHighlightTurnIdRef = useRef<string | null>(null);

  // ── Auto-dismiss switch banner ────────────────────────────────────────────
  useEffect(() => {
    if (!dispatcherSwitchBanner) return;
    const timer = window.setTimeout(() => setDispatcherSwitchBanner(null), 2400);
    return () => window.clearTimeout(timer);
  }, [dispatcherSwitchBanner]);

  // ── Auto-pin latest turn on session change ────────────────────────────────
  useEffect(() => {
    autoPinnedSessionIdRef.current = null;
    setPendingHeaderTurnId(null);
  }, [activeSession?.sessionId, setPendingHeaderTurnId]);

  useEffect(() => {
    const sessionId = activeSession?.sessionId;
    const latestTurnId = turnSummaries[turnSummaries.length - 1]?.turnId;
    if (!sessionId || !latestTurnId || autoPinnedSessionIdRef.current === sessionId) return;

    const crossTarget = pendingCrossSessionTargetRef.current;
    let resolvedTurnId = latestTurnId;
    let pinMode: 'sticky-latest' | 'transient' = 'sticky-latest';

    if (crossTarget && crossTarget.sessionId === sessionId) {
      const targetExists = turnSummaries.some(t => t.turnId === crossTarget.turnId);
      if (targetExists) {
        resolvedTurnId = crossTarget.turnId;
        pinMode = resolvedTurnId === latestTurnId ? 'sticky-latest' : 'transient';
        pendingCrossSessionTargetRef.current = null;
      } else {
        // Target turn not yet hydrated; defer to a later effect run.
        return;
      }
    }

    autoPinnedSessionIdRef.current = sessionId;
    setPendingHeaderTurnId(resolvedTurnId);

    const highlightTurnId = pendingHighlightTurnIdRef.current;
    pendingHighlightTurnIdRef.current = null;

    const frameId = requestAnimationFrame(() => {
      const accepted =
        virtualListRef.current?.pinTurnToTop(resolvedTurnId, {
          behavior: 'auto',
          pinMode,
        }) ?? false;

      if (!accepted) {
        autoPinnedSessionIdRef.current = null;
        setPendingHeaderTurnId(null);
      }

      if (highlightTurnId) {
        const applyPulse = () => {
          const root = chatScopeRef.current;
          const node = root?.querySelector<HTMLElement>(
            `.virtual-item-wrapper[data-item-type="user-message"][data-turn-id="${CSS.escape(highlightTurnId)}"]`,
          );
          if (!node) return false;
          node.classList.remove('dispatcher-anchor-pulse');
          // Restart the CSS animation cleanly (force layout read).
          void node.offsetWidth;
          node.classList.add('dispatcher-anchor-pulse');
          window.setTimeout(() => node.classList.remove('dispatcher-anchor-pulse'), 1700);
          return true;
        };
        let attempts = 0;
        const tryApply = () => {
          if (applyPulse()) return;
          if (attempts++ < 8) requestAnimationFrame(tryApply);
        };
        requestAnimationFrame(tryApply);
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [
    activeSession?.sessionId,
    turnSummaries,
    virtualListRef,
    chatScopeRef,
    setPendingHeaderTurnId,
  ]);

  // ── Switch banner builder ─────────────────────────────────────────────────
  const buildSwitchBanner = useCallback(
    (
      targetSessionId: string,
    ): { title: string; timeLabel: string; direction: 'older' | 'newer' } | null => {
      let target: { title: string; sortTimestamp: number } | null = null;
      for (const bucket of dispatcherTimeline.buckets) {
        const found = bucket.sessions.find(s => s.sessionId === targetSessionId);
        if (found) {
          target = { title: found.title, sortTimestamp: found.sortTimestamp };
          break;
        }
      }
      if (!target) return null;

      const currentSortTs =
        activeSession?.lastFinishedAt ?? activeSession?.createdAt ?? Date.now();
      const direction: 'older' | 'newer' =
        target.sortTimestamp >= currentSortTs ? 'newer' : 'older';

      const date = new Date(target.sortTimestamp);
      const now = new Date();
      const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate();

      const time = `${String(date.getHours()).padStart(2, '0')}:${String(
        date.getMinutes(),
      ).padStart(2, '0')}`;
      const dayLabel = sameDay
        ? t('dispatcherTimeline.bucket.today', { defaultValue: 'Today' })
        : isYesterday
          ? t('dispatcherTimeline.bucket.yesterday', { defaultValue: 'Yesterday' })
          : `${date.getMonth() + 1}/${date.getDate()}`;

      return { title: target.title, timeLabel: `${dayLabel} ${time}`, direction };
    },
    [activeSession?.createdAt, activeSession?.lastFinishedAt, dispatcherTimeline, t],
  );

  // ── Cross-session navigation ──────────────────────────────────────────────
  const handleDispatcherTimelineTurnSelect = useCallback(
    async (sessionId: string, turnId: string) => {
      if (activeSession?.sessionId === sessionId) {
        pendingHighlightTurnIdRef.current = turnId;
        handleJumpToTurn(turnId);
        return;
      }
      try {
        const bannerInfo = buildSwitchBanner(sessionId);
        pendingCrossSessionTargetRef.current = { sessionId, turnId };
        pendingHighlightTurnIdRef.current = turnId;
        autoPinnedSessionIdRef.current = null;
        if (bannerInfo) setDispatcherSwitchBanner({ key: Date.now(), ...bannerInfo });
        setDispatcherFadeKey(prev => prev + 1);
        await flowChatManager.switchChatSession(sessionId);
        window.setTimeout(() => {
          if (
            pendingCrossSessionTargetRef.current?.sessionId === sessionId &&
            pendingCrossSessionTargetRef.current?.turnId === turnId
          ) {
            pendingCrossSessionTargetRef.current = null;
          }
        }, 8000);
      } catch (error) {
        pendingCrossSessionTargetRef.current = null;
        pendingHighlightTurnIdRef.current = null;
        log.warn('Dispatcher timeline turn select failed', { sessionId, turnId, error });
      }
    },
    [activeSession?.sessionId, buildSwitchBanner, handleJumpToTurn],
  );

  const handleDispatcherTimelineSessionSelect = useCallback(
    async (sessionId: string) => {
      if (activeSession?.sessionId === sessionId) return;
      try {
        const bannerInfo = buildSwitchBanner(sessionId);
        autoPinnedSessionIdRef.current = null;
        if (bannerInfo) setDispatcherSwitchBanner({ key: Date.now(), ...bannerInfo });
        setDispatcherFadeKey(prev => prev + 1);
        await flowChatManager.switchChatSession(sessionId);
      } catch (error) {
        log.warn('Dispatcher timeline session select failed', { sessionId, error });
      }
    },
    [activeSession?.sessionId, buildSwitchBanner],
  );

  const handleDispatcherCreateSession = useCallback(async () => {
    try {
      await flowChatManager.createChatSession(
        { storageScope: 'agentic_os' },
        getDispatcherSessionDescriptor()
      );
    } catch (error) {
      log.warn('Failed to create dispatcher session from timeline', error);
    }
  }, []);

  // ── Timeline search ───────────────────────────────────────────────────────
  const dispatcherSearch = useMemo(() => {
    const query = dispatcherTimelineQuery.trim().toLowerCase();
    if (query.length === 0) {
      return {
        matchedTurnIds: new Set<string>(),
        matchedSessionIds: new Set<string>(),
        orderedMatches: [] as Array<{ sessionId: string; turnId: string }>,
      };
    }

    const matchedTurnIds = new Set<string>();
    const matchedSessionIds = new Set<string>();
    const orderedMatches: Array<{ sessionId: string; turnId: string }> = [];

    for (const bucket of dispatcherTimeline.buckets) {
      for (const session of bucket.sessions) {
        const sessionMatches = session.title.toLowerCase().includes(query);
        if (sessionMatches) matchedSessionIds.add(session.sessionId);
        for (const turn of session.turns) {
          if (turn.title.toLowerCase().includes(query) || sessionMatches) {
            matchedTurnIds.add(turn.turnId);
            orderedMatches.push({ sessionId: session.sessionId, turnId: turn.turnId });
          }
        }
      }
    }

    return { matchedTurnIds, matchedSessionIds, orderedMatches };
  }, [dispatcherTimelineQuery, dispatcherTimeline]);

  useEffect(() => {
    setDispatcherTimelineMatchCursor(0);
  }, [dispatcherSearch.orderedMatches.length, dispatcherTimelineQuery]);

  const handleDispatcherSearchNext = useCallback(() => {
    const total = dispatcherSearch.orderedMatches.length;
    if (total === 0) return;
    const next = (dispatcherTimelineMatchCursor + 1) % total;
    setDispatcherTimelineMatchCursor(next);
    void handleDispatcherTimelineTurnSelect(
      dispatcherSearch.orderedMatches[next].sessionId,
      dispatcherSearch.orderedMatches[next].turnId,
    );
  }, [
    dispatcherSearch.orderedMatches,
    dispatcherTimelineMatchCursor,
    handleDispatcherTimelineTurnSelect,
  ]);

  const handleDispatcherSearchPrev = useCallback(() => {
    const total = dispatcherSearch.orderedMatches.length;
    if (total === 0) return;
    const next = (dispatcherTimelineMatchCursor - 1 + total) % total;
    setDispatcherTimelineMatchCursor(next);
    void handleDispatcherTimelineTurnSelect(
      dispatcherSearch.orderedMatches[next].sessionId,
      dispatcherSearch.orderedMatches[next].turnId,
    );
  }, [
    dispatcherSearch.orderedMatches,
    dispatcherTimelineMatchCursor,
    handleDispatcherTimelineTurnSelect,
  ]);

  const handleDispatcherSearchClose = useCallback(() => {
    setDispatcherTimelineQuery('');
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useShortcut(
    'chat.stopGeneration',
    { key: 'Escape', scope: 'chat', allowInInput: true },
    () => { void FlowChatManager.getInstance().cancelCurrentTask(); },
    { priority: 20, description: 'keyboard.shortcuts.chat.stopGeneration' },
  );

  useShortcut(
    'btw-fill',
    { key: 'B', ctrl: true, alt: true, scope: 'chat', allowInInput: true },
    () => {
      const selected = (window.getSelection?.()?.toString() ?? '').trim();
      const message = selected ? `/btw Explain this:\n\n${selected}` : '/btw ';
      window.dispatchEvent(new CustomEvent('fill-chat-input', { detail: { message } }));
    },
    { priority: 20, description: 'keyboard.shortcuts.chat.btwFill' },
  );

  useShortcut(
    'chat.search',
    { key: 'F', ctrl: true, scope: 'chat', allowInInput: false },
    () => {
      // Ctrl+F in Agentic OS always focuses the timeline search.
      setTurnListSearchFocusRequest(prev => prev + 1);
    },
    { priority: 15, description: 'keyboard.shortcuts.chat.search' },
  );

  // ── Background CSS variables ──────────────────────────────────────────────
  const dispatcherBackgroundVars: React.CSSProperties = {
    ['--ds-chat-surface' as string]: 'var(--ds-color-bg-app)',
    ['--color-bg-flowchat' as string]: 'var(--ds-color-bg-app)',
    ['--color-bg-scene' as string]: 'var(--ds-color-bg-app)',
  };

  return (
    <FlowChatContext.Provider value={contextValue}>
      <FlowChatStaticContext.Provider value={staticContextValue}>
        <FlowChatViewContext.Provider value={viewContextValue}>
          <div
            ref={chatScopeRef}
            className={[
              'modern-flowchat-container',
              'flow-chat-typography',
              'modern-flowchat-container--dispatcher',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            style={dispatcherBackgroundVars}
            data-shortcut-scope="chat"
          >
            <FlowChatSelectionAddButton containerRef={chatScopeRef} />

            <FlowChatHeader
              visible={!!activeSession}
              sessionId={activeSession?.sessionId}
              turns={turnSummaries}
              onJumpToTurn={handleJumpToTurn}
              onResetHistory={() => {
                void handleDispatcherCreateSession();
              }}
              // Header-level search is hidden while the timeline sidebar is
              // open; Ctrl+F routes to the timeline search instead.
              searchQuery=""
              onSearchChange={() => {}}
              searchMatchCount={0}
              searchCurrentMatch={0}
              onSearchNext={() => {}}
              onSearchPrev={() => {}}
              onSearchClose={() => {}}
              searchOpenRequest={0}
              turnListOpen={turnListOpen}
              onTurnListOpenChange={setTurnListOpen}
              forceTurnListEnabled
              turnListTooltipOverride={t('dispatcherTimeline.toggleTooltip', {
                defaultValue: 'Timeline',
              })}
            />

            <div className="modern-flowchat-container__body modern-flowchat-container__body--dispatcher">
              <div className="modern-flowchat-container__messages">
                {dispatcherSwitchBanner && (
                  <div
                    key={dispatcherSwitchBanner.key}
                    className={`dispatcher-switch-banner dispatcher-switch-banner--${dispatcherSwitchBanner.direction}`}
                    role="status"
                    aria-live="polite"
                  >
                    <span className="dispatcher-switch-banner__time">
                      {dispatcherSwitchBanner.timeLabel}
                    </span>
                    <span className="dispatcher-switch-banner__sep" aria-hidden>·</span>
                    <span className="dispatcher-switch-banner__title">
                      {dispatcherSwitchBanner.title}
                    </span>
                  </div>
                )}
                <div
                  className="modern-flowchat-container__messages-inner dispatcher-messages-fade"
                  key={`dispatcher-fade-${dispatcherFadeKey}`}
                >
                  {virtualItems.length === 0 ? (
                    <WelcomePanel
                      key={activeSession?.sessionId ?? 'welcome'}
                      workspacePath={activeSession?.workspacePath}
                      onQuickAction={command => {
                        window.dispatchEvent(
                          new CustomEvent('fill-chat-input', { detail: { message: command } }),
                        );
                      }}
                    />
                  ) : (
                    <VirtualMessageList
                      key={activeSession?.sessionId ?? 'virtual-message-list'}
                      ref={virtualListRef}
                      hideScrollAnchor={turnListOpen}
                    />
                  )}
                </div>
              </div>

              <DispatcherTimelineSidebar
                ref={turnListSidebarRef}
                open={turnListOpen}
                data={dispatcherTimeline}
                activeSessionId={activeSession?.sessionId}
                activeTurnId={effectiveVisibleTurnInfo?.turnId}
                onSelectTurn={handleDispatcherTimelineTurnSelect}
                onSelectSession={handleDispatcherTimelineSessionSelect}
                onCreateSession={handleDispatcherCreateSession}
                searchQuery={dispatcherTimelineQuery}
                onSearchChange={setDispatcherTimelineQuery}
                searchMatchCount={dispatcherSearch.orderedMatches.length}
                searchCurrentMatch={
                  dispatcherSearch.orderedMatches.length > 0
                    ? dispatcherTimelineMatchCursor + 1
                    : 0
                }
                onSearchNext={handleDispatcherSearchNext}
                onSearchPrev={handleDispatcherSearchPrev}
                onSearchClose={handleDispatcherSearchClose}
                searchFocusRequest={turnListSearchFocusRequest}
                searchMatchedTurnIds={
                  dispatcherTimelineQuery.trim().length > 0
                    ? dispatcherSearch.matchedTurnIds
                    : undefined
                }
                searchMatchedSessionIds={
                  dispatcherTimelineQuery.trim().length > 0
                    ? dispatcherSearch.matchedSessionIds
                    : undefined
                }
              />
            </div>
          </div>
        </FlowChatViewContext.Provider>
      </FlowChatStaticContext.Provider>
    </FlowChatContext.Provider>
  );
};

AgenticOSFlowChatContainer.displayName = 'AgenticOSFlowChatContainer';
