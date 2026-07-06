/**
 * Shared FlowChat core logic.
 * Used by both AgenticOSFlowChatContainer and StandardFlowChatContainer.
 * Contains session-type-agnostic state, hooks, and handlers.
 */

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExploreGroupState } from './useExploreGroupState';
import { useFlowChatFileActions } from './useFlowChatFileActions';
import { useFlowChatNavigation } from './useFlowChatNavigation';
import { useFlowChatCopyDialog } from './useFlowChatCopyDialog';
import { useFlowChatSync } from './useFlowChatSync';
import { useFlowChatToolActions } from './useFlowChatToolActions';
import { useFlowChatSearch } from './useFlowChatSearch';
import {
  useActiveSessionMeta,
  useScopedSession,
  useVisibleTurnInfo,
  getSessionVirtualItems,
  sessionToActiveSessionMeta,
  type VisibleTurnInfo,
} from '../../store/modernFlowChatStore';
import type { FlowChatConfig } from '../../types/flow-chat';
import type { LineRange } from '@/shared/markdown';
import type { FlowChatHeaderTurnSummary } from './FlowChatHeader';
import type { VirtualMessageListRef } from './VirtualMessageList';
import type {
  FlowChatStaticContextValue,
  FlowChatViewContextValue,
} from './FlowChatContext';

export interface UseFlowChatCoreOptions {
  initialTurnListOpen?: boolean;
  sessionId?: string | null;
  workspacePath?: string | null;
  config?: Partial<FlowChatConfig>;
  onFileViewRequest?: (filePath: string, fileName: string, lineRange?: LineRange) => void;
  onTabOpen?: (tabInfo: any, sessionId?: string, panelType?: string) => void;
  onOpenVisualization?: (type: string, data: any) => void;
  onSwitchToChatPanel?: () => void;
}

