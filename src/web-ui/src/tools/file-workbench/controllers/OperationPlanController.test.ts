import { describe, expect, it } from 'vitest';
import { fileEntryFromFsEntry } from '../services/fileClassification';
import { createReadOnlyPlanDraft } from './OperationPlanController';

describe('OperationPlanController', () => {
  it('creates non-executable draft items until a concrete plan is confirmed', () => {
    const entry = fileEntryFromFsEntry({
      path: '/work/a.txt',
      name: 'a.txt',
      kind: 'file',
      size: 12,
      readonly: false,
      hidden: false,
    }, { kind: 'workspace', root: '/work' });

    const plan = createReadOnlyPlanDraft({ kind: 'workspace', root: '/work' }, '/work', [entry], 'Review');

    expect(plan.status).toBe('draft');
    expect(plan.items[0]).toMatchObject({
      sourcePath: '/work/a.txt',
      requiresConfirmation: true,
      included: false,
    });
  });
});
