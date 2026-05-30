/**
 * Virtualized message list.
 * Renders a flattened DialogTurn stream (user messages + model rounds).
 *
 * Scroll policy (simplified):
 * - The list preserves the current viewport by default.
 * - A new turn first pins the latest user message near the top for reading.
 * - Follow mode starts explicitly via "jump to latest", or automatically once
 *   the latest turn's streaming output grows enough to consume the sticky tail space.
 * - User upward scroll intent exits follow and cancels any pending auto-follow arm.
 * - "Scroll to latest" bar appears whenever the list is not at bottom.
 */

import React, { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useActiveSessionState } from '../../hooks/useActiveSessionState';
import { VirtualItemRenderer } from './VirtualItemRenderer';
import { ScrollToLatestBar } from '../ScrollToLatestBar';
import { ProcessingIndicator } from './ProcessingIndicator';
import { ScrollAnchor } from './ScrollAnchor';
import {
  useVirtuosoFlowFollowOutput,
  type FollowOutputEnterReason,
  type FollowOutputExitReason,
} from '../../scroll/adapters/useVirtuosoFlowFollowOutput';
import { useVirtuosoFlowLayoutMutationBridge } from '../../scroll/adapters/useVirtuosoFlowLayoutMutationBridge';
import { useVirtuosoFlowLayoutObservers } from '../../scroll/adapters/useVirtuosoFlowLayoutObservers';
import { useVirtuosoFlowUserIntentBridge } from '../../scroll/adapters/useVirtuosoFlowUserIntentBridge';
import { useVirtuosoVisibleTurnTracker } from '../../scroll/adapters/useVirtuosoVisibleTurnTracker';
import { useVirtuosoFlowGeometryController } from '../../scroll/adapters/useVirtuosoFlowGeometryController';
import { useVirtuosoFlowNavigationController } from '../../scroll/adapters/useVirtuosoFlowNavigationController';
import type { FlowChatPinTurnToTopMode } from '../../events/flowchatNavigation';
import { useVirtualItems, useActiveSession } from '../../store/modernFlowChatStore';
import { useChatInputState } from '../../store/chatInputStateStore';
import { computeFlowChatInputStackFooterPx } from '../../utils/flowChatScrollLayout';
import { projectStreamingOutput } from '../../projections/streamingOutputProjection';
import { getToolViewState } from '../../runtime/toolViewState';
import { COMPENSATION_EPSILON_PX } from '../../scroll/FlowScrollGeometry';
import './VirtualMessageList.scss';

// Read `FLOWCHAT_SCROLL_STABILITY.md` before changing collapse compensation logic.

/**
 * Methods exposed by VirtualMessageList.
 */
export interface VirtualMessageListRef {
  scrollToTurn: (turnIndex: number) => void;
  scrollToIndex: (index: number) => void;
  // Clears pin reservation first, then scrolls to the physical bottom.
  scrollToPhysicalBottomAndClearPin: () => void;
  // Preserves any existing pin reservation and behaves like an End-key scroll.
  scrollToLatestEndPosition: () => void;
  // Aligns the target turn's user message to the viewport top.
  pinTurnToTop: (turnId: string, options?: { behavior?: ScrollBehavior; pinMode?: FlowChatPinTurnToTopMode }) => boolean;
}

export interface VirtualMessageListProps {
  /**
   * When true, hide the right-edge scroll milestone dots. Used while the
   * turn-list / timeline sidebar is open so anchors do not overlap the panel.
   */
  hideScrollAnchor?: boolean;
}

