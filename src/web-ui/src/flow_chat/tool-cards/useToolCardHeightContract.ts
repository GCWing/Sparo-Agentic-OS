import { useCallback, useRef } from 'react';
import {
  dispatchToolCardCollapseIntent,
  dispatchToolCardToggle,
  type ToolCardCollapseReason,
} from './toolCardScrollEvents';
export type { ToolCardCollapseReason };

interface UseToolCardHeightContractOptions {
  toolId: string | null | undefined;
  toolName: string;
  getCardHeight?: () => number | null;
}

interface ApplyHeightContractOptions {
  reason?: ToolCardCollapseReason;
  onExpand?: () => void;
  detail?: Record<string, unknown>;
}

export function useToolCardHeightContract({
  toolId,
  toolName,
  getCardHeight,
}: UseToolCardHeightContractOptions) {
  const cardRootRef = useRef<HTMLDivElement>(null);

  const dispatchCollapseIntent = useCallback((
    reason: ToolCardCollapseReason,
    detail?: Record<string, unknown>,
  ) => {
    const cardHeight = getCardHeight?.()
      ?? cardRootRef.current?.getBoundingClientRect().height
      ?? null;

    dispatchToolCardCollapseIntent({
      toolId: toolId ?? null,
      toolName,
      cardHeight,
      reason,
      ...detail,
    });
  }, [getCardHeight, toolId, toolName]);

  const applyExpandedState = useCallback((
    currentExpanded: boolean,
    nextExpanded: boolean,
    setExpanded: (nextExpanded: boolean) => void,
    options?: ApplyHeightContractOptions,
  ) => {
    if (!nextExpanded && currentExpanded) {
      dispatchCollapseIntent(options?.reason ?? 'manual', options?.detail);
    }

    if (nextExpanded !== currentExpanded) {
      setExpanded(nextExpanded);
      dispatchToolCardToggle();
    }

    if (nextExpanded) {
      options?.onExpand?.();
    }
  }, [dispatchCollapseIntent]);

  return {
    cardRootRef,
    dispatchToolCardToggle,
    dispatchCollapseIntent,
    applyExpandedState,
  };
}
