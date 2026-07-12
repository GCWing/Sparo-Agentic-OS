/**
 * Pure viewport mode machine. The scheduler owns layout contracts and side
 * effects; this reducer is the single authority for current scroll behavior.
 */

import {
  areLatestTurnLayoutOwnersEqual,
  type LatestTurnLayoutOwner,
} from './FlowViewportGeometry';

export type ViewportNavigationTarget =
  | {
      type: 'latest-turn-top';
      owner: LatestTurnLayoutOwner;
      behavior: ScrollBehavior;
    }
  | { type: 'turn-top'; turnId: string; behavior: ScrollBehavior }
  | { type: 'index-center'; index: number; behavior: ScrollBehavior }
  | { type: 'latest-end'; behavior: ScrollBehavior };

export type ViewportMode =
  | { kind: 'reading' }
  | { kind: 'pinned-latest'; owner: LatestTurnLayoutOwner }
  | { kind: 'following' }
  | { kind: 'finalizing'; sinceMs: number }
  | { kind: 'navigating'; target: ViewportNavigationTarget };

export type ViewportEvent =
  | { type: 'TURN_SUBMITTED'; owner: LatestTurnLayoutOwner }
  | { type: 'LATEST_TURN_CHANGED' }
  | { type: 'PIN_FLOOR_CONSUMED' }
  | { type: 'USER_SCROLL_UP' }
  | { type: 'USER_SCROLL_DOWN_WITH_CONTENT' }
  | { type: 'USER_REACHED_OUTPUT_END' }
  | { type: 'USER_REACHED_LATEST_LAYOUT' }
  | { type: 'USER_JUMP_LATEST' }
  | { type: 'NAVIGATE'; target: ViewportNavigationTarget }
  | { type: 'NAVIGATION_SETTLED'; nowMs: number; ownerEpoch?: number }
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_ENDED'; nowMs: number }
  | { type: 'FINALIZE_SETTLED' }
  | {
      type: 'SESSION_ENTERED';
      owner: LatestTurnLayoutOwner | null;
      initialTargetTurnId: string | null;
    };

export interface ViewportContext {
  isStreaming: boolean;
  latestTurnId: string | null;
  latestTurnLayoutOwner: LatestTurnLayoutOwner | null;
}

export const READING_MODE: ViewportMode = { kind: 'reading' };

function createLatestTurnNavigation(
  owner: LatestTurnLayoutOwner,
  behavior: ScrollBehavior = 'auto',
): ViewportMode {
  return {
    kind: 'navigating',
    target: { type: 'latest-turn-top', owner, behavior },
  };
}

function isCurrentLatestOwner(
  owner: LatestTurnLayoutOwner,
  context: ViewportContext,
): boolean {
  return (
    owner.turnId === context.latestTurnId &&
    areLatestTurnLayoutOwnersEqual(owner, context.latestTurnLayoutOwner)
  );
}

