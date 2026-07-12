import { describe, expect, it } from 'vitest';
import {
  absorbLatestTurnContentGrowth,
  clearConsumableCompensation,
  consumeCompensation,
  createInitialGeometry,
  getContentDistanceFromBottom,
  getEffectiveContentHeight,
  getFollowTargetScrollTop,
  getTotalCompensationPx,
  hasLatestTurnFloor,
  hasLatestTurnLayout,
  reconcileLatestTurnFloor,
  replaceLatestTurnLayout,
  resolveTailAlignmentMetrics,
  sanitizeGeometry,
  setLatestTurnActivationTail,
  setTransientTail,
  type LatestTurnLayoutOwner,
  type ScrollerMetrics,
  type ViewportGeometryState,
} from './FlowViewportGeometry';

const metrics: ScrollerMetrics = { scrollTop: 500, scrollHeight: 2000, clientHeight: 800 };
const ownerA: LatestTurnLayoutOwner = { sessionId: 'session-a', turnId: 'turn-a2', epoch: 1 };
const ownerB: LatestTurnLayoutOwner = { sessionId: 'session-b', turnId: 'turn-b3', epoch: 2 };

function withOwner(
  owner: LatestTurnLayoutOwner = ownerA,
  phase: 'dormant' | 'activating' | 'active' = 'active',
): ViewportGeometryState {
  return replaceLatestTurnLayout(createInitialGeometry(), owner, phase);
}

describe('FlowViewportGeometry', () => {
  it('sanitizes every reservation independently', () => {
    const state = setLatestTurnActivationTail(withOwner(ownerA, 'activating'), ownerA, 25);
    const sanitized = sanitizeGeometry({
      ...state,
      collapsePx: -4,
      transientTailPx: -8,
      latestTurnLayout: state.latestTurnLayout
        ? { ...state.latestTurnLayout, floorPx: -12 }
        : null,
    });
    expect(sanitized.collapsePx).toBe(0);
    expect(sanitized.transientTailPx).toBe(0);
    expect(sanitized.latestTurnLayout?.floorPx).toBe(0);
    expect(sanitized.latestTurnLayout?.activationTailPx).toBe(25);
  });

  it('consumes collapse, transient, and activation space but never the floor', () => {
    let state = withOwner(ownerA, 'activating');
    state = reconcileLatestTurnFloor(state, ownerA, 80, false);
    state = setLatestTurnActivationTail(state, ownerA, 20);
    state = setTransientTail({ ...state, collapsePx: 30 }, 15);

    const next = consumeCompensation(state, 60);
    expect(next.collapsePx).toBe(0);
    expect(next.transientTailPx).toBe(0);
    expect(next.latestTurnLayout?.activationTailPx).toBe(5);
    expect(next.latestTurnLayout?.floorPx).toBe(80);

    const exhausted = consumeCompensation(next, 500);
    expect(exhausted.latestTurnLayout?.activationTailPx).toBe(0);
    expect(exhausted.latestTurnLayout?.floorPx).toBe(80);
  });

  it('clears consumable space while preserving the semantic latest layout', () => {
    let state = withOwner(ownerA, 'activating');
    state = reconcileLatestTurnFloor(state, ownerA, 90, false);
    state = setLatestTurnActivationTail(state, ownerA, 25);
    state = setTransientTail({ ...state, collapsePx: 20 }, 35);

    const cleared = clearConsumableCompensation(state);
    expect(cleared.collapsePx).toBe(0);
    expect(cleared.transientTailPx).toBe(0);
    expect(cleared.latestTurnLayout?.activationTailPx).toBe(0);
    expect(cleared.latestTurnLayout?.floorPx).toBe(90);
    expect(cleared.latestTurnLayout?.owner).toEqual(ownerA);
  });

  it('bases effective height and bottom distance on compensation-free content', () => {
    let state = withOwner();
    state = reconcileLatestTurnFloor(state, ownerA, 200, false);
    expect(getEffectiveContentHeight(metrics, state, 100)).toBe(1700);
    expect(getContentDistanceFromBottom(metrics, state)).toBe(500);
    expect(getFollowTargetScrollTop(metrics, state)).toBe(1000);
  });

  it('computes an absolute tail requirement at equilibrium', () => {
    const result = resolveTailAlignmentMetrics(
      { scrollTop: 1500, scrollHeight: 2300, clientHeight: 800 },
      0,
      200,
    );
    expect(result.desiredScrollTop).toBe(1500);
    // Removing the existing 200px reservation yields a raw max of 1300.
    expect(result.requiredTailSpacePx).toBe(200);
  });

  it('replaces owner pixels atomically instead of inheriting an old floor', () => {
    const old = reconcileLatestTurnFloor(withOwner(ownerA), ownerA, 420, false);
    const replaced = replaceLatestTurnLayout(old, ownerB, 'activating');
    const measured = reconcileLatestTurnFloor(replaced, ownerB, 0, false);

    expect(measured.latestTurnLayout?.owner).toEqual(ownerB);
    expect(measured.latestTurnLayout?.floorPx).toBe(0);
    expect(getTotalCompensationPx(measured)).toBe(0);
  });

  it('rejects a late measurement from a retired owner epoch', () => {
    const current = reconcileLatestTurnFloor(withOwner(ownerB), ownerB, 260, false);
    const staleResult = reconcileLatestTurnFloor(current, ownerA, 500, false);
    expect(staleResult).toBe(current);
    expect(staleResult.latestTurnLayout?.owner).toEqual(ownerB);
    expect(staleResult.latestTurnLayout?.floorPx).toBe(260);
  });

  it('keeps owner existence independent from whether floor pixels are needed', () => {
    const state = withOwner(ownerA, 'dormant');
    expect(hasLatestTurnLayout(state)).toBe(true);
    expect(hasLatestTurnFloor(state)).toBe(false);
  });

  it('exchanges active owner floor one-for-one with real content growth', () => {
    const state = reconcileLatestTurnFloor(withOwner(ownerA), ownerA, 500, false);
    const next = absorbLatestTurnContentGrowth(state, ownerA, 120);
    expect(next.latestTurnLayout?.floorPx).toBe(380);
    expect(absorbLatestTurnContentGrowth(next, ownerB, 200)).toBe(next);
  });
});
