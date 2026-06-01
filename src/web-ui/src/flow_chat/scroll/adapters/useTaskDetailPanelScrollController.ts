import { useCallback, useEffect, useRef, useState, type RefCallback, type RefObject } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import {
  isEditableElement,
  isPointerOnScrollbarGutter,
  isUpwardScrollIntentKey,
  TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX,
} from '../FlowScrollIntent';
import {
  FLOW_SCROLL_BOTTOM_THRESHOLD_PX,
  FLOW_SCROLL_PROGRAMMATIC_GUARD_MS,
  type FlowScrollMode,
} from '../FlowScrollPolicy';

type TaskDetailScrollBehavior = 'auto' | 'smooth';

interface TaskDetailPanelScrollControllerOptions {
  isStreaming: boolean;
  itemCount: number;
  resetKey: string;
  tailSignature: string;
}

interface TaskDetailPanelScrollController {
  virtuosoRef: RefObject<VirtuosoHandle>;
  executionElementRef: RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  handleScrollerRef: RefCallback<HTMLElement | Window>;
  handleAtBottomStateChange: (atBottom: boolean) => void;
  handlePromptToggle: () => void;
  scrollToLatest: (behavior?: TaskDetailScrollBehavior) => void;
}

function getDistanceFromBottom(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
}

