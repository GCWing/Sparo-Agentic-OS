import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  isEditableElement,
  isPointerOnScrollbarGutter,
  isUpwardScrollIntentKey,
  TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX,
} from '../FlowScrollIntent';
import {
  FLOW_SCROLL_BOTTOM_THRESHOLD_PX,
  FLOW_SCROLL_PROGRAMMATIC_GUARD_MS,
  type FlowScrollExitReason,
  type FlowScrollMode,
} from '../FlowScrollPolicy';

interface UsePlainFlowScrollControllerOptions {
  isStreaming: boolean;
  dependencies: readonly unknown[];
  resetKey?: unknown;
  bottomThresholdPx?: number;
}

interface PlainFlowScrollController {
  scrollContainerRef: RefObject<HTMLDivElement>;
  modeRef: RefObject<FlowScrollMode>;
  scrollToLatest: (behavior?: ScrollBehavior) => void;
  exitFollowMode: (reason: FlowScrollExitReason) => void;
}

function getDistanceFromBottom(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
}

export function usePlainFlowScrollController({
  isStreaming,
  dependencies,
  resetKey,
  bottomThresholdPx = FLOW_SCROLL_BOTTOM_THRESHOLD_PX,
}: UsePlainFlowScrollControllerOptions): PlainFlowScrollController {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<FlowScrollMode>('following-output');
  const programmaticScrollUntilMsRef = useRef(0);
  const touchScrollIntentStartYRef = useRef<number | null>(null);
  const scrollbarPointerInteractionActiveRef = useRef(false);

  const runProgrammaticScroll = useCallback((action: () => void) => {
    programmaticScrollUntilMsRef.current = performance.now() + FLOW_SCROLL_PROGRAMMATIC_GUARD_MS;
    action();
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    modeRef.current = 'following-output';
    runProgrammaticScroll(() => {
      container.scrollTo({
        top: Math.max(0, container.scrollHeight - container.clientHeight),
        behavior,
      });
    });
  }, [runProgrammaticScroll]);

  const exitFollowMode = useCallback((_reason: FlowScrollExitReason) => {
    modeRef.current = 'reading-history';
  }, []);

  useEffect(() => {
    modeRef.current = isStreaming ? 'following-output' : 'idle';
    if (isStreaming) {
      scrollToLatest('auto');
    }
  }, [isStreaming, resetKey, scrollToLatest]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (performance.now() <= programmaticScrollUntilMsRef.current) {
        return;
      }

      if (getDistanceFromBottom(container) <= bottomThresholdPx) {
        modeRef.current = isStreaming ? 'following-output' : 'idle';
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        exitFollowMode('user-scroll-up');
        return;
      }

      if (event.deltaY > 0 && getDistanceFromBottom(container) <= bottomThresholdPx) {
        modeRef.current = isStreaming ? 'following-output' : 'idle';
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchScrollIntentStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchScrollIntentStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) return;

      if (currentY - startY > TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX) {
        touchScrollIntentStartYRef.current = currentY;
        exitFollowMode('touch-scroll-up');
      }
    };

    const resetTouchScrollIntent = () => {
      touchScrollIntentStartYRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUpwardScrollIntentKey(event) || isEditableElement(event.target)) {
        return;
      }

      exitFollowMode('keyboard-scroll-up');
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) {
        return;
      }

      if (!isPointerOnScrollbarGutter(container, event.clientX, event.clientY)) {
        return;
      }

      scrollbarPointerInteractionActiveRef.current = true;
      exitFollowMode('scrollbar-drag');
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!scrollbarPointerInteractionActiveRef.current || event.pointerType === 'touch') {
        return;
      }

      if ((event.buttons & 1) !== 1) {
        scrollbarPointerInteractionActiveRef.current = false;
        return;
      }

      exitFollowMode('scrollbar-drag');
    };

    const endScrollbarPointerInteraction = () => {
      scrollbarPointerInteractionActiveRef.current = false;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', resetTouchScrollIntent, { passive: true });
    container.addEventListener('touchcancel', resetTouchScrollIntent, { passive: true });
    container.addEventListener('keydown', handleKeyDown, true);
    container.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', endScrollbarPointerInteraction, true);
    window.addEventListener('pointercancel', endScrollbarPointerInteraction, true);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', resetTouchScrollIntent);
      container.removeEventListener('touchcancel', resetTouchScrollIntent);
      container.removeEventListener('keydown', handleKeyDown, true);
      container.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', endScrollbarPointerInteraction, true);
      window.removeEventListener('pointercancel', endScrollbarPointerInteraction, true);
      touchScrollIntentStartYRef.current = null;
      scrollbarPointerInteractionActiveRef.current = false;
    };
  }, [bottomThresholdPx, exitFollowMode, isStreaming]);

  useEffect(() => {
    if (!isStreaming || modeRef.current !== 'following-output') {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      scrollToLatest('auto');
    });

    return () => cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return {
    scrollContainerRef: scrollContainerRef as RefObject<HTMLDivElement>,
    modeRef,
    scrollToLatest,
    exitFollowMode,
  };
}
