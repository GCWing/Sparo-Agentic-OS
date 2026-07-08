/**
 * Agentic OS FlowChat container — for Agentic OS sessions.
 *
 * Handles: cross-session timeline navigation, Agentic OS search, session
 * switching banners, and the AgenticOsTimelineSidebar. Evolves
 * independently from StandardFlowChatContainer.
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { openSession } from '@/app/navigation/navigationController';
import { FlowChatManager, flowChatManager } from '../../services/FlowChatManager';
import { VirtualMessageList } from './VirtualMessageList';
import { FlowChatHeader } from './FlowChatHeader';
import { AgenticOsTimelineSidebar } from './AgenticOsTimelineSidebar';
import { FlowChatSelectionAddButton } from './FlowChatSelectionAddButton';
import { WelcomePanel } from '../WelcomePanel';
import {
  FlowChatContext,
  FlowChatStaticContext,
  FlowChatViewContext,
  type FlowChatContextValue,
} from './FlowChatContext';
import { useAgenticOsTimeline } from '../../hooks/useAgenticOsTimeline';
import { useFlowChatCore, type UseFlowChatCoreOptions } from './useFlowChatCore';
import { useSessionSidecarActions } from './useSessionSidecarActions';
import { createLogger } from '@/shared/utils/logger';
import { getAgenticOsSessionDescriptor } from '../../domain/sessionDescriptor';
import './ModernFlowChatContainer.scss';

const log = createLogger('AgenticOSFlowChatContainer');

type AgenticOSFlowChatContainerProps = UseFlowChatCoreOptions & {
  className?: string;
};

export const AgenticOSFlowChatContainer: React.FC<AgenticOSFlowChatContainerProps> = ({
  className = '',
  sessionId,
  workspacePath,
  config,
  onFileViewRequest,
  onTabOpen,
  onOpenVisualization,
  onSwitchToChatPanel,
}) => {
  const { t } = useTranslation('flow-chat');

  const core = useFlowChatCore({
    initialTurnListOpen: false,
    sessionId,
    workspacePath,
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
  const sidecarActions = useSessionSidecarActions();

  // ── Agentic OS-specific state ─────────────────────────────────────────────
  const agenticOsTimeline = useAgenticOsTimeline();

  const [agenticOsTimelineQuery, setAgenticOsTimelineQuery] = useState('');
  const [agenticOsTimelineMatchCursor, setAgenticOsTimelineMatchCursor] = useState(0);
  const [agenticOsSwitchBanner, setAgenticOsSwitchBanner] = useState<{
    key: number;
    title: string;
    timeLabel: string;
    direction: 'older' | 'newer';
  } | null>(null);
  const [agenticOsFadeKey, setAgenticOsFadeKey] = useState(0);

  // Refs tracking cross-session navigation state.
  const autoPinnedSessionIdRef = useRef<string | null>(null);
  const pendingCrossSessionTargetRef = useRef<{ sessionId: string; turnId: string } | null>(null);
  const pendingHighlightTurnIdRef = useRef<string | null>(null);

  // ── Auto-dismiss switch banner ────────────────────────────────────────────
  useEffect(() => {
    if (!agenticOsSwitchBanner) return;
    const timer = window.setTimeout(() => setAgenticOsSwitchBanner(null), 2400);
    return () => window.clearTimeout(timer);
  }, [agenticOsSwitchBanner]);

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
          node.classList.remove('agentic-os-anchor-pulse');
          // Restart the CSS animation cleanly (force layout read).
          void node.offsetWidth;
          node.classList.add('agentic-os-anchor-pulse');
          window.setTimeout(() => node.classList.remove('agentic-os-anchor-pulse'), 1700);
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
      for (const bucket of agenticOsTimeline.buckets) {
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
        ? t('agenticOsTimeline.bucket.today', { defaultValue: 'Today' })
        : isYesterday
          ? t('agenticOsTimeline.bucket.yesterday', { defaultValue: 'Yesterday' })
          : `${date.getMonth() + 1}/${date.getDate()}`;

      return { title: target.title, timeLabel: `${dayLabel} ${time}`, direction };
    },
    [activeSession?.createdAt, activeSession?.lastFinishedAt, agenticOsTimeline, t],
  );

  // ── Cross-session navigation ──────────────────────────────────────────────
  const handleAgenticOsTimelineTurnSelect = useCallback(
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
        if (bannerInfo) setAgenticOsSwitchBanner({ key: Date.now(), ...bannerInfo });
        setAgenticOsFadeKey(prev => prev + 1);
        await openSession(sessionId);
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
        log.warn('Agentic OS timeline turn select failed', { sessionId, turnId, error });
      }
    },
    [activeSession?.sessionId, buildSwitchBanner, handleJumpToTurn],
  );

  const handleAgenticOsTimelineSessionSelect = useCallback(
    async (sessionId: string) => {
      if (activeSession?.sessionId === sessionId) return;
      try {
        const bannerInfo = buildSwitchBanner(sessionId);
        autoPinnedSessionIdRef.current = null;
        if (bannerInfo) setAgenticOsSwitchBanner({ key: Date.now(), ...bannerInfo });
        setAgenticOsFadeKey(prev => prev + 1);
        await openSession(sessionId);
      } catch (error) {
        log.warn('Agentic OS timeline session select failed', { sessionId, error });
      }
    },
    [activeSession?.sessionId, buildSwitchBanner],
  );

  const handleAgenticOsCreateSession = useCallback(async () => {
    try {
      await flowChatManager.createChatSession(
        { storageScope: 'agentic_os' },
        getAgenticOsSessionDescriptor()
      );
    } catch (error) {
      log.warn('Failed to create Agentic OS session from timeline', error);
    }
  }, []);

  const handleAgenticOsDeleteSessions = useCallback(
    async (sessionIds: string[]): Promise<string[]> => {
      const succeededSessionIds: string[] = [];

      for (const targetSessionId of sessionIds) {
        try {
          await flowChatManager.deleteChatSession(targetSessionId);
          succeededSessionIds.push(targetSessionId);
        } catch (error) {
          log.warn('Failed to delete Agentic OS session from timeline', {
            sessionId: targetSessionId,
            error,
          });
        }
      }

      const succeededSessionIdSet = new Set(succeededSessionIds);
      const nextSession = agenticOsTimeline.buckets
        .flatMap(bucket => bucket.sessions)
        .find(session => !succeededSessionIdSet.has(session.sessionId));

      if (
        activeSession?.sessionId &&
        succeededSessionIdSet.has(activeSession.sessionId) &&
        nextSession
      ) {
        await openSession(nextSession.sessionId);
      }

      return succeededSessionIds;
    },
    [activeSession?.sessionId, agenticOsTimeline.buckets],
  );

  // ── Timeline search ───────────────────────────────────────────────────────
  const agenticOsSearch = useMemo(() => {
    const query = agenticOsTimelineQuery.trim().toLowerCase();
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

    for (const bucket of agenticOsTimeline.buckets) {
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
  }, [agenticOsTimelineQuery, agenticOsTimeline]);

  useEffect(() => {
    setAgenticOsTimelineMatchCursor(0);
  }, [agenticOsSearch.orderedMatches.length, agenticOsTimelineQuery]);

  const handleAgenticOsSearchNext = useCallback(() => {
    const total = agenticOsSearch.orderedMatches.length;
    if (total === 0) return;
    const next = (agenticOsTimelineMatchCursor + 1) % total;
    setAgenticOsTimelineMatchCursor(next);
    void handleAgenticOsTimelineTurnSelect(
      agenticOsSearch.orderedMatches[next].sessionId,
      agenticOsSearch.orderedMatches[next].turnId,
    );
  }, [
    agenticOsSearch.orderedMatches,
    agenticOsTimelineMatchCursor,
    handleAgenticOsTimelineTurnSelect,
  ]);

  const handleAgenticOsSearchPrev = useCallback(() => {
    const total = agenticOsSearch.orderedMatches.length;
    if (total === 0) return;
    const next = (agenticOsTimelineMatchCursor - 1 + total) % total;
    setAgenticOsTimelineMatchCursor(next);
    void handleAgenticOsTimelineTurnSelect(
      agenticOsSearch.orderedMatches[next].sessionId,
      agenticOsSearch.orderedMatches[next].turnId,
    );
  }, [
    agenticOsSearch.orderedMatches,
    agenticOsTimelineMatchCursor,
    handleAgenticOsTimelineTurnSelect,
  ]);

  const handleAgenticOsSearchClose = useCallback(() => {
    setAgenticOsTimelineQuery('');
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
  const agenticOsBackgroundVars: React.CSSProperties = {
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
              'modern-flowchat-container--agentic-os',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            style={agenticOsBackgroundVars}
            data-shortcut-scope="chat"
          >
            <FlowChatSelectionAddButton containerRef={chatScopeRef} />

            <FlowChatHeader
              visible={!!activeSession}
              sessionId={activeSession?.sessionId}
              turns={turnSummaries}
              onJumpToTurn={handleJumpToTurn}
              onResetHistory={() => {
                void handleAgenticOsCreateSession();
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
              turnListTooltipOverride={t('agenticOsTimeline.toggleTooltip', {
                defaultValue: 'Timeline',
              })}
              sidecarActions={sidecarActions}
            />

            <div className="modern-flowchat-container__body modern-flowchat-container__body--agentic-os">
              <div className="modern-flowchat-container__messages">
                {agenticOsSwitchBanner && (
                  <div
                    key={agenticOsSwitchBanner.key}
                    className={`agentic-os-switch-banner agentic-os-switch-banner--${agenticOsSwitchBanner.direction}`}
                    role="status"
                    aria-live="polite"
                  >
                    <span className="agentic-os-switch-banner__time">
                      {agenticOsSwitchBanner.timeLabel}
                    </span>
                    <span className="agentic-os-switch-banner__sep" aria-hidden>·</span>
                    <span className="agentic-os-switch-banner__title">
                      {agenticOsSwitchBanner.title}
                    </span>
                  </div>
                )}
                <div
                  className="modern-flowchat-container__messages-inner agentic-os-messages-fade"
                  key={`agentic-os-fade-${agenticOsFadeKey}`}
                >
                  {virtualItems.length === 0 ? (
                    <WelcomePanel
                      key={activeSession?.sessionId ?? 'welcome'}
                      sessionId={activeSession?.sessionId}
                      workspacePath={activeSession?.workspacePath}
                      preferredDescriptor={activeSession?.descriptor}
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

              <AgenticOsTimelineSidebar
                ref={turnListSidebarRef}
                open={turnListOpen}
                data={agenticOsTimeline}
                activeSessionId={activeSession?.sessionId}
                activeTurnId={effectiveVisibleTurnInfo?.turnId}
                onSelectTurn={handleAgenticOsTimelineTurnSelect}
                onSelectSession={handleAgenticOsTimelineSessionSelect}
                onCreateSession={handleAgenticOsCreateSession}
                onDeleteSessions={handleAgenticOsDeleteSessions}
                searchQuery={agenticOsTimelineQuery}
                onSearchChange={setAgenticOsTimelineQuery}
                searchMatchCount={agenticOsSearch.orderedMatches.length}
                searchCurrentMatch={
                  agenticOsSearch.orderedMatches.length > 0
                    ? agenticOsTimelineMatchCursor + 1
                    : 0
                }
                onSearchNext={handleAgenticOsSearchNext}
                onSearchPrev={handleAgenticOsSearchPrev}
                onSearchClose={handleAgenticOsSearchClose}
                searchFocusRequest={turnListSearchFocusRequest}
                searchMatchedTurnIds={
                  agenticOsTimelineQuery.trim().length > 0
                    ? agenticOsSearch.matchedTurnIds
                    : undefined
                }
                searchMatchedSessionIds={
                  agenticOsTimelineQuery.trim().length > 0
                    ? agenticOsSearch.matchedSessionIds
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
