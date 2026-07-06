/**
 * FlowChat viewport scheduler.
 *
 * The single requestAnimationFrame pipeline that owns the main list's
 * `scrollTop`. Every frame it:
 *
 *  1. reads scroller geometry,
 *  2. reconciles the reservation model (growth consumption, pin floor,
 *     reading shrink protection),
 *  3. computes the target scrollTop for the current viewport mode,
 *  4. performs at most one scrollTop write.
 *
 * Nothing else writes `scrollTop`. Input listeners dispatch machine events;
 * layout observers only mark geometry dirty and wake the pipeline.
 *
 * Two synchronous footer-height (never scrollTop) writes are allowed outside
 * the pipeline because they must land before the browser clamps or paints:
 *  - collapse-intent pre-compensation (reading / pinned modes),
 *  - consumable-reservation consumption on user downward scroll.
 *
 * The scheduler also owns the built-in ease-out animator used for smooth
 * navigation. Unlike native `behavior: 'smooth'`, the animator re-resolves
 * its destination every frame, so chasing a still-growing bottom stays fluid.
 */

import {
  ANCHOR_LOCK_DURATION_MS,
  COLLAPSE_INTENT_TTL_MS,
  FINALIZE_STABLE_FRAMES,
  FINALIZE_TIMEOUT_MS,
  NAVIGATION_STABLE_FRAMES,
  PIN_RETRY_TTL_MS,
  PINNED_TURN_VIEWPORT_OFFSET_PX,
  PIPELINE_IDLE_FRAMES,
  REENTER_FOLLOW_THRESHOLD_PX,
  SCROLL_TO_LATEST_THRESHOLD_PX,
  VIEWPORT_ANIMATION_MS,
  VIEWPORT_EPSILON_PX,
  areGeometriesEqual,
  absorbPinnedContentGrowth,
  clearConsumableCompensation,
  clearPinReservation,
  consumeCompensation,
  createInitialGeometry,
  easeOutCubic,
  getContentDistanceFromBottom,
  getEffectiveContentHeight,
  getFollowTargetScrollTop,
  getMaxScrollTop,
  getTotalCompensationPx,
  hasActiveStickyFloor,
  reconcileStickyPinReservation,
  resolvePinMetrics,
  sanitizeGeometry,
  type ScrollerMetrics,
  type ViewportGeometryState,
} from './FlowViewportGeometry';
import {
  READING_MODE,
  areViewportModesEqual,
  reduceViewportMode,
  type ViewportContext,
  type ViewportEvent,
  type ViewportMode,
} from './FlowViewportMachine';
import { incrementFlowChatCounter } from '../../performance/flowChatPerf';

export interface FlowViewportHost {
  getScroller(): HTMLElement | null;
  getFooter(): HTMLElement | null;
  getInputFooterPx(): number;
  isStreaming(): boolean;
  getLatestTurnId(): string | null;
  /** Returns -1 when the turn has no user-message virtual item. */
  findUserMessageIndex(turnId: string): number;
  getUserMessageElement(turnId: string): HTMLElement | null;
  /** Ask Virtuoso to bring an index into range (the only third-party scroll writer). */
  virtuosoScrollToIndex(index: number, align: 'start' | 'center', behavior: ScrollBehavior): void;
  onVisibleTurnMeasure(): void;
}

export interface ViewportSnapshot {
  modeKind: ViewportMode['kind'];
  showScrollToLatest: boolean;
}

interface AnchorLockState {
  active: boolean;
  targetScrollTop: number;
  untilMs: number;
}

interface CollapseIntentState {
  active: boolean;
  anchorScrollTop: number;
  baseCompensationPx: number;
  distanceFromBottomBeforeCollapse: number;
  cumulativeShrinkPx: number;
  expiresAtMs: number;
}

interface AnimationState {
  active: boolean;
  startScrollTop: number;
  startMs: number;
  durationMs: number;
}

interface NavigationRuntime {
  startedAtMs: number;
  issuedVirtuosoScroll: boolean;
  stableFrames: number;
  lastScrollTop: number;
}

