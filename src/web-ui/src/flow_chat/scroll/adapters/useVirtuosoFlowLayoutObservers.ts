import { useEffect, type MutableRefObject } from 'react';
import { createInactiveCollapseIntent, type PendingCollapseIntentState } from '../FlowScrollGeometry';

interface UseVirtuosoFlowLayoutObserversOptions {
  scrollerElement: HTMLElement | null;
  isProcessing: boolean;
  layoutTransitionCountRef: MutableRefObject<number>;
  pendingCollapseIntentRef: MutableRefObject<PendingCollapseIntentState>;
  deferredFollowReasonRef: MutableRefObject<string | null>;
  previousMeasuredHeightRef: MutableRefObject<number | null>;
  previousScrollTopRef: MutableRefObject<number>;
  snapshotMeasuredContentHeight: (scroller: HTMLElement) => number;
  scheduleHeightMeasure: (frames?: number) => void;
  scheduleVisibleTurnMeasure: (frames?: number) => void;
  schedulePinReservationReconcile: (frames?: number) => void;
  scheduleFollowToLatestWithViewportState: (reason: string) => void;
  shouldSuspendAutoFollow: () => boolean;
  scheduleFollowToLatest: (reason: string) => void;
}

function isLayoutTransitionProperty(propertyName: string): boolean {
  return (
    propertyName === 'grid-template-rows' ||
    propertyName === 'height' ||
    propertyName === 'max-height'
  );
}

function hasSemanticMutation(mutations: MutationRecord[]): boolean {
  return mutations.some(mutation => (
    mutation.type === 'characterData' ||
    mutation.type === 'attributes'
  ));
}

export function useVirtuosoFlowLayoutObservers({
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
  scheduleFollowToLatest,
}: UseVirtuosoFlowLayoutObserversOptions): void {
  useEffect(() => {
    if (!scrollerElement) {
      previousMeasuredHeightRef.current = null;
      return;
    }

    const resizeTarget =
      scrollerElement.firstElementChild instanceof HTMLElement
        ? scrollerElement.firstElementChild
        : scrollerElement;

    previousMeasuredHeightRef.current = snapshotMeasuredContentHeight(scrollerElement);
    previousScrollTopRef.current = scrollerElement.scrollTop;

    const resizeObserver = new ResizeObserver(() => {
      scheduleHeightMeasure();
      scheduleVisibleTurnMeasure(2);
      schedulePinReservationReconcile(2);
      scheduleFollowToLatestWithViewportState('resize-observer');
    });
    resizeObserver.observe(resizeTarget);

    let mutationPending = false;
    const mutationObserver = new MutationObserver((mutations) => {
      if (mutationPending || !isProcessing || !hasSemanticMutation(mutations)) {
        return;
      }

      mutationPending = true;
      requestAnimationFrame(() => {
        mutationPending = false;
        scheduleHeightMeasure(2);
        scheduleVisibleTurnMeasure(2);
        schedulePinReservationReconcile(2);
        scheduleFollowToLatestWithViewportState('mutation-observer');
      });
    });
    mutationObserver.observe(scrollerElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    const handleTransitionRun = (event: TransitionEvent) => {
      if (!isLayoutTransitionProperty(event.propertyName)) return;
      layoutTransitionCountRef.current += 1;
    };

    const handleTransitionFinish = (event: TransitionEvent) => {
      if (!isLayoutTransitionProperty(event.propertyName)) return;
      layoutTransitionCountRef.current = Math.max(0, layoutTransitionCountRef.current - 1);
      scheduleHeightMeasure(2);
      scheduleVisibleTurnMeasure(2);
      schedulePinReservationReconcile(2);

      if (layoutTransitionCountRef.current === 0 && pendingCollapseIntentRef.current.active) {
        pendingCollapseIntentRef.current = createInactiveCollapseIntent();
      }

      if (layoutTransitionCountRef.current === 0 && deferredFollowReasonRef.current && !shouldSuspendAutoFollow()) {
        const deferredReason = deferredFollowReasonRef.current;
        deferredFollowReasonRef.current = null;
        scheduleFollowToLatest(`${deferredReason}-after-transition`);
      }
    };

    scrollerElement.addEventListener('transitionrun', handleTransitionRun, true);
    scrollerElement.addEventListener('transitionend', handleTransitionFinish, true);
    scrollerElement.addEventListener('transitioncancel', handleTransitionFinish, true);
    scheduleVisibleTurnMeasure(2);

    return () => {
      scrollerElement.removeEventListener('transitionrun', handleTransitionRun, true);
      scrollerElement.removeEventListener('transitionend', handleTransitionFinish, true);
      scrollerElement.removeEventListener('transitioncancel', handleTransitionFinish, true);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [
    deferredFollowReasonRef,
    isProcessing,
    layoutTransitionCountRef,
    pendingCollapseIntentRef,
    previousMeasuredHeightRef,
    previousScrollTopRef,
    scheduleFollowToLatest,
    scheduleFollowToLatestWithViewportState,
    scheduleHeightMeasure,
    schedulePinReservationReconcile,
    scheduleVisibleTurnMeasure,
    scrollerElement,
    shouldSuspendAutoFollow,
    snapshotMeasuredContentHeight,
  ]);
}
