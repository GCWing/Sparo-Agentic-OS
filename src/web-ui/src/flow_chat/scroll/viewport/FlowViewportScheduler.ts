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
  areLatestTurnLayoutOwnersEqual,
  absorbLatestTurnContentGrowth,
  clearConsumableCompensation,
  consumeCompensation,
  createInitialGeometry,
  easeOutCubic,
  getContentDistanceFromBottom,
  getEffectiveContentHeight,
  getFollowTargetScrollTop,
  getMaxScrollTop,
  getTotalCompensationPx,
  increaseLatestTurnFloor,
  reconcileLatestTurnFloor,
  replaceLatestTurnLayout,
  resolveTailAlignmentMetrics,
  sanitizeGeometry,
  setLatestTurnActivationTail,
  setLatestTurnLayoutPhase,
  setTransientTail,
  type LatestTurnLayoutOwner,
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

export interface FlowViewportDiagnostics {
  mode: ViewportMode;
  latestTurnLayout: ViewportGeometryState['latestTurnLayout'];
  transientTailPx: number;
  totalCompensationPx: number;
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
  private activeSessionId: string | null = null;
  private nextLayoutEpoch = 0;

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

  getDiagnostics(): FlowViewportDiagnostics {
    const latestTurnLayout = this.geometry.latestTurnLayout;
    return {
      mode: this.mode,
      latestTurnLayout: latestTurnLayout
        ? { ...latestTurnLayout, owner: { ...latestTurnLayout.owner } }
        : null,
      transientTailPx: this.geometry.transientTailPx,
      totalCompensationPx: getTotalCompensationPx(this.geometry),
    };
  }

  getFooterHeightPx(): number {
    return this.host.getInputFooterPx() + getTotalCompensationPx(this.geometry);
  }

  private getLatestTurnLayoutOwner(): LatestTurnLayoutOwner | null {
    return this.geometry.latestTurnLayout?.owner ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.cancelFrame();
    this.listeners.clear();
  }

  enterSession(
    sessionId: string,
    latestTurnId: string | null,
    initialTargetTurnId: string | null,
  ): void {
    this.activeSessionId = sessionId;
    const owner = latestTurnId ? this.createLayoutOwner(sessionId, latestTurnId) : null;
    this.geometry = owner
      ? replaceLatestTurnLayout(
          createInitialGeometry(),
          owner,
          initialTargetTurnId && initialTargetTurnId !== latestTurnId
            ? 'dormant'
            : 'activating',
        )
      : createInitialGeometry();
    this.anchorLock = { active: false, targetScrollTop: 0, untilMs: 0 };
    this.collapseIntent = createInactiveCollapseIntent();
    this.animation.active = false;
    this.previousEffectiveHeight = null;
    this.previousScrollTop = 0;
    this.idleFrames = 0;
    this.finalizeStableFrames = 0;
    this.applyFooterNow();
    this.dispatch({ type: 'SESSION_ENTERED', owner, initialTargetTurnId });
  }

  /** Synchronize a data-derived latest turn without claiming user intent. */
  syncLatestTurn(sessionId: string, turnId: string): void {
    if (this.activeSessionId !== sessionId) return;
    const current = this.getLatestTurnLayoutOwner();
    if (current?.sessionId === sessionId && current.turnId === turnId) {
      return;
    }

    const owner = this.createLayoutOwner(sessionId, turnId);
    this.geometry = replaceLatestTurnLayout(createInitialGeometry(), owner, 'dormant');
    this.anchorLock.active = false;
    this.collapseIntent = createInactiveCollapseIntent();
    this.animation.active = false;
    this.previousEffectiveHeight = null;
    this.applyFooterNow();
    this.dispatch({ type: 'LATEST_TURN_CHANGED' });
    this.wake();
  }

  /** Explicit local submission: replace the owner if needed and activate it. */
  submitLatestTurn(sessionId: string, turnId: string): boolean {
    if (this.activeSessionId !== sessionId) return false;
    const owner = this.ensureLatestTurnOwner(sessionId, turnId);
    if (
      (this.mode.kind === 'pinned-latest' &&
        areLatestTurnLayoutOwnersEqual(this.mode.owner, owner)) ||
      (this.mode.kind === 'navigating' &&
        this.mode.target.type === 'latest-turn-top' &&
        areLatestTurnLayoutOwnersEqual(this.mode.target.owner, owner))
    ) {
      this.wake();
      return true;
    }
    this.geometry = setLatestTurnLayoutPhase(this.geometry, 'activating');
    this.applyFooterNow();
    this.snapshotEffectiveHeight();
    this.dispatch({ type: 'TURN_SUBMITTED', owner });
    return true;
  }

