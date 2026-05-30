import { describe, expect, it } from 'vitest';
import {
  areBottomReservationStatesEqual,
  createInactiveAnchorLock,
  createInactiveCollapseIntent,
  createInitialBottomReservationState,
  getReservationConsumablePx,
  getReservationTotalPx,
  sanitizeBottomReservationState,
} from './FlowScrollGeometry';

describe('FlowScrollGeometry', () => {
  it('creates inert anchor and collapse states', () => {
    expect(createInactiveAnchorLock()).toEqual({
      active: false,
      targetScrollTop: 0,
      reason: null,
      lockUntilMs: 0,
    });
    expect(createInactiveCollapseIntent()).toEqual({
      active: false,
      anchorScrollTop: 0,
      toolId: null,
      toolName: null,
      expiresAtMs: 0,
      distanceFromBottomBeforeCollapse: 0,
      baseTotalCompensationPx: 0,
      cumulativeShrinkPx: 0,
    });
  });

  it('sanitizes reservation values and keeps floors within reservation size', () => {
    const sanitized = sanitizeBottomReservationState({
      collapse: { kind: 'collapse', px: -10, floorPx: 5 },
      pin: {
        kind: 'pin',
        px: 8,
        floorPx: 24,
        mode: 'sticky-latest',
        targetTurnId: 'turn-1',
      },
    });

    expect(sanitized.collapse).toEqual({ kind: 'collapse', px: 0, floorPx: 0 });
    expect(sanitized.pin).toEqual({
      kind: 'pin',
      px: 8,
      floorPx: 8,
      mode: 'sticky-latest',
      targetTurnId: 'turn-1',
    });
    expect(getReservationTotalPx(sanitized.pin)).toBe(8);
    expect(getReservationConsumablePx(sanitized.pin)).toBe(0);
  });

  it('compares reservation states using the scroll compensation epsilon', () => {
    const base = createInitialBottomReservationState();
    const tinyDelta = {
      ...base,
      pin: {
        ...base.pin,
        px: 0.25,
      },
    };
    const realDelta = {
      ...base,
      pin: {
        ...base.pin,
        px: 2,
      },
    };

    expect(areBottomReservationStatesEqual(base, tinyDelta)).toBe(true);
    expect(areBottomReservationStatesEqual(base, realDelta)).toBe(false);
  });
});
