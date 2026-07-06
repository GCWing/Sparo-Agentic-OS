import { describe, expect, it } from 'vitest';
import {
  READING_MODE,
  reduceViewportMode,
  type ViewportContext,
  type ViewportMode,
} from './FlowViewportMachine';

const streamingCtx: ViewportContext = {
  isStreaming: true,
  latestTurnId: 'turn-2',
  stickyPinTurnId: null,
};
const idleCtx: ViewportContext = {
  isStreaming: false,
  latestTurnId: 'turn-2',
  stickyPinTurnId: null,
};
const idleWithFloorCtx: ViewportContext = {
  isStreaming: false,
  latestTurnId: 'turn-2',
  stickyPinTurnId: 'turn-2',
};

const pinnedLatest: ViewportMode = { kind: 'pinned-latest', turnId: 'turn-2' };
const following: ViewportMode = { kind: 'following' };
const finalizing: ViewportMode = { kind: 'finalizing', sinceMs: 1000 };
const stickyNavigating: ViewportMode = {
  kind: 'navigating',
  target: { type: 'turn-pin-top', turnId: 'turn-2', pinMode: 'sticky-latest', behavior: 'auto' },
};

describe('FlowViewportMachine', () => {
  it('routes a sent turn into sticky pin navigation', () => {
    const next = reduceViewportMode(READING_MODE, { type: 'TURN_SENT', turnId: 'turn-2' }, streamingCtx);
    expect(next).toEqual(stickyNavigating);
  });

  it('keeps TURN_SENT idempotent for the already pinned turn', () => {
    expect(
      reduceViewportMode(pinnedLatest, { type: 'TURN_SENT', turnId: 'turn-2' }, streamingCtx),
    ).toBe(pinnedLatest);
    expect(
      reduceViewportMode(stickyNavigating, { type: 'TURN_SENT', turnId: 'turn-2' }, streamingCtx),
    ).toBe(stickyNavigating);
  });

  it('treats a sticky NAVIGATE to the already pinned turn as a no-op', () => {
    expect(
      reduceViewportMode(pinnedLatest, {
        type: 'NAVIGATE',
        target: { type: 'turn-pin-top', turnId: 'turn-2', pinMode: 'sticky-latest', behavior: 'smooth' },
      }, streamingCtx),
    ).toBe(pinnedLatest);
  });

  it('settles sticky pin navigation of the latest turn into pinned-latest', () => {
    const next = reduceViewportMode(
      stickyNavigating,
      { type: 'NAVIGATION_SETTLED', nowMs: 5 },
      streamingCtx,
    );
    expect(next).toEqual(pinnedLatest);
  });

  it('settles transient pin navigation into reading', () => {
    const navigating: ViewportMode = {
      kind: 'navigating',
      target: { type: 'turn-pin-top', turnId: 'turn-1', pinMode: 'transient', behavior: 'smooth' },
    };
    expect(
      reduceViewportMode(navigating, { type: 'NAVIGATION_SETTLED', nowMs: 5 }, streamingCtx),
    ).toEqual(READING_MODE);
  });

  it('activates follow once the pin floor is consumed while streaming', () => {
    expect(reduceViewportMode(pinnedLatest, { type: 'PIN_FLOOR_CONSUMED' }, streamingCtx))
      .toEqual(following);
    expect(reduceViewportMode(pinnedLatest, { type: 'PIN_FLOOR_CONSUMED' }, idleCtx))
      .toBe(pinnedLatest);
  });

  it('always yields to explicit upward user intent', () => {
    for (const mode of [pinnedLatest, following, finalizing, stickyNavigating]) {
      expect(reduceViewportMode(mode, { type: 'USER_SCROLL_UP' }, streamingCtx))
        .toEqual(READING_MODE);
    }
  });

  it('re-enters follow when the user returns to the content bottom mid-stream', () => {
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_CONTENT_BOTTOM' }, streamingCtx),
    ).toEqual(following);
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_CONTENT_BOTTOM' }, idleCtx),
    ).toBe(READING_MODE);
  });

  it('re-enters pinned-latest when the user scrolls back down onto a live sticky floor', () => {
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_CONTENT_BOTTOM' }, idleWithFloorCtx),
    ).toEqual(pinnedLatest);
    // A floor owned by a superseded turn must not re-pin.
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_CONTENT_BOTTOM' }, {
        ...idleWithFloorCtx,
        stickyPinTurnId: 'turn-1',
      }),
    ).toBe(READING_MODE);
  });

  it('keeps pinned-latest alive across stream end (short answers stay pinned)', () => {
    expect(reduceViewportMode(pinnedLatest, { type: 'STREAM_ENDED', nowMs: 100 }, idleCtx))
      .toBe(pinnedLatest);
  });

  it('moves follow into finalizing on stream end, then into reading on settle', () => {
    const next = reduceViewportMode(following, { type: 'STREAM_ENDED', nowMs: 100 }, idleCtx);
    expect(next).toEqual({ kind: 'finalizing', sinceMs: 100 });
    expect(reduceViewportMode(next, { type: 'FINALIZE_SETTLED' }, idleCtx)).toEqual(READING_MODE);
  });

  it('resumes follow when a stream flaps back on during finalizing', () => {
    expect(reduceViewportMode(finalizing, { type: 'STREAM_STARTED' }, streamingCtx))
      .toEqual(following);
  });

  it('jump-to-latest settles into follow while streaming, pinned-latest when a sticky floor is live', () => {
    const navigating = reduceViewportMode(READING_MODE, { type: 'USER_JUMP_LATEST' }, streamingCtx);
    expect(navigating.kind).toBe('navigating');
    expect(reduceViewportMode(navigating, { type: 'NAVIGATION_SETTLED', nowMs: 5 }, streamingCtx))
      .toEqual(following);
    expect(
      reduceViewportMode(navigating, { type: 'NAVIGATION_SETTLED', nowMs: 5 }, idleWithFloorCtx),
    ).toEqual(pinnedLatest);
    expect(reduceViewportMode(navigating, { type: 'NAVIGATION_SETTLED', nowMs: 5 }, idleCtx))
      .toEqual(READING_MODE);
  });

  it('initializes sessions by streaming state', () => {
    expect(
      reduceViewportMode(following, {
        type: 'SESSION_CHANGED',
        latestTurnId: 'turn-9',
        isStreaming: true,
      }, streamingCtx),
    ).toEqual({
      kind: 'navigating',
      target: { type: 'turn-pin-top', turnId: 'turn-9', pinMode: 'sticky-latest', behavior: 'auto' },
    });
    expect(
      reduceViewportMode(following, {
        type: 'SESSION_CHANGED',
        latestTurnId: 'turn-9',
        isStreaming: false,
      }, idleCtx),
    ).toEqual(READING_MODE);
  });
});
