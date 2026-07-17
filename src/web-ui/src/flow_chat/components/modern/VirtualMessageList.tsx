/**
 * Virtualized message list.
 * Renders a flattened DialogTurn stream (user messages + model rounds).
 *
 * Scroll policy:
 * - A new turn pins the latest user message near the top for reading; the
 *   synthetic tail below it is exchanged 1:1 against streaming growth.
 * - Once the tail floor is consumed, the viewport follows the output.
 * - Explicit upward user intent (wheel/touch/keys/scrollbar) always hands the
 *   viewport back to the user immediately.
 * - When the stream ends, a short finalizing window absorbs terminal
 *   auto-collapses before settling into reading mode.
 *
 * All of this is owned by `useFlowViewportController`; this component only
 * wires the controller to Virtuoso and renders overlays.
 * See `src/web-ui/src/flow_chat/scroll/README.md`.
 */

import { useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useSessionStateMachine } from '../../hooks/useSessionStateMachine';
import { SessionExecutionState } from '../../state-machine/types';
import { VirtualItemRenderer } from './VirtualItemRenderer';
import { ScrollToLatestBar } from '../ScrollToLatestBar';
import { ProcessingIndicator } from './ProcessingIndicator';
import { ScrollAnchor } from './ScrollAnchor';
import { useFlowViewportController } from '../../scroll/viewport/useFlowViewportController';
import {
  acknowledgeFlowViewportTurnNavigation,
  useFlowViewportTurnNavigationRequest,
  type FlowViewportTurnNavigationRequest,
} from '../../scroll/viewport/FlowViewportNavigationBroker';
import { useVirtuosoVisibleTurnTracker } from '../../scroll/adapters/useVirtuosoVisibleTurnTracker';
import type { VirtualItem } from '../../store/modernFlowChatStore';
import type { Session } from '../../types/flow-chat';
import { useChatInputState } from '../../store/chatInputStateStore';
import { computeFlowChatInputStackFooterPx } from '../../utils/flowChatScrollLayout';
import { projectStreamingOutput } from '../../projections/streamingOutputProjection';
import { projectProcessingAffordance } from '../../projections/processingAffordanceProjection';
import { useStableProcessingAffordance } from './useStableProcessingAffordance';
import { FallbackWelcomePanel } from '../FallbackWelcomePanel';
import './VirtualMessageList.scss';

/**
 * Methods exposed by VirtualMessageList.
 */
export interface VirtualMessageListRef {
  scrollToTurn: (turnIndex: number) => void;
  scrollToIndex: (index: number) => void;
  // Jump to the latest output and follow it while streaming.
  scrollToLatestEndPosition: () => void;
}

export interface VirtualMessageListProps {
  /** Session owned by the containing FlowChat surface. */
  session: Session | null;
  /** Projection for the same scoped session. */
  virtualItems: VirtualItem[];
  /**
   * When true, dock the right-edge scroll milestone dots to the timeline
   * sidebar's left border instead of letting the sidebar cover them.
   */
  timelineSidebarOpen?: boolean;
}

