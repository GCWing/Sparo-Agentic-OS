import type { FlowChatPinTurnToTopMode } from '../events/flowchatNavigation';

export const COMPENSATION_EPSILON_PX = 0.5;
export const ANCHOR_LOCK_MIN_DEVIATION_PX = 0.5;
export const ANCHOR_LOCK_DURATION_MS = 450;
export const PINNED_TURN_VIEWPORT_OFFSET_PX = 61;

export interface ScrollAnchorLockState {
  active: boolean;
  targetScrollTop: number;
  reason: 'transition-shrink' | 'instant-shrink' | null;
  lockUntilMs: number;
}

export interface PendingCollapseIntentState {
  active: boolean;
  anchorScrollTop: number;
  toolId: string | null;
  toolName: string | null;
  expiresAtMs: number;
  distanceFromBottomBeforeCollapse: number;
  baseTotalCompensationPx: number;
  cumulativeShrinkPx: number;
}

type BottomReservationKind = 'collapse' | 'pin';

export interface BottomReservationBase {
  kind: BottomReservationKind;
  px: number;
  floorPx: number;
}

export interface CollapseBottomReservation extends BottomReservationBase {
  kind: 'collapse';
}

export interface PinBottomReservation extends BottomReservationBase {
  kind: 'pin';
  mode: FlowChatPinTurnToTopMode;
  targetTurnId: string | null;
}

export interface BottomReservationState {
  collapse: CollapseBottomReservation;
  pin: PinBottomReservation;
}

export interface PendingTurnPinState {
  turnId: string;
  behavior: ScrollBehavior;
  pinMode: FlowChatPinTurnToTopMode;
  expiresAtMs: number;
  attempts: number;
}

export function createInitialBottomReservationState(): BottomReservationState {
  return {
    collapse: {
      kind: 'collapse',
      px: 0,
      floorPx: 0,
    },
    pin: {
      kind: 'pin',
      px: 0,
      floorPx: 0,
      mode: 'transient',
      targetTurnId: null,
    },
  };
}

export function createInactiveAnchorLock(): ScrollAnchorLockState {
  return {
    active: false,
    targetScrollTop: 0,
    reason: null,
    lockUntilMs: 0,
  };
}

export function createInactiveCollapseIntent(): PendingCollapseIntentState {
  return {
    active: false,
    anchorScrollTop: 0,
    toolId: null,
    toolName: null,
    expiresAtMs: 0,
    distanceFromBottomBeforeCollapse: 0,
    baseTotalCompensationPx: 0,
    cumulativeShrinkPx: 0,
  };
}

export function sanitizeReservationPx(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function sanitizeBottomReservationState(state: BottomReservationState): BottomReservationState {
  const collapsePx = sanitizeReservationPx(state.collapse.px);
  const collapseFloorPx = Math.min(collapsePx, sanitizeReservationPx(state.collapse.floorPx));
  const pinPx = sanitizeReservationPx(state.pin.px);
  const pinFloorPx = Math.min(pinPx, sanitizeReservationPx(state.pin.floorPx));

  return {
    collapse: {
      kind: 'collapse',
      px: collapsePx,
      floorPx: collapseFloorPx,
    },
    pin: {
      kind: 'pin',
      px: pinPx,
      floorPx: pinFloorPx,
      mode: state.pin.mode ?? 'transient',
      targetTurnId: state.pin.targetTurnId ?? null,
    },
  };
}

export function areBottomReservationStatesEqual(
  left: BottomReservationState,
  right: BottomReservationState,
): boolean {
  return (
    Math.abs(left.collapse.px - right.collapse.px) <= COMPENSATION_EPSILON_PX &&
    Math.abs(left.collapse.floorPx - right.collapse.floorPx) <= COMPENSATION_EPSILON_PX &&
    Math.abs(left.pin.px - right.pin.px) <= COMPENSATION_EPSILON_PX &&
    Math.abs(left.pin.floorPx - right.pin.floorPx) <= COMPENSATION_EPSILON_PX &&
    left.pin.mode === right.pin.mode &&
    left.pin.targetTurnId === right.pin.targetTurnId
  );
}

export function getReservationTotalPx(reservation: BottomReservationBase): number {
  return Math.max(0, reservation.px);
}

export function getReservationConsumablePx(reservation: BottomReservationBase): number {
  return Math.max(0, reservation.px - reservation.floorPx);
}
