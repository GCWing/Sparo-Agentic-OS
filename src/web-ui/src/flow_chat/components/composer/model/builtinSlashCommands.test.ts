import { describe, expect, it } from 'vitest';
import {
  buildInputForSelectedBuiltinSlashCommand,
  getBuiltinSlashActionItems,
  isExactBuiltinSlashCommand,
  matchesBuiltinSlashCommand,
  resolveTypedBuiltinSlashCommand,
  type BuiltinSlashCommandContext,
  type BuiltinSlashCommandTranslator,
} from './builtinSlashCommands';

const t: BuiltinSlashCommandTranslator = (_key, options) => options.defaultValue;

const goalCapableContext: BuiltinSlashCommandContext = {
  isBtwSession: false,
  supportsGoal: true,
};

const agenticOsContext: BuiltinSlashCommandContext = {
  isBtwSession: false,
  supportsGoal: false,
};

describe('builtin slash commands', () => {
  it('lists /goal only when the current target supports goals', () => {
    expect(getBuiltinSlashActionItems(t, goalCapableContext, '').map(item => item.command))
      .toContain('/goal');
    expect(getBuiltinSlashActionItems(t, agenticOsContext, '').map(item => item.command))
      .not.toContain('/goal');
  });

  it('filters builtin actions by command and label', () => {
    expect(getBuiltinSlashActionItems(t, goalCapableContext, 'g').map(item => item.command))
      .toContain('/goal');
    expect(getBuiltinSlashActionItems(t, goalCapableContext, 'side').map(item => item.command))
      .toEqual(['/btw']);
  });

  it('fills argument-taking commands with a trailing space', () => {
    expect(buildInputForSelectedBuiltinSlashCommand('goal', '/g', goalCapableContext))
      .toBe('/goal ');
    expect(buildInputForSelectedBuiltinSlashCommand('btw', '/b existing question', goalCapableContext))
      .toBe('/btw existing question');
  });

  it('does not fill /goal when goals are not supported', () => {
    expect(buildInputForSelectedBuiltinSlashCommand('goal', '/g', agenticOsContext))
      .toBeNull();
  });

  it('matches complete command tokens only', () => {
    expect(matchesBuiltinSlashCommand('/btw explain this', 'btw')).toBe(true);
    expect(matchesBuiltinSlashCommand('/btwhy is this', 'btw')).toBe(false);
    expect(isExactBuiltinSlashCommand('/compact  ', 'compact')).toBe(true);
    expect(isExactBuiltinSlashCommand('/compact now', 'compact')).toBe(false);
  });

  it('resolves typed /goal only for goal-capable targets', () => {
    expect(resolveTypedBuiltinSlashCommand('/goal status', goalCapableContext)?.id).toBe('goal');
    expect(resolveTypedBuiltinSlashCommand('/goal status', agenticOsContext)).toBeNull();
  });
});