  navigateToTurn(turnId: string, behavior: ScrollBehavior): boolean {
    let owner = this.getLatestTurnLayoutOwner();
    if (
      turnId === this.host.getLatestTurnId() &&
      this.activeSessionId &&
      owner?.turnId !== turnId
    ) {
      owner = this.ensureLatestTurnOwner(this.activeSessionId, turnId);
    }
    if (owner?.turnId === turnId) {
      if (
        (this.mode.kind === 'pinned-latest' &&
          areLatestTurnLayoutOwnersEqual(this.mode.owner, owner)) ||
        (this.mode.kind === 'navigating' &&
          this.mode.target.type === 'latest-turn-top' &&
          areLatestTurnLayoutOwnersEqual(this.mode.target.owner, owner))
      ) {
        this.wake();
        return true;
      }
      this.geometry = setLatestTurnLayoutPhase(this.geometry, 'activating');
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
      this.dispatch({
        type: 'NAVIGATE',
        target: { type: 'latest-turn-top', owner, behavior },
      });
      return true;
    }

    this.geometry = setLatestTurnLayoutPhase(this.geometry, 'dormant');
    this.applyFooterNow();
    this.snapshotEffectiveHeight();
    this.dispatch({ type: 'NAVIGATE', target: { type: 'turn-top', turnId, behavior } });
    return true;
  }

  resetForEmptyList(): void {
    this.geometry = createInitialGeometry();
    this.activeSessionId = null;
    this.previousEffectiveHeight = null;
    this.anchorLock.active = false;
    this.collapseIntent = createInactiveCollapseIntent();
    this.applyFooterNow();
  }

  private createLayoutOwner(sessionId: string, turnId: string): LatestTurnLayoutOwner {
    this.nextLayoutEpoch += 1;
    return { sessionId, turnId, epoch: this.nextLayoutEpoch };
  }

  private ensureLatestTurnOwner(sessionId: string, turnId: string): LatestTurnLayoutOwner {
    const current = this.getLatestTurnLayoutOwner();
    if (current?.sessionId === sessionId && current.turnId === turnId) {
      return current;
    }
    const owner = this.createLayoutOwner(sessionId, turnId);
    this.geometry = replaceLatestTurnLayout(createInitialGeometry(), owner, 'activating');
    this.previousEffectiveHeight = null;
    return owner;
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
      latestTurnLayoutOwner: this.getLatestTurnLayoutOwner(),
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
      this.geometry = clearConsumableCompensation(this.geometry);
      if (next.target.type === 'latest-turn-top') {
        if (
          areLatestTurnLayoutOwnersEqual(
            next.target.owner,
            this.getLatestTurnLayoutOwner(),
          )
        ) {
          this.geometry = setLatestTurnLayoutPhase(this.geometry, 'activating');
        }
      } else {
        this.geometry = setLatestTurnLayoutPhase(this.geometry, 'dormant');
      }
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
    }

    if (next.kind === 'pinned-latest') {
      this.geometry = setLatestTurnLayoutPhase(this.geometry, 'active');
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
      this.pinnedFramesSinceEstablished = 0;
    }

    if (next.kind === 'following' || next.kind === 'finalizing') {
      this.geometry = setLatestTurnLayoutPhase(this.geometry, 'dormant');
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
    }