const PIN_ALIGN_TOLERANCE_PX = 1.5;

export class FlowViewportScheduler {
  private readonly host: FlowViewportHost;

  private mode: ViewportMode = READING_MODE;
  private geometry: ViewportGeometryState = createInitialGeometry();

  private anchorLock: AnchorLockState = { active: false, targetScrollTop: 0, untilMs: 0 };
  private collapseIntent: CollapseIntentState = createInactiveCollapseIntent();
  private animation: AnimationState = { active: false, startScrollTop: 0, startMs: 0, durationMs: 0 };
  private navigation: NavigationRuntime = createNavigationRuntime(0);

  private transitionCount = 0;
  private previousEffectiveHeight: number | null = null;
  private previousScrollTop = 0;
  private frameHandle: number | null = null;
  private idleFrames = 0;
  private finalizeStableFrames = 0;
  private pinnedFramesSinceEstablished = 0;
  private disposed = false;

  private snapshot: ViewportSnapshot = { modeKind: 'reading', showScrollToLatest: false };
  private readonly listeners = new Set<() => void>();

  constructor(host: FlowViewportHost) {
    this.host = host;
  }

  // ── External store API ─────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ViewportSnapshot => this.snapshot;

  getMode(): ViewportMode {
    return this.mode;
  }

  getFooterHeightPx(): number {
    return this.host.getInputFooterPx() + getTotalCompensationPx(this.geometry);
  }

  /** Turn owning a live sticky pin floor, or null when no floor is active. */
  private getStickyPinTurnId(): string | null {
    return hasActiveStickyFloor(this.geometry) ? this.geometry.pinTargetTurnId : null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.cancelFrame();
    this.listeners.clear();
  }

  resetForSession(latestTurnId: string | null, isStreaming: boolean): void {
    this.geometry = createInitialGeometry();
    this.anchorLock = { active: false, targetScrollTop: 0, untilMs: 0 };
    this.collapseIntent = createInactiveCollapseIntent();
    this.animation.active = false;
    this.previousEffectiveHeight = null;
    this.previousScrollTop = 0;
    this.idleFrames = 0;
    this.finalizeStableFrames = 0;
    this.applyFooterNow();
    this.dispatch({ type: 'SESSION_CHANGED', latestTurnId, isStreaming });
  }

  resetForEmptyList(): void {
    this.geometry = createInitialGeometry();
    this.previousEffectiveHeight = null;
    this.anchorLock.active = false;
    this.collapseIntent = createInactiveCollapseIntent();
    this.applyFooterNow();
  }

  attachScroller(): void {
    const scroller = this.host.getScroller();
    if (scroller) {
      this.previousScrollTop = scroller.scrollTop;
      this.previousEffectiveHeight = null;
    }
    this.applyFooterNow();
    this.wake();
  }

  attachFooter(): void {
    this.applyFooterNow();
  }

  onInputFooterChanged(): void {
    this.applyFooterNow();
    this.previousEffectiveHeight = null;
    this.wake();
  }

  // ── Machine dispatch ───────────────────────────────────────────────────────

  dispatch(event: ViewportEvent): void {
    const context: ViewportContext = {
      isStreaming: this.host.isStreaming(),
      latestTurnId: this.host.getLatestTurnId(),
      stickyPinTurnId: this.getStickyPinTurnId(),
    };
    const nextMode = reduceViewportMode(this.mode, event, context);
    if (areViewportModesEqual(this.mode, nextMode)) {
      return;
    }

    incrementFlowChatCounter(`viewport.mode.${nextMode.kind}`);
    const previousMode = this.mode;
    this.mode = nextMode;
    this.onModeChanged(previousMode, nextMode);
    this.publishSnapshot();
    this.wake();
  }

