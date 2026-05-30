import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useModernFlowChatStore,
  type VisibleTurnInfo,
} from '../../store/modernFlowChatStore';
import { PINNED_TURN_VIEWPORT_OFFSET_PX } from '../FlowScrollGeometry';

interface UserMessageRenderItem {
  item: {
    turnId: string;
    data?: unknown;
  };
  index: number;
}

interface UseVirtuosoVisibleTurnTrackerOptions {
  activeSessionId?: string;
  scrollerElement: HTMLElement | null;
  scrollerElementRef: React.RefObject<HTMLElement | null>;
  userMessageItems: UserMessageRenderItem[];
  virtualItemCount: number;
}

export function useVirtuosoVisibleTurnTracker({
  activeSessionId,
  scrollerElement,
  scrollerElementRef,
  userMessageItems,
  virtualItemCount,
}: UseVirtuosoVisibleTurnTrackerOptions) {
  const visibleTurnMeasureFrameRef = useRef<number | null>(null);

  const visibleTurnInfoByTurnId = useMemoVisibleTurnInfo(userMessageItems);

  const measureVisibleTurn = useCallback(() => {
    const setVisibleTurnInfo = useModernFlowChatStore.getState().setVisibleTurnInfo;
    const currentVisibleTurnInfo = useModernFlowChatStore.getState().visibleTurnInfo;

    if (userMessageItems.length === 0) {
      if (currentVisibleTurnInfo !== null) {
        setVisibleTurnInfo(null);
      }
      return;
    }

    const scroller = scrollerElementRef.current;
    if (!scroller) {
      const fallbackInfo = visibleTurnInfoByTurnId.get(userMessageItems[0]?.item.turnId ?? '') ?? null;
      if (!areVisibleTurnInfoEqual(currentVisibleTurnInfo, fallbackInfo)) {
        setVisibleTurnInfo(fallbackInfo);
      }
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const viewportTop = scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX;
    const viewportBottom = scrollerRect.bottom;
    const renderedItems = Array.from(
      scroller.querySelectorAll<HTMLElement>('.virtual-item-wrapper[data-turn-id]')
    );

    const topVisibleItem = renderedItems.find(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > viewportTop && rect.top < viewportBottom;
    });

    const nextTurnId = topVisibleItem?.dataset.turnId ?? userMessageItems[0]?.item.turnId ?? null;
    const nextInfo = nextTurnId ? (visibleTurnInfoByTurnId.get(nextTurnId) ?? null) : null;

    if (!areVisibleTurnInfoEqual(currentVisibleTurnInfo, nextInfo)) {
      setVisibleTurnInfo(nextInfo);
    }
  }, [scrollerElementRef, userMessageItems, visibleTurnInfoByTurnId]);

  const scheduleVisibleTurnMeasure = useCallback((frames: number = 1) => {
    if (visibleTurnMeasureFrameRef.current !== null) {
      cancelAnimationFrame(visibleTurnMeasureFrameRef.current);
      visibleTurnMeasureFrameRef.current = null;
    }

    const run = (remainingFrames: number) => {
      visibleTurnMeasureFrameRef.current = requestAnimationFrame(() => {
        if (remainingFrames > 1) {
          run(remainingFrames - 1);
          return;
        }

        visibleTurnMeasureFrameRef.current = null;
        measureVisibleTurn();
      });
    };

    run(Math.max(1, frames));
  }, [measureVisibleTurn]);

  useEffect(() => {
    if (userMessageItems.length === 0) {
      useModernFlowChatStore.getState().setVisibleTurnInfo(null);
      return;
    }

    scheduleVisibleTurnMeasure(2);
  }, [activeSessionId, scheduleVisibleTurnMeasure, scrollerElement, userMessageItems, virtualItemCount]);

  useEffect(() => {
    return () => {
      if (visibleTurnMeasureFrameRef.current !== null) {
        cancelAnimationFrame(visibleTurnMeasureFrameRef.current);
        visibleTurnMeasureFrameRef.current = null;
      }
    };
  }, []);

  return {
    scheduleVisibleTurnMeasure,
  };
}

function useMemoVisibleTurnInfo(userMessageItems: UserMessageRenderItem[]) {
  return useMemo(() => {
    const infoMap = new Map<string, VisibleTurnInfo>();

    userMessageItems.forEach(({ item }, index) => {
      infoMap.set(item.turnId, {
        turnIndex: index + 1,
        totalTurns: userMessageItems.length,
        userMessage: getUserMessageContent(item.data),
        turnId: item.turnId,
      });
    });

    return infoMap;
  }, [userMessageItems]);
}

function getUserMessageContent(data: unknown): string {
  if (!data || typeof data !== 'object' || !('content' in data)) {
    return '';
  }

  const content = (data as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function areVisibleTurnInfoEqual(
  left: VisibleTurnInfo | null,
  right: VisibleTurnInfo | null,
): boolean {
  return (
    left?.turnId === right?.turnId &&
    left?.turnIndex === right?.turnIndex &&
    left?.totalTurns === right?.totalTurns &&
    left?.userMessage === right?.userMessage
  );
}
