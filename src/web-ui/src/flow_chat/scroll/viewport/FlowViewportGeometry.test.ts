import { describe, expect, it } from 'vitest';
import {
  absorbPinnedContentGrowth,
  clearConsumableCompensation,
  clearPinReservation,
  consumeCompensation,
  createInitialGeometry,
  getContentDistanceFromBottom,
  getEffectiveContentHeight,
  getFollowTargetScrollTop,
  getTotalCompensationPx,
  hasActiveStickyFloor,
  reconcileStickyPinReservation,
  resolvePinMetrics,
  sanitizeGeometry,
  type ScrollerMetrics,
  type ViewportGeometryState,
} from './FlowViewportGeometry';

const metrics: ScrollerMetrics = { scrollTop: 500, scrollHeight: 2000, clientHeight: 800 };

function geometry(partial: Partial<ViewportGeometryState>): ViewportGeometryState {
  return { ...createInitialGeometry(), ...partial };
}

describe('FlowViewportGeometry', () => {
  it('sanitizes negative values and clamps the floor to the reservation', () => {
    const sanitized = sanitizeGeometry(geometry({ collapsePx: -4, pinPx: 10, pinFloorPx: 25 }));
    expect(sanitized.collapsePx).toBe(0);
    expect(sanitized.pinPx).toBe(10);
    expect(sanitized.pinFloorPx).toBe(10);
  });

  it('consumes collapse space first, then pin space above the floor only', () => {
    const state = geometry({ collapsePx: 30, pinPx: 100, pinFloorPx: 80 });
    const next = consumeCompensation(state, 40);
    expect(next.collapsePx).toBe(0);
    expect(next.pinPx).toBe(90);
    expect(next.pinFloorPx).toBe(80);

    const exhausted = consumeCompensation(next, 500);
    expect(exhausted.collapsePx).toBe(0);
    expect(exhausted.pinPx).toBe(80);
    expect(exhausted.pinFloorPx).toBe(80);
  });

  it('clears only consumable space, preserving the sticky floor', () => {
    const state = geometry({
      collapsePx: 20,
      pinPx: 120,
      pinFloorPx: 90,
      pinMode: 'sticky-latest',
      pinTargetTurnId: 'turn-1',
    });
    const next = clearConsumableCompensation(state);
    expect(next.collapsePx).toBe(0);
    expect(next.pinPx).toBe(90);
    expect(next.pinFloorPx).toBe(90);
    expect(next.pinTargetTurnId).toBe('turn-1');

    const cleared = clearPinReservation(next);
    expect(getTotalCompensationPx(cleared)).toBe(0);
    expect(cleared.pinTargetTurnId).toBeNull();
  });

  it('bases effective height and bottom distance on compensation-free content', () => {
    const state = geometry({ pinPx: 200, pinFloorPx: 200 });
    expect(getEffectiveContentHeight(metrics, state, 100)).toBe(1700);
    // content bottom: 2000 - 200 - 800 - 500 = 500
    expect(getContentDistanceFromBottom(metrics, state)).toBe(500);
    expect(getFollowTargetScrollTop(metrics, state)).toBe(1000);
  });

  it('computes missing tail space for pin alignment', () => {
    // Wants to scroll 400px further down while only 700px of range remains
    // past the current pin reservation.
    const pinMetrics = resolvePinMetrics(
      { scrollTop: 900, scrollHeight: 2000, clientHeight: 800 },
      400,
      100,
    );
    expect(pinMetrics.desiredScrollTop).toBe(1300);
    // rawMax = 2000 - 100 - 800 = 1100 -> missing 200
    expect(pinMetrics.missingTailSpacePx).toBe(200);
  });

  it('detects an active sticky floor from geometry state', () => {
    expect(hasActiveStickyFloor(geometry({ pinFloorPx: 0 }))).toBe(false);
    expect(
      hasActiveStickyFloor(geometry({
        pinPx: 200,
        pinFloorPx: 200,
        pinMode: 'sticky-latest',
        pinTargetTurnId: 'turn-1',
      })),
    ).toBe(true);
  });

  it('preserves the sticky floor at equilibrium when missing tail is zero', () => {
    const state = geometry({
      pinPx: 500,
      pinFloorPx: 500,
      pinMode: 'sticky-latest',
      pinTargetTurnId: 'turn-2',
    });
    const next = reconcileStickyPinReservation(state, 0, false, 'turn-2');
    expect(next.pinPx).toBe(500);
    expect(next.pinFloorPx).toBe(500);
    expect(next.pinTargetTurnId).toBe('turn-2');
  });

  it('shrinks the sticky floor 1:1 during pinned content growth', () => {
    const state = geometry({
      pinPx: 500,
      pinFloorPx: 500,
      pinMode: 'sticky-latest',
      pinTargetTurnId: 'turn-2',
    });
    const next = absorbPinnedContentGrowth(state, 120);
    expect(next.pinPx).toBe(380);
    expect(next.pinFloorPx).toBe(380);
  });
});
