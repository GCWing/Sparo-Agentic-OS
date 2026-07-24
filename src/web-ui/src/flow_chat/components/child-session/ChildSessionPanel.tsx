import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import path from 'path-browserify';
import { Link2, CornerUpLeft } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import {
  FlowChatContext,
  FlowChatStaticContext,
  FlowChatViewContext,
} from '../modern/FlowChatContext';
import { VirtualItemRenderer } from '../modern/VirtualItemRenderer';
import { ProcessingIndicator } from '../modern/ProcessingIndicator';
import { flowChatStore } from '../../store/FlowChatStore';
import type { FlowChatConfig, Session } from '../../types/flow-chat';
import { getSessionVirtualItems } from '../../projections/flowChatProjectionScheduler';
import { useExploreGroupState } from '../modern/useExploreGroupState';
import { useFlowChatStoreSelector } from '../../hooks/useFlowChatStoreSelector';
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
import { projectProcessingAffordance } from '../../projections/processingAffordanceProjection';
import { useStableProcessingAffordance } from '../modern/useStableProcessingAffordance';
import { canHydrateSession } from '../../domain/sessionLoadPhase';
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
  const { childSession, parentSession } = useFlowChatStoreSelector((state) => ({
    childSession: childSessionId ? state.sessions.get(childSessionId) : undefined,
    parentSession: parentSessionId ? state.sessions.get(parentSessionId) : undefined,
  }), (left, right) =>
    left.childSession === right.childSession &&
    left.parentSession === right.parentSession
  );
  const resolvedVariant = resolveVariant(variant, childSession);
  const virtualItems = useMemo(() => getSessionVirtualItems(childSession ?? null), [childSession]);
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
    if (!canHydrateSession(childSession)) return;
    if (isLoadingRef.current) return;

    const pathValue = workspacePath ?? childSession.workspacePath;
    if (!pathValue) return;

    isLoadingRef.current = true;
    flowChatStore.loadSessionHistory(
      childSessionId,
      pathValue,
      childSession.domain,
    ).finally(() => {
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

  const streamingOutputProjection = useMemo(
    () => projectStreamingOutput(childSession),
    [childSession],
  );
  const isTurnProcessing = streamingOutputProjection.isStreamingOutput;
  const processingAffordanceProjection = useMemo(
    () => projectProcessingAffordance({
      session: childSession,
      isProcessing: isTurnProcessing,
    }),
    [childSession, isTurnProcessing],
  );
  const processingAffordance = useStableProcessingAffordance(processingAffordanceProjection);

  const btwOrigin = childSession?.btwOrigin;
  const isReviewSession = childSession?.config.agentType === 'CodeReview';
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

        <div className="child-session-panel__body">
          {virtualItems.length === 0 ? (
            <div className="child-session-panel__empty-state">{t('session.empty')}</div>
          ) : (
            <Virtuoso
              className="child-session-panel__virtual-list"
              data={virtualItems}
              followOutput={isTurnProcessing ? 'smooth' : false}
              increaseViewportBy={{ top: 240, bottom: 360 }}
              initialItemCount={Math.min(virtualItems.length, 12)}
              computeItemKey={(index, item) => `${item.turnId}-${item.type}-${index}`}
              itemContent={(index, item) => (
                <VirtualItemRenderer
                  item={item}
                  index={index}
                />
              )}
              components={{
                Footer: () => (
                  <>
                    <ProcessingIndicator
                      visible={processingAffordance.visible}
                      reserveSpace={processingAffordance.reserveSpace}
                      resetKey={processingAffordance.resetKey}
                    />
                    <div className="child-session-panel__tail-spacer" />
                  </>
                ),
              }}
            />
          )}
        </div>
          </div>
        </FlowChatViewContext.Provider>
      </FlowChatStaticContext.Provider>
    </FlowChatContext.Provider>
  );
};

ChildSessionPanel.displayName = 'ChildSessionPanel';