  private onModeChanged(previous: ViewportMode, next: ViewportMode): void {
    this.animation.active = false;
    this.idleFrames = 0;
    this.finalizeStableFrames = 0;

    if (next.kind === 'navigating') {
      this.navigation = createNavigationRuntime(now());
      this.anchorLock.active = false;
      // Navigating into history is a detour, not a layout change: the sticky
      // floor keeps belonging to the latest turn's reading layout and is only
      // released by the explicit clear-pin bottom jump (or a new turn /
      // session change).
      if (next.target.type === 'latest-end' && next.target.clearPin) {
        this.geometry = clearPinReservation(this.geometry);
        this.applyFooterNow();
      }
    }

    if (next.kind === 'pinned-latest') {
      this.pinnedFramesSinceEstablished = 0;
    }

    if (next.kind === 'following' && previous.kind === 'pinned-latest') {
      // The floor just reached zero; drop any leftover consumable pin space so
      // the follow target and the pinned position coincide exactly.
      this.geometry = sanitizeGeometry({
        ...this.geometry,
        pinPx: this.geometry.pinFloorPx,
      });
      this.applyFooterNow();
    }

    if (next.kind === 'reading' && previous.kind === 'finalizing') {
      this.geometry = clearConsumableCompensation(this.geometry);
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
    }
  }

  // ── Input / layout entry points ────────────────────────────────────────────

  /** Wheel-up, touch pull-down, upward key, scrollbar grab. */
  handleUserScrollUpIntent(): void {
    this.dispatch({ type: 'USER_SCROLL_UP' });
  }

  handleScrollEvent(): void {
    const scroller = this.host.getScroller();
    if (!scroller) return;

    const metrics = readMetrics(scroller);
    const delta = metrics.scrollTop - this.previousScrollTop;

    // Synchronous consumption: only when no sticky floor is active. The sticky
    // floor is a layout contract for the latest turn — it must survive detours
    // into history and only be released explicitly (new turn / session / clear).
    const stickyFloorActive = this.getStickyPinTurnId() !== null;
    if (
      delta > VIEWPORT_EPSILON_PX &&
      !this.anchorLock.active &&
      this.transitionCount === 0 &&
      !stickyFloorActive &&
      (this.mode.kind === 'reading' || this.mode.kind === 'pinned-latest')
    ) {
      const next = consumeCompensation(this.geometry, delta);
      if (!areGeometriesEqual(next, this.geometry)) {
        this.geometry = next;
        this.applyFooterNow();
        this.snapshotEffectiveHeight();
      }
    }

    if (delta > VIEWPORT_EPSILON_PX && this.mode.kind === 'reading') {
      const fresh = readMetrics(scroller);
      const stickyPinTurnId = this.getStickyPinTurnId();
      if (this.host.isStreaming()) {
        if (getContentDistanceFromBottom(fresh, this.geometry) <= REENTER_FOLLOW_THRESHOLD_PX) {
          this.dispatch({ type: 'USER_REACHED_CONTENT_BOTTOM' });
        }
      } else if (
        stickyPinTurnId !== null &&
        getContentDistanceFromBottom(fresh, this.geometry) <= REENTER_FOLLOW_THRESHOLD_PX
      ) {
        // Pinned layout lives at the content bottom, not the physical bottom
        // (which includes the synthetic tail). Arriving at content bottom
        // restores pinned-latest with the preserved floor.
        this.dispatch({ type: 'USER_REACHED_CONTENT_BOTTOM' });
      }
    }

    this.previousScrollTop = scroller.scrollTop;
    this.updateShowScrollToLatest(readMetrics(scroller));
    this.host.onVisibleTurnMeasure();
    this.idleFrames = 0;
    this.wake();
  }

  handleContentResize(): void {
    this.idleFrames = 0;
    this.host.onVisibleTurnMeasure();
    this.wake();
  }

  handleLayoutMutation(): void {
    this.idleFrames = 0;
    this.host.onVisibleTurnMeasure();
    this.wake();
  }

  handleRangeChanged(): void {
    this.idleFrames = 0;
    this.host.onVisibleTurnMeasure();
    this.wake();
  }

  transitionStarted(): void {
    this.transitionCount += 1;
    this.idleFrames = 0;
    this.wake();
  }

  transitionEnded(): void {
    this.transitionCount = Math.max(0, this.transitionCount - 1);
    if (this.transitionCount === 0 && this.collapseIntent.active) {
      this.collapseIntent = createInactiveCollapseIntent();
    }
    this.idleFrames = 0;
    this.wake();
  }

