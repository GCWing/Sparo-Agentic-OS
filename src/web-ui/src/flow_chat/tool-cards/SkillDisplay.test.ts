import { describe, expect, it } from 'vitest';
import { resolveSkillDisplayName } from './skillDisplayName';

describe('resolveSkillDisplayName', () => {
  it('uses suite metadata returned by the Skill tool', () => {
    expect(resolveSkillDisplayName(
      { suite_id: 'ppt-design', suite_name: 'PPT presentation design' },
      { command: 'suite:ppt-design' },
      'Unknown skill',
    )).toBe('PPT presentation design');
  });

  it('keeps the suite command readable before the result arrives', () => {
    expect(resolveSkillDisplayName(
      null,
      { command: 'suite:ppt-presentation-design' },
      'Unknown skill',
    )).toBe('ppt-presentation-design');
  });
});
