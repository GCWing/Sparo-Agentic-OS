/**
 * React assembly for the FlowChat viewport system.
 *
 * Wires the mode machine + frame scheduler to a Virtuoso host: input intent
 * listeners, layout observers, layout mutation events, session/turn/stream
 * effects, and the imperative navigation command API.
 *
 * This hook is the only integration point `VirtualMessageList` needs.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import {
  FLOW_LAYOUT_COLLAPSE_INTENT_EVENT,
  FLOW_LAYOUT_MUTATION_EVENT,
  isFlowLayoutCollapseIntentEvent,
} from '../FlowLayoutMutationEvents';
import {
  TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX,
  isEditableElement,
  isPointerOnScrollbarGutter,
  isUpwardScrollIntentKey,
} from '../FlowScrollIntent';
import type { ViewportPinMode } from './FlowViewportGeometry';
import { FlowViewportScheduler, type FlowViewportHost, type ViewportSnapshot } from './FlowViewportScheduler';
import type { ViewportMode } from './FlowViewportMachine';

interface UserMessageRenderItem {
  item: { turnId: string; data?: unknown };
  index: number;
}

export interface UseFlowViewportControllerOptions {
  activeSessionId: string | undefined;
  latestTurnId: string | null;
  virtualItemCount: number;
  userMessageItems: UserMessageRenderItem[];
  isStreaming: boolean;
  inputStackFooterPx: number;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  scrollerElementRef: MutableRefObject<HTMLElement | null>;
  /** Scroller element mirrored into parent state; listener effects rebind on change. */
  scrollerElement: HTMLElement | null;
  onScrollerElementChange: (element: HTMLElement | null) => void;
  onVisibleTurnMeasure: () => void;
}

export interface FlowViewportCommands {
  scrollToTurn: (turnIndex: number) => void;
  scrollToIndex: (index: number) => void;
  pinTurnToTop: (
    turnId: string,
    options?: { behavior?: ScrollBehavior; pinMode?: ViewportPinMode },
  ) => boolean;
  scrollToLatestEndPosition: () => void;
  scrollToPhysicalBottomAndClearPin: () => void;
}

export interface UseFlowViewportControllerResult {
  snapshot: ViewportSnapshot;
  handleScrollerRef: (el: HTMLElement | Window | null) => void;
  handleFooterRef: (el: HTMLDivElement | null) => void;
  handleRangeChanged: () => void;
  getFooterHeightPx: () => number;
  commands: FlowViewportCommands;
  getMode: () => ViewportMode;
}

const LAYOUT_TRANSITION_PROPERTIES = new Set(['grid-template-rows', 'height', 'max-height']);

