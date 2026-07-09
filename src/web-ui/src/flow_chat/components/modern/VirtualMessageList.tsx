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
import { useActiveSessionState } from '../../hooks/useActiveSessionState';
import { VirtualItemRenderer } from './VirtualItemRenderer';
import { ScrollToLatestBar } from '../ScrollToLatestBar';
import { ProcessingIndicator } from './ProcessingIndicator';
import { ScrollAnchor } from './ScrollAnchor';
import { useFlowViewportController } from '../../scroll/viewport/useFlowViewportController';
import type { ViewportPinMode } from '../../scroll/viewport/FlowViewportGeometry';
import { useVirtuosoVisibleTurnTracker } from '../../scroll/adapters/useVirtuosoVisibleTurnTracker';
import { useVirtualItems, useActiveSession } from '../../store/modernFlowChatStore';
import { useChatInputState } from '../../store/chatInputStateStore';
import { computeFlowChatInputStackFooterPx } from '../../utils/flowChatScrollLayout';
import { projectStreamingOutput } from '../../projections/streamingOutputProjection';
import { projectProcessingAffordance } from '../../projections/processingAffordanceProjection';
import { useStableProcessingAffordance } from './useStableProcessingAffordance';
import './VirtualMessageList.scss';

/**
 * Methods exposed by VirtualMessageList.
 */
export interface VirtualMessageListRef {
  scrollToTurn: (turnIndex: number) => void;
  scrollToIndex: (index: number) => void;
  // Clears the pin reservation first, then scrolls to the end of content.
  scrollToPhysicalBottomAndClearPin: () => void;
  // Jump to the latest output and follow it while streaming.
  scrollToLatestEndPosition: () => void;
  // Aligns the target turn's user message to the viewport reading offset.
  pinTurnToTop: (turnId: string, options?: { behavior?: ScrollBehavior; pinMode?: ViewportPinMode }) => boolean;
}

export interface VirtualMessageListProps {
  /**
   * When true, hide the right-edge scroll milestone dots. Used while the
   * timeline sidebar is open so anchors do not overlap the panel.
   */
  hideScrollAnchor?: boolean;
}

export const VirtualMessageList = forwardRef<VirtualMessageListRef, VirtualMessageListProps>(
  ({ hideScrollAnchor = false }, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const virtualItems = useVirtualItems();
  const activeSession = useActiveSession();

  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);

  const isInputActive = useChatInputState(state => state.isActive);
  const isInputExpanded = useChatInputState(state => state.isExpanded);
  const inputHeight = useChatInputState(state => state.inputHeight);
  const inputStackFooterPx = computeFlowChatInputStackFooterPx(inputHeight, isInputActive);

  const activeSessionState = useActiveSessionState();
  const isProcessing = activeSessionState.isProcessing;
  const processingPhase = activeSessionState.processingPhase;

  const userMessageItems = useMemo(() => {
    return virtualItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'user-message');
  }, [virtualItems]);

  const latestTurnId = userMessageItems[userMessageItems.length - 1]?.item.turnId ?? null;
  const latestUserMessageIndex = userMessageItems[userMessageItems.length - 1]?.index ?? 0;

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
    isStreaming: isStreamingOutput,
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
    scrollToPhysicalBottomAndClearPin: commands.scrollToPhysicalBottomAndClearPin,
    scrollToLatestEndPosition: commands.scrollToLatestEndPosition,
    pinTurnToTop: commands.pinTurnToTop,
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
        <div className="empty-state">
          <p>No messages yet</p>
        </div>
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
        // New mounts start near the latest user turn to avoid flashing older
        // content before the sticky pin can establish.
        initialTopMostItemIndex={latestUserMessageIndex}

        overscan={{ main: 360, reverse: 240 }}

        rangeChanged={handleRangeChanged}

        defaultItemHeight={200}

        increaseViewportBy={{ top: 360, bottom: 420 }}

        scrollerRef={handleScrollerRef}

        components={components}
      />

      {!hideScrollAnchor && (
        <ScrollAnchor
          onAnchorNavigate={(turnId) => {
            commands.pinTurnToTop(turnId, { behavior: 'smooth' });
          }}
          scrollerRef={scrollerElementRef}
        />
      )}

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
