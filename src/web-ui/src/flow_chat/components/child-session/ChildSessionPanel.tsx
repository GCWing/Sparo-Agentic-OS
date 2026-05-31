import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import path from 'path-browserify';
import { Link2, CornerUpLeft } from 'lucide-react';
import {
  FlowChatContext,
  FlowChatStaticContext,
  FlowChatViewContext,
} from '../modern/FlowChatContext';
import { VirtualItemRenderer } from '../modern/VirtualItemRenderer';
import { ProcessingIndicator } from '../modern/ProcessingIndicator';
import { flowChatStore } from '../../store/FlowChatStore';
import type { FlowChatConfig, FlowChatState, Session } from '../../types/flow-chat';
import { sessionToVirtualItems } from '../../store/modernFlowChatStore';
import { useExploreGroupState } from '../modern/useExploreGroupState';
import {
  FLOWCHAT_FOCUS_ITEM_EVENT,
  type FlowChatFocusItemRequest,
} from '../../events/flowchatNavigation';
import { fileTabManager } from '@/shared/services/FileTabManager';
import { createTab } from '@/shared/utils/tabUtils';
import { IconButton } from '@/design-system';
import type { LineRange } from '@/shared/markdown';
import { globalEventBus } from '@/infrastructure/event-bus';
import { projectStreamingOutput } from '../../projections/streamingOutputProjection';
import { getToolViewState } from '../../runtime/toolViewState';
import { usePlainFlowScrollController } from '../../scroll/adapters/usePlainFlowScrollController';
import './ChildSessionPanel.scss';

export interface ChildSessionPanelProps {
  childSessionId?: string;
  parentSessionId?: string;
  workspacePath?: string;
  variant?: 'btw';
}

const PANEL_CONFIG: FlowChatConfig = {
  enableMarkdown: true,
  autoScroll: true,
  showTimestamps: false,
  maxHistoryRounds: 50,
  enableVirtualScroll: false,
  theme: 'dark',
};

const resolveVariant = (
  variant: ChildSessionPanelProps['variant'],
  _session?: Session | null
): 'btw' =>
  variant || 'btw';

const resolveSessionTitle = (session?: Session | null, fallback = 'Side thread') =>
  session?.title?.trim() || fallback;