    if (next.kind === 'reading') {
      this.geometry = setLatestTurnLayoutPhase(this.geometry, 'dormant');
      if (previous.kind === 'finalizing') {
        this.geometry = clearConsumableCompensation(this.geometry);
      }
      this.applyFooterNow();
      this.snapshotEffectiveHeight();
    }
  }

  // ── Input / layout entry points ────────────────────────────────────────────

  /** Wheel-up, touch pull-down, upward key, scrollbar grab. */
  handleUserScrollUpIntent(): void {
    this.dispatch({ type: 'USER_SCROLL_UP' });
  }

  /**
   * Downward intent only releases a pinned page when real content exists
   * below the viewport. Synthetic blank alone is not scrollable content.
   */
  handleUserScrollDownIntent(): void {
    if (this.mode.kind === 'navigating') {
      this.dispatch({ type: 'USER_SCROLL_DOWN_WITH_CONTENT' });
      return;
    }
    if (this.mode.kind !== 'pinned-latest') return;

    const scroller = this.host.getScroller();
    if (!scroller) return;
    if (getContentDistanceFromBottom(readMetrics(scroller), this.geometry) > VIEWPORT_EPSILON_PX) {
      this.dispatch({ type: 'USER_SCROLL_DOWN_WITH_CONTENT' });
    }
  }

  handleScrollEvent(): void {
    const scroller = this.host.getScroller();
    if (!scroller) return;

    const metrics = readMetrics(scroller);
    const delta = metrics.scrollTop - this.previousScrollTop;

    // Synchronous consumption removes only temporary reservations. The latest
    // floor is non-consumable and survives history detours.
    if (
      delta > VIEWPORT_EPSILON_PX &&
      !this.anchorLock.active &&
      this.transitionCount === 0 &&
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
      const latestOwner = this.getLatestTurnLayoutOwner();
      if (this.host.isStreaming()) {
        if (getContentDistanceFromBottom(fresh, this.geometry) <= REENTER_FOLLOW_THRESHOLD_PX) {
          this.dispatch({ type: 'USER_REACHED_OUTPUT_END' });
        }
      } else if (
        latestOwner !== null &&
        latestOwner.turnId === this.host.getLatestTurnId() &&
        (this.geometry.latestTurnLayout?.floorPx ?? 0) > VIEWPORT_EPSILON_PX &&
        getMaxScrollTop(fresh) - fresh.scrollTop <= PIN_ALIGN_TOLERANCE_PX
      ) {
        // While returning from history the floor is traversable layout range.
        // Activation occurs only once native scrolling reaches the measured
        // latest page, so no content-bottom snap is introduced.
        this.dispatch({ type: 'USER_REACHED_LATEST_LAYOUT' });
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
        const owner = this.getLatestTurnLayoutOwner();
        if (owner) {
          this.geometry = increaseLatestTurnFloor(this.geometry, owner, estimate);
        }
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
      const next = this.mode.kind === 'pinned-latest'
        ? absorbLatestTurnContentGrowth(this.geometry, this.mode.owner, delta)
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
      const nonCollapsePx = getTotalCompensationPx(this.geometry) - this.geometry.collapsePx;
      this.geometry = sanitizeGeometry({
        ...this.geometry,
        collapsePx: Math.max(0, nextTotal - nonCollapsePx),
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

    if (!areLatestTurnLayoutOwnersEqual(mode.owner, this.getLatestTurnLayoutOwner())) {
      this.dispatch({ type: 'LATEST_TURN_CHANGED' });
      return false;
    }

    const element = this.host.getUserMessageElement(mode.owner.turnId);
    if (!element) {
      // Virtualized out (large resize or fast history jump); bring it back.
      const index = this.host.findUserMessageIndex(mode.owner.turnId);
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
    const { desiredScrollTop, requiredTailSpacePx } = resolveTailAlignmentMetrics(
      metrics,
      topDelta,
      getTotalCompensationPx(this.geometry),
    );

    // Absolute measurement converges the current epoch without inheriting
    // pixels from a previous session or turn.
    const currentFloorPx = this.geometry.latestTurnLayout?.floorPx ?? 0;
    const holdReconcile =
      this.transitionCount > 0 && requiredTailSpacePx < currentFloorPx;
    const nextGeometry = reconcileLatestTurnFloor(
      this.geometry,
      mode.owner,
      requiredTailSpacePx,
      holdReconcile,
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
      (this.geometry.latestTurnLayout?.floorPx ?? 0) <= VIEWPORT_EPSILON_PX &&
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
    const anchorLocked = this.enforceAnchorLock(scroller);
    const layoutChanged = this.materializeDormantLatestTurnLayout(scroller);
    return anchorLocked || layoutChanged;
  }

  /**
   * A history detour keeps the semantic latest owner but does not force a
   * jump. Once virtualization renders that owner, establish its floor in
   * place. Growing the footer does not move the current reading anchor; it
   * simply makes the correct latest-turn page reachable on the way down.
   */
  private materializeDormantLatestTurnLayout(scroller: HTMLElement): boolean {
    const layout = this.geometry.latestTurnLayout;
    if (
      !layout ||
      layout.phase !== 'dormant' ||
      layout.owner.turnId !== this.host.getLatestTurnId()
    ) {
      return false;
    }

    const element = this.host.getUserMessageElement(layout.owner.turnId);
    if (!element) return false;

    const metrics = readMetrics(scroller);
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const topDelta = targetRect.top - (scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX);
    const { requiredTailSpacePx } = resolveTailAlignmentMetrics(
      metrics,
      topDelta,
      getTotalCompensationPx(this.geometry),
    );
    const next = reconcileLatestTurnFloor(
      this.geometry,
      layout.owner,
      requiredTailSpacePx,
      this.transitionCount > 0 && requiredTailSpacePx < layout.floorPx,
    );
    if (areGeometriesEqual(next, this.geometry)) {
      return false;
    }
    this.geometry = next;
    this.applyFooterNow();
    this.snapshotEffectiveHeight();
    if (
      !this.host.isStreaming() &&
      requiredTailSpacePx > VIEWPORT_EPSILON_PX &&
      getMaxScrollTop(readMetrics(scroller)) - scroller.scrollTop <=
        PIN_ALIGN_TOLERANCE_PX
    ) {
      this.dispatch({ type: 'USER_REACHED_LATEST_LAYOUT' });
    }
    return true;
  }

  private stepNavigation(scroller: HTMLElement): boolean {
    const mode = this.mode;
    if (mode.kind !== 'navigating') return false;
    const target = mode.target;

    if (
      now() - this.navigation.startedAtMs > PIN_RETRY_TTL_MS &&
      (target.type === 'latest-turn-top' || target.type === 'turn-top')
    ) {
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

      case 'latest-turn-top': {
        if (!areLatestTurnLayoutOwnersEqual(target.owner, this.getLatestTurnLayoutOwner())) {
          this.dispatch({ type: 'LATEST_TURN_CHANGED' });
          return false;
        }

        const element = this.host.getUserMessageElement(target.owner.turnId);
        if (!element) {
          const index = this.host.findUserMessageIndex(target.owner.turnId);
          if (index < 0) {
            this.settleNavigation();
            return false;
          }
          const metrics = readMetrics(scroller);
          const provisionalPx = Math.max(metrics.clientHeight, getMaxScrollTop(metrics));
          const next = setLatestTurnActivationTail(
            this.geometry,
            target.owner,
            provisionalPx,
          );
          if (!areGeometriesEqual(next, this.geometry)) {
            this.geometry = next;
            this.applyFooterNow();
            this.snapshotEffectiveHeight();
          }
          this.host.virtuosoScrollToIndex(index, 'start', 'auto');
          return true;
        }

        const metrics = readMetrics(scroller);
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = element.getBoundingClientRect();
        const topDelta = targetRect.top - (scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX);
        const { desiredScrollTop, requiredTailSpacePx } = resolveTailAlignmentMetrics(
          metrics,
          topDelta,
          getTotalCompensationPx(this.geometry),
        );

        this.geometry = reconcileLatestTurnFloor(
          this.geometry,
          target.owner,
          requiredTailSpacePx,
          false,
        );
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

      case 'turn-top': {
        const element = this.host.getUserMessageElement(target.turnId);
        if (!element) {
          const index = this.host.findUserMessageIndex(target.turnId);
          if (index < 0) {
            this.settleNavigation();
            return false;
          }
          this.host.virtuosoScrollToIndex(index, 'start', 'auto');
          return true;
        }

        const metrics = readMetrics(scroller);
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = element.getBoundingClientRect();
        const topDelta = targetRect.top - (scrollerRect.top + PINNED_TURN_VIEWPORT_OFFSET_PX);
        const { desiredScrollTop, requiredTailSpacePx } = resolveTailAlignmentMetrics(
          metrics,
          topDelta,
          this.geometry.transientTailPx,
        );

        this.geometry = setTransientTail(this.geometry, requiredTailSpacePx);
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
    const ownerEpoch =
      this.mode.kind === 'navigating' && this.mode.target.type === 'latest-turn-top'
        ? this.mode.target.owner.epoch
        : undefined;
    this.dispatch({ type: 'NAVIGATION_SETTLED', nowMs: now(), ownerEpoch });
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
      this.getDistanceToLatestTarget(metrics) > SCROLL_TO_LATEST_THRESHOLD_PX;
    if (show !== this.snapshot.showScrollToLatest) {
      this.publishSnapshot();
    }
  }

  private publishSnapshot(): void {
    const scroller = this.host.getScroller();
    const show = scroller
      ? this.mode.kind === 'reading' &&
        this.getDistanceToLatestTarget(readMetrics(scroller)) >
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

  private getDistanceToLatestTarget(metrics: ScrollerMetrics): number {
    if (
      !this.host.isStreaming() &&
      this.geometry.latestTurnLayout?.phase === 'dormant' &&
      this.geometry.latestTurnLayout.floorPx > VIEWPORT_EPSILON_PX
    ) {
      return Math.max(0, getMaxScrollTop(metrics) - metrics.scrollTop);
    }
    return getContentDistanceFromBottom(metrics, this.geometry);
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
