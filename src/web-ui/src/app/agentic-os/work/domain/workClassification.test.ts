import { describe, expect, it } from 'vitest';
import {
  getWorkCategory,
  getWorkPriorityGroup,
  getWorkRailSection,
  isDockEligibleWork,
} from './workClassification';

describe('workClassification', () => {
  it('treats app_workflow as immediate, not long-term', () => {
    expect(getWorkCategory('app_workflow')).toBe('immediate');
    expect(getWorkRailSection({ kind: 'app_workflow' })).toBe('immediate');
    expect(getWorkPriorityGroup('app_workflow', 'active')).toBe('immediate');
  });

  it('keeps explicit continuity kinds in long-term or topic/recurring rails', () => {
    expect(getWorkCategory('tracking')).toBe('long_term');
    expect(getWorkCategory('long_running_session')).toBe('long_term');
    expect(getWorkRailSection({ kind: 'topic' })).toBe('topic');
    expect(getWorkRailSection({ kind: 'recurring' })).toBe('recurring');
  });

  it('routes system-managed recurring works to the system rail', () => {
    expect(getWorkRailSection({ kind: 'recurring', systemManaged: true })).toBe('system');
  });

  it('excludes system and recurring works from the Work Dock', () => {
    expect(isDockEligibleWork({ kind: 'multi_step' })).toBe(true);
    expect(isDockEligibleWork({ kind: 'app_workflow' })).toBe(true);
    expect(isDockEligibleWork({ kind: 'recurring' })).toBe(false);
    expect(isDockEligibleWork({ kind: 'recurring', systemManaged: true })).toBe(false);
    expect(isDockEligibleWork({ kind: 'multi_step', systemManaged: true })).toBe(false);
  });
});
