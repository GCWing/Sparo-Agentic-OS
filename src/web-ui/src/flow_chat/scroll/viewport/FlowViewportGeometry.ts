/**
 * FlowChat viewport geometry.
 *
 * Pure math for the synthetic bottom reservation model used by the
 * virtualized main chat list:
 *
 * - `collapsePx` protects the viewport against height loss near the bottom
 *   while the user is reading (shrink compensation).
 * - `pinPx` / `pinFloorPx` provide the synthetic tail space that keeps the
 *   latest user message pinned to the reading offset. The floor part is
 *   never consumable; only reservation space above the floor may be consumed
 *   by content growth or user downward scrolling.
 *
 * All height comparisons must use the effective content height:
 * `scrollHeight - totalCompensation - inputFooterPx`. Raw `scrollHeight`
 * deltas would misattribute reservation changes to content changes.
 */

export const VIEWPORT_EPSILON_PX = 0.5;

/** Reading offset for a pinned user turn; matches the header spacer height. */
export const PINNED_TURN_VIEWPORT_OFFSET_PX = 61;

/** Content-bottom distance beyond which the scroll-to-latest bar shows. */
export const SCROLL_TO_LATEST_THRESHOLD_PX = 50;

/** Content-bottom distance within which a user downward scroll re-enters follow. */
export const REENTER_FOLLOW_THRESHOLD_PX = 100;

/** How long a shrink anchor lock stays enforceable. */
export const ANCHOR_LOCK_DURATION_MS = 450;

/** How long a collapse intent stays valid while waiting for the real shrink. */
export const COLLAPSE_INTENT_TTL_MS = 1000;

/** How long a turn pin keeps retrying while the target item is not rendered. */
export const PIN_RETRY_TTL_MS = 1500;

/** Stable frames required before finalizing settles into reading. */
export const FINALIZE_STABLE_FRAMES = 8;

/** Upper bound for the finalizing window. */
export const FINALIZE_TIMEOUT_MS = 800;

/** Stable frames required before an externally driven navigation settles. */
export const NAVIGATION_STABLE_FRAMES = 6;

/** Duration of scheduler-driven smooth scroll animations. */
export const VIEWPORT_ANIMATION_MS = 260;

/** Idle frames after which the continuous pipeline goes to sleep. */
export const PIPELINE_IDLE_FRAMES = 4;

export type ViewportPinMode = 'transient' | 'sticky-latest';

export interface ViewportGeometryState {
  /** Consumable shrink-protection reservation. */
  collapsePx: number;
  /** Total pin reservation; always >= pinFloorPx. */
  pinPx: number;
  /** Non-consumable part of the pin reservation. */
  pinFloorPx: number;
  pinMode: ViewportPinMode;
  pinTargetTurnId: string | null;
}

export interface ScrollerMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function createInitialGeometry(): ViewportGeometryState {
  return {
    collapsePx: 0,
    pinPx: 0,
    pinFloorPx: 0,
    pinMode: 'transient',
    pinTargetTurnId: null,
  };
}

