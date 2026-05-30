import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  ANCHOR_LOCK_MIN_DEVIATION_PX,
  COMPENSATION_EPSILON_PX,
  type BottomReservationState,
  type ScrollAnchorLockState,
} from '../FlowScrollGeometry';
import {
  TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX,
  isEditableElement,
  isPointerOnScrollbarGutter,
  isUpwardScrollIntentKey,
} from '../FlowScrollIntent';

interface VirtuosoFollowOutputController {
  handleUserScrollIntent: () => void;
  handleScroll: () => void;
}

interface UseVirtuosoFlowUserIntentBridgeOptions {
  scrollerElement: HTMLElement | null;
  anchorLockRef: MutableRefObject<ScrollAnchorLockState>;
  layoutTransitionCountRef: MutableRefObject<number>;
  previousScrollTopRef: MutableRefObject<number>;
  previousMeasuredHeightRef: MutableRefObject<number | null>;
  followOutputControllerRef: MutableRefObject<VirtuosoFollowOutputController>;
  releaseAnchorLock: (reason: string) => void;
  getTotalBottomCompensationPx: () => number;
  consumeBottomCompensation: (amountPx: number) => BottomReservationState;
  applyFooterCompensationNow: (compensation: number | BottomReservationState) => void;
  snapshotMeasuredContentHeight: (
    scroller: HTMLElement,
    reservationState?: BottomReservationState,
  ) => number;
  scheduleVisibleTurnMeasure: (frames?: number) => void;
}

export function useVirtuosoFlowUserIntentBridge({
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
}: UseVirtuosoFlowUserIntentBridgeOptions): void {
  const touchScrollIntentStartYRef = useRef<number | null>(null);
  const scrollbarPointerInteractionActiveRef = useRef(false);

  useEffect(() => {
    if (!scrollerElement) {
      touchScrollIntentStartYRef.current = null;
      scrollbarPointerInteractionActiveRef.current = false;
      return;
    }

    const handleScroll = () => {
      const now = performance.now();
      if (anchorLockRef.current.active && now > anchorLockRef.current.lockUntilMs && layoutTransitionCountRef.current === 0) {
        releaseAnchorLock('expired-before-scroll');
      }

      const currentTotalCompensation = getTotalBottomCompensationPx();
      if (
        currentTotalCompensation > COMPENSATION_EPSILON_PX &&
        !anchorLockRef.current.active &&
        layoutTransitionCountRef.current === 0
      ) {
        const nextScrollTop = scrollerElement.scrollTop;
        const scrollDelta = nextScrollTop - previousScrollTopRef.current;
        if (scrollDelta > COMPENSATION_EPSILON_PX) {
          const nextCompensationState = consumeBottomCompensation(scrollDelta);
          applyFooterCompensationNow(nextCompensationState);
          previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(
            scrollerElement,
            nextCompensationState,
          );
        }
      }

      if (getTotalBottomCompensationPx() > COMPENSATION_EPSILON_PX) {
        const nextScrollTop = scrollerElement.scrollTop;
        const maxScrollTop = Math.max(0, scrollerElement.scrollHeight - scrollerElement.clientHeight);
        if (anchorLockRef.current.active && performance.now() <= anchorLockRef.current.lockUntilMs) {
          const targetScrollTop = Math.min(anchorLockRef.current.targetScrollTop, maxScrollTop);
          const restoreDelta = targetScrollTop - nextScrollTop;
          if (Math.abs(restoreDelta) > ANCHOR_LOCK_MIN_DEVIATION_PX) {
            scrollerElement.scrollTop = targetScrollTop;
            previousScrollTopRef.current = targetScrollTop;
            return;
          }
        }
      }

      previousScrollTopRef.current = scrollerElement.scrollTop;
      scheduleVisibleTurnMeasure();
      followOutputControllerRef.current.handleScroll();

      if (anchorLockRef.current.active && performance.now() > anchorLockRef.current.lockUntilMs && layoutTransitionCountRef.current === 0) {
        releaseAnchorLock('expired-after-scroll');
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        followOutputControllerRef.current.handleUserScrollIntent();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchScrollIntentStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchScrollIntentStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) {
        return;
      }

      if (currentY - startY > TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX) {
        touchScrollIntentStartYRef.current = currentY;
        followOutputControllerRef.current.handleUserScrollIntent();
      }
    };

    const resetTouchScrollIntent = () => {
      touchScrollIntentStartYRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUpwardScrollIntentKey(event) || isEditableElement(event.target)) {
        return;
      }

      followOutputControllerRef.current.handleUserScrollIntent();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) {
        return;
      }

      if (!isPointerOnScrollbarGutter(scrollerElement, event.clientX, event.clientY)) {
        return;
      }

      scrollbarPointerInteractionActiveRef.current = true;
      followOutputControllerRef.current.handleUserScrollIntent();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!scrollbarPointerInteractionActiveRef.current || event.pointerType === 'touch') {
        return;
      }

      if ((event.buttons & 1) !== 1) {
        scrollbarPointerInteractionActiveRef.current = false;
        return;
      }

      followOutputControllerRef.current.handleUserScrollIntent();
    };

    const endScrollbarPointerInteraction = () => {
      scrollbarPointerInteractionActiveRef.current = false;
    };

    scrollerElement.addEventListener('scroll', handleScroll, { passive: true });
    scrollerElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollerElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollerElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollerElement.addEventListener('touchend', resetTouchScrollIntent, { passive: true });
    scrollerElement.addEventListener('touchcancel', resetTouchScrollIntent, { passive: true });
    scrollerElement.addEventListener('keydown', handleKeyDown, true);
    scrollerElement.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', endScrollbarPointerInteraction, true);
    window.addEventListener('pointercancel', endScrollbarPointerInteraction, true);

    return () => {
      scrollerElement.removeEventListener('scroll', handleScroll);
      scrollerElement.removeEventListener('wheel', handleWheel);
      scrollerElement.removeEventListener('touchstart', handleTouchStart);
      scrollerElement.removeEventListener('touchmove', handleTouchMove);
      scrollerElement.removeEventListener('touchend', resetTouchScrollIntent);
      scrollerElement.removeEventListener('touchcancel', resetTouchScrollIntent);
      scrollerElement.removeEventListener('keydown', handleKeyDown, true);
      scrollerElement.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', endScrollbarPointerInteraction, true);
      window.removeEventListener('pointercancel', endScrollbarPointerInteraction, true);
      touchScrollIntentStartYRef.current = null;
      scrollbarPointerInteractionActiveRef.current = false;
    };
  }, [
    anchorLockRef,
    applyFooterCompensationNow,
    consumeBottomCompensation,
    followOutputControllerRef,
    getTotalBottomCompensationPx,
    layoutTransitionCountRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    releaseAnchorLock,
    scheduleVisibleTurnMeasure,
    scrollerElement,
    snapshotMeasuredContentHeight,
  ]);
}
