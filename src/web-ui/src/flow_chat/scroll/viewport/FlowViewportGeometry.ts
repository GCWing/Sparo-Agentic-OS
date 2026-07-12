/**
 * FlowChat viewport geometry.
 *
 * The synthetic footer has three independent owners:
 *
 * - `collapsePx` protects a reading anchor from real-content shrink.
 * - `transientTailPx` is temporary range borrowed by history navigation.
 * - `latestTurnLayout` owns the durable blank for the latest turn's reading
 *   page. Its semantic owner survives history detours; its pixels are always
 *   remeasured for the current viewport and never copied to another owner.
 *
 * All height comparisons use effective content height. Raw `scrollHeight`
 * includes these reservations and cannot identify real content growth.
 */

export const VIEWPORT_EPSILON_PX = 0.5;

/** Reading offset for a pinned user turn; matches the header spacer height. */
export const PINNED_TURN_VIEWPORT_OFFSET_PX = 61;

/** Content-bottom distance beyond which the scroll-to-latest bar shows. */
export const SCROLL_TO_LATEST_THRESHOLD_PX = 50;

/** Content-bottom distance within which a downward scroll re-enters follow. */
export const REENTER_FOLLOW_THRESHOLD_PX = 100;

/** How long a shrink anchor lock stays enforceable. */
export const ANCHOR_LOCK_DURATION_MS = 450;

/** How long a collapse intent stays valid while waiting for the real shrink. */
export const COLLAPSE_INTENT_TTL_MS = 1000;

/** How long a turn navigation keeps retrying while its item is not rendered. */
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

export interface LatestTurnLayoutOwner {
  sessionId: string;
  turnId: string;
  /** Scheduler-local generation. A pixel measurement is valid for one epoch. */
  epoch: number;
}

export type LatestTurnLayoutPhase = 'dormant' | 'activating' | 'active';

export interface LatestTurnLayoutContract {
  owner: LatestTurnLayoutOwner;
  phase: LatestTurnLayoutPhase;
  /** Durable, non-consumable blank for the latest turn's reading page. */
  floorPx: number;
  /** Provisional range used only while the owner is being brought into view. */
  activationTailPx: number;
}

export interface ViewportGeometryState {
  /** Consumable shrink-protection reservation. */
  collapsePx: number;
  /** Consumable range used by an older-turn navigation. */
  transientTailPx: number;
  /** Semantic latest-turn layout plus its current measured reservation. */
  latestTurnLayout: LatestTurnLayoutContract | null;
}

export interface ScrollerMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function createInitialGeometry(): ViewportGeometryState {
  return {
    collapsePx: 0,
    transientTailPx: 0,
    latestTurnLayout: null,
  };
}

function sanitizePx(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function areLatestTurnLayoutOwnersEqual(
  left: LatestTurnLayoutOwner | null | undefined,
  right: LatestTurnLayoutOwner | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.sessionId === right.sessionId &&
    left.turnId === right.turnId &&
    left.epoch === right.epoch,
  );
}

export function sanitizeGeometry(state: ViewportGeometryState): ViewportGeometryState {
  const latestTurnLayout = state.latestTurnLayout
    ? {
        ...state.latestTurnLayout,
        floorPx: sanitizePx(state.latestTurnLayout.floorPx),
        activationTailPx: sanitizePx(state.latestTurnLayout.activationTailPx),
      }
    : null;
  return {
    collapsePx: sanitizePx(state.collapsePx),
    transientTailPx: sanitizePx(state.transientTailPx),
    latestTurnLayout,
  };
}

export function getLatestTurnReservationPx(state: ViewportGeometryState): number {
  const layout = state.latestTurnLayout;
  return layout ? sanitizePx(layout.floorPx) + sanitizePx(layout.activationTailPx) : 0;
}

export function getTotalCompensationPx(state: ViewportGeometryState): number {
  return (
    sanitizePx(state.collapsePx) +
    sanitizePx(state.transientTailPx) +
    getLatestTurnReservationPx(state)
  );
}

export function getConsumableCompensationPx(state: ViewportGeometryState): number {
  return (
    sanitizePx(state.collapsePx) +
    sanitizePx(state.transientTailPx) +
    sanitizePx(state.latestTurnLayout?.activationTailPx ?? 0)
  );
}

