import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { FlowChatPinTurnToTopMode } from '../../events/flowchatNavigation';
import type { VirtualItem } from '../../store/modernFlowChatStore';
import type {
  FollowOutputEnterReason,
  FollowOutputExitReason,
} from './useVirtuosoFlowFollowOutput';
import {
  COMPENSATION_EPSILON_PX,
  PINNED_TURN_VIEWPORT_OFFSET_PX,
  sanitizeReservationPx,
  type BottomReservationState,
  type PendingCollapseIntentState,
  type PendingTurnPinState,
  type PinBottomReservation,
} from '../FlowScrollGeometry';

interface UserMessageVirtualItem {
  item: VirtualItem;
  index: number;
}

interface UseVirtuosoFlowNavigationControllerOptions {
  activeSessionId: string | undefined;
  virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
  scrollerElement: HTMLElement | null;
  scrollerElementRef: MutableRefObject<HTMLElement | null>;
  virtualItemCount: number;
  userMessageItems: UserMessageVirtualItem[];
  latestTurnId: string | null;
  bottomReservationStateRef: MutableRefObject<BottomReservationState>;
  previousMeasuredHeightRef: MutableRefObject<number | null>;
  previousScrollTopRef: MutableRefObject<number>;
  pendingCollapseIntentRef: MutableRefObject<PendingCollapseIntentState>;
  layoutTransitionCountRef: MutableRefObject<number>;
  getTotalBottomCompensationPx: () => number;
  snapshotMeasuredContentHeight: (
    scroller: HTMLElement,
    reservationState?: BottomReservationState,
  ) => number;
  updateBottomReservationState: (
    updater: BottomReservationState | ((prev: BottomReservationState) => BottomReservationState),
  ) => void;
  resetBottomReservations: () => void;
  resetTransientGeometryState: () => void;
  applyFooterCompensationNow: (compensation: number | BottomReservationState) => void;
  releaseAnchorLock: (reason: string) => void;
  scheduleVisibleTurnMeasure: (frames?: number) => void;
  exitFollowOutputRef: MutableRefObject<(reason: FollowOutputExitReason) => void>;
  enterFollowOutputRef: MutableRefObject<(reason: FollowOutputEnterReason) => void>;
}

