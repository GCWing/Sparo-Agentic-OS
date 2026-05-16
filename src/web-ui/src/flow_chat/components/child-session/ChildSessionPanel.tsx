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
import type { SessionKind } from '@/shared/types/session-history';
import './ChildSessionPanel.scss';

export interface ChildSessionPanelProps {
  childSessionId?: string;
  parentSessionId?: string;
  workspacePath?: string;
  variant?: Extract<SessionKind, 'btw' | 'host_scan'>;
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
  session?: Session | null
): Extract<SessionKind, 'btw' | 'host_scan'> =>
  variant || (session?.sessionKind === 'host_scan' ? 'host_scan' : 'btw');

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

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

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        shouldAutoScrollRef.current = false;
      } else if (event.deltaY > 0) {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        if (distanceFromBottom < 100) {
          shouldAutoScrollRef.current = true;
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !shouldAutoScrollRef.current) return;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [virtualItems]);

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
  const isTurnProcessing =
    lastDialogTurn?.status === 'processing' ||
    lastDialogTurn?.status === 'finishing' ||
    lastDialogTurn?.status === 'image_analyzing';
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
      const toolStatus = (lastItem as any).status;
      if (toolStatus === 'running' || toolStatus === 'streaming' || toolStatus === 'preparing') {
        return false;
      }
    }

    return true;
  }, [isTurnProcessing, lastItem, isContentGrowing]);

  const btwOrigin = childSession?.btwOrigin;
  const isReviewSession = childSession?.mode === 'CodeReview';
  const isBtwVariant = resolvedVariant === 'btw';
  const parentFallback =
    resolvedVariant === 'host_scan'
      ? t('hostScan.parent', { defaultValue: 'Source session' })
      : t('btw.parent');
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

  const badgeLabel = isBtwVariant
    ? t('btw.shortLabel')
    : t('hostScan.shortLabel', { defaultValue: 'host scan' });
  const threadLabel = isBtwVariant
    ? t('btw.threadLabel')
    : t('hostScan.threadLabel', { defaultValue: 'Host scan' });
  const originLabel = isBtwVariant
    ? t('btw.origin')
    : t('hostScan.origin', { defaultValue: 'From session' });

  if (!childSessionId || !childSession) {
    return (
      <div className="child-session-panel child-session-panel--empty">
        <div className="child-session-panel__empty-state">
          {isBtwVariant
            ? t('btw.emptyThreadLabel', { label: t('btw.threadLabel') })
            : t('hostScan.emptyThreadLabel', {
                label: t('hostScan.threadLabel', { defaultValue: 'Host scan' }),
                defaultValue: 'No {{label}} thread yet',
              })}
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