export function useFlowChatCore(options: UseFlowChatCoreOptions = {}) {
  const {
    initialTurnListOpen = false,
    sessionId,
    workspacePath: scopedWorkspacePath,
    config,
    onFileViewRequest,
    onTabOpen,
    onOpenVisualization,
    onSwitchToChatPanel,
  } = options;

  const { t } = useTranslation('flow-chat');
  const scopedSession = useScopedSession(sessionId);
  const activeSession = useMemo(
    () => sessionToActiveSessionMeta(scopedSession),
    [scopedSession],
  );
  const virtualItems = useMemo(
    () => getSessionVirtualItems(scopedSession),
    [scopedSession],
  );
  const modernActiveSession = useActiveSessionMeta();
  const rawVisibleTurnInfo = useVisibleTurnInfo();
  const visibleTurnInfo = activeSession.sessionId === modernActiveSession.sessionId
    ? rawVisibleTurnInfo
    : null;
  const effectiveWorkspacePath =
    activeSession.workspacePath ?? scopedWorkspacePath ?? undefined;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [pendingHeaderTurnId, setPendingHeaderTurnId] = useState<string | null>(null);
  const [searchOpenRequest, setSearchOpenRequest] = useState(0);
  const [turnListSearchFocusRequest, setTurnListSearchFocusRequest] = useState(0);
  const [turnListOpen, setTurnListOpen] = useState(initialTurnListOpen);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const virtualListRef = useRef<VirtualMessageListRef>(null);
  const chatScopeRef = useRef<HTMLDivElement>(null);
  const turnListSidebarRef = useRef<HTMLElement | null>(null);

  // ── Sub-hooks ─────────────────────────────────────────────────────────────
  const {
    exploreGroupStates,
    onExploreGroupToggle: handleExploreGroupToggle,
    onExpandGroup: handleExpandGroup,
    onExpandAllInTurn: handleExpandAllInTurn,
    onCollapseGroup: handleCollapseGroup,
  } = useExploreGroupState(virtualItems);

  const { handleToolConfirm, handleToolReject } = useFlowChatToolActions();
  const { handleFileViewRequest } = useFlowChatFileActions({
    workspacePath: effectiveWorkspacePath,
    onFileViewRequest,
  });

  useFlowChatSync();
  useFlowChatCopyDialog();
  useFlowChatNavigation({
    activeSessionId: activeSession?.sessionId,
    virtualItems,
    virtualListRef,
  });

  // In-message search, used for highlight context by both container types.
  const {
    searchQuery,
    onSearchChange,
    matches: searchMatches,
    matchIndices: searchMatchIndices,
    currentMatchIndex: searchCurrentMatchIndex,
    currentMatchVirtualIndex: searchCurrentMatchVirtualIndex,
    goToNext: handleSearchNext,
    goToPrev: handleSearchPrev,
    clearSearch,
  } = useFlowChatSearch(virtualItems);

  // ── Turn summaries ────────────────────────────────────────────────────────
  const turnSummaries = useMemo<FlowChatHeaderTurnSummary[]>(
    () =>
      virtualItems
        .filter((item): item is Extract<typeof item, { type: 'user-message' }> => item.type === 'user-message')
        .map(item => ({
          turnId: item.turnId,
          turnIndex: item.turnIndex + 1,
          title: item.data?.content ?? '',
          startedAt: item.turnStartMs,
        })),
    [virtualItems],
  );

  const untitledTurnLabel = t('flowChatHeader.untitledTurn', { defaultValue: 'Untitled turn' });
  const displayTurns = useMemo(
    () => turnSummaries.map(turn => ({ ...turn, title: turn.title.trim() || untitledTurnLabel })),
    [turnSummaries, untitledTurnLabel],
  );

  // ── Effective visible turn (optimistic while pending) ─────────────────────
  const effectiveVisibleTurnInfo = useMemo<VisibleTurnInfo | null>(() => {
    if (!pendingHeaderTurnId) return visibleTurnInfo;
    const targetTurn = turnSummaries.find(t => t.turnId === pendingHeaderTurnId);
    if (!targetTurn) return visibleTurnInfo;
    return {
      turnId: targetTurn.turnId,
      turnIndex: targetTurn.turnIndex,
      totalTurns: turnSummaries.length,
      userMessage: targetTurn.title,
    };
  }, [pendingHeaderTurnId, turnSummaries, visibleTurnInfo]);

  useEffect(() => {
    if (!pendingHeaderTurnId) return;
    if (visibleTurnInfo?.turnId === pendingHeaderTurnId) {
      setPendingHeaderTurnId(null);
      return;
    }
    if (!turnSummaries.some(t => t.turnId === pendingHeaderTurnId)) {
      setPendingHeaderTurnId(null);
    }
  }, [pendingHeaderTurnId, turnSummaries, visibleTurnInfo?.turnId]);

  useEffect(() => {
    setPendingHeaderTurnId(null);
  }, [activeSession?.sessionId]);

  // ── Jump to turn ──────────────────────────────────────────────────────────
  const handleJumpToTurn = useCallback(
    (turnId: string) => {
      if (!turnId) return;
      const isLatest = turnSummaries[turnSummaries.length - 1]?.turnId === turnId;
      const accepted =
        virtualListRef.current?.pinTurnToTop(turnId, {
          behavior: 'smooth',
          pinMode: isLatest ? 'sticky-latest' : 'transient',
        }) ?? false;
      setPendingHeaderTurnId(accepted ? turnId : null);
    },
    [turnSummaries],
  );

  // ── Scroll to current search match ───────────────────────────────────────
  useEffect(() => {
    if (searchCurrentMatchVirtualIndex < 0) return;
    const frameId = requestAnimationFrame(() => {
      virtualListRef.current?.scrollToIndex(searchCurrentMatchVirtualIndex);
    });
    return () => cancelAnimationFrame(frameId);
  }, [searchCurrentMatchVirtualIndex]);

  // ── Context value builders ────────────────────────────────────────────────
  const staticContextValue = useMemo<FlowChatStaticContextValue>(
    () => ({
      onFileViewRequest: handleFileViewRequest,
      onTabOpen,
      onOpenVisualization,
      onSwitchToChatPanel,
      onToolConfirm: handleToolConfirm,
      onToolReject: handleToolReject,
      sessionId: activeSession?.sessionId,
      config: {
        enableMarkdown: true,
        autoScroll: true,
        showTimestamps: false,
        maxHistoryRounds: 50,
        enableVirtualScroll: true,
        theme: 'dark',
        ...config,
      },
    }),
    [
      handleFileViewRequest,
      onTabOpen,
      onOpenVisualization,
      onSwitchToChatPanel,
      handleToolConfirm,
      handleToolReject,
      activeSession?.sessionId,
      config,
    ],
  );

  const viewContextValue = useMemo<FlowChatViewContextValue>(
    () => ({
      exploreGroupStates,
      onExploreGroupToggle: handleExploreGroupToggle,
      onExpandGroup: handleExpandGroup,
      onExpandAllInTurn: handleExpandAllInTurn,
      onCollapseGroup: handleCollapseGroup,
      searchQuery,
      searchMatchIndices,
      searchCurrentMatchVirtualIndex,
    }),
    [
      exploreGroupStates,
      handleExploreGroupToggle,
      handleExpandGroup,
      handleExpandAllInTurn,
      handleCollapseGroup,
      searchQuery,
      searchMatchIndices,
      searchCurrentMatchVirtualIndex,
    ],
  );

  const searchMatchedTurnIds = useMemo(
    () => new Set(searchMatches.map(m => m.turnId)),
    [searchMatches],
  );

  return {
    // Store data
    virtualItems,
    activeSession,
    visibleTurnInfo,
    effectiveVisibleTurnInfo,

    // Refs
    virtualListRef,
    chatScopeRef,
    turnListSidebarRef,

    // Turn data
    turnSummaries,
    displayTurns,

    // Explore group
    exploreGroupStates,
    handleExploreGroupToggle,
    handleExpandGroup,
    handleExpandAllInTurn,
    handleCollapseGroup,

    // Actions
    handleJumpToTurn,

    // In-message search
    searchQuery,
    onSearchChange,
    searchMatches,
    searchMatchedTurnIds,
    searchMatchIndices,
    searchCurrentMatchIndex,
    searchCurrentMatchVirtualIndex,
    handleSearchNext,
    handleSearchPrev,
    clearSearch,

    // UI state
    pendingHeaderTurnId,
    setPendingHeaderTurnId,
    turnListOpen,
    setTurnListOpen,
    searchOpenRequest,
    setSearchOpenRequest,
    turnListSearchFocusRequest,
    setTurnListSearchFocusRequest,

    // Workspace
    workspacePath: effectiveWorkspacePath,

    // Pre-built context values
    staticContextValue,
    viewContextValue,
  };
}