/** Consume collapse protection, transient range, then activation range. */
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
  const transientConsumed = Math.min(state.transientTailPx, remaining);
  remaining -= transientConsumed;

  const activationTailPx = state.latestTurnLayout?.activationTailPx ?? 0;
  const activationConsumed = Math.min(activationTailPx, remaining);

  return sanitizeGeometry({
    ...state,
    collapsePx: state.collapsePx - collapseConsumed,
    transientTailPx: state.transientTailPx - transientConsumed,
    latestTurnLayout: state.latestTurnLayout
      ? {
          ...state.latestTurnLayout,
          activationTailPx: activationTailPx - activationConsumed,
        }
      : null,
  });
}

/** Drop all consumable space while preserving the latest-turn floor. */
export function clearConsumableCompensation(state: ViewportGeometryState): ViewportGeometryState {
  return sanitizeGeometry({
    ...state,
    collapsePx: 0,
    transientTailPx: 0,
    latestTurnLayout: state.latestTurnLayout
      ? { ...state.latestTurnLayout, activationTailPx: 0 }
      : null,
  });
}

export function replaceLatestTurnLayout(
  state: ViewportGeometryState,
  owner: LatestTurnLayoutOwner,
  phase: LatestTurnLayoutPhase = 'dormant',
): ViewportGeometryState {
  if (areLatestTurnLayoutOwnersEqual(state.latestTurnLayout?.owner, owner)) {
    return setLatestTurnLayoutPhase(state, phase);
  }
  return sanitizeGeometry({
    ...state,
    transientTailPx: 0,
    latestTurnLayout: {
      owner,
      phase,
      floorPx: 0,
      activationTailPx: 0,
    },
  });
}

export function setLatestTurnLayoutPhase(
  state: ViewportGeometryState,
  phase: LatestTurnLayoutPhase,
): ViewportGeometryState {
  const layout = state.latestTurnLayout;
  if (!layout) return state;
  const activationTailPx = phase === 'activating' ? layout.activationTailPx : 0;
  if (layout.phase === phase && layout.activationTailPx === activationTailPx) {
    return state;
  }
  return sanitizeGeometry({
    ...state,
    latestTurnLayout: { ...layout, phase, activationTailPx },
  });
}

export function setLatestTurnActivationTail(
  state: ViewportGeometryState,
  owner: LatestTurnLayoutOwner,
  activationTailPx: number,
): ViewportGeometryState {
  const layout = state.latestTurnLayout;
  if (!layout || !areLatestTurnLayoutOwnersEqual(layout.owner, owner)) {
    return state;
  }
  return sanitizeGeometry({
    ...state,
    latestTurnLayout: {
      ...layout,
      phase: 'activating',
      activationTailPx,
    },
  });
}

export function setTransientTail(
  state: ViewportGeometryState,
  transientTailPx: number,
): ViewportGeometryState {
  return sanitizeGeometry({ ...state, transientTailPx });
}

export function increaseLatestTurnFloor(
  state: ViewportGeometryState,
  owner: LatestTurnLayoutOwner,
  amountPx: number,
): ViewportGeometryState {
  const layout = state.latestTurnLayout;
  if (
    amountPx <= VIEWPORT_EPSILON_PX ||
    !layout ||
    !areLatestTurnLayoutOwnersEqual(layout.owner, owner)
  ) {
    return state;
  }
  return sanitizeGeometry({
    ...state,
    latestTurnLayout: {
      ...layout,
      floorPx: layout.floorPx + amountPx,
    },
  });
}