export function useVirtuosoFlowNavigationController({
  activeSessionId,
  virtuosoRef,
  scrollerElement,
  scrollerElementRef,
  virtualItemCount,
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
  exitFollowOutputRef,
  enterFollowOutputRef,
}: UseVirtuosoFlowNavigationControllerOptions) {
  const [pendingTurnPin, setPendingTurnPin] = useState<PendingTurnPinState | null>(null);
  const pinReservationReconcileFrameRef = useRef<number | null>(null);

  const getRenderedUserMessageElement = useCallback((turnId: string) => {
    const scroller = scrollerElementRef.current;
    if (!scroller) return null;

    return scroller.querySelector<HTMLElement>(
      `.virtual-item-wrapper[data-item-type="user-message"][data-turn-id="${turnId}"]`,
    );
  }, [scrollerElementRef]);

  const buildPinReservation = useCallback((
    turnId: string,
    pinMode: FlowChatPinTurnToTopMode,
    requiredTailSpacePx: number,
    currentPinReservation: PinBottomReservation = bottomReservationStateRef.current.pin,
  ): PinBottomReservation => {
    const resolvedRequiredTailSpacePx = sanitizeReservationPx(requiredTailSpacePx);
    const nextFloorPx = pinMode === 'sticky-latest'
      ? resolvedRequiredTailSpacePx
      : 0;
    const shouldPreserveCurrentPx = (
      currentPinReservation.mode === pinMode &&
      currentPinReservation.targetTurnId === turnId &&
      (
        pinMode === 'transient' ||
        currentPinReservation.floorPx > COMPENSATION_EPSILON_PX
      )
    );
    const preservedPx = shouldPreserveCurrentPx ? currentPinReservation.px : 0;
    const additiveRetryPx = (
      shouldPreserveCurrentPx &&
      pinMode === 'transient' &&
      resolvedRequiredTailSpacePx > COMPENSATION_EPSILON_PX
    )
      ? currentPinReservation.px + resolvedRequiredTailSpacePx
      : 0;
    const shouldRetainTarget = (
      pinMode === 'sticky-latest' ||
      resolvedRequiredTailSpacePx > COMPENSATION_EPSILON_PX ||
      shouldPreserveCurrentPx
    );

    return {
      kind: 'pin',
      px: Math.max(nextFloorPx, resolvedRequiredTailSpacePx, preservedPx, additiveRetryPx),
      floorPx: nextFloorPx,
      mode: pinMode,
      targetTurnId: shouldRetainTarget ? turnId : null,
    };
  }, [bottomReservationStateRef]);

  const resolveTurnPinMetrics = useCallback((turnId: string, ignoredTailSpacePx: number = 0) => {
    const scroller = scrollerElementRef.current;
    if (!scroller) return null;

    const targetElement = getRenderedUserMessageElement(turnId);
    if (!targetElement) return null;

    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const viewportTop = scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX;
    const desiredScrollTop = Math.max(0, scroller.scrollTop + (targetRect.top - viewportTop));
    const effectiveScrollHeight = Math.max(0, scroller.scrollHeight - Math.max(0, ignoredTailSpacePx));
    const rawMaxScrollTop = effectiveScrollHeight - scroller.clientHeight;
    const maxScrollTop = Math.max(0, rawMaxScrollTop);
    const missingTailSpace = Math.max(0, desiredScrollTop - rawMaxScrollTop);

    return {
      targetElement,
      viewportTop,
      desiredScrollTop,
      maxScrollTop,
      missingTailSpace,
    };
  }, [getRenderedUserMessageElement, scrollerElementRef]);

  const reconcileStickyPinReservation = useCallback(() => {
    const scroller = scrollerElementRef.current;
    const currentState = bottomReservationStateRef.current;
    const pinReservation = currentState.pin;
    if (!scroller || pinReservation.mode !== 'sticky-latest' || !pinReservation.targetTurnId) {
      return false;
    }

    const collapseIntent = pendingCollapseIntentRef.current;
    const hasActiveCollapseTransition = (
      layoutTransitionCountRef.current > 0 &&
      collapseIntent.active &&
      collapseIntent.expiresAtMs >= performance.now()
    );
    if (hasActiveCollapseTransition) {
      return false;
    }

    const resolvedMetrics = resolveTurnPinMetrics(
      pinReservation.targetTurnId,
      pinReservation.px,
    );
    if (!resolvedMetrics) {
      return false;
    }

    const requiredFloorPx = sanitizeReservationPx(resolvedMetrics.missingTailSpace);
    const hadOnlyFloor = pinReservation.px <= pinReservation.floorPx + COMPENSATION_EPSILON_PX;
    const nextPinPx = hadOnlyFloor
      ? requiredFloorPx
      : Math.max(requiredFloorPx, pinReservation.px);
    const nextPinReservation: PinBottomReservation = {
      ...pinReservation,
      px: nextPinPx,
      floorPx: requiredFloorPx,
    };

    if (
      Math.abs(nextPinReservation.px - pinReservation.px) <= COMPENSATION_EPSILON_PX &&
      Math.abs(nextPinReservation.floorPx - pinReservation.floorPx) <= COMPENSATION_EPSILON_PX
    ) {
      return false;
    }

    const nextState: BottomReservationState = {
      ...currentState,
      pin: nextPinReservation,
    };
    updateBottomReservationState(nextState);
    applyFooterCompensationNow(nextState);
    previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(scroller, nextState);
    return true;
  }, [
    applyFooterCompensationNow,
    bottomReservationStateRef,
    layoutTransitionCountRef,
    pendingCollapseIntentRef,
    previousMeasuredHeightRef,
    resolveTurnPinMetrics,
    scrollerElementRef,
    snapshotMeasuredContentHeight,
    updateBottomReservationState,
  ]);

  const schedulePinReservationReconcile = useCallback((frames: number = 1) => {
    if (pinReservationReconcileFrameRef.current !== null) {
      cancelAnimationFrame(pinReservationReconcileFrameRef.current);
      pinReservationReconcileFrameRef.current = null;
    }

    const run = (remainingFrames: number) => {
      pinReservationReconcileFrameRef.current = requestAnimationFrame(() => {
        if (remainingFrames > 1) {
          run(remainingFrames - 1);
          return;
        }

        pinReservationReconcileFrameRef.current = null;
        reconcileStickyPinReservation();
      });
    };

    run(Math.max(1, frames));
  }, [reconcileStickyPinReservation]);

  const tryResolvePendingTurnPin = useCallback((request: PendingTurnPinState) => {
    const scroller = scrollerElementRef.current;
    const virtuoso = virtuosoRef.current;

    if (!scroller || !virtuoso) return false;

    const targetItem = userMessageItems.find(({ item }) => item.turnId === request.turnId);
    if (!targetItem) return false;

    const currentPinReservation = bottomReservationStateRef.current.pin;
    let ignoredTailSpacePx = 0;
    if (currentPinReservation.px > COMPENSATION_EPSILON_PX) {
      ignoredTailSpacePx = currentPinReservation.px;
    }
    const resolvedMetrics = resolveTurnPinMetrics(request.turnId, ignoredTailSpacePx);
    if (!resolvedMetrics) {
      const fallbackBehavior: ScrollBehavior = request.pinMode === 'sticky-latest'
        ? 'auto'
        : targetItem.index === 0
          ? 'auto'
        : request.attempts === 0 && request.behavior === 'smooth'
          ? 'smooth'
          : 'auto';
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const provisionalPinPx = request.pinMode === 'sticky-latest'
        ? Math.max(maxScrollTop, currentPinReservation.px)
        : 0;

      if (request.pinMode === 'sticky-latest' && provisionalPinPx > COMPENSATION_EPSILON_PX) {
        const nextReservationState: BottomReservationState = {
          ...bottomReservationStateRef.current,
          pin: {
            kind: 'pin',
            px: provisionalPinPx,
            floorPx: 0,
            mode: request.pinMode,
            targetTurnId: request.turnId,
          },
        };
        updateBottomReservationState(nextReservationState);
        applyFooterCompensationNow(nextReservationState);
        previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(scroller, nextReservationState);
      }

      virtuoso.scrollToIndex({
        index: targetItem.index,
        align: 'start',
        behavior: fallbackBehavior,
      });
      return false;
    }

    const nextReservationState: BottomReservationState = {
      ...bottomReservationStateRef.current,
      pin: buildPinReservation(
        request.turnId,
        request.pinMode,
        resolvedMetrics.missingTailSpace,
      ),
    };
    updateBottomReservationState(nextReservationState);
    applyFooterCompensationNow(nextReservationState);

    const resolvedMaxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const targetScrollTop = Math.min(resolvedMetrics.desiredScrollTop, resolvedMaxScrollTop);
    if (Math.abs(scroller.scrollTop - targetScrollTop) > COMPENSATION_EPSILON_PX) {
      scroller.scrollTop = targetScrollTop;
    }

    const verifyPinAlignment = (frameLabel: string) => {
      const liveTargetElement = getRenderedUserMessageElement(request.turnId);
      const liveRect = liveTargetElement?.getBoundingClientRect();
      const viewportTop = liveTargetElement
        ? scroller.getBoundingClientRect().top + PINNED_TURN_VIEWPORT_OFFSET_PX
        : null;
      const deltaToViewportTop = liveRect && viewportTop != null
        ? liveRect.top - viewportTop
        : null;

      const stickyPinStillTargetsRequest = (
        bottomReservationStateRef.current.pin.mode === 'sticky-latest' &&
        bottomReservationStateRef.current.pin.targetTurnId === request.turnId
      );
      const shouldRealign = (
        frameLabel !== 'immediate' &&
        deltaToViewportTop != null &&
        Math.abs(deltaToViewportTop) > 1.5 &&
        (
          request.pinMode === 'transient'
            ? Math.abs(scroller.scrollTop - targetScrollTop) <= 2
            : stickyPinStillTargetsRequest
        )
      );
      if (!shouldRealign) {
        return;
      }

      const correctedMaxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const correctedScrollTop = Math.min(
        correctedMaxScrollTop,
        Math.max(0, scroller.scrollTop + deltaToViewportTop),
      );
      if (Math.abs(correctedScrollTop - scroller.scrollTop) <= COMPENSATION_EPSILON_PX) {
        return;
      }

      scroller.scrollTop = correctedScrollTop;
      previousScrollTopRef.current = correctedScrollTop;
      previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(
        scroller,
        bottomReservationStateRef.current,
      );
      scheduleVisibleTurnMeasure(2);
      schedulePinReservationReconcile(2);
    };
    verifyPinAlignment('immediate');
    requestAnimationFrame(() => {
      verifyPinAlignment('raf-1');
      requestAnimationFrame(() => {
        verifyPinAlignment('raf-2');
      });
    });

    previousScrollTopRef.current = targetScrollTop;
    previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(scroller, nextReservationState);

    const alignedRect = resolvedMetrics.targetElement.getBoundingClientRect();
    return Math.abs(alignedRect.top - resolvedMetrics.viewportTop) <= 1.5;
  }, [
    applyFooterCompensationNow,
    bottomReservationStateRef,
    buildPinReservation,
    getRenderedUserMessageElement,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    resolveTurnPinMetrics,
    schedulePinReservationReconcile,
    scheduleVisibleTurnMeasure,
    scrollerElementRef,
    snapshotMeasuredContentHeight,
    updateBottomReservationState,
    userMessageItems,
    virtuosoRef,
  ]);

  const clearPinReservationForUserNavigation = useCallback(() => {
    const currentState = bottomReservationStateRef.current;
    const scroller = scrollerElementRef.current;
    const hasActivePin = (
      currentState.pin.px > COMPENSATION_EPSILON_PX ||
      currentState.pin.floorPx > COMPENSATION_EPSILON_PX ||
      currentState.pin.targetTurnId !== null ||
      currentState.pin.mode !== 'transient'
    );

    releaseAnchorLock('user-navigation');
    setPendingTurnPin(null);

    if (!hasActivePin) {
      return;
    }

    const nextReservationState: BottomReservationState = {
      ...currentState,
      pin: {
        kind: 'pin',
        px: 0,
        floorPx: 0,
        mode: 'transient',
        targetTurnId: null,
      },
    };
    updateBottomReservationState(nextReservationState);
    applyFooterCompensationNow(nextReservationState);

    if (scroller) {
      previousScrollTopRef.current = scroller.scrollTop;
      previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(scroller, nextReservationState);
    }
  }, [
    applyFooterCompensationNow,
    bottomReservationStateRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    releaseAnchorLock,
    scrollerElementRef,
    snapshotMeasuredContentHeight,
    updateBottomReservationState,
  ]);

  const scrollToLatestEndPositionInternal = useCallback((behavior: ScrollBehavior) => {
    if (virtuosoRef.current && virtualItemCount > 0) {
      releaseAnchorLock('scroll-to-latest');
      setPendingTurnPin(null);
      virtuosoRef.current.scrollTo({ top: 999999999, behavior });
    }
  }, [releaseAnchorLock, virtualItemCount, virtuosoRef]);

  const requestTurnPinToTop = useCallback((turnId: string, options?: { behavior?: ScrollBehavior; pinMode?: FlowChatPinTurnToTopMode }) => {
    const requestedPinMode = options?.pinMode ?? 'transient';
    const requestedBehavior = options?.behavior ?? 'auto';
    const targetItem = userMessageItems.find(({ item }) => item.turnId === turnId);
    if (!targetItem || !virtuosoRef.current) {
      return false;
    }

    if (targetItem.index === 0 && requestedPinMode === 'transient') {
      setPendingTurnPin(null);
      virtuosoRef.current.scrollTo({ top: 0, behavior: 'auto' });
      return true;
    }

    setPendingTurnPin({
      turnId,
      behavior: requestedBehavior,
      pinMode: requestedPinMode,
      expiresAtMs: performance.now() + 1500,
      attempts: 0,
    });
    return true;
  }, [userMessageItems, virtuosoRef]);

  const performAutoFollowSync = useCallback(() => {
    if (!latestTurnId) {
      return;
    }

    const currentPinReservation = bottomReservationStateRef.current.pin;
    const totalBottomCompensationPx = getTotalBottomCompensationPx();
    const hasPendingLatestStickyPin = (
      pendingTurnPin?.turnId === latestTurnId &&
      pendingTurnPin.pinMode === 'sticky-latest'
    );
    const hasAppliedLatestStickyPin = (
      currentPinReservation.mode === 'sticky-latest' &&
      currentPinReservation.targetTurnId === latestTurnId
    );
    const shouldKeepStickyLatest = (
      hasAppliedLatestStickyPin &&
      currentPinReservation.floorPx > COMPENSATION_EPSILON_PX
    );
    const shouldPreserveSyntheticTail = (
      hasAppliedLatestStickyPin &&
      totalBottomCompensationPx > COMPENSATION_EPSILON_PX
    );

    if (hasPendingLatestStickyPin) {
      return;
    }

    if (!hasAppliedLatestStickyPin) {
      requestTurnPinToTop(latestTurnId, {
        behavior: 'auto',
        pinMode: 'sticky-latest',
      });
      return;
    }

    if (shouldKeepStickyLatest) {
      return;
    }

    if (shouldPreserveSyntheticTail) {
      return;
    }

    scrollToLatestEndPositionInternal('auto');
  }, [
    bottomReservationStateRef,
    getTotalBottomCompensationPx,
    latestTurnId,
    pendingTurnPin?.pinMode,
    pendingTurnPin?.turnId,
    requestTurnPinToTop,
    scrollToLatestEndPositionInternal,
  ]);

  const scrollToTurn = useCallback((turnIndex: number) => {
    if (!virtuosoRef.current) return;
    if (turnIndex < 1 || turnIndex > userMessageItems.length) return;

    const targetItem = userMessageItems[turnIndex - 1];
    if (!targetItem) return;

    exitFollowOutputRef.current('scroll-to-turn');
    clearPinReservationForUserNavigation();

    if (targetItem.index === 0) {
      virtuosoRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      virtuosoRef.current.scrollToIndex({
        index: targetItem.index,
        behavior: 'smooth',
        align: 'center',
      });
    }
  }, [clearPinReservationForUserNavigation, exitFollowOutputRef, userMessageItems, virtuosoRef]);

  const scrollToIndex = useCallback((index: number) => {
    if (!virtuosoRef.current) return;
    if (index < 0 || index >= virtualItemCount) return;

    exitFollowOutputRef.current('scroll-to-index');
    clearPinReservationForUserNavigation();

    if (index === 0) {
      virtuosoRef.current.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      virtuosoRef.current.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    }
  }, [clearPinReservationForUserNavigation, exitFollowOutputRef, virtualItemCount, virtuosoRef]);

  const pinTurnToTop = useCallback((turnId: string, options?: { behavior?: ScrollBehavior; pinMode?: FlowChatPinTurnToTopMode }) => {
    const shouldExitFollowOutput = !(
      options?.pinMode === 'sticky-latest' &&
      turnId === latestTurnId
    );
    if (shouldExitFollowOutput) {
      exitFollowOutputRef.current('pin-turn-to-top');
      clearPinReservationForUserNavigation();
    }

    return requestTurnPinToTop(turnId, options);
  }, [
    clearPinReservationForUserNavigation,
    exitFollowOutputRef,
    latestTurnId,
    requestTurnPinToTop,
  ]);

  const scrollToPhysicalBottomAndClearPin = useCallback(() => {
    if (virtuosoRef.current && virtualItemCount > 0) {
      clearPinReservationForUserNavigation();
      virtuosoRef.current.scrollTo({ top: 999999999, behavior: 'smooth' });
    }
  }, [clearPinReservationForUserNavigation, virtualItemCount, virtuosoRef]);

  const scrollToLatestEndPosition = useCallback(() => {
    enterFollowOutputRef.current('jump-to-latest');
  }, [enterFollowOutputRef]);

  useEffect(() => {
    setPendingTurnPin(null);
    resetTransientGeometryState();
  }, [activeSessionId, resetTransientGeometryState]);

  useEffect(() => {
    if (virtualItemCount === 0) {
      previousMeasuredHeightRef.current = null;
      setPendingTurnPin(null);
      resetBottomReservations();
    }
  }, [previousMeasuredHeightRef, resetBottomReservations, virtualItemCount]);

  useEffect(() => {
    return () => {
      if (pinReservationReconcileFrameRef.current !== null) {
        cancelAnimationFrame(pinReservationReconcileFrameRef.current);
        pinReservationReconcileFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    schedulePinReservationReconcile(2);
  }, [activeSessionId, schedulePinReservationReconcile, scrollerElement, userMessageItems, virtualItemCount]);

  useEffect(() => {
    if (!pendingTurnPin) return;

    if (performance.now() > pendingTurnPin.expiresAtMs) {
      setPendingTurnPin(null);
      return;
    }

    const frameId = requestAnimationFrame(() => {
      const resolved = tryResolvePendingTurnPin(pendingTurnPin);
      if (resolved) {
        setPendingTurnPin(null);
        scheduleVisibleTurnMeasure(2);
        return;
      }

      setPendingTurnPin(prev => {
        if (!prev || prev.turnId !== pendingTurnPin.turnId) {
          return prev;
        }

        return {
          ...prev,
          attempts: prev.attempts + 1,
          behavior: 'auto',
        };
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [pendingTurnPin, scheduleVisibleTurnMeasure, tryResolvePendingTurnPin]);

  return {
    pendingTurnPin,
    clearPinReservationForUserNavigation,
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
  };
}
