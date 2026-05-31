import { useEffect, type MutableRefObject } from 'react';
import {
  FLOW_LAYOUT_COLLAPSE_INTENT_EVENT,
  FLOW_LAYOUT_MUTATION_EVENT,
  isFlowLayoutCollapseIntentEvent,
} from '../FlowLayoutMutationEvents';
import {
  COMPENSATION_EPSILON_PX,
  getReservationTotalPx,
  type BottomReservationState,
  type PendingCollapseIntentState,
} from '../FlowScrollGeometry';

interface UseVirtuosoFlowLayoutMutationBridgeOptions {
  scrollerElement: HTMLElement | null;
  isFollowingOutputRef: MutableRefObject<boolean>;
  isStreamingOutputRef: MutableRefObject<boolean>;
  bottomReservationStateRef: MutableRefObject<BottomReservationState>;
  pendingCollapseIntentRef: MutableRefObject<PendingCollapseIntentState>;
  scheduleHeightMeasure: (frames?: number) => void;
  scheduleVisibleTurnMeasure: (frames?: number) => void;
  schedulePinReservationReconcile: (frames?: number) => void;
  getTotalBottomCompensationPx: (state?: BottomReservationState) => number;
  updateBottomReservationState: (
    updater: BottomReservationState | ((prev: BottomReservationState) => BottomReservationState),
  ) => void;
  applyFooterCompensationNow: (compensation: number | BottomReservationState) => void;
  activateAnchorLock: (targetScrollTop: number, reason: 'transition-shrink' | 'instant-shrink') => void;
}

export function useVirtuosoFlowLayoutMutationBridge({
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
}: UseVirtuosoFlowLayoutMutationBridgeOptions): void {
  useEffect(() => {
    if (!scrollerElement) {
      return;
    }

    const handleLayoutMutation = () => {
      scheduleHeightMeasure(2);
      scheduleVisibleTurnMeasure(2);
      schedulePinReservationReconcile(2);
    };

    const handleLayoutCollapseIntent = (event: Event) => {
      if (!isFlowLayoutCollapseIntentEvent(event)) {
        return;
      }

      const detail = event.detail;
      if (isFollowingOutputRef.current && isStreamingOutputRef.current) {
        scheduleVisibleTurnMeasure(2);
        schedulePinReservationReconcile(2);
        return;
      }

      const baseTotalCompensationPx = getTotalBottomCompensationPx();
      const distanceFromBottom = Math.max(
        0,
        scrollerElement.scrollHeight - scrollerElement.clientHeight - scrollerElement.scrollTop,
      );
      const effectiveDistanceFromBottom = Math.max(0, distanceFromBottom - baseTotalCompensationPx);
      const estimatedShrink = Math.max(0, detail?.cardHeight ?? 0);
      const provisionalTotalCompensationPx = Math.max(
        0,
        baseTotalCompensationPx + Math.max(0, estimatedShrink - effectiveDistanceFromBottom),
      );

      pendingCollapseIntentRef.current = {
        active: true,
        anchorScrollTop: scrollerElement.scrollTop,
        toolId: detail?.toolId ?? null,
        toolName: detail?.toolName ?? null,
        expiresAtMs: performance.now() + 1000,
        distanceFromBottomBeforeCollapse: effectiveDistanceFromBottom,
        baseTotalCompensationPx,
        cumulativeShrinkPx: 0,
      };

      if (provisionalTotalCompensationPx - baseTotalCompensationPx > COMPENSATION_EPSILON_PX) {
        const nextReservationState: BottomReservationState = {
          ...bottomReservationStateRef.current,
          collapse: {
            ...bottomReservationStateRef.current.collapse,
            px: Math.max(
              0,
              provisionalTotalCompensationPx - getReservationTotalPx(bottomReservationStateRef.current.pin),
            ),
            floorPx: 0,
          },
        };
        updateBottomReservationState(nextReservationState);
        applyFooterCompensationNow(nextReservationState);
        activateAnchorLock(scrollerElement.scrollTop, 'instant-shrink');
      }

      scheduleVisibleTurnMeasure(2);
      schedulePinReservationReconcile(2);
    };

    window.addEventListener(FLOW_LAYOUT_MUTATION_EVENT, handleLayoutMutation);
    window.addEventListener(FLOW_LAYOUT_COLLAPSE_INTENT_EVENT, handleLayoutCollapseIntent as EventListener);

    return () => {
      window.removeEventListener(FLOW_LAYOUT_MUTATION_EVENT, handleLayoutMutation);
      window.removeEventListener(FLOW_LAYOUT_COLLAPSE_INTENT_EVENT, handleLayoutCollapseIntent as EventListener);
    };
  }, [
    activateAnchorLock,
    applyFooterCompensationNow,
    bottomReservationStateRef,
    getTotalBottomCompensationPx,
    isFollowingOutputRef,
    isStreamingOutputRef,
    pendingCollapseIntentRef,
    scheduleHeightMeasure,
    schedulePinReservationReconcile,
    scheduleVisibleTurnMeasure,
    scrollerElement,
    updateBottomReservationState,
  ]);
}