function sanitizePx(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function sanitizeGeometry(state: ViewportGeometryState): ViewportGeometryState {
  const pinPx = sanitizePx(state.pinPx);
  const pinFloorPx = Math.min(pinPx, sanitizePx(state.pinFloorPx));
  return {
    collapsePx: sanitizePx(state.collapsePx),
    pinPx,
    pinFloorPx,
    pinMode: state.pinMode ?? 'transient',
    pinTargetTurnId: state.pinTargetTurnId ?? null,
  };
}

export function getTotalCompensationPx(state: ViewportGeometryState): number {
  return sanitizePx(state.collapsePx) + sanitizePx(state.pinPx);
}

export function getConsumableCompensationPx(state: ViewportGeometryState): number {
  return sanitizePx(state.collapsePx) + Math.max(0, state.pinPx - state.pinFloorPx);
}

/**
 * Consume compensation from the collapse reservation first, then from pin
 * space above the floor. Floors are never consumed.
 */
export function consumeCompensation(
  state: ViewportGeometryState,
  amountPx: number,
): ViewportGeometryState {
  if (amountPx <= VIEWPORT_EPSILON_PX) {
    return state;
  }

  let remaining = Math.max(0, amountPx);
  const collapseConsumed = Math.min(state.collapsePx, remaining);
  remaining -= collapseConsumed;
  const pinConsumable = Math.max(0, state.pinPx - state.pinFloorPx);
  const pinConsumed = Math.min(pinConsumable, remaining);

  return sanitizeGeometry({
    ...state,
    collapsePx: state.collapsePx - collapseConsumed,
    pinPx: state.pinPx - pinConsumed,
  });
}

export function clearPinReservation(state: ViewportGeometryState): ViewportGeometryState {
  return {
    ...state,
    pinPx: 0,
    pinFloorPx: 0,
    pinMode: 'transient',
    pinTargetTurnId: null,
  };
}

/** Drop everything consumable; keep only the sticky pin floor. */
export function clearConsumableCompensation(state: ViewportGeometryState): ViewportGeometryState {
  return sanitizeGeometry({
    ...state,
    collapsePx: 0,
    pinPx: state.pinFloorPx,
  });
}

export function areGeometriesEqual(
  left: ViewportGeometryState,
  right: ViewportGeometryState,
): boolean {
  return (
    Math.abs(left.collapsePx - right.collapsePx) <= VIEWPORT_EPSILON_PX &&
    Math.abs(left.pinPx - right.pinPx) <= VIEWPORT_EPSILON_PX &&
    Math.abs(left.pinFloorPx - right.pinFloorPx) <= VIEWPORT_EPSILON_PX &&
    left.pinMode === right.pinMode &&
    left.pinTargetTurnId === right.pinTargetTurnId
  );
}

/**
 * Effective content height with synthetic reservations and the input-stack
 * footer removed. This is the only valid basis for growth/shrink deltas.
 */
export function getEffectiveContentHeight(
  metrics: ScrollerMetrics,
  state: ViewportGeometryState,
  inputFooterPx: number,
): number {
  return Math.max(0, metrics.scrollHeight - getTotalCompensationPx(state) - inputFooterPx);
}

/**
 * Distance between the viewport bottom and the end of real content
 * (synthetic reservation space excluded). The single "at bottom" semantics
 * used by follow targeting, bar visibility, and follow re-entry.
 */
export function getContentDistanceFromBottom(
  metrics: ScrollerMetrics,
  state: ViewportGeometryState,
): number {
  return Math.max(
    0,
    metrics.scrollHeight - getTotalCompensationPx(state) - metrics.clientHeight - metrics.scrollTop,
  );
}

/**
 * Scroll target that aligns the end of real content (plus input clearance)
 * with the viewport bottom, without scrolling into synthetic tail space.
 */
export function getFollowTargetScrollTop(
  metrics: ScrollerMetrics,
  state: ViewportGeometryState,
): number {
  return Math.max(
    0,
    metrics.scrollHeight - getTotalCompensationPx(state) - metrics.clientHeight,
  );
}

export function getMaxScrollTop(metrics: ScrollerMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

/**
 * Pin alignment math for a rendered target element.
 *
 * `missingTailSpacePx` is how much synthetic tail is required so that
 * `desiredScrollTop` becomes reachable once the current pin reservation is
 * excluded from the available scroll range.
 */
export interface PinMetrics {
  desiredScrollTop: number;
  missingTailSpacePx: number;
}

export function resolvePinMetrics(
  metrics: ScrollerMetrics,
  targetTopDeltaPx: number,
  currentPinPx: number,
): PinMetrics {
  const desiredScrollTop = Math.max(0, metrics.scrollTop + targetTopDeltaPx);
  const rawMaxScrollTop = metrics.scrollHeight - Math.max(0, currentPinPx) - metrics.clientHeight;
  const missingTailSpacePx = Math.max(0, desiredScrollTop - rawMaxScrollTop);
  return { desiredScrollTop, missingTailSpacePx };
}

/** Whether a live sticky pin floor is active for the latest turn's layout. */
export function hasActiveStickyFloor(state: ViewportGeometryState): boolean {
  return (
    state.pinMode === 'sticky-latest' &&
    state.pinFloorPx > VIEWPORT_EPSILON_PX &&
    state.pinTargetTurnId !== null
  );
}

/**
 * Reconcile the sticky pin reservation from a pin-alignment measurement.
 *
 * `missingTailSpacePx` is **incremental** tail needed beyond what `pinPx`
 * already provisions in `scrollHeight`. At equilibrium (message aligned and
 * reservation correct) it is zero — that means "keep the current floor", not
 * "floor should be zero".
 */
export function reconcileStickyPinReservation(
  state: ViewportGeometryState,
  missingTailSpacePx: number,
  holdFloorDuringTransition: boolean,
  turnId: string,
): ViewportGeometryState {
  if (holdFloorDuringTransition) {
    return sanitizeGeometry({
      ...state,
      pinMode: 'sticky-latest',
      pinTargetTurnId: turnId,
    });
  }

  const hadOnlyFloor = state.pinPx <= state.pinFloorPx + VIEWPORT_EPSILON_PX;

  if (hadOnlyFloor && missingTailSpacePx <= VIEWPORT_EPSILON_PX) {
    return sanitizeGeometry({
      ...state,
      pinMode: 'sticky-latest',
      pinTargetTurnId: turnId,
    });
  }

  if (hadOnlyFloor) {
    return sanitizeGeometry({
      ...state,
      pinPx: missingTailSpacePx,
      pinFloorPx: missingTailSpacePx,
      pinMode: 'sticky-latest',
      pinTargetTurnId: turnId,
    });
  }

  const nextFloor = missingTailSpacePx;
  const nextPx = Math.max(nextFloor, state.pinPx);
  return sanitizeGeometry({
    ...state,
    pinPx: nextPx,
    pinFloorPx: nextFloor,
    pinMode: 'sticky-latest',
    pinTargetTurnId: turnId,
  });
}

/**
 * Equal exchange while pinned: content growth below the pinned turn shrinks the
 * floor 1:1 so scrollHeight stays constant. Falls back to consumable
 * consumption when a consumable headroom exists above the floor.
 */
export function absorbPinnedContentGrowth(
  state: ViewportGeometryState,
  growthPx: number,
): ViewportGeometryState {
  if (growthPx <= VIEWPORT_EPSILON_PX) {
    return state;
  }

  const hadOnlyFloor = state.pinPx <= state.pinFloorPx + VIEWPORT_EPSILON_PX;
  if (!hadOnlyFloor || state.pinFloorPx <= VIEWPORT_EPSILON_PX) {
    return consumeCompensation(state, growthPx);
  }

  const shrinkBy = Math.min(state.pinFloorPx, growthPx);
  const nextFloor = state.pinFloorPx - shrinkBy;
  return sanitizeGeometry({
    ...state,
    pinPx: nextFloor,
    pinFloorPx: nextFloor,
  });
}

/** Ease-out cubic used by scheduler-driven scroll animations. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}
