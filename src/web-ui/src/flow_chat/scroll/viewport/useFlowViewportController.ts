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
  isDownwardScrollIntentKey,
  isPointerOnScrollbarGutter,
  isUpwardScrollIntentKey,
} from '../FlowScrollIntent';
import { FlowViewportScheduler, type FlowViewportHost, type ViewportSnapshot } from './FlowViewportScheduler';
import type { ViewportMode } from './FlowViewportMachine';
import type { FlowViewportTurnNavigationRequest } from './FlowViewportNavigationBroker';

interface UserMessageRenderItem {
  item: { turnId: string; data?: unknown };
  index: number;
}

export interface UseFlowViewportControllerOptions {
  activeSessionId: string | undefined;
  latestTurnId: string | null;
  virtualItemCount: number;
  userMessageItems: UserMessageRenderItem[];
  isSessionReady: boolean;
  isStreaming: boolean;
  navigationRequest: FlowViewportTurnNavigationRequest | null;
  onNavigationRequestHandled: (request: FlowViewportTurnNavigationRequest) => void;
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
  navigateToTurn: (
    turnId: string,
    options?: { behavior?: ScrollBehavior },
  ) => boolean;
  scrollToLatestEndPosition: () => void;
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
    isSessionReady,
    isStreaming,
    navigationRequest,
    onNavigationRequestHandled,
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

  const initializedSessionIdRef = useRef<string | null>(null);
  const previousLatestTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeSessionId || !isSessionReady || !latestTurnId) {
      return;
    }

    const matchingRequest =
      navigationRequest?.sessionId === activeSessionId ? navigationRequest : null;
    const requestTargetExists = matchingRequest
      ? userMessageItems.some(({ item }) => item.turnId === matchingRequest.turnId)
      : false;

    // A registered cross-session target has priority over the default latest
    // layout. Wait for hydration instead of briefly pinning latest first.
    if (matchingRequest && !requestTargetExists) {
      return;
    }

    if (initializedSessionIdRef.current !== activeSessionId) {
      initializedSessionIdRef.current = activeSessionId;
      previousLatestTurnIdRef.current = latestTurnId;
      scheduler.enterSession(
        activeSessionId,
        latestTurnId,
        matchingRequest?.turnId ?? null,
      );
      if (matchingRequest) {
        onNavigationRequestHandled(matchingRequest);
      }
      return;
    }

    if (previousLatestTurnIdRef.current !== latestTurnId) {
      previousLatestTurnIdRef.current = latestTurnId;
      scheduler.syncLatestTurn(activeSessionId, latestTurnId);
    }

    if (matchingRequest) {
      if (matchingRequest.source === 'send-message' && matchingRequest.turnId === latestTurnId) {
        scheduler.submitLatestTurn(activeSessionId, matchingRequest.turnId);
      } else {
        scheduler.navigateToTurn(matchingRequest.turnId, matchingRequest.behavior);
      }
      onNavigationRequestHandled(matchingRequest);
    }
  }, [
    activeSessionId,
    isSessionReady,
    latestTurnId,
    navigationRequest,
    onNavigationRequestHandled,
    scheduler,
    userMessageItems,
  ]);

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
      } else if (event.deltaY > 0) {
        scheduler.handleUserScrollDownIntent();
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
      } else if (touchStartY - currentY > TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX) {
        touchStartY = currentY;
        scheduler.handleUserScrollDownIntent();
      }
    };

    const resetTouch = () => {
      touchStartY = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }
      if (isUpwardScrollIntentKey(event)) {
        scheduler.handleUserScrollUpIntent();
      } else if (isDownwardScrollIntentKey(event)) {
        scheduler.handleUserScrollDownIntent();
      }
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
    navigateToTurn: (turnId, navigationOptions) => {
      const exists = hostStateRef.current.userMessageItems.some(
        ({ item }) => item.turnId === turnId,
      );
      if (!exists) return false;
      return scheduler.navigateToTurn(turnId, navigationOptions?.behavior ?? 'auto');
    },
    scrollToLatestEndPosition: () => {
      scheduler.dispatch({ type: 'USER_JUMP_LATEST' });
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
