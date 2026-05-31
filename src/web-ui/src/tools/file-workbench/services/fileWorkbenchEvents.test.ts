import { describe, expect, it, vi } from 'vitest';
import type { FileOperationPlan } from '@/infrastructure/api';
import {
  FILE_WORKBENCH_REVIEW_PLAN_EVENT,
  consumePendingFileWorkbenchPlanReview,
  dispatchFileWorkbenchPlanReview,
  isFileWorkbenchPlanReviewEvent,
} from './fileWorkbenchEvents';

function samplePlan(): FileOperationPlan {
  return {
    id: 'plan-test',
    title: 'Review archive',
    scope: { kind: 'system', root: 'C:/tmp' },
    cwd: 'C:/tmp',
    createdBy: 'agent',
    createdAt: '2026-05-31T00:00:00.000Z',
    status: 'draft',
    summary: {
      total: 1,
      highRiskCount: 0,
      conflictCount: 0,
    },
    items: [
      {
        id: 'item-test',
        operationType: 'archive',
        sourcePath: 'C:/tmp/report.md',
        targetPath: 'C:/tmp/report.zip',
        reason: 'Package the file',
        risk: 'low',
        requiresConfirmation: true,
        included: true,
        conflicts: [],
      },
    ],
  };
}

describe('fileWorkbenchEvents', () => {
  it('stores a pending plan review and emits a typed browser event', () => {
    const windowTarget = new EventTarget();
    class TestCustomEvent<T> extends Event {
      detail: T;

      constructor(type: string, init: CustomEventInit<T>) {
        super(type);
        this.detail = init.detail as T;
      }
    }
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('CustomEvent', TestCustomEvent);

    const listener = vi.fn((event: Event) => {
      expect(isFileWorkbenchPlanReviewEvent(event)).toBe(true);
    });
    window.addEventListener(FILE_WORKBENCH_REVIEW_PLAN_EVENT, listener);

    const detail = { plan: samplePlan(), source: 'tool-card' as const };
    dispatchFileWorkbenchPlanReview(detail);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumePendingFileWorkbenchPlanReview()).toEqual(detail);
    expect(consumePendingFileWorkbenchPlanReview()).toBeNull();

    window.removeEventListener(FILE_WORKBENCH_REVIEW_PLAN_EVENT, listener);
    vi.unstubAllGlobals();
  });
});
