import { describe, expect, it } from 'vitest';
import {
  READING_MODE,
  reduceViewportMode,
  type ViewportContext,
  type ViewportMode,
} from './FlowViewportMachine';
import type { LatestTurnLayoutOwner } from './FlowViewportGeometry';

const owner: LatestTurnLayoutOwner = {
  sessionId: 'session-b',
  turnId: 'turn-b3',
  epoch: 2,
};
const nextOwner: LatestTurnLayoutOwner = {
  sessionId: 'session-b',
  turnId: 'turn-b4',
  epoch: 3,
};

const streamingCtx: ViewportContext = {
  isStreaming: true,
  latestTurnId: owner.turnId,
  latestTurnLayoutOwner: owner,
};
const idleCtx: ViewportContext = { ...streamingCtx, isStreaming: false };

const pinnedLatest: ViewportMode = { kind: 'pinned-latest', owner };
const following: ViewportMode = { kind: 'following' };
const finalizing: ViewportMode = { kind: 'finalizing', sinceMs: 1000 };
const latestNavigation: ViewportMode = {
  kind: 'navigating',
  target: { type: 'latest-turn-top', owner, behavior: 'auto' },
};

describe('FlowViewportMachine', () => {
  it('routes a submitted turn into its owned latest-layout navigation', () => {
    expect(
      reduceViewportMode(READING_MODE, { type: 'TURN_SUBMITTED', owner }, streamingCtx),
    ).toEqual(latestNavigation);
  });

  it('keeps an activation idempotent only for the same owner epoch', () => {
    expect(
      reduceViewportMode(pinnedLatest, { type: 'TURN_SUBMITTED', owner }, streamingCtx),
    ).toBe(pinnedLatest);
    expect(
      reduceViewportMode(latestNavigation, { type: 'TURN_SUBMITTED', owner }, streamingCtx),
    ).toBe(latestNavigation);

    expect(
      reduceViewportMode(pinnedLatest, { type: 'TURN_SUBMITTED', owner: nextOwner }, {
        ...streamingCtx,
        latestTurnId: nextOwner.turnId,
        latestTurnLayoutOwner: nextOwner,
      }),
    ).toEqual({
      kind: 'navigating',
      target: { type: 'latest-turn-top', owner: nextOwner, behavior: 'auto' },
    });
  });

  it('settles latest navigation only for the current owner epoch', () => {
    expect(
      reduceViewportMode(
        latestNavigation,
        { type: 'NAVIGATION_SETTLED', nowMs: 5, ownerEpoch: owner.epoch },
        idleCtx,
      ),
    ).toEqual(pinnedLatest);

    expect(
      reduceViewportMode(
        latestNavigation,
        { type: 'NAVIGATION_SETTLED', nowMs: 5, ownerEpoch: owner.epoch - 1 },
        idleCtx,
      ),
    ).toBe(latestNavigation);
  });

  it('settles an older-turn navigation into reading without changing ownership', () => {
    const navigating: ViewportMode = {
      kind: 'navigating',
      target: { type: 'turn-top', turnId: 'turn-b1', behavior: 'smooth' },
    };
    expect(
      reduceViewportMode(navigating, { type: 'NAVIGATION_SETTLED', nowMs: 5 }, idleCtx),
    ).toEqual(READING_MODE);
  });

  it('restores latest at its layout boundary and follows streaming output end', () => {
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_LATEST_LAYOUT' }, idleCtx),
    ).toEqual(latestNavigation);
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_OUTPUT_END' }, streamingCtx),
    ).toEqual(following);
  });

  it('does not restore a layout whose owner was superseded', () => {
    expect(
      reduceViewportMode(READING_MODE, { type: 'USER_REACHED_LATEST_LAYOUT' }, {
        ...idleCtx,
        latestTurnId: nextOwner.turnId,
      }),
    ).toBe(READING_MODE);
  });

  it('enters an older explicit session target while retaining latest ownership in context', () => {
    expect(
      reduceViewportMode(following, {
        type: 'SESSION_ENTERED',
        owner,
        initialTargetTurnId: 'turn-b1',
      }, idleCtx),
    ).toEqual({
      kind: 'navigating',
      target: { type: 'turn-top', turnId: 'turn-b1', behavior: 'auto' },
    });
  });

  it('opens static and streaming sessions at the latest turn reading position', () => {
    for (const context of [idleCtx, streamingCtx]) {
      expect(
        reduceViewportMode(following, {
          type: 'SESSION_ENTERED',
          owner,
          initialTargetTurnId: null,
        }, context),
      ).toEqual(latestNavigation);
    }
  });

  it('returns static sessions to latest-turn-top and streaming sessions to output end', () => {
    expect(reduceViewportMode(READING_MODE, { type: 'USER_JUMP_LATEST' }, idleCtx))
      .toEqual({
        kind: 'navigating',
        target: { type: 'latest-turn-top', owner, behavior: 'smooth' },
      });
    expect(reduceViewportMode(READING_MODE, { type: 'USER_JUMP_LATEST' }, streamingCtx))
      .toEqual({
        kind: 'navigating',
        target: { type: 'latest-end', behavior: 'smooth' },
      });
  });

  it('yields to upward intent and to downward intent when real content exists', () => {
    for (const mode of [pinnedLatest, following, finalizing, latestNavigation]) {
      expect(reduceViewportMode(mode, { type: 'USER_SCROLL_UP' }, streamingCtx))
        .toEqual(READING_MODE);
    }
    expect(
      reduceViewportMode(pinnedLatest, { type: 'USER_SCROLL_DOWN_WITH_CONTENT' }, idleCtx),
    ).toEqual(READING_MODE);
    expect(
      reduceViewportMode(following, { type: 'USER_SCROLL_DOWN_WITH_CONTENT' }, streamingCtx),
    ).toBe(following);
  });

  it('follows after floor consumption only while streaming', () => {
    expect(reduceViewportMode(pinnedLatest, { type: 'PIN_FLOOR_CONSUMED' }, streamingCtx))
      .toEqual(following);
    expect(reduceViewportMode(pinnedLatest, { type: 'PIN_FLOOR_CONSUMED' }, idleCtx))
      .toBe(pinnedLatest);
  });

  it('keeps short completed answers pinned and finalizes followed output', () => {
    expect(reduceViewportMode(pinnedLatest, { type: 'STREAM_ENDED', nowMs: 100 }, idleCtx))
      .toBe(pinnedLatest);
    const next = reduceViewportMode(following, { type: 'STREAM_ENDED', nowMs: 100 }, idleCtx);
    expect(next).toEqual({ kind: 'finalizing', sinceMs: 100 });
    expect(reduceViewportMode(next, { type: 'FINALIZE_SETTLED' }, idleCtx))
      .toEqual(READING_MODE);
  });
});