export const ChildSessionPanel: React.FC<ChildSessionPanelProps> = ({
  childSessionId,
  parentSessionId,
  workspacePath,
  variant,
}) => {
  const { t } = useTranslation('flow-chat');
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() => flowChatStore.getState());
  useEffect(() => {
    const unsubscribe = flowChatStore.subscribe(setFlowChatState);
    return unsubscribe;
  }, []);

  const childSession = childSessionId ? flowChatState.sessions.get(childSessionId) : undefined;
  const parentSession = parentSessionId ? flowChatState.sessions.get(parentSessionId) : undefined;
  const resolvedVariant = resolveVariant(variant, childSession);
  const virtualItems = useMemo(() => sessionToVirtualItems(childSession ?? null), [childSession]);
  const {
    exploreGroupStates,
    onExploreGroupToggle,
    onExpandGroup,
    onExpandAllInTurn,
    onCollapseGroup,
  } = useExploreGroupState(virtualItems);

  const isLoadingRef = useRef(false);
  useEffect(() => {
    if (!childSessionId || !childSession) return;
    if (!childSession.isHistorical) return;
    if (isLoadingRef.current) return;

    const pathValue = workspacePath ?? childSession.workspacePath;
    if (!pathValue) return;

    isLoadingRef.current = true;
    flowChatStore.loadSessionHistory(childSessionId, pathValue).finally(() => {
      isLoadingRef.current = false;
    });
  }, [childSessionId, childSession, workspacePath]);

  const handleFileViewRequest = useCallback(
    (filePath: string, fileName: string, lineRange?: LineRange) => {
      let absoluteFilePath = filePath;
      const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(filePath);

      if (!isWindowsAbsolutePath && !path.isAbsolute(filePath) && workspacePath) {
        absoluteFilePath = path.join(workspacePath, filePath);
      }

      fileTabManager.openFile({
        filePath: absoluteFilePath,
        fileName,
        workspacePath,
        jumpToRange: lineRange,
        mode: 'agent',
      });
    },
    [workspacePath]
  );

  const handleTabOpen = useCallback((tabInfo: any) => {
    if (!tabInfo?.type) return;
    createTab({
      type: tabInfo.type,
      title: tabInfo.title || 'New Tab',
      data: tabInfo.data,
      metadata: tabInfo.metadata,
      checkDuplicate: !!tabInfo.metadata?.duplicateCheckKey,
      duplicateCheckKey: tabInfo.metadata?.duplicateCheckKey,
      replaceExisting: false,
      mode: 'agent',
    });
  }, []);

  const staticContextValue = useMemo(
    () => ({
      onFileViewRequest: handleFileViewRequest,
      onTabOpen: handleTabOpen,
      sessionId: childSessionId,
      config: PANEL_CONFIG,
    }),
    [childSessionId, handleFileViewRequest, handleTabOpen]
  );

  const viewContextValue = useMemo(
    () => ({
      exploreGroupStates,
      onExploreGroupToggle,
      onExpandGroup,
      onExpandAllInTurn,
      onCollapseGroup,
    }),
    [
      exploreGroupStates,
      onCollapseGroup,
      onExpandAllInTurn,
      onExpandGroup,
      onExploreGroupToggle,
    ]
  );

  const contextValue = useMemo(
    () => ({
      ...staticContextValue,
      ...viewContextValue,
      activeSessionOverride: childSession ?? null,
    }),
    [childSession, staticContextValue, viewContextValue]
  );

  const lastDialogTurn = childSession?.dialogTurns[childSession.dialogTurns.length - 1];
  const lastModelRound = lastDialogTurn?.modelRounds[lastDialogTurn.modelRounds.length - 1];
  const lastItem = lastModelRound?.items[lastModelRound.items.length - 1];
  const lastItemContent =
    lastItem && 'content' in lastItem ? String((lastItem as any).content || '') : '';
  const streamingOutputProjection = useMemo(
    () => projectStreamingOutput(childSession),
    [childSession],
  );
  const isTurnProcessing = streamingOutputProjection.isStreamingOutput;
  const { scrollContainerRef } = usePlainFlowScrollController({
    isStreaming: isTurnProcessing,
    dependencies: [virtualItems],
    resetKey: childSessionId,
  });
  const [isContentGrowing, setIsContentGrowing] = useState(true);
  const lastContentRef = useRef(lastItemContent);
  const contentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastItemContent !== lastContentRef.current) {
      lastContentRef.current = lastItemContent;
      setIsContentGrowing(true);
      if (contentTimeoutRef.current) clearTimeout(contentTimeoutRef.current);
      contentTimeoutRef.current = setTimeout(() => {
        setIsContentGrowing(false);
      }, 500);
    }

    return () => {
      if (contentTimeoutRef.current) {
        clearTimeout(contentTimeoutRef.current);
      }
    };
  }, [lastItemContent]);

  useEffect(() => {
    if (!isTurnProcessing) {
      setIsContentGrowing(false);
    }
  }, [isTurnProcessing]);

  const showProcessingIndicator = useMemo(() => {
    if (!isTurnProcessing) return false;
    if (!lastItem) return true;

    if (lastItem.type === 'text' || lastItem.type === 'thinking') {
      const hasContent = 'content' in lastItem && Boolean((lastItem as any).content);
      if (hasContent && isContentGrowing) {
        return false;
      }
    }

    if (lastItem.type === 'tool') {
      if (getToolViewState(lastItem).isLive) {
        return false;
      }
    }

    return true;
  }, [isTurnProcessing, lastItem, isContentGrowing]);

  const btwOrigin = childSession?.btwOrigin;
  const isReviewSession = childSession?.mode === 'CodeReview';
  const isBtwVariant = resolvedVariant === 'btw';
  const parentFallback = t('btw.parent');
  const parentLabel = resolveSessionTitle(parentSession, parentFallback);
  const backTooltip = btwOrigin?.parentTurnIndex
    ? t('flowChatHeader.btwBackTooltipWithTurn', {
        title: parentLabel,
        turn: btwOrigin.parentTurnIndex,
        defaultValue: `Go back to the source session: ${parentLabel} (Turn ${btwOrigin.parentTurnIndex})`,
      })
    : t('flowChatHeader.btwBackTooltipWithoutTurn', {
        title: parentLabel,
        defaultValue: `Go back to the source session: ${parentLabel}`,
      });
  const canReturnToParentSession =
    isBtwVariant && isReviewSession && !!(btwOrigin?.parentSessionId || parentSessionId);

  const handleFocusOriginTurn = useCallback(() => {
    const resolvedParentSessionId = btwOrigin?.parentSessionId || parentSessionId;
    if (!resolvedParentSessionId) return;

    const requestId = btwOrigin?.requestId;
    const itemId = requestId ? `btw_marker_${requestId}` : undefined;
    const request: FlowChatFocusItemRequest = {
      sessionId: resolvedParentSessionId,
      turnIndex: btwOrigin?.parentTurnIndex,
      itemId,
      source: 'btw-back',
    };

    globalEventBus.emit(FLOWCHAT_FOCUS_ITEM_EVENT, request, 'ChildSessionPanel');
  }, [btwOrigin, parentSessionId]);

  const badgeLabel = t('btw.shortLabel');
  const threadLabel = t('btw.threadLabel');
  const originLabel = t('btw.origin');

  if (!childSessionId || !childSession) {
    return (
      <div className="child-session-panel child-session-panel--empty">
        <div className="child-session-panel__empty-state">
          {t('btw.emptyThreadLabel', { label: t('btw.threadLabel') })}
        </div>
      </div>
    );
  }

  return (
    <FlowChatContext.Provider value={contextValue}>
      <FlowChatStaticContext.Provider value={staticContextValue}>
        <FlowChatViewContext.Provider value={viewContextValue}>
          <div className="child-session-panel">
        <div className="child-session-panel__header">
          <div className="child-session-panel__header-left">
            <span className="child-session-panel__badge">{badgeLabel}</span>
          </div>
          <div className="child-session-panel__header-title-wrap">
            <span className="child-session-panel__title">
              {resolveSessionTitle(childSession, threadLabel)}
            </span>
          </div>
          <div className="child-session-panel__header-right">
            <div className="child-session-panel__meta">
              <span className="child-session-panel__meta-label">{originLabel}</span>
              <Link2 size={11} />
              <span className="child-session-panel__meta-title">{parentLabel}</span>
            </div>
            {canReturnToParentSession && (
              <IconButton
                className="child-session-panel__origin-button"
                variant="ghost"
                size="xs"
                onClick={handleFocusOriginTurn}
                tooltip={backTooltip}
                aria-label={t('btw.backToParent')}
                data-testid="btw-session-panel-origin-button"
              >
                <CornerUpLeft size={12} />
              </IconButton>
            )}
          </div>
        </div>

        <div ref={scrollContainerRef} className="child-session-panel__body">
          {virtualItems.length === 0 ? (
            <div className="child-session-panel__empty-state">{t('session.empty')}</div>
          ) : (
            <>
              {virtualItems.map((item, index) => (
                <VirtualItemRenderer
                  key={`${item.turnId}-${item.type}-${index}`}
                  item={item}
                  index={index}
                />
              ))}
              <ProcessingIndicator visible={showProcessingIndicator} reserveSpace={isTurnProcessing} />
            </>
          )}
        </div>
          </div>
        </FlowChatViewContext.Provider>
      </FlowChatStaticContext.Provider>
    </FlowChatContext.Provider>
  );
};

ChildSessionPanel.displayName = 'ChildSessionPanel';