export const VirtualMessageList = forwardRef<VirtualMessageListRef, VirtualMessageListProps>(
  ({ session: activeSession, virtualItems, timelineSidebarOpen = false }, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const navigationRequest = useFlowViewportTurnNavigationRequest(activeSession?.sessionId);

  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);

  const isInputActive = useChatInputState(state => state.isActive);
  const isInputExpanded = useChatInputState(state => state.isExpanded);
  const inputHeight = useChatInputState(state => state.inputHeight);
  const inputStackFooterPx = computeFlowChatInputStackFooterPx(inputHeight, isInputActive);

  const sessionState = useSessionStateMachine(activeSession?.sessionId ?? null);
  const isProcessing = sessionState?.currentState === SessionExecutionState.PROCESSING;
  const processingPhase = sessionState?.context.processingPhase ?? null;

  const userMessageItems = useMemo(() => {
    return virtualItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'user-message');
  }, [virtualItems]);

  const latestTurnId = userMessageItems[userMessageItems.length - 1]?.item.turnId ?? null;
  const latestUserMessageIndex = userMessageItems[userMessageItems.length - 1]?.index ?? 0;
  const requestedUserMessageIndex = navigationRequest
    ? userMessageItems.find(({ item }) => item.turnId === navigationRequest.turnId)?.index
    : undefined;
  const initialUserMessageIndex = requestedUserMessageIndex ?? latestUserMessageIndex;
  const isSessionReady =
    activeSession?.loadPhase === 'live' ||
    activeSession?.loadPhase === 'hydrated' ||
    activeSession?.loadPhase === 'hydrate-failed';

  const handleNavigationRequestHandled = useCallback(
    (request: FlowViewportTurnNavigationRequest) => {
      acknowledgeFlowViewportTurnNavigation(request.sessionId, request.requestId);
      if (!request.highlight) return;

      let attempts = 0;
      const applyHighlight = () => {
        const node = scrollerElementRef.current?.querySelector<HTMLElement>(
          `.virtual-item-wrapper[data-item-type="user-message"][data-turn-id="${CSS.escape(request.turnId)}"]`,
        );
        if (!node) {
          if (attempts++ < 12) requestAnimationFrame(applyHighlight);
          return;
        }
        node.classList.remove('agentic-os-anchor-pulse');
        void node.offsetWidth;
        node.classList.add('agentic-os-anchor-pulse');
        window.setTimeout(() => node.classList.remove('agentic-os-anchor-pulse'), 1700);
      };
      requestAnimationFrame(applyHighlight);
    },
    [],
  );

  const streamingOutputProjection = useMemo(
    () => projectStreamingOutput(activeSession),
    [activeSession],
  );
  const isStreamingOutput = isProcessing || streamingOutputProjection.isStreamingOutput;

  const { scheduleVisibleTurnMeasure } = useVirtuosoVisibleTurnTracker({
    activeSessionId: activeSession?.sessionId,
    scrollerElement,
    scrollerElementRef,
    userMessageItems,
    virtualItemCount: virtualItems.length,
  });

  const handleVisibleTurnMeasure = useCallback(() => {
    scheduleVisibleTurnMeasure();
  }, [scheduleVisibleTurnMeasure]);

  const {
    snapshot,
    handleScrollerRef,
    handleFooterRef,
    handleRangeChanged,
    getFooterHeightPx,
    commands,
  } = useFlowViewportController({
    activeSessionId: activeSession?.sessionId,
    latestTurnId,
    virtualItemCount: virtualItems.length,
    userMessageItems,
    isSessionReady,
    isStreaming: isStreamingOutput,
    navigationRequest,
    onNavigationRequestHandled: handleNavigationRequestHandled,
    inputStackFooterPx,
    virtuosoRef,
    scrollerElementRef,
    scrollerElement,
    onScrollerElementChange: setScrollerElement,
    onVisibleTurnMeasure: handleVisibleTurnMeasure,
  });

  useImperativeHandle(ref, () => ({
    scrollToTurn: commands.scrollToTurn,
    scrollToIndex: commands.scrollToIndex,
    scrollToLatestEndPosition: commands.scrollToLatestEndPosition,
  }), [commands]);

  const processingAffordanceProjection = useMemo(
    () => projectProcessingAffordance({
      session: activeSession,
      isProcessing: isStreamingOutput,
      processingPhase,
    }),
    [activeSession, isStreamingOutput, processingPhase],
  );
  const processingAffordance = useStableProcessingAffordance(processingAffordanceProjection);

  // The footer height is owned by the scheduler (direct DOM writes); render
  // only seeds the current value so a remount starts consistent.
  const components = useMemo(() => ({
    Header: () => <div className="message-list-header" />,
    Footer: () => (
      <>
        <ProcessingIndicator
          visible={processingAffordance.visible}
          reserveSpace={processingAffordance.reserveSpace}
          resetKey={processingAffordance.resetKey}
        />
        <div
          ref={handleFooterRef}
          className="message-list-footer"
          style={{
            height: `${getFooterHeightPx()}px`,
            minHeight: `${getFooterHeightPx()}px`,
          }}
        />
      </>
    ),
  }), [
    getFooterHeightPx,
    handleFooterRef,
    processingAffordance.reserveSpace,
    processingAffordance.resetKey,
    processingAffordance.visible,
  ]);

  // Render.
  if (virtualItems.length === 0) {
    return (
      <div className="virtual-message-list virtual-message-list--empty">
        <FallbackWelcomePanel />
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
        // Cross-session requests seed their explicit turn; otherwise mounts
        // start at latest while its owned layout is established.
        initialTopMostItemIndex={initialUserMessageIndex}

        overscan={{ main: 360, reverse: 240 }}

        rangeChanged={handleRangeChanged}

        defaultItemHeight={200}

        increaseViewportBy={{ top: 360, bottom: 420 }}

        scrollerRef={handleScrollerRef}

        components={components}
      />

      <ScrollAnchor
        virtualItems={virtualItems}
        onAnchorNavigate={(turnId) => {
          commands.navigateToTurn(turnId, { behavior: 'smooth' });
        }}
        scrollerRef={scrollerElementRef}
        dockToTimelineSidebar={timelineSidebarOpen}
      />

      <ScrollToLatestBar
        visible={snapshot.showScrollToLatest && virtualItems.length > 0}
        onClick={commands.scrollToLatestEndPosition}
        isInputActive={isInputActive}
        isInputExpanded={isInputExpanded}
        inputHeight={inputHeight}
      />
    </div>
  );
});

VirtualMessageList.displayName = 'VirtualMessageList';