export const VirtualMessageList = forwardRef<VirtualMessageListRef, VirtualMessageListProps>(
  ({ hideScrollAnchor = false }, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const virtualItems = useVirtualItems();
  const activeSession = useActiveSession();

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);

  const scrollerElementRef = useRef<HTMLElement | null>(null);
  const footerElementRef = useRef<HTMLDivElement | null>(null);
  const layoutTransitionCountRef = useRef(0);
  const followOutputControllerRef = useRef<{
    handleUserScrollIntent: () => void;
    handleScroll: () => void;
    scheduleFollowToLatest: (reason: string) => void;
  }>({
    handleUserScrollIntent: () => {},
    handleScroll: () => {},
    scheduleFollowToLatest: () => {},
  });
  const deferredFollowReasonRef = useRef<string | null>(null);
  const enterFollowOutputRef = useRef<(reason: FollowOutputEnterReason) => void>(() => {});
  const exitFollowOutputRef = useRef<(reason: FollowOutputExitReason) => void>(() => {});
  // Mirror of `isFollowingOutput` for use inside listeners that are registered
  // once per mount. When follow mode is active we deliberately bypass collapse
  // pre-compensation and anchor lock so the continuous follow loop can keep
  // tracking the bottom without fighting the layout-stability machinery.
  const isFollowingOutputRef = useRef(false);
  const isStreamingOutputRef = useRef(false);

  const isInputActive = useChatInputState(state => state.isActive);
  const isInputExpanded = useChatInputState(state => state.isExpanded);
  const inputHeight = useChatInputState(state => state.inputHeight);

  const inputStackFooterPxRef = useRef(0);
  const inputStackFooterPx = computeFlowChatInputStackFooterPx(inputHeight, isInputActive);
  inputStackFooterPxRef.current = inputStackFooterPx;

  const activeSessionState = useActiveSessionState();
  const isProcessing = activeSessionState.isProcessing;
  const processingPhase = activeSessionState.processingPhase;
  const {
    bottomReservationState,
    bottomReservationStateRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    anchorLockRef,
    pendingCollapseIntentRef,
    getFooterHeightPx,
    getTotalBottomCompensationPx,
    snapshotMeasuredContentHeight,
    updateBottomReservationState,
    resetBottomReservations,
    resetTransientGeometryState,
    consumeBottomCompensation,
    applyFooterCompensationNow,
    releaseAnchorLock,
    activateAnchorLock,
    scheduleHeightMeasure,
  } = useVirtuosoFlowGeometryController({
    footerElementRef,
    scrollerElementRef,
    inputStackFooterPxRef,
    layoutTransitionCountRef,
    isFollowingOutputRef,
    isStreamingOutputRef,
  });

  const userMessageItems = React.useMemo(() => {
    return virtualItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'user-message');
  }, [virtualItems]);

  const latestTurnId = userMessageItems[userMessageItems.length - 1]?.item.turnId ?? null;
  const latestUserMessageIndex = userMessageItems[userMessageItems.length - 1]?.index ?? 0;
  const latestTurnAutoFollowStateRef = useRef<{
    turnId: string | null;
    sawPositiveFloor: boolean;
  }>({
    turnId: latestTurnId,
    sawPositiveFloor: false,
  });
  const hasPrimedMountedStreamingTurnFollowRef = useRef(false);
  const previousLatestTurnIdForFollowRef = useRef<string | null>(latestTurnId);
  const previousSessionIdForFollowRef = useRef<string | undefined>(activeSession?.sessionId);

  const { scheduleVisibleTurnMeasure } = useVirtuosoVisibleTurnTracker({
    activeSessionId: activeSession?.sessionId,
    scrollerElement,
    scrollerElementRef,
    userMessageItems,
    virtualItemCount: virtualItems.length,
  });

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    if (el && el instanceof HTMLElement) {
      scrollerElementRef.current = el;
      setScrollerElement(el);
      return;
    }

    scrollerElementRef.current = null;
    setScrollerElement(null);
  }, []);

  const shouldSuspendAutoFollow = useCallback(() => {
    const collapseIntent = pendingCollapseIntentRef.current;
    return (
      layoutTransitionCountRef.current > 0 ||
      (collapseIntent.active && collapseIntent.expiresAtMs >= performance.now())
    );
  }, [pendingCollapseIntentRef]);

  const scheduleFollowToLatestWithViewportState = useCallback((reason: string) => {
    const collapseIntentActive = shouldSuspendAutoFollow();
    if (collapseIntentActive) {
      deferredFollowReasonRef.current = reason;
      return;
    }
    deferredFollowReasonRef.current = null;
    followOutputControllerRef.current.scheduleFollowToLatest(reason);
  }, [shouldSuspendAutoFollow]);

  const scheduleDeferredFollowToLatest = useCallback((reason: string) => {
    followOutputControllerRef.current.scheduleFollowToLatest(reason);
  }, []);

  const {
    pendingTurnPin,
    performAutoFollowSync,
    requestTurnPinToTop,
    reconcileStickyPinReservation,
    schedulePinReservationReconcile,
    scrollToLatestEndPositionInternal,
    scrollToTurn,
    scrollToIndex,
    pinTurnToTop,
    scrollToPhysicalBottomAndClearPin,
    scrollToLatestEndPosition,
  } = useVirtuosoFlowNavigationController({
    activeSessionId: activeSession?.sessionId,
    virtuosoRef,
    scrollerElement,
    scrollerElementRef,
    virtualItemCount: virtualItems.length,
    userMessageItems,
    latestTurnId,
    bottomReservationStateRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    pendingCollapseIntentRef,
    layoutTransitionCountRef,
    getTotalBottomCompensationPx,
    snapshotMeasuredContentHeight,
    updateBottomReservationState,
    resetBottomReservations,
    resetTransientGeometryState,
    applyFooterCompensationNow,
    releaseAnchorLock,
    scheduleVisibleTurnMeasure,
    enterFollowOutputRef,
    exitFollowOutputRef,
  });

  useVirtuosoFlowLayoutMutationBridge({
    scrollerElement,
    isFollowingOutputRef,
    isStreamingOutputRef,
    bottomReservationStateRef,
    pendingCollapseIntentRef,
    scheduleHeightMeasure,
    scheduleVisibleTurnMeasure,
    schedulePinReservationReconcile,
    getTotalBottomCompensationPx,
    updateBottomReservationState,
    applyFooterCompensationNow,
    activateAnchorLock,
  });

  useVirtuosoFlowLayoutObservers({
    scrollerElement,
    isProcessing,
    layoutTransitionCountRef,
    pendingCollapseIntentRef,
    deferredFollowReasonRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    snapshotMeasuredContentHeight,
    scheduleHeightMeasure,
    scheduleVisibleTurnMeasure,
    schedulePinReservationReconcile,
    scheduleFollowToLatestWithViewportState,
    shouldSuspendAutoFollow,
    scheduleFollowToLatest: scheduleDeferredFollowToLatest,
  });

  useVirtuosoFlowUserIntentBridge({
    scrollerElement,
    anchorLockRef,
    layoutTransitionCountRef,
    previousScrollTopRef,
    previousMeasuredHeightRef,
    followOutputControllerRef,
    releaseAnchorLock,
    getTotalBottomCompensationPx,
    consumeBottomCompensation,
    applyFooterCompensationNow,
    snapshotMeasuredContentHeight,
    scheduleVisibleTurnMeasure,
  });

  // `rangeChanged` is affected by overscan/increaseViewportBy, so treat it as a
  // "rendered DOM changed" signal and derive the pinned turn from real DOM visibility.
  const handleRangeChanged = useCallback(() => {
    scheduleVisibleTurnMeasure(2);
    schedulePinReservationReconcile(2);
    scheduleFollowToLatestWithViewportState('range-changed');
  }, [scheduleFollowToLatestWithViewportState, schedulePinReservationReconcile, scheduleVisibleTurnMeasure]);

  const streamingOutputProjection = React.useMemo(
    () => projectStreamingOutput(activeSession),
    [activeSession],
  );
  const isStreamingOutput = isProcessing || streamingOutputProjection.isStreamingOutput;

  const {
    isFollowingOutput,
    enterFollowOutput,
    exitFollowOutput,
    armFollowOutputForNewTurn,
    activateArmedFollowOutput,
    cancelPendingAutoFollowArm,
    scheduleFollowToLatest,
    handleUserScrollIntent,
    handleScroll: handleFollowOutputScroll,
  } = useVirtuosoFlowFollowOutput({
    activeSessionId: activeSession?.sessionId,
    latestTurnId,
    virtualItemCount: virtualItems.length,
    isStreaming: isStreamingOutput,
    scrollerRef: scrollerElementRef,
    performUserFollowScroll: () => {
      scrollToLatestEndPositionInternal('smooth');
    },
    performAutoFollowScroll: performAutoFollowSync,
    performLatestTurnStickyPin: () => {
      if (latestTurnId) {
        requestTurnPinToTop(latestTurnId, {
          behavior: 'auto',
          pinMode: 'sticky-latest',
        });
      }
    },
    shouldSuspendAutoFollow,
    getAutoFollowDistanceFromBottom: (scroller) => (
      Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop - getTotalBottomCompensationPx())
    ),
    onContinuousFollowFrame: () => {
      // Keep sticky-latest pin floor aligned with the live DOM as collapses
      // shrink the layout. Without this the pin reservation would lag for one
      // RAF tick and the viewport would briefly land below the latest user
      // message.
      reconcileStickyPinReservation();
    },
  });

  useEffect(() => {
    if (hasPrimedMountedStreamingTurnFollowRef.current) {
      return;
    }

    hasPrimedMountedStreamingTurnFollowRef.current = true;
    if (!latestTurnId || !isStreamingOutput) {
      return;
    }

    latestTurnAutoFollowStateRef.current = {
      turnId: latestTurnId,
      sawPositiveFloor: false,
    };
    armFollowOutputForNewTurn();
  }, [
    activeSession?.sessionId,
    armFollowOutputForNewTurn,
    isStreamingOutput,
    latestTurnId,
    virtualItems.length,
  ]);

  useEffect(() => {
    const previousSessionId = previousSessionIdForFollowRef.current;
    if (previousSessionId !== activeSession?.sessionId) {
      previousSessionIdForFollowRef.current = activeSession?.sessionId;
      previousLatestTurnIdForFollowRef.current = latestTurnId;
      latestTurnAutoFollowStateRef.current = {
        turnId: latestTurnId,
        sawPositiveFloor: false,
      };
      return;
    }

    const previousLatestTurnId = previousLatestTurnIdForFollowRef.current;
    if (previousLatestTurnId === latestTurnId) {
      return;
    }

    previousLatestTurnIdForFollowRef.current = latestTurnId;
    latestTurnAutoFollowStateRef.current = {
      turnId: latestTurnId,
      sawPositiveFloor: false,
    };

    if (!latestTurnId) {
      cancelPendingAutoFollowArm();
      return;
    }

    armFollowOutputForNewTurn();
  }, [
    activeSession?.sessionId,
    armFollowOutputForNewTurn,
    cancelPendingAutoFollowArm,
    latestTurnId,
  ]);

  useEffect(() => {
    const trackingState = latestTurnAutoFollowStateRef.current;
    if (
      !latestTurnId ||
      trackingState.turnId !== latestTurnId ||
      isFollowingOutput ||
      !isStreamingOutput
    ) {
      return;
    }

    const hasPendingLatestStickyPin = (
      pendingTurnPin?.turnId === latestTurnId &&
      pendingTurnPin.pinMode === 'sticky-latest'
    );
    if (hasPendingLatestStickyPin) {
      return;
    }

    if (
      bottomReservationState.pin.mode !== 'sticky-latest' ||
      bottomReservationState.pin.targetTurnId !== latestTurnId
    ) {
      return;
    }

    if (bottomReservationState.pin.floorPx > COMPENSATION_EPSILON_PX) {
      trackingState.sawPositiveFloor = true;
      return;
    }

    if (activateArmedFollowOutput()) {
      latestTurnAutoFollowStateRef.current = {
        turnId: null,
        sawPositiveFloor: false,
      };
    }
  }, [
    activateArmedFollowOutput,
    bottomReservationState.pin.floorPx,
    bottomReservationState.pin.mode,
    bottomReservationState.pin.targetTurnId,
    isFollowingOutput,
    isStreamingOutput,
    latestTurnId,
    pendingTurnPin?.pinMode,
    pendingTurnPin?.turnId,
  ]);

  followOutputControllerRef.current = {
    handleUserScrollIntent,
    handleScroll: handleFollowOutputScroll,
    scheduleFollowToLatest,
  };
  enterFollowOutputRef.current = enterFollowOutput;
  exitFollowOutputRef.current = exitFollowOutput;
  isFollowingOutputRef.current = isFollowingOutput;
  isStreamingOutputRef.current = isStreamingOutput;

  useImperativeHandle(ref, () => ({
    scrollToTurn,
    scrollToIndex,
    scrollToPhysicalBottomAndClearPin,
    scrollToLatestEndPosition,
    pinTurnToTop,
  }), [pinTurnToTop, scrollToTurn, scrollToIndex, scrollToPhysicalBottomAndClearPin, scrollToLatestEndPosition]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
  }, []);

  // Last-item info for breathing indicator.
  const lastItemInfo = React.useMemo(() => {
    const dialogTurns = activeSession?.dialogTurns;
    const lastDialogTurn = dialogTurns && dialogTurns.length > 0
      ? dialogTurns[dialogTurns.length - 1]
      : undefined;
    const modelRounds = lastDialogTurn?.modelRounds;
    const lastModelRound = modelRounds && modelRounds.length > 0
      ? modelRounds[modelRounds.length - 1]
      : undefined;
    const items = lastModelRound?.items;
    const lastItem = items && items.length > 0
      ? items[items.length - 1]
      : undefined;

    const content = lastItem && 'content' in lastItem ? (lastItem as any).content : '';
    const isTurnProcessing = streamingOutputProjection.isStreamingOutput;

    return { lastItem, lastDialogTurn, content, isTurnProcessing };
  }, [activeSession, streamingOutputProjection.isStreamingOutput]);

  const [isContentGrowing, setIsContentGrowing] = useState(true);
  const lastContentRef = useRef(lastItemInfo.content);
  const contentTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const currentContent = lastItemInfo.content;

    if (currentContent !== lastContentRef.current) {
      lastContentRef.current = currentContent;
      setIsContentGrowing(true);

      if (contentTimeoutRef.current) {
        clearTimeout(contentTimeoutRef.current);
      }

      contentTimeoutRef.current = setTimeout(() => {
        setIsContentGrowing(false);
      }, 500);
    }

    return () => {
      if (contentTimeoutRef.current) {
        clearTimeout(contentTimeoutRef.current);
      }
    };
  }, [lastItemInfo.content]);

  useEffect(() => {
    if (!lastItemInfo.isTurnProcessing && !isProcessing) {
      setIsContentGrowing(false);
    }
  }, [lastItemInfo.isTurnProcessing, isProcessing]);

  const showBreathingIndicator = React.useMemo(() => {
    const { lastItem, isTurnProcessing } = lastItemInfo;

    if (!isTurnProcessing && !isProcessing) return false;
    if (processingPhase === 'tool_confirming') return false;
    if (!lastItem) return true;

    if ((lastItem.type === 'text' || lastItem.type === 'thinking')) {
      const hasContent = 'content' in lastItem && lastItem.content;
      if (hasContent && isContentGrowing) return false;
    }

    if (lastItem.type === 'tool') {
      if (getToolViewState(lastItem).isLive) {
        return false;
      }
    }

    return isTurnProcessing || isProcessing;
  }, [isProcessing, processingPhase, lastItemInfo, isContentGrowing]);

  const reserveSpaceForIndicator = React.useMemo(() => {
    if (!lastItemInfo.isTurnProcessing && !isProcessing) return false;
    if (processingPhase === 'tool_confirming') return false;
    return true;
  }, [lastItemInfo.isTurnProcessing, isProcessing, processingPhase]);

  const footerHeightPx = getFooterHeightPx(getTotalBottomCompensationPx(bottomReservationState));

  // Render.
  if (virtualItems.length === 0) {
    return (
      <div className="virtual-message-list virtual-message-list--empty">
        <div className="empty-state">
          <p>No messages yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="virtual-message-list">
      <Virtuoso
        ref={virtuosoRef}
        data={virtualItems}
        computeItemKey={(index, item) =>
          `${item.type}-${item.turnId}-${'data' in item && item.data && typeof item.data === 'object' && 'id' in item.data ? item.data.id : index}`
        }
        itemContent={(index, item) => (
          <VirtualItemRenderer
            item={item}
            index={index}
          />
        )}
        followOutput={false}

        alignToBottom={false}
        // New mounts start near the latest user turn to avoid flashing older
        // content before sticky pin logic can finish.
        initialTopMostItemIndex={latestUserMessageIndex}

        overscan={{ main: 600, reverse: 600 }}

        atBottomThreshold={50}
        atBottomStateChange={handleAtBottomStateChange}

        rangeChanged={handleRangeChanged}

        defaultItemHeight={200}

        increaseViewportBy={{ top: 600, bottom: 600 }}

        scrollerRef={handleScrollerRef}

        components={{
          Header: () => <div className="message-list-header" />,
          Footer: () => (
            <>
              <ProcessingIndicator visible={showBreathingIndicator} reserveSpace={reserveSpaceForIndicator} />
              <div
                ref={footerElementRef}
                className="message-list-footer"
                style={{
                  height: `${footerHeightPx}px`,
                  minHeight: `${footerHeightPx}px`,
                }}
              />
            </>
          ),
        }}
      />

      {!hideScrollAnchor && (
        <ScrollAnchor
          onAnchorNavigate={(turnId) => {
            pinTurnToTop(turnId, { behavior: 'smooth' });
          }}
          scrollerRef={scrollerElementRef}
        />
      )}

      <ScrollToLatestBar
        visible={!isAtBottom && virtualItems.length > 0}
        onClick={scrollToLatestEndPosition}
        isInputActive={isInputActive}
        isInputExpanded={isInputExpanded}
        inputHeight={inputHeight}
      />
    </div>
  );
});

VirtualMessageList.displayName = 'VirtualMessageList';
