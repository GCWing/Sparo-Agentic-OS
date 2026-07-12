/**
 * One-shot turn navigation broker shared by every FlowChat surface.
 *
 * A cross-session target is registered before `openSession()`. The target
 * survives the source component and VirtualMessageList remount, then the
 * active viewport consumes it only after the transcript contains that turn.
 */

import { useCallback, useSyncExternalStore } from 'react';

export type FlowViewportNavigationSource =
  | 'send-message'
  | 'timeline'
  | 'header'
  | 'btw-back';

export interface FlowViewportTurnNavigationRequest {
  requestId: number;
  sessionId: string;
  turnId: string;
  source: FlowViewportNavigationSource;
  behavior: ScrollBehavior;
  highlight: boolean;
}

export interface RequestFlowViewportTurnNavigation {
  sessionId: string;
  turnId: string;
  source: FlowViewportNavigationSource;
  behavior?: ScrollBehavior;
  highlight?: boolean;
}

let nextRequestId = 0;
const requestsBySession = new Map<string, FlowViewportTurnNavigationRequest>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

export function requestFlowViewportTurnNavigation(
  request: RequestFlowViewportTurnNavigation,
): FlowViewportTurnNavigationRequest {
  nextRequestId += 1;
  const next: FlowViewportTurnNavigationRequest = {
    requestId: nextRequestId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    source: request.source,
    behavior: request.behavior ?? 'auto',
    highlight: request.highlight ?? false,
  };
  requestsBySession.set(request.sessionId, next);
  publish();
  return next;
}

export function getFlowViewportTurnNavigationRequest(
  sessionId: string | undefined,
): FlowViewportTurnNavigationRequest | null {
  return sessionId ? requestsBySession.get(sessionId) ?? null : null;
}

export function acknowledgeFlowViewportTurnNavigation(
  sessionId: string,
  requestId: number,
): void {
  const current = requestsBySession.get(sessionId);
  if (!current || current.requestId !== requestId) return;
  requestsBySession.delete(sessionId);
  publish();
}

export function useFlowViewportTurnNavigationRequest(
  sessionId: string | undefined,
): FlowViewportTurnNavigationRequest | null {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const getSnapshot = useCallback(
    () => getFlowViewportTurnNavigationRequest(sessionId),
    [sessionId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
