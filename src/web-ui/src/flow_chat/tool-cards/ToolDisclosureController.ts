import { useCallback, useEffect, useRef, useState } from 'react';
import { useToolCardHeightContract, type ToolCardCollapseReason } from './useToolCardHeightContract';
import type { ToolCardStatus } from './toolStatus';

export interface ToolDisclosureControllerOptions {
  toolId?: string;
  toolName: string;
  initialExpanded?: boolean;
  autoExpandStatuses?: ToolCardStatus[];
  autoCollapseStatuses?: ToolCardStatus[];
  status?: ToolCardStatus;
  onExpand?: () => void;
}

export function useToolDisclosureController({
  toolId,
  toolName,
  initialExpanded = false,
  autoExpandStatuses,
  autoCollapseStatuses,
  status,
  onExpand,
}: ToolDisclosureControllerOptions) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const previousStatusRef = useRef(status);
  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({ toolId, toolName });

  const setExpanded = useCallback((nextExpanded: boolean, reason: ToolCardCollapseReason = 'manual') => {
    applyExpandedState(isExpanded, nextExpanded, setIsExpanded, { reason, onExpand });
  }, [applyExpandedState, isExpanded, onExpand]);

  const toggleExpanded = useCallback((reason: ToolCardCollapseReason = 'manual') => {
    setExpanded(!isExpanded, reason);
  }, [isExpanded, setExpanded]);

  useEffect(() => {
    if (!status || previousStatusRef.current === status) {
      return;
    }

    previousStatusRef.current = status;

    if (autoExpandStatuses?.includes(status)) {
      setExpanded(true, 'auto');
      return;
    }

    if (autoCollapseStatuses?.includes(status)) {
      setExpanded(false, 'auto');
    }
  }, [autoCollapseStatuses, autoExpandStatuses, setExpanded, status]);

  return {
    cardRootRef,
    isExpanded,
    setExpanded,
    toggleExpanded,
  };
}

