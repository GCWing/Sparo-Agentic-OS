import { describe, expect, it } from 'vitest';
import {
  canEditGoalHeaderObjective,
  getGoalHeaderControlActions,
  isTerminalGoalHeaderState,
} from './goalHeaderActions';

describe('goalHeaderActions', () => {
  it('limits completed goals to clear-only controls', () => {
    expect(getGoalHeaderControlActions({ visualState: 'completed' })).toEqual(['clear']);
    expect(canEditGoalHeaderObjective('completed')).toBe(false);
  });

  it('limits cancelled goals to clear-only controls', () => {
    expect(getGoalHeaderControlActions({ visualState: 'cancelled' })).toEqual(['clear']);
    expect(canEditGoalHeaderObjective('cancelled')).toBe(false);
  });

  it('keeps active and paused goals actionable', () => {
    expect(getGoalHeaderControlActions({ visualState: 'active' })).toEqual(['pause', 'review', 'clear']);
    expect(getGoalHeaderControlActions({ visualState: 'paused' })).toEqual(['resume', 'review', 'clear']);
    expect(canEditGoalHeaderObjective('active')).toBe(true);
  });

  it('treats only durable terminal states as terminal', () => {
    expect(isTerminalGoalHeaderState('completed')).toBe(true);
    expect(isTerminalGoalHeaderState('cancelled')).toBe(true);
    expect(isTerminalGoalHeaderState('blocked')).toBe(false);
    expect(isTerminalGoalHeaderState('failed')).toBe(false);
  });
});
