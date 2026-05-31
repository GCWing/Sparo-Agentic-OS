import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  ANCHOR_LOCK_DURATION_MS,
  ANCHOR_LOCK_MIN_DEVIATION_PX,
  COMPENSATION_EPSILON_PX,
  areBottomReservationStatesEqual,
  createInactiveAnchorLock,
  createInactiveCollapseIntent,
  createInitialBottomReservationState,
  getReservationConsumablePx,
  getReservationTotalPx,
  sanitizeBottomReservationState,
  type BottomReservationState,
  type PendingCollapseIntentState,
  type ScrollAnchorLockState,
} from '../FlowScrollGeometry';

interface UseVirtuosoFlowGeometryControllerOptions {
  footerElementRef: RefObject<HTMLDivElement | null>;
  scrollerElementRef: RefObject<HTMLElement | null>;
  inputStackFooterPxRef: MutableRefObject<number>;
  layoutTransitionCountRef: MutableRefObject<number>;
  isFollowingOutputRef: MutableRefObject<boolean>;
  isStreamingOutputRef: MutableRefObject<boolean>;
}

export function useVirtuosoFlowGeometryController({
  footerElementRef,
  scrollerElementRef,
  inputStackFooterPxRef,
  layoutTransitionCountRef,
  isFollowingOutputRef,
  isStreamingOutputRef,
}: UseVirtuosoFlowGeometryControllerOptions) {
  const [bottomReservationState, setBottomReservationState] = useState<BottomReservationState>(
    () => createInitialBottomReservationState()
  );

  const bottomReservationStateRef = useRef<BottomReservationState>(createInitialBottomReservationState());
  const previousMeasuredHeightRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const measureFrameRef = useRef<number | null>(null);
  const anchorLockRef = useRef<ScrollAnchorLockState>(createInactiveAnchorLock());
  const pendingCollapseIntentRef = useRef<PendingCollapseIntentState>(createInactiveCollapseIntent());

  const getFooterHeightPx = useCallback((compensationPx: number) => {
    return inputStackFooterPxRef.current + compensationPx;
  }, [inputStackFooterPxRef]);

  const getTotalBottomCompensationPx = useCallback((state: BottomReservationState = bottomReservationStateRef.current) => {
    return getReservationTotalPx(state.collapse) + getReservationTotalPx(state.pin);
  }, []);

  const snapshotMeasuredContentHeight = useCallback((
    scroller: HTMLElement,
    reservationState: BottomReservationState = bottomReservationStateRef.current,
  ) => {
    const compensationPx = getTotalBottomCompensationPx(reservationState);
    return Math.max(0, scroller.scrollHeight - compensationPx - inputStackFooterPxRef.current);
  }, [getTotalBottomCompensationPx, inputStackFooterPxRef]);

  const updateBottomReservationState = useCallback((
    updater: BottomReservationState | ((prev: BottomReservationState) => BottomReservationState),
  ) => {
    setBottomReservationState(prev => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next = sanitizeBottomReservationState(rawNext);
      bottomReservationStateRef.current = next;
      return areBottomReservationStatesEqual(next, prev) ? prev : next;
    });
  }, []);

  const resetBottomReservations = useCallback(() => {
    updateBottomReservationState(createInitialBottomReservationState());
  }, [updateBottomReservationState]);

  const resetTransientGeometryState = useCallback(() => {
    previousMeasuredHeightRef.current = null;
    previousScrollTopRef.current = 0;
    anchorLockRef.current = createInactiveAnchorLock();
    pendingCollapseIntentRef.current = createInactiveCollapseIntent();
    resetBottomReservations();
  }, [resetBottomReservations]);

  const consumeBottomCompensation = useCallback((amountPx: number) => {
    if (amountPx <= COMPENSATION_EPSILON_PX) {
      return bottomReservationStateRef.current;
    }

    let resolvedNextState = bottomReservationStateRef.current;
    updateBottomReservationState(prev => {
      let remaining = Math.max(0, amountPx);

      const collapseConsumablePx = getReservationConsumablePx(prev.collapse);
      const collapseConsumed = Math.min(collapseConsumablePx, remaining);
      remaining -= collapseConsumed;

      const pinConsumablePx = getReservationConsumablePx(prev.pin);
      const pinConsumed = Math.min(pinConsumablePx, remaining);

      const nextState: BottomReservationState = {
        collapse: {
          ...prev.collapse,
          px: Math.max(prev.collapse.floorPx, prev.collapse.px - collapseConsumed),
        },
        pin: {
          ...prev.pin,
          px: Math.max(prev.pin.floorPx, prev.pin.px - pinConsumed),
        },
      };
      resolvedNextState = nextState;
      return nextState;
    });
    return resolvedNextState;
  }, [updateBottomReservationState]);

  const applyFooterCompensationNow = useCallback((compensation: number | BottomReservationState) => {
    const footer = footerElementRef.current;
    const scroller = scrollerElementRef.current;
    if (!footer || !scroller) return;

    const compensationPx = typeof compensation === 'number'
      ? compensation
      : getTotalBottomCompensationPx(compensation);
    const footerHeightPx = getFooterHeightPx(compensationPx);
    footer.style.height = `${footerHeightPx}px`;
    footer.style.minHeight = `${footerHeightPx}px`;
    void footer.offsetHeight;
    void scroller.scrollHeight;
  }, [footerElementRef, getFooterHeightPx, getTotalBottomCompensationPx, scrollerElementRef]);

  const releaseAnchorLock = useCallback((_reason: string) => {
    if (!anchorLockRef.current.active) return;
    anchorLockRef.current = createInactiveAnchorLock();
  }, []);

  const activateAnchorLock = useCallback((targetScrollTop: number, reason: 'transition-shrink' | 'instant-shrink') => {
    const nextTarget = Math.max(anchorLockRef.current.targetScrollTop, targetScrollTop);
    anchorLockRef.current = {
      active: true,
      targetScrollTop: nextTarget,
      reason,
      lockUntilMs: performance.now() + ANCHOR_LOCK_DURATION_MS,
    };
  }, []);

  const restoreAnchorLockNow = useCallback((reason: string) => {
    const scroller = scrollerElementRef.current;
    const lockState = anchorLockRef.current;
    if (!scroller || !lockState.active) return false;

    const now = performance.now();
    if (now > lockState.lockUntilMs && layoutTransitionCountRef.current === 0) {
      releaseAnchorLock(`expired-before-${reason}`);
      return false;
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const targetScrollTop = Math.min(lockState.targetScrollTop, maxScrollTop);
    const currentScrollTop = scroller.scrollTop;
    const restoreDelta = targetScrollTop - currentScrollTop;

    if (Math.abs(restoreDelta) <= ANCHOR_LOCK_MIN_DEVIATION_PX) {
      return false;
    }

    scroller.scrollTop = targetScrollTop;
    previousScrollTopRef.current = targetScrollTop;
    return true;
  }, [layoutTransitionCountRef, releaseAnchorLock, scrollerElementRef]);

  const measureHeightChange = useCallback(() => {
    const scroller = scrollerElementRef.current;
    if (!scroller) return;

    const currentScrollTop = scroller.scrollTop;
    const previousScrollTop = previousScrollTopRef.current;
    const currentTotalCompensation = getTotalBottomCompensationPx();
    const effectiveScrollHeight = Math.max(
      0,
      scroller.scrollHeight - currentTotalCompensation - inputStackFooterPxRef.current,
    );
    const previousMeasuredHeight = previousMeasuredHeightRef.current;
    previousMeasuredHeightRef.current = effectiveScrollHeight;

    if (previousMeasuredHeight === null) {
      previousScrollTopRef.current = currentScrollTop;
      return;
    }

    const heightDelta = effectiveScrollHeight - previousMeasuredHeight;
    if (Math.abs(heightDelta) <= COMPENSATION_EPSILON_PX) {
      previousScrollTopRef.current = currentScrollTop;
      return;
    }

    const distanceFromBottom = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    );

    if (heightDelta > 0) {
      if (currentTotalCompensation > COMPENSATION_EPSILON_PX && layoutTransitionCountRef.current > 0) {
        previousScrollTopRef.current = currentScrollTop;
        return;
      }

      const nextReservationState = consumeBottomCompensation(heightDelta);
      applyFooterCompensationNow(nextReservationState);
      previousScrollTopRef.current = currentScrollTop;
      return;
    }

    const shrinkAmount = -heightDelta;
    if (isFollowingOutputRef.current && isStreamingOutputRef.current) {
      previousScrollTopRef.current = currentScrollTop;
      return;
    }

    const collapseIntent = pendingCollapseIntentRef.current;
    const now = performance.now();
    const hasValidCollapseIntent = collapseIntent.active && collapseIntent.expiresAtMs >= now;
    const fallbackAdditionalCompensation = Math.max(0, shrinkAmount - distanceFromBottom);
    const cumulativeShrinkPx = hasValidCollapseIntent
      ? collapseIntent.cumulativeShrinkPx + shrinkAmount
      : 0;
    const resolvedIntentCompensation = hasValidCollapseIntent
      ? collapseIntent.baseTotalCompensationPx + Math.max(0, cumulativeShrinkPx - collapseIntent.distanceFromBottomBeforeCollapse)
      : 0;
    const nextTotalCompensation = hasValidCollapseIntent
      ? (
        layoutTransitionCountRef.current > 0
          ? Math.max(currentTotalCompensation, resolvedIntentCompensation)
          : resolvedIntentCompensation
      )
      : currentTotalCompensation + fallbackAdditionalCompensation;

    if (hasValidCollapseIntent) {
      pendingCollapseIntentRef.current = {
        ...collapseIntent,
        cumulativeShrinkPx,
      };
    }

    if (!hasValidCollapseIntent && fallbackAdditionalCompensation <= COMPENSATION_EPSILON_PX) {
      previousScrollTopRef.current = currentScrollTop;
      return;
    }

    const nextReservationState: BottomReservationState = {
      ...bottomReservationStateRef.current,
      collapse: {
        ...bottomReservationStateRef.current.collapse,
        px: Math.max(0, nextTotalCompensation - getReservationTotalPx(bottomReservationStateRef.current.pin)),
        floorPx: 0,
      },
    };
    updateBottomReservationState(nextReservationState);
    if (nextTotalCompensation > COMPENSATION_EPSILON_PX) {
      const anchorTarget =
        hasValidCollapseIntent
          ? collapseIntent.anchorScrollTop
          : previousScrollTop;

      activateAnchorLock(
        anchorTarget,
        layoutTransitionCountRef.current > 0 ? 'transition-shrink' : 'instant-shrink'
      );
      applyFooterCompensationNow(nextReservationState);
      restoreAnchorLockNow('measure-shrink');
      if (layoutTransitionCountRef.current === 0) {
        pendingCollapseIntentRef.current = createInactiveCollapseIntent();
      }
    }

    previousScrollTopRef.current = currentScrollTop;
  }, [
    activateAnchorLock,
    applyFooterCompensationNow,
    consumeBottomCompensation,
    getTotalBottomCompensationPx,
    inputStackFooterPxRef,
    isFollowingOutputRef,
    isStreamingOutputRef,
    layoutTransitionCountRef,
    restoreAnchorLockNow,
    scrollerElementRef,
    updateBottomReservationState,
  ]);

  const scheduleHeightMeasure = useCallback((frames: number = 1) => {
    if (measureFrameRef.current !== null) {
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = null;
    }

    const run = (remainingFrames: number) => {
      measureFrameRef.current = requestAnimationFrame(() => {
        if (remainingFrames > 1) {
          run(remainingFrames - 1);
          return;
        }

        measureFrameRef.current = null;
        measureHeightChange();
      });
    };

    run(Math.max(1, frames));
  }, [measureHeightChange]);

  const cancelScheduledHeightMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) {
      cancelAnimationFrame(measureFrameRef.current);
      measureFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledHeightMeasure, [cancelScheduledHeightMeasure]);

  return {
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
    cancelScheduledHeightMeasure,
  };
}