export function useFlowViewportController(
  options: UseFlowViewportControllerOptions,
): UseFlowViewportControllerResult {
  const {
    activeSessionId,
    latestTurnId,
    virtualItemCount,
    userMessageItems,
    isStreaming,
    inputStackFooterPx,
    virtuosoRef,
    scrollerElementRef,
    scrollerElement,
    onScrollerElementChange,
    onVisibleTurnMeasure,
  } = options;

  const footerElementRef = useRef<HTMLDivElement | null>(null);

  // Live host values readable from scheduler callbacks without re-binding.
  const hostStateRef = useRef({
    isStreaming,
    latestTurnId,
    inputStackFooterPx,
    userMessageItems,
    onVisibleTurnMeasure,
  });
  hostStateRef.current = {
    isStreaming,
    latestTurnId,
    inputStackFooterPx,
    userMessageItems,
    onVisibleTurnMeasure,
  };

  const schedulerRef = useRef<FlowViewportScheduler | null>(null);
  if (schedulerRef.current === null) {
    const host: FlowViewportHost = {
      getScroller: () => scrollerElementRef.current,
      getFooter: () => footerElementRef.current,
      getInputFooterPx: () => hostStateRef.current.inputStackFooterPx,
      isStreaming: () => hostStateRef.current.isStreaming,
      getLatestTurnId: () => hostStateRef.current.latestTurnId,
      findUserMessageIndex: (turnId: string) => {
        const entry = hostStateRef.current.userMessageItems.find(
          ({ item }) => item.turnId === turnId,
        );
        return entry ? entry.index : -1;
      },
      getUserMessageElement: (turnId: string) => {
        const scroller = scrollerElementRef.current;
        if (!scroller) return null;
        return scroller.querySelector<HTMLElement>(
          `.virtual-item-wrapper[data-item-type="user-message"][data-turn-id="${CSS.escape(turnId)}"]`,
        );
      },
      virtuosoScrollToIndex: (index, align, behavior) => {
        virtuosoRef.current?.scrollToIndex({
          index,
          align,
          behavior: behavior === 'smooth' ? 'smooth' : 'auto',
        });
      },
      onVisibleTurnMeasure: () => hostStateRef.current.onVisibleTurnMeasure(),
    };
    schedulerRef.current = new FlowViewportScheduler(host);
  }
  const scheduler = schedulerRef.current;

  useEffect(() => () => scheduler.dispose(), [scheduler]);

  const snapshot = useSyncExternalStore(scheduler.subscribe, scheduler.getSnapshot);

  // ── Scroller / footer wiring ───────────────────────────────────────────────

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const element = el instanceof HTMLElement ? el : null;
    scrollerElementRef.current = element;
    onScrollerElementChange(element);
    if (element) {
      scheduler.attachScroller();
    }
  }, [onScrollerElementChange, scheduler, scrollerElementRef]);

  const handleFooterRef = useCallback((el: HTMLDivElement | null) => {
    footerElementRef.current = el;
    if (el) {
      scheduler.attachFooter();
    }
  }, [scheduler]);

  // ── Session / turn / stream effects ────────────────────────────────────────

  const previousSessionIdRef = useRef<string | undefined>(undefined);
  const previousLatestTurnIdRef = useRef<string | null>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      previousSessionIdRef.current = activeSessionId;
      previousLatestTurnIdRef.current = latestTurnId;
      // Initial mount inherits session semantics: a streaming session pins
      // its latest turn; a static one starts in reading mode.
      scheduler.resetForSession(latestTurnId, isStreaming);
      return;
    }

    if (previousSessionIdRef.current !== activeSessionId) {
      previousSessionIdRef.current = activeSessionId;
      previousLatestTurnIdRef.current = latestTurnId;
      scheduler.resetForSession(latestTurnId, isStreaming);
      return;
    }

    if (previousLatestTurnIdRef.current !== latestTurnId) {
      previousLatestTurnIdRef.current = latestTurnId;
      if (latestTurnId) {
        scheduler.notifyTurnSent(latestTurnId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, latestTurnId, scheduler]);

  const previousStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (previousStreamingRef.current === isStreaming) {
      return;
    }
    previousStreamingRef.current = isStreaming;
    scheduler.notifyStreamingChanged(isStreaming);
  }, [isStreaming, scheduler]);

  useEffect(() => {
    if (virtualItemCount === 0) {
      scheduler.resetForEmptyList();
    }
  }, [scheduler, virtualItemCount]);

  useEffect(() => {
    scheduler.onInputFooterChanged();
  }, [inputStackFooterPx, scheduler]);

  // ── Input intent + scroll listeners ────────────────────────────────────────

  useEffect(() => {
    const scroller = scrollerElement;
    if (!scroller) return;

    let touchStartY: number | null = null;
    let scrollbarDragActive = false;

    const handleScroll = () => scheduler.handleScrollEvent();

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        scheduler.handleUserScrollUpIntent();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (touchStartY === null || currentY === undefined) return;
      if (currentY - touchStartY > TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX) {
        touchStartY = currentY;
        scheduler.handleUserScrollUpIntent();
      }
    };

    const resetTouch = () => {
      touchStartY = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUpwardScrollIntentKey(event) || isEditableElement(event.target)) {
        return;
      }
      scheduler.handleUserScrollUpIntent();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      if (!isPointerOnScrollbarGutter(scroller, event.clientX, event.clientY)) return;
      scrollbarDragActive = true;
      scheduler.handleUserScrollUpIntent();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!scrollbarDragActive || event.pointerType === 'touch') return;
      if ((event.buttons & 1) !== 1) {
        scrollbarDragActive = false;
        return;
      }
      scheduler.handleUserScrollUpIntent();
    };

    const endScrollbarDrag = () => {
      scrollbarDragActive = false;
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    scroller.addEventListener('wheel', handleWheel, { passive: true });
    scroller.addEventListener('touchstart', handleTouchStart, { passive: true });
    scroller.addEventListener('touchmove', handleTouchMove, { passive: true });
    scroller.addEventListener('touchend', resetTouch, { passive: true });
    scroller.addEventListener('touchcancel', resetTouch, { passive: true });
    scroller.addEventListener('keydown', handleKeyDown, true);
    scroller.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', endScrollbarDrag, true);
    window.addEventListener('pointercancel', endScrollbarDrag, true);

    return () => {
      scroller.removeEventListener('scroll', handleScroll);
      scroller.removeEventListener('wheel', handleWheel);
      scroller.removeEventListener('touchstart', handleTouchStart);
      scroller.removeEventListener('touchmove', handleTouchMove);
      scroller.removeEventListener('touchend', resetTouch);
      scroller.removeEventListener('touchcancel', resetTouch);
      scroller.removeEventListener('keydown', handleKeyDown, true);
      scroller.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', endScrollbarDrag, true);
      window.removeEventListener('pointercancel', endScrollbarDrag, true);
    };
  }, [scheduler, scrollerElement]);

  // ── Layout observers ───────────────────────────────────────────────────────

  useEffect(() => {
    const scroller = scrollerElement;
    if (!scroller) return;

    const resizeTarget = scroller.firstElementChild instanceof HTMLElement
      ? scroller.firstElementChild
      : scroller;

    const resizeObserver = new ResizeObserver(() => {
      scheduler.handleContentResize();
    });
    resizeObserver.observe(resizeTarget);

    const handleTransitionRun = (event: TransitionEvent) => {
      if (!LAYOUT_TRANSITION_PROPERTIES.has(event.propertyName)) return;
      scheduler.transitionStarted();
    };
    const handleTransitionFinish = (event: TransitionEvent) => {
      if (!LAYOUT_TRANSITION_PROPERTIES.has(event.propertyName)) return;
      scheduler.transitionEnded();
    };

    scroller.addEventListener('transitionrun', handleTransitionRun, true);
    scroller.addEventListener('transitionend', handleTransitionFinish, true);
    scroller.addEventListener('transitioncancel', handleTransitionFinish, true);

    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener('transitionrun', handleTransitionRun, true);
      scroller.removeEventListener('transitionend', handleTransitionFinish, true);
      scroller.removeEventListener('transitioncancel', handleTransitionFinish, true);
    };
  }, [scheduler, scrollerElement]);

  // ── Layout mutation contract ───────────────────────────────────────────────

  useEffect(() => {
    const handleMutation = () => {
      scheduler.handleLayoutMutation();
    };
    const handleCollapseIntent = (event: Event) => {
      if (!isFlowLayoutCollapseIntentEvent(event)) return;
      scheduler.handleCollapseIntent(event.detail?.cardHeight ?? null);
    };

    window.addEventListener(FLOW_LAYOUT_MUTATION_EVENT, handleMutation);
    window.addEventListener(FLOW_LAYOUT_COLLAPSE_INTENT_EVENT, handleCollapseIntent as EventListener);
    return () => {
      window.removeEventListener(FLOW_LAYOUT_MUTATION_EVENT, handleMutation);
      window.removeEventListener(FLOW_LAYOUT_COLLAPSE_INTENT_EVENT, handleCollapseIntent as EventListener);
    };
  }, [scheduler]);

  // ── Commands ───────────────────────────────────────────────────────────────

  const commands = useMemo<FlowViewportCommands>(() => ({
    scrollToTurn: (turnIndex: number) => {
      const items = hostStateRef.current.userMessageItems;
      if (turnIndex < 1 || turnIndex > items.length) return;
      const target = items[turnIndex - 1];
      if (!target) return;
      scheduler.dispatch({
        type: 'NAVIGATE',
        target: { type: 'index-center', index: target.index, behavior: 'smooth' },
      });
    },
    scrollToIndex: (index: number) => {
      scheduler.dispatch({
        type: 'NAVIGATE',
        target: { type: 'index-center', index, behavior: 'auto' },
      });
    },
    pinTurnToTop: (turnId, pinOptions) => {
      const exists = hostStateRef.current.userMessageItems.some(
        ({ item }) => item.turnId === turnId,
      );
      if (!exists) return false;
      // Pin mode is derived from the target, not trusted from the caller:
      // pinning the latest turn must always keep (or rebuild) the sticky tail
      // floor, while pinning an older turn is a transient detour that leaves
      // the floor untouched for the return trip. This keeps anchor-dot jumps,
      // header jumps, and send-message pins consistent without per-caller
      // mode decisions.
      const pinMode: ViewportPinMode =
        turnId === hostStateRef.current.latestTurnId ? 'sticky-latest' : 'transient';
      scheduler.dispatch({
        type: 'NAVIGATE',
        target: {
          type: 'turn-pin-top',
          turnId,
          pinMode,
          behavior: pinOptions?.behavior ?? 'auto',
        },
      });
      return true;
    },
    scrollToLatestEndPosition: () => {
      scheduler.dispatch({ type: 'USER_JUMP_LATEST' });
    },
    scrollToPhysicalBottomAndClearPin: () => {
      scheduler.dispatch({
        type: 'NAVIGATE',
        target: { type: 'latest-end', behavior: 'smooth', clearPin: true },
      });
    },
  }), [scheduler]);

  const handleRangeChanged = useCallback(() => {
    scheduler.handleRangeChanged();
  }, [scheduler]);

  const getFooterHeightPx = useCallback(() => scheduler.getFooterHeightPx(), [scheduler]);
  const getMode = useCallback(() => scheduler.getMode(), [scheduler]);

  return {
    snapshot,
    handleScrollerRef,
    handleFooterRef,
    handleRangeChanged,
    getFooterHeightPx,
    commands,
    getMode,
  };
}
