import type { PetRenderAction, PetSpriteAction, PetSpriteSecondaryMotion } from './petTypes';

export const PETDEX_COLUMNS = 8;
export const PETDEX_ROWS = 9;

interface PetActionDefinition {
  row: number;
  frames: number;
  durationMs: number;
  secondary: PetSpriteSecondaryMotion;
}

export const PETDEX_ACTIONS: Record<PetSpriteAction, PetActionDefinition> = {
  idle: { row: 0, frames: 6, durationMs: 2400, secondary: 'breathe' },
  'running-right': { row: 1, frames: 8, durationMs: 780, secondary: 'drag' },
  'running-left': { row: 2, frames: 8, durationMs: 780, secondary: 'drag' },
  waving: { row: 3, frames: 4, durationMs: 980, secondary: 'hover' },
  jumping: { row: 4, frames: 5, durationMs: 860, secondary: 'jump' },
  failed: { row: 5, frames: 8, durationMs: 1320, secondary: 'sad' },
  waiting: { row: 6, frames: 6, durationMs: 1720, secondary: 'hover' },
  running: { row: 7, frames: 6, durationMs: 1160, secondary: 'work' },
  review: { row: 8, frames: 6, durationMs: 1720, secondary: 'hover' },
};

export function resolvePetRenderAction(
  action: PetSpriteAction,
  motionSpeed = 0,
): PetRenderAction {
  const definition = PETDEX_ACTIONS[action] ?? PETDEX_ACTIONS.idle;
  const speedRatio = action === 'running-left' || action === 'running-right'
    ? Math.min(1, Math.max(0, motionSpeed / 1200))
    : 0;
  const durationMs = Math.max(240, Math.round(definition.durationMs - speedRatio * 340));
  const frameEnd = `${(definition.frames * 100 / (PETDEX_COLUMNS - 1)).toFixed(6)}%`;

  return {
    action,
    ...definition,
    durationMs,
    frameEnd,
  };
}
