import { describe, expect, it } from 'vitest';
import {
  DelegatedWorkIcon,
  IntelligentAppWorkIcon,
  LongRunningWorkIcon,
  MultiStepWorkIcon,
  NormalWorkIcon,
  RecurringWorkIcon,
  SystemWorkIcon,
  TopicWorkIcon,
} from '@/design-system';
import { getWorkKindIcon, getWorkTypeIcon } from './workTypeIcon';

describe('workTypeIcon', () => {
  it.each([
    ['one_shot', NormalWorkIcon],
    ['multi_step', MultiStepWorkIcon],
    ['long_running_session', LongRunningWorkIcon],
    ['recurring', RecurringWorkIcon],
    ['tracking', LongRunningWorkIcon],
    ['topic', TopicWorkIcon],
    ['app_workflow', IntelligentAppWorkIcon],
    ['delegated_work', DelegatedWorkIcon],
  ] as const)('maps %s to its system icon', (kind, expectedIcon) => {
    expect(getWorkKindIcon(kind)).toBe(expectedIcon);
  });

  it('uses the frameless system icon for system-managed work', () => {
    expect(getWorkTypeIcon({ kind: 'recurring', systemManaged: true })).toBe(SystemWorkIcon);
  });
});
