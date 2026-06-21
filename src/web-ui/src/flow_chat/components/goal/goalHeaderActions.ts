import type { GoalControlAction } from '@/infrastructure/api';

export type GoalHeaderVisualState =
  | 'extracting'
  | 'active'
  | 'reviewing'
  | 'paused'
  | 'needs_input'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

const TERMINAL_GOAL_HEADER_STATES = new Set<GoalHeaderVisualState>([
  'completed',
  'cancelled',
]);

export function isTerminalGoalHeaderState(state: GoalHeaderVisualState): boolean {
  return TERMINAL_GOAL_HEADER_STATES.has(state);
}

export function canEditGoalHeaderObjective(state: GoalHeaderVisualState): boolean {
  return !isTerminalGoalHeaderState(state);
}

export function getGoalHeaderControlActions(input: {
  visualState: GoalHeaderVisualState;
}): GoalControlAction[] {
  if (isTerminalGoalHeaderState(input.visualState)) {
    return ['clear'];
  }

  if (input.visualState === 'paused') {
    return ['resume', 'review', 'clear'];
  }

  return ['pause', 'review', 'clear'];
}