export function useTaskDetailPanelScrollController({
  isStreaming,
  itemCount,
  resetKey,
  tailSignature,
}: TaskDetailPanelScrollControllerOptions): TaskDetailPanelScrollController {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const executionElementRef = useRef<HTMLDivElement>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);
  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const itemCountRef = useRef(itemCount);
  const programmaticScrollUntilMsRef = useRef(0);
  const scrollModeRef = useRef<FlowScrollMode>('following-output');
  const touchScrollIntentStartYRef = useRef<number | null>(null);
  const scrollbarPointerInteractionActiveRef = useRef(false);
  const followFrameRef = useRef<number | null>(null);
  const previousResetKeyRef = useRef<string | null>(null);

  itemCountRef.current = itemCount;

  const runProgrammaticScroll = useCallback((scrollAction: () => void) => {
    programmaticScrollUntilMsRef.current = performance.now() + FLOW_SCROLL_PROGRAMMATIC_GUARD_MS;
    scrollAction();
  }, []);

  const alignScrollerToBottom = useCallback((behavior: TaskDetailScrollBehavior = 'auto') => {
    const scroller = scrollerElementRef.current;
    if (!scroller) {
      return;
    }

    const nextTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(nextTop - scroller.scrollTop) < 1) {
      return;
    }

    scroller.scrollTo({ top: nextTop, behavior });
  }, []);

  const scheduleFollowAlignment = useCallback(() => {
    if (scrollModeRef.current !== 'following-output' || itemCountRef.current === 0) {
      return;
    }

    if (followFrameRef.current !== null) {
      return;
    }

    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (scrollModeRef.current !== 'following-output' || itemCountRef.current === 0) {
        return;
      }

      runProgrammaticScroll(() => alignScrollerToBottom('auto'));
    });
  }, [alignScrollerToBottom, runProgrammaticScroll]);

  const scrollToLatestInternal = useCallback((
    behavior: TaskDetailScrollBehavior = 'auto',
    options: { activateFollow?: boolean; useIndexScroll?: boolean } = {},
  ) => {
    const currentItemCount = itemCountRef.current;
    if (currentItemCount === 0) {
      return;
    }

    if (options.activateFollow ?? true) {
      scrollModeRef.current = 'following-output';
    }

    runProgrammaticScroll(() => {
      if (options.useIndexScroll) {
        virtuosoRef.current?.scrollToIndex({
          index: currentItemCount - 1,
          align: 'end',
          behavior,
        });
      }

      requestAnimationFrame(() => alignScrollerToBottom(behavior));
    });
  }, [alignScrollerToBottom, runProgrammaticScroll]);

  const scrollToLatest = useCallback((behavior: TaskDetailScrollBehavior = 'smooth') => {
    scrollToLatestInternal(behavior, { activateFollow: true, useIndexScroll: true });
  }, [scrollToLatestInternal]);

  const exitFollowMode = useCallback(() => {
    if (followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
    scrollModeRef.current = 'reading-history';
  }, []);

  const handleScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    const nextElement = element instanceof HTMLElement ? element : null;
    scrollerElementRef.current = nextElement;
    setScrollerElement(nextElement);
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
    if (atBottom) {
      scrollModeRef.current = isStreaming ? 'following-output' : 'idle';
    }
  }, [isStreaming]);

  const handlePromptToggle = useCallback(() => {
    if (scrollModeRef.current !== 'following-output') {
      return;
    }

    scheduleFollowAlignment();
  }, [scheduleFollowAlignment]);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }

    previousResetKeyRef.current = resetKey;
    scrollModeRef.current = isStreaming ? 'following-output' : 'idle';
    setIsAtBottom(true);
    if (isStreaming) {
      requestAnimationFrame(() => {
        scrollToLatestInternal('auto', { activateFollow: false, useIndexScroll: true });
      });
    }
  }, [isStreaming, resetKey, scrollToLatestInternal]);

  useEffect(() => {
    if (!scrollerElement) {
      return;
    }

    const handleScroll = () => {
      if (performance.now() <= programmaticScrollUntilMsRef.current) {
        return;
      }

      if (getDistanceFromBottom(scrollerElement) <= FLOW_SCROLL_BOTTOM_THRESHOLD_PX) {
        scrollModeRef.current = isStreaming ? 'following-output' : 'idle';
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        exitFollowMode();
        return;
      }

      if (event.deltaY > 0 && getDistanceFromBottom(scrollerElement) <= FLOW_SCROLL_BOTTOM_THRESHOLD_PX) {
        scrollModeRef.current = isStreaming ? 'following-output' : 'idle';
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
        exitFollowMode();
      }
    };

    const resetTouchScrollIntent = () => {
      touchScrollIntentStartYRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUpwardScrollIntentKey(event) || isEditableElement(event.target)) {
        return;
      }

      exitFollowMode();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) {
        return;
      }

      if (!isPointerOnScrollbarGutter(scrollerElement, event.clientX, event.clientY)) {
        return;
      }

      scrollbarPointerInteractionActiveRef.current = true;
      exitFollowMode();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!scrollbarPointerInteractionActiveRef.current || event.pointerType === 'touch') {
        return;
      }

      if ((event.buttons & 1) !== 1) {
        scrollbarPointerInteractionActiveRef.current = false;
        return;
      }

      exitFollowMode();
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
  }, [exitFollowMode, isStreaming, scrollerElement]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    scheduleFollowAlignment();
  }, [isStreaming, itemCount, scheduleFollowAlignment, tailSignature]);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const executionElement = executionElementRef.current;
    if (!executionElement) {
      return;
    }

    const resizeObserver = new ResizeObserver(scheduleFollowAlignment);
    resizeObserver.observe(executionElement);

    const scroller = scrollerElementRef.current;
    const virtuosoContent = scroller?.firstElementChild;
    if (virtuosoContent instanceof HTMLElement) {
      resizeObserver.observe(virtuosoContent);
    }

    const mutationObserver = new MutationObserver(scheduleFollowAlignment);
    mutationObserver.observe(executionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-expanded'],
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [isStreaming, scheduleFollowAlignment, scrollerElement]);

  useEffect(() => () => {
    if (followFrameRef.current !== null) {
      cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
  }, []);

  return {
    virtuosoRef,
    executionElementRef,
    isAtBottom,
    handleScrollerRef,
    handleAtBottomStateChange,
    handlePromptToggle,
    scrollToLatest,
  };
}
