/**
 * FlowChat viewport mode state machine.
 *
 * The single authority for "what is the viewport doing right now". All scroll
 * behavior branches on the current mode; nothing else may infer intent from
 * scroll deltas or timing windows.
 *
 * Modes:
 * - `reading`        user owns the viewport; no automatic scrolling.
 * - `pinned-latest`  latest user turn is pinned to the reading offset with a
 *                    synthetic tail floor; content growth is absorbed by the
 *                    floor (equal exchange) so the viewport never moves.
 * - `following`      viewport chases the end of content every frame.
 * - `finalizing`     stream just ended; keep chasing the tail while terminal
 *                    auto-collapses settle, then hand off to reading.
 * - `navigating`     an explicit navigation (pin, center, jump-to-latest) is
 *                    being executed by the scheduler.
 *
 * The reducer is pure; the scheduler owns all side effects.
 */

import type { ViewportPinMode } from './FlowViewportGeometry';

export type ViewportNavigationTarget =
  | {
      type: 'turn-pin-top';
      turnId: string;
      pinMode: ViewportPinMode;
      behavior: ScrollBehavior;
    }
  | { type: 'index-center'; index: number; behavior: ScrollBehavior }
  | { type: 'latest-end'; behavior: ScrollBehavior; clearPin: boolean };

export type ViewportMode =
  | { kind: 'reading' }
  | { kind: 'pinned-latest'; turnId: string }
  | { kind: 'following' }
  | { kind: 'finalizing'; sinceMs: number }
  | { kind: 'navigating'; target: ViewportNavigationTarget };

export type ViewportEvent =
  | { type: 'TURN_SENT'; turnId: string }
  | { type: 'PIN_FLOOR_CONSUMED' }
  | { type: 'USER_SCROLL_UP' }
  | { type: 'USER_REACHED_CONTENT_BOTTOM' }
  | { type: 'USER_JUMP_LATEST' }
  | { type: 'NAVIGATE'; target: ViewportNavigationTarget }
  | { type: 'NAVIGATION_SETTLED'; nowMs: number }
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_ENDED'; nowMs: number }
  | { type: 'FINALIZE_SETTLED' }
  | { type: 'SESSION_CHANGED'; latestTurnId: string | null; isStreaming: boolean };

export interface ViewportContext {
  isStreaming: boolean;
  latestTurnId: string | null;
  /**
   * Turn that currently owns a live sticky pin floor (synthetic tail blank),
   * or null when no floor is active. The floor belongs to the latest turn's
   * reading layout and survives detours into history; reaching the bottom
   * again re-enters pinned-latest instead of stopping in reading.
   */
  stickyPinTurnId: string | null;
}

export const READING_MODE: ViewportMode = { kind: 'reading' };

function createStickyPinNavigation(turnId: string): ViewportMode {
  return {
    kind: 'navigating',
    target: {
      type: 'turn-pin-top',
      turnId,
      pinMode: 'sticky-latest',
      behavior: 'auto',
    },
  };
}

export function reduceViewportMode(
  mode: ViewportMode,
  event: ViewportEvent,
  context: ViewportContext,
): ViewportMode {
  switch (event.type) {
    case 'TURN_SENT': {
      // Idempotent per turn: repeated pin requests for the turn we are
      // already pinning or pinned to are no-ops.
      if (mode.kind === 'pinned-latest' && mode.turnId === event.turnId) {
        return mode;
      }
      if (
        mode.kind === 'navigating' &&
        mode.target.type === 'turn-pin-top' &&
        mode.target.pinMode === 'sticky-latest' &&
        mode.target.turnId === event.turnId
      ) {
        return mode;
      }
      return createStickyPinNavigation(event.turnId);
    }

    case 'NAVIGATE': {
      if (
        mode.kind === 'navigating' &&
        JSON.stringify(mode.target) === JSON.stringify(event.target)
      ) {
        return mode;
      }
      // Re-pinning the turn we are already pinned to is a no-op.
      if (
        mode.kind === 'pinned-latest' &&
        event.target.type === 'turn-pin-top' &&
        event.target.pinMode === 'sticky-latest' &&
        event.target.turnId === mode.turnId
      ) {
        return mode;
      }
      return { kind: 'navigating', target: event.target };
    }

    case 'NAVIGATION_SETTLED': {
      if (mode.kind !== 'navigating') {
        return mode;
      }
      const target = mode.target;
      if (
        target.type === 'turn-pin-top' &&
        target.pinMode === 'sticky-latest' &&
        target.turnId === context.latestTurnId
      ) {
        return { kind: 'pinned-latest', turnId: target.turnId };
      }
      if (target.type === 'latest-end') {
        if (
          !context.isStreaming &&
          context.stickyPinTurnId &&
          context.stickyPinTurnId === context.latestTurnId
        ) {
          return { kind: 'pinned-latest', turnId: context.stickyPinTurnId };
        }
        return context.isStreaming ? { kind: 'following' } : READING_MODE;
      }
      return READING_MODE;
    }

    case 'PIN_FLOOR_CONSUMED': {
      if (mode.kind === 'pinned-latest' && context.isStreaming) {
        return { kind: 'following' };
      }
      return mode;
    }

    case 'USER_SCROLL_UP': {
      return mode.kind === 'reading' ? mode : READING_MODE;
    }

    case 'USER_REACHED_CONTENT_BOTTOM': {
      if (mode.kind !== 'reading') {
        return mode;
      }
      if (context.isStreaming) {
        return { kind: 'following' };
      }
      // Scrolling back down to the pinned layout restores it: the sticky
      // floor survived the detour, so re-arm the equal-exchange invariant.
      if (context.stickyPinTurnId && context.stickyPinTurnId === context.latestTurnId) {
        return { kind: 'pinned-latest', turnId: context.stickyPinTurnId };
      }
      return mode;
    }

    case 'USER_JUMP_LATEST': {
      return {
        kind: 'navigating',
        target: { type: 'latest-end', behavior: 'smooth', clearPin: false },
      };
    }

    case 'STREAM_STARTED': {
      // A stream that flaps back on during finalizing resumes following.
      return mode.kind === 'finalizing' ? { kind: 'following' } : mode;
    }

    case 'STREAM_ENDED': {
      if (mode.kind === 'following') {
        return { kind: 'finalizing', sinceMs: event.nowMs };
      }
      // pinned-latest deliberately survives stream end: short answers keep
      // their synthetic tail so the pinned turn never drops.
      return mode;
    }

    case 'FINALIZE_SETTLED': {
      return mode.kind === 'finalizing' ? READING_MODE : mode;
    }

    case 'SESSION_CHANGED': {
      if (event.isStreaming && event.latestTurnId) {
        return createStickyPinNavigation(event.latestTurnId);
      }
      return READING_MODE;
    }
  }
}

export function areViewportModesEqual(left: ViewportMode, right: ViewportMode): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'pinned-latest':
      return left.turnId === (right as Extract<ViewportMode, { kind: 'pinned-latest' }>).turnId;
    case 'finalizing':
      return left.sinceMs === (right as Extract<ViewportMode, { kind: 'finalizing' }>).sinceMs;
    case 'navigating':
      return (
        JSON.stringify(left.target) ===
        JSON.stringify((right as Extract<ViewportMode, { kind: 'navigating' }>).target)
      );
    default:
      return true;
  }
}