  /**
   * Pre-compensation for an announced collapse. Must run synchronously inside
   * the dispatching event so the footer grows before the browser clamps.
   */
  handleCollapseIntent(estimatedShrinkPx: number | null): void {
    const scroller = this.host.getScroller();
    if (!scroller) return;

    const estimate = Math.max(0, estimatedShrinkPx ?? 0);
    const metrics = readMetrics(scroller);

    switch (this.mode.kind) {
      case 'following':
      case 'finalizing':
      case 'navigating': {
        // Tail chasing absorbs the shrink; protection would fight it.
        this.wake();
        return;
      }
      case 'pinned-latest': {
        if (estimate <= VIEWPORT_EPSILON_PX) {
          this.wake();
          return;
        }
        // Grow the floor before layout shrinks so scrollHeight never dips and
        // the pinned turn cannot be clamped downward. The per-frame pin
        // reconcile converges to the measured value afterwards.
        this.geometry = sanitizeGeometry({
          ...this.geometry,
          pinFloorPx: this.geometry.pinFloorPx + estimate,
          pinPx: Math.max(this.geometry.pinPx, this.geometry.pinFloorPx + estimate),
        });
        this.applyFooterNow();
        this.snapshotEffectiveHeight();
        this.wake();
        return;
      }
      case 'reading': {
        const baseCompensationPx = getTotalCompensationPx(this.geometry);
        const distanceFromBottom = Math.max(
          0,
          metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop,
        );
        const effectiveDistance = Math.max(0, distanceFromBottom - baseCompensationPx);
        const provisionalPx = Math.max(0, estimate - effectiveDistance);

        this.collapseIntent = {
          active: true,
          anchorScrollTop: metrics.scrollTop,
          baseCompensationPx,
          distanceFromBottomBeforeCollapse: effectiveDistance,
          cumulativeShrinkPx: 0,
          expiresAtMs: now() + COLLAPSE_INTENT_TTL_MS,
        };

        if (provisionalPx > VIEWPORT_EPSILON_PX) {
          this.geometry = sanitizeGeometry({
            ...this.geometry,
            collapsePx: this.geometry.collapsePx + provisionalPx,
          });
          this.applyFooterNow();
          this.activateAnchorLock(metrics.scrollTop);
        }
        this.wake();
        return;
      }
    }
  }

  /** Latest turn changed within the same session (message sent / restored). */
  notifyTurnSent(turnId: string): void {
    this.dispatch({ type: 'TURN_SENT', turnId });
  }

  notifyStreamingChanged(isStreaming: boolean): void {
    if (isStreaming) {
      this.dispatch({ type: 'STREAM_STARTED' });
    } else {
      this.dispatch({ type: 'STREAM_ENDED', nowMs: now() });
    }
    this.wake();
  }

  // ── Pipeline ───────────────────────────────────────────────────────────────

  wake(): void {
    if (this.disposed || this.frameHandle !== null) {
      return;
    }
    this.frameHandle = requestAnimationFrame(this.runFrame);
  }

