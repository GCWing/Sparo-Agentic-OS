import { useCallback, useRef } from 'react';
import {
  dispatchFlowLayoutCollapseIntent,
  invalidateFlowLayout,
  type FlowLayoutCollapseReason,
  type FlowLayoutMutationDetail,
} from './FlowLayoutMutationEvents';
export type { FlowLayoutCollapseReason };

interface UseFlowLayoutMutationContractOptions {
  toolId: string | null | undefined;
  toolName: string;
  getCardHeight?: () => number | null;
}

interface ApplyLayoutMutationOptions {
  reason?: FlowLayoutCollapseReason;
  onExpand?: () => void;
  detail?: Record<string, unknown>;
}

export function useFlowLayoutMutationContract({
  toolId,
  toolName,
  getCardHeight,
}: UseFlowLayoutMutationContractOptions) {
  const cardRootRef = useRef<HTMLDivElement>(null);

  const dispatchCollapseIntent = useCallback((
    reason: FlowLayoutCollapseReason,
    detail?: Record<string, unknown>,
  ) => {
    const cardHeight = getCardHeight?.()
      ?? cardRootRef.current?.getBoundingClientRect().height
      ?? null;

    dispatchFlowLayoutCollapseIntent({
      toolId: toolId ?? null,
      toolName,
      cardHeight,
      reason,
      ...detail,
    });
  }, [getCardHeight, toolId, toolName]);

  const invalidateLayout = useCallback((detail: FlowLayoutMutationDetail = {}) => {
    invalidateFlowLayout({
      source: toolName,
      toolId: toolId ?? null,
      ...detail,
    });
  }, [toolId, toolName]);

  const applyExpandedState = useCallback((
    currentExpanded: boolean,
    nextExpanded: boolean,
    setExpanded: (nextExpanded: boolean) => void,
    options?: ApplyLayoutMutationOptions,
  ) => {
    if (!nextExpanded && currentExpanded) {
      dispatchCollapseIntent(options?.reason ?? 'manual', options?.detail);
    }

    if (nextExpanded !== currentExpanded) {
      setExpanded(nextExpanded);
      invalidateLayout({
        reason: nextExpanded ? 'expand' : 'collapse',
        priority: 'high',
      });
    }

    if (nextExpanded) {
      options?.onExpand?.();
    }
  }, [dispatchCollapseIntent, invalidateLayout]);

  return {
    cardRootRef,
    invalidateLayout,
    dispatchFlowLayoutMutation: invalidateLayout,
    dispatchCollapseIntent,
    applyExpandedState,
  };
}