export function reduceViewportMode(
  mode: ViewportMode,
  event: ViewportEvent,
  context: ViewportContext,
): ViewportMode {
  switch (event.type) {
    case 'TURN_SUBMITTED': {
      if (
        mode.kind === 'pinned-latest' &&
        areLatestTurnLayoutOwnersEqual(mode.owner, event.owner)
      ) {
        return mode;
      }
      if (
        mode.kind === 'navigating' &&
        mode.target.type === 'latest-turn-top' &&
        areLatestTurnLayoutOwnersEqual(mode.target.owner, event.owner)
      ) {
        return mode;
      }
      return createLatestTurnNavigation(event.owner);
    }

    case 'LATEST_TURN_CHANGED':
      return READING_MODE;

    case 'NAVIGATE': {
      if (
        mode.kind === 'navigating' &&
        areNavigationTargetsEqual(mode.target, event.target)
      ) {
        return mode;
      }
      if (
        mode.kind === 'pinned-latest' &&
        event.target.type === 'latest-turn-top' &&
        areLatestTurnLayoutOwnersEqual(mode.owner, event.target.owner)
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
      if (target.type === 'latest-turn-top') {
        if (
          event.ownerEpoch !== target.owner.epoch ||
          !isCurrentLatestOwner(target.owner, context)
        ) {
          return mode;
        }
        return { kind: 'pinned-latest', owner: target.owner };
      }
      if (target.type === 'latest-end') {
        return context.isStreaming ? { kind: 'following' } : READING_MODE;
      }
      return READING_MODE;
    }

    case 'PIN_FLOOR_CONSUMED':
      return mode.kind === 'pinned-latest' && context.isStreaming
        ? { kind: 'following' }
        : mode;

    case 'USER_SCROLL_UP':
      return mode.kind === 'reading' ? mode : READING_MODE;

    case 'USER_SCROLL_DOWN_WITH_CONTENT':
      return mode.kind === 'pinned-latest' || mode.kind === 'navigating'
        ? READING_MODE
        : mode;

    case 'USER_REACHED_OUTPUT_END': {
      if (mode.kind !== 'reading') {
        return mode;
      }
      if (context.isStreaming) {
        return { kind: 'following' };
      }
      return mode;
    }

    case 'USER_REACHED_LATEST_LAYOUT': {
      if (mode.kind !== 'reading' || context.isStreaming) {
        return mode;
      }
      const owner = context.latestTurnLayoutOwner;
      return owner && isCurrentLatestOwner(owner, context)
        ? createLatestTurnNavigation(owner)
        : mode;
    }

    case 'USER_JUMP_LATEST': {
      const owner = context.latestTurnLayoutOwner;
      if (!context.isStreaming && owner && isCurrentLatestOwner(owner, context)) {
        return createLatestTurnNavigation(owner, 'smooth');
      }
      return {
        kind: 'navigating',
        target: { type: 'latest-end', behavior: 'smooth' },
      };
    }

    case 'STREAM_STARTED':
      return mode.kind === 'finalizing' ? { kind: 'following' } : mode;

    case 'STREAM_ENDED': {
      if (mode.kind === 'following') {
        return { kind: 'finalizing', sinceMs: event.nowMs };
      }
      return mode;
    }

    case 'FINALIZE_SETTLED':
      return mode.kind === 'finalizing' ? READING_MODE : mode;

    case 'SESSION_ENTERED': {
      const owner = event.owner;
      if (!owner) {
        return READING_MODE;
      }
      if (event.initialTargetTurnId && event.initialTargetTurnId !== owner.turnId) {
        return {
          kind: 'navigating',
          target: {
            type: 'turn-top',
            turnId: event.initialTargetTurnId,
            behavior: 'auto',
          },
        };
      }
      return createLatestTurnNavigation(owner);
    }
  }
}

function areNavigationTargetsEqual(
  left: ViewportNavigationTarget,
  right: ViewportNavigationTarget,
): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case 'latest-turn-top': {
      const candidate = right as Extract<ViewportNavigationTarget, { type: 'latest-turn-top' }>;
      return (
        areLatestTurnLayoutOwnersEqual(left.owner, candidate.owner) &&
        left.behavior === candidate.behavior
      );
    }
    case 'turn-top': {
      const candidate = right as Extract<ViewportNavigationTarget, { type: 'turn-top' }>;
      return left.turnId === candidate.turnId && left.behavior === candidate.behavior;
    }
    case 'index-center': {
      const candidate = right as Extract<ViewportNavigationTarget, { type: 'index-center' }>;
      return left.index === candidate.index && left.behavior === candidate.behavior;
    }
    case 'latest-end': {
      const candidate = right as Extract<ViewportNavigationTarget, { type: 'latest-end' }>;
      return left.behavior === candidate.behavior;
    }
  }
}

export function areViewportModesEqual(left: ViewportMode, right: ViewportMode): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'pinned-latest':
      return areLatestTurnLayoutOwnersEqual(
        left.owner,
        (right as Extract<ViewportMode, { kind: 'pinned-latest' }>).owner,
      );
    case 'finalizing':
      return left.sinceMs === (right as Extract<ViewportMode, { kind: 'finalizing' }>).sinceMs;
    case 'navigating':
      return areNavigationTargetsEqual(
        left.target,
        (right as Extract<ViewportMode, { kind: 'navigating' }>).target,
      );
    default:
      return true;
  }
}