  private cancelFrame(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private readonly runFrame = (): void => {
    this.frameHandle = null;
    if (this.disposed) return;

    const scroller = this.host.getScroller();
    if (!scroller) return;

    incrementFlowChatCounter('viewport.frame');
    const metrics = readMetrics(scroller);

    this.reconcileHeightChange(scroller, metrics);

    let keepRunning = false;
    switch (this.mode.kind) {
      case 'navigating':
        keepRunning = this.stepNavigation(scroller);
        break;
      case 'pinned-latest':
        keepRunning = this.stepPinned(scroller);
        break;
      case 'following':
        keepRunning = this.stepFollow(scroller, false);
        break;
      case 'finalizing':
        keepRunning = this.stepFollow(scroller, true);
        break;
      case 'reading':
        keepRunning = this.stepReading(scroller);
        break;
    }

    this.updateShowScrollToLatest(readMetrics(scroller));
    this.previousScrollTop = scroller.scrollTop;

    if (keepRunning) {
      this.idleFrames = 0;
      this.wake();
      return;
    }

    this.idleFrames += 1;
    if (this.idleFrames < PIPELINE_IDLE_FRAMES) {
      this.wake();
    }
  };

  /**
   * Growth consumes consumable reservations; shrink outside tail-chasing
   * modes triggers reading protection. Uses effective heights only.
   */
  private reconcileHeightChange(scroller: HTMLElement, metrics: ScrollerMetrics): void {
    const effectiveHeight = getEffectiveContentHeight(
      metrics,
      this.geometry,
      this.host.getInputFooterPx(),
    );
    const previous = this.previousEffectiveHeight;
    this.previousEffectiveHeight = effectiveHeight;

    if (previous === null) {
      return;
    }

    const delta = effectiveHeight - previous;
    if (Math.abs(delta) <= VIEWPORT_EPSILON_PX) {
      return;
    }

    if (delta > 0) {
      // Growth. During an active layout transition with compensation present,
      // hold consumption until the transition finishes (intermediate sizes).
      if (getTotalCompensationPx(this.geometry) > VIEWPORT_EPSILON_PX && this.transitionCount > 0) {
        return;
      }
      // Sticky floor is frozen while the user is away in reading/navigating.
      // Only pinned-latest applies equal exchange; height deltas from
      // virtualization while scrolling history are ignored.
      if (this.getStickyPinTurnId() !== null && this.mode.kind !== 'pinned-latest') {
        return;
      }
      const next = this.mode.kind === 'pinned-latest'
        ? absorbPinnedContentGrowth(this.geometry, delta)
        : consumeCompensation(this.geometry, delta);
      if (!areGeometriesEqual(next, this.geometry)) {
        this.geometry = next;
        this.applyFooterNow();
        this.previousEffectiveHeight = getEffectiveContentHeight(
          readMetrics(scroller),
          this.geometry,
          this.host.getInputFooterPx(),
        );
      }
      return;
    }

    // Shrink.
    const shrink = -delta;
    if (this.mode.kind !== 'reading') {
      // pinned: the pin floor reconcile restores the tail this frame.
      // following/finalizing/navigating: chasing absorbs the shrink.
      return;
    }

    const distanceFromBottom = Math.max(
      0,
      metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop,
    );
    const intent = this.collapseIntent;
    const hasIntent = intent.active && intent.expiresAtMs >= now();
    const fallbackPx = Math.max(0, shrink - distanceFromBottom);

    let nextTotal: number;
    if (hasIntent) {
      const cumulative = intent.cumulativeShrinkPx + shrink;
      this.collapseIntent = { ...intent, cumulativeShrinkPx: cumulative };
      const resolved = intent.baseCompensationPx +
        Math.max(0, cumulative - intent.distanceFromBottomBeforeCollapse);
      nextTotal = this.transitionCount > 0
        ? Math.max(getTotalCompensationPx(this.geometry), resolved)
        : resolved;
    } else {
      if (fallbackPx <= VIEWPORT_EPSILON_PX) {
        return;
      }
      nextTotal = getTotalCompensationPx(this.geometry) + fallbackPx;
    }

    if (nextTotal > VIEWPORT_EPSILON_PX) {
      this.geometry = sanitizeGeometry({
        ...this.geometry,
        collapsePx: Math.max(0, nextTotal - this.geometry.pinPx),
      });
      const anchorTarget = hasIntent ? intent.anchorScrollTop : this.previousScrollTop;
      this.activateAnchorLock(anchorTarget);
      this.applyFooterNow();
      this.enforceAnchorLock(scroller);
      if (this.transitionCount === 0) {
        this.collapseIntent = createInactiveCollapseIntent();
      }
      this.previousEffectiveHeight = getEffectiveContentHeight(
        readMetrics(scroller),
        this.geometry,
        this.host.getInputFooterPx(),
      );
    }
  }

  // ── Mode steps ─────────────────────────────────────────────────────────────

  private stepPinned(scroller: HTMLElement): boolean {
    const mode = this.mode;
    if (mode.kind !== 'pinned-latest') return false;

    const element = this.host.getUserMessageElement(mode.turnId);
    if (!element) {
      // Virtualized out (large resize or fast history jump); bring it back.
      const index = this.host.findUserMessageIndex(mode.turnId);
      if (index < 0) {
        this.dispatch({ type: 'USER_SCROLL_UP' });
        return false;
      }
      this.host.virtuosoScrollToIndex(index, 'start', 'auto');
      return true;
    }

    const metrics = readMetrics(scroller);
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const topDelta = targetRect.top - (scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX);
    const { desiredScrollTop, missingTailSpacePx } = resolvePinMetrics(
      metrics,
      topDelta,
      this.geometry.pinPx,
    );

    // Equal exchange: floor tracks the live missing-tail measurement. At
    // equilibrium missingTailSpacePx is zero (incremental need), which means
    // the current reservation is correct — reconcileStickyPinReservation
    // preserves it instead of zeroing the floor.
    const holdReconcile = this.transitionCount > 0 && missingTailSpacePx < this.geometry.pinFloorPx;
    const nextGeometry = reconcileStickyPinReservation(
      this.geometry,
      missingTailSpacePx,
      holdReconcile,
      mode.turnId,
    );
    if (!areGeometriesEqual(nextGeometry, this.geometry)) {
      this.geometry = nextGeometry;
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
    }

    const target = Math.min(desiredScrollTop, getMaxScrollTop(readMetrics(scroller)));
    const deviation = target - scroller.scrollTop;
    if (Math.abs(deviation) > PIN_ALIGN_TOLERANCE_PX) {
      scroller.scrollTop = target;
    }

    this.pinnedFramesSinceEstablished += 1;
    if (
      this.pinnedFramesSinceEstablished > 1 &&
      this.geometry.pinFloorPx <= VIEWPORT_EPSILON_PX &&
      this.host.isStreaming() &&
      this.transitionCount === 0
    ) {
      this.dispatch({ type: 'PIN_FLOOR_CONSUMED' });
      return true;
    }

    // Keep running every frame while streaming; otherwise settle and let
    // observers wake us for late layout changes.
    return this.host.isStreaming() || Math.abs(deviation) > PIN_ALIGN_TOLERANCE_PX;
  }

  private stepFollow(scroller: HTMLElement, finalizing: boolean): boolean {
    const metrics = readMetrics(scroller);
    const target = Math.min(
      getFollowTargetScrollTop(metrics, this.geometry),
      getMaxScrollTop(metrics),
    );
    const distance = target - scroller.scrollTop;

    let moved = false;
    if (distance > VIEWPORT_EPSILON_PX) {
      // Only chase downward. Upward corrections would fight the browser's own
      // clamp behavior during shrink and feel like a bounce.
      scroller.scrollTop = target;
      moved = true;
    }

    if (finalizing) {
      const mode = this.mode;
      const sinceMs = mode.kind === 'finalizing' ? mode.sinceMs : now();
      if (moved || this.transitionCount > 0) {
        this.finalizeStableFrames = 0;
      } else {
        this.finalizeStableFrames += 1;
      }
      if (
        this.finalizeStableFrames >= FINALIZE_STABLE_FRAMES ||
        now() - sinceMs >= FINALIZE_TIMEOUT_MS
      ) {
        this.dispatch({ type: 'FINALIZE_SETTLED' });
        return false;
      }
      return true;
    }

    return this.host.isStreaming() || moved;
  }

  private stepReading(scroller: HTMLElement): boolean {
    return this.enforceAnchorLock(scroller);
  }

  private stepNavigation(scroller: HTMLElement): boolean {
    const mode = this.mode;
    if (mode.kind !== 'navigating') return false;
    const target = mode.target;

    if (now() - this.navigation.startedAtMs > PIN_RETRY_TTL_MS && target.type === 'turn-pin-top') {
      this.settleNavigation();
      return false;
    }

    switch (target.type) {
      case 'latest-end': {
        const metrics = readMetrics(scroller);
        const destination = Math.min(
          getFollowTargetScrollTop(metrics, this.geometry),
          getMaxScrollTop(metrics),
        );
        const arrived = this.driveScroll(scroller, destination, target.behavior);
        if (arrived) {
          this.settleNavigation();
          return false;
        }
        return true;
      }

      case 'index-center': {
        if (!this.navigation.issuedVirtuosoScroll) {
          this.navigation.issuedVirtuosoScroll = true;
          this.navigation.lastScrollTop = scroller.scrollTop;
          this.host.virtuosoScrollToIndex(target.index, 'center', target.behavior);
          return true;
        }
        // Virtuoso drives this scroll; settle once the position stabilizes.
        if (Math.abs(scroller.scrollTop - this.navigation.lastScrollTop) <= VIEWPORT_EPSILON_PX) {
          this.navigation.stableFrames += 1;
        } else {
          this.navigation.stableFrames = 0;
          this.navigation.lastScrollTop = scroller.scrollTop;
        }
        if (this.navigation.stableFrames >= NAVIGATION_STABLE_FRAMES) {
          this.settleNavigation();
          return false;
        }
        return true;
      }

      case 'turn-pin-top': {
        const element = this.host.getUserMessageElement(target.turnId);
        if (!element) {
          const index = this.host.findUserMessageIndex(target.turnId);
          if (index < 0) {
            this.settleNavigation();
            return false;
          }
          if (target.pinMode === 'sticky-latest') {
            // Provisional tail so the eventual alignment has enough scroll
            // range even before the item renders. Preserve any live floor.
            const metrics = readMetrics(scroller);
            const provisional = Math.max(getMaxScrollTop(metrics), this.geometry.pinPx);
            if (provisional > this.geometry.pinPx + VIEWPORT_EPSILON_PX) {
              this.geometry = sanitizeGeometry({
                ...this.geometry,
                pinPx: provisional,
                pinFloorPx: this.geometry.pinFloorPx,
                pinMode: 'sticky-latest',
                pinTargetTurnId: target.turnId,
              });
              this.applyFooterNow();
              this.snapshotEffectiveHeight();
            }
          }
          this.host.virtuosoScrollToIndex(index, 'start', 'auto');
          return true;
        }

        const metrics = readMetrics(scroller);
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = element.getBoundingClientRect();
        const topDelta = targetRect.top - (scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX);
        const { desiredScrollTop, missingTailSpacePx } = resolvePinMetrics(
          metrics,
          topDelta,
          this.geometry.pinPx,
        );

        const isSticky = target.pinMode === 'sticky-latest';
        if (isSticky) {
          this.geometry = reconcileStickyPinReservation(
            this.geometry,
            missingTailSpacePx,
            false,
            target.turnId,
          );
        } else {
          // Transient: borrow consumable space only; never touch the floor.
          this.geometry = sanitizeGeometry({
            ...this.geometry,
            pinPx: Math.max(missingTailSpacePx, this.geometry.pinPx),
          });
        }
        this.applyFooterNow();
        this.snapshotEffectiveHeight();

        const destination = Math.min(desiredScrollTop, getMaxScrollTop(readMetrics(scroller)));
        const arrived = this.driveScroll(scroller, destination, target.behavior);
        if (arrived) {
          this.settleNavigation();
          return false;
        }
        return true;
      }
    }
  }

  private settleNavigation(): void {
    this.dispatch({ type: 'NAVIGATION_SETTLED', nowMs: now() });
    this.host.onVisibleTurnMeasure();
  }

  /**
   * Move toward a destination either instantly or through the retargeting
   * ease-out animator. Returns true once within tolerance.
   */
  private driveScroll(
    scroller: HTMLElement,
    destination: number,
    behavior: ScrollBehavior,
  ): boolean {
    const current = scroller.scrollTop;
    if (Math.abs(destination - current) <= PIN_ALIGN_TOLERANCE_PX) {
      this.animation.active = false;
      return true;
    }

    if (behavior !== 'smooth') {
      scroller.scrollTop = destination;
      return false;
    }

    if (!this.animation.active) {
      this.animation = {
        active: true,
        startScrollTop: current,
        startMs: now(),
        durationMs: VIEWPORT_ANIMATION_MS,
      };
    }

    const t = (now() - this.animation.startMs) / this.animation.durationMs;
    const eased = easeOutCubic(t);
    // Destination is re-resolved by the caller every frame, so a growing
    // bottom is chased without restarting the animation.
    const next = this.animation.startScrollTop + (destination - this.animation.startScrollTop) * eased;
    scroller.scrollTop = next;

    if (t >= 1) {
      this.animation.active = false;
      scroller.scrollTop = destination;
      return true;
    }
    return false;
  }

  // ── Anchor lock ────────────────────────────────────────────────────────────

  private activateAnchorLock(targetScrollTop: number): void {
    this.anchorLock = {
      active: true,
      targetScrollTop: Math.max(this.anchorLock.active ? this.anchorLock.targetScrollTop : 0, targetScrollTop),
      untilMs: now() + ANCHOR_LOCK_DURATION_MS,
    };
  }

  private enforceAnchorLock(scroller: HTMLElement): boolean {
    if (!this.anchorLock.active) {
      return false;
    }
    if (now() > this.anchorLock.untilMs && this.transitionCount === 0) {
      this.anchorLock.active = false;
      return false;
    }

    const metrics = readMetrics(scroller);
    const target = Math.min(this.anchorLock.targetScrollTop, getMaxScrollTop(metrics));
    if (Math.abs(target - scroller.scrollTop) > VIEWPORT_EPSILON_PX) {
      scroller.scrollTop = target;
      this.previousScrollTop = target;
    }
    return true;
  }

  // ── Footer / snapshot plumbing ─────────────────────────────────────────────

  /**
   * Synchronous footer DOM write with forced layout reads so the new height
   * participates in this task's layout, before any scroll clamping.
   */
  private applyFooterNow(): void {
    const footer = this.host.getFooter();
    if (!footer) return;

    const heightPx = this.getFooterHeightPx();
    footer.style.height = `${heightPx}px`;
    footer.style.minHeight = `${heightPx}px`;
    void footer.offsetHeight;
    const scroller = this.host.getScroller();
    if (scroller) {
      void scroller.scrollHeight;
    }
  }

  private snapshotEffectiveHeight(): void {
    const scroller = this.host.getScroller();
    if (!scroller) return;
    this.previousEffectiveHeight = getEffectiveContentHeight(
      readMetrics(scroller),
      this.geometry,
      this.host.getInputFooterPx(),
    );
  }

  private updateShowScrollToLatest(metrics: ScrollerMetrics): void {
    const show =
      this.mode.kind === 'reading' &&
      getContentDistanceFromBottom(metrics, this.geometry) > SCROLL_TO_LATEST_THRESHOLD_PX;
    if (show !== this.snapshot.showScrollToLatest) {
      this.publishSnapshot();
    }
  }

  private publishSnapshot(): void {
    const scroller = this.host.getScroller();
    const show = scroller
      ? this.mode.kind === 'reading' &&
        getContentDistanceFromBottom(readMetrics(scroller), this.geometry) >
          SCROLL_TO_LATEST_THRESHOLD_PX
      : false;
    const next: ViewportSnapshot = { modeKind: this.mode.kind, showScrollToLatest: show };
    if (
      next.modeKind === this.snapshot.modeKind &&
      next.showScrollToLatest === this.snapshot.showScrollToLatest
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function readMetrics(scroller: HTMLElement): ScrollerMetrics {
  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  };
}

function createInactiveCollapseIntent(): CollapseIntentState {
  return {
    active: false,
    anchorScrollTop: 0,
    baseCompensationPx: 0,
    distanceFromBottomBeforeCollapse: 0,
    cumulativeShrinkPx: 0,
    expiresAtMs: 0,
  };
}

function createNavigationRuntime(startedAtMs: number): NavigationRuntime {
  return {
    startedAtMs,
    issuedVirtuosoScroll: false,
    stableFrames: 0,
    lastScrollTop: 0,
  };
}

function now(): number {
  return performance.now();
}