export function areGeometriesEqual(
  left: ViewportGeometryState,
  right: ViewportGeometryState,
): boolean {
  const leftLayout = left.latestTurnLayout;
  const rightLayout = right.latestTurnLayout;
  return (
    Math.abs(left.collapsePx - right.collapsePx) <= VIEWPORT_EPSILON_PX &&
    Math.abs(left.transientTailPx - right.transientTailPx) <= VIEWPORT_EPSILON_PX &&
    ((!leftLayout && !rightLayout) ||
      Boolean(
        leftLayout &&
        rightLayout &&
        areLatestTurnLayoutOwnersEqual(leftLayout.owner, rightLayout.owner) &&
        leftLayout.phase === rightLayout.phase &&
        Math.abs(leftLayout.floorPx - rightLayout.floorPx) <= VIEWPORT_EPSILON_PX &&
        Math.abs(leftLayout.activationTailPx - rightLayout.activationTailPx) <=
          VIEWPORT_EPSILON_PX,
      ))
  );
}

/** Effective real-content height with all synthetic reservations removed. */
export function getEffectiveContentHeight(
  metrics: ScrollerMetrics,
  state: ViewportGeometryState,
  inputFooterPx: number,
): number {
  return Math.max(0, metrics.scrollHeight - getTotalCompensationPx(state) - inputFooterPx);
}

/** Distance from viewport bottom to the end of real content. */
export function getContentDistanceFromBottom(
  metrics: ScrollerMetrics,
  state: ViewportGeometryState,
): number {
  return Math.max(
    0,
    metrics.scrollHeight - getTotalCompensationPx(state) - metrics.clientHeight - metrics.scrollTop,
  );
}

/** Scroll target for the end of real content, excluding synthetic tail space. */
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

export interface TailAlignmentMetrics {
  desiredScrollTop: number;
  /** Absolute reservation required, excluding the current reservation. */
  requiredTailSpacePx: number;
}

/**
 * Resolve the absolute tail needed to align a rendered target. Removing the
 * current reservation from `scrollHeight` makes the result independent of old
 * pixels, so an owner can never inherit another owner's floor at equilibrium.
 */
export function resolveTailAlignmentMetrics(
  metrics: ScrollerMetrics,
  targetTopDeltaPx: number,
  currentReservationPx: number,
): TailAlignmentMetrics {
  const desiredScrollTop = Math.max(0, metrics.scrollTop + targetTopDeltaPx);
  const maxWithoutCurrentReservation =
    metrics.scrollHeight - sanitizePx(currentReservationPx) - metrics.clientHeight;
  const requiredTailSpacePx = Math.max(0, desiredScrollTop - maxWithoutCurrentReservation);
  return { desiredScrollTop, requiredTailSpacePx };
}

export function hasLatestTurnLayout(state: ViewportGeometryState): boolean {
  return state.latestTurnLayout !== null;
}

export function hasLatestTurnFloor(state: ViewportGeometryState): boolean {
  return (state.latestTurnLayout?.floorPx ?? 0) > VIEWPORT_EPSILON_PX;
}

/** Apply an absolute floor measurement only when its owner epoch is current. */
export function reconcileLatestTurnFloor(
  state: ViewportGeometryState,
  owner: LatestTurnLayoutOwner,
  requiredFloorPx: number,
  holdFloorDuringTransition: boolean,
): ViewportGeometryState {
  const layout = state.latestTurnLayout;
  if (!layout || !areLatestTurnLayoutOwnersEqual(layout.owner, owner)) {
    return state;
  }

  const measuredFloor = sanitizePx(requiredFloorPx);
  const floorPx = holdFloorDuringTransition
    ? Math.max(layout.floorPx, measuredFloor)
    : measuredFloor;
  return sanitizeGeometry({
    ...state,
    latestTurnLayout: {
      ...layout,
      floorPx,
      activationTailPx: 0,
    },
  });
}

/** Equal exchange: real growth consumes only the current owner's floor. */
export function absorbLatestTurnContentGrowth(
  state: ViewportGeometryState,
  owner: LatestTurnLayoutOwner,
  growthPx: number,
): ViewportGeometryState {
  const layout = state.latestTurnLayout;
  if (
    growthPx <= VIEWPORT_EPSILON_PX ||
    !layout ||
    !areLatestTurnLayoutOwnersEqual(layout.owner, owner)
  ) {
    return state;
  }

  const floorPx = Math.max(0, layout.floorPx - growthPx);
  return sanitizeGeometry({
    ...state,
    latestTurnLayout: { ...layout, floorPx },
  });
}

/** Ease-out cubic used by scheduler-driven scroll animations. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}
