import { describe, expect, it } from 'vitest';
import {
  acknowledgeFlowViewportTurnNavigation,
  getFlowViewportTurnNavigationRequest,
  requestFlowViewportTurnNavigation,
} from './FlowViewportNavigationBroker';

describe('FlowViewportNavigationBroker', () => {
  it('retains a cross-session target until the destination viewport acknowledges it', () => {
    const request = requestFlowViewportTurnNavigation({
      sessionId: 'broker-session-a',
      turnId: 'turn-a2',
      source: 'timeline',
      behavior: 'auto',
    });

    expect(getFlowViewportTurnNavigationRequest('broker-session-a')).toEqual(request);
    acknowledgeFlowViewportTurnNavigation(request.sessionId, request.requestId);
    expect(getFlowViewportTurnNavigationRequest('broker-session-a')).toBeNull();
  });

  it('keeps the latest intent when a stale request acknowledges late', () => {
    const first = requestFlowViewportTurnNavigation({
      sessionId: 'broker-session-b',
      turnId: 'turn-b1',
      source: 'header',
    });
    const latest = requestFlowViewportTurnNavigation({
      sessionId: 'broker-session-b',
      turnId: 'turn-b3',
      source: 'timeline',
      highlight: true,
    });

    acknowledgeFlowViewportTurnNavigation(first.sessionId, first.requestId);
    expect(getFlowViewportTurnNavigationRequest('broker-session-b')).toEqual(latest);

    acknowledgeFlowViewportTurnNavigation(latest.sessionId, latest.requestId);
    expect(getFlowViewportTurnNavigationRequest('broker-session-b')).toBeNull();
  });
});
