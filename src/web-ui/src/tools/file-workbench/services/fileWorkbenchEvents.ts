import type { FileOperationPlan } from '@/infrastructure/api';

export const FILE_WORKBENCH_REVIEW_PLAN_EVENT = 'sparo:file-workbench:review-plan';

export interface FileWorkbenchPlanReviewDetail {
  plan: FileOperationPlan;
  source: 'tool-card' | 'files-scene' | 'test';
}

let pendingPlanReview: FileWorkbenchPlanReviewDetail | null = null;

export function isFileWorkbenchPlanReviewEvent(
  event: Event,
): event is CustomEvent<FileWorkbenchPlanReviewDetail> {
  if (event.type !== FILE_WORKBENCH_REVIEW_PLAN_EVENT) {
    return false;
  }

  const detail = (event as CustomEvent<FileWorkbenchPlanReviewDetail>).detail;
  return Boolean(
    detail &&
    detail.plan &&
    typeof detail.plan.id === 'string' &&
    Array.isArray(detail.plan.items),
  );
}

export function dispatchFileWorkbenchPlanReview(
  detail: FileWorkbenchPlanReviewDetail,
): void {
  pendingPlanReview = detail;

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(FILE_WORKBENCH_REVIEW_PLAN_EVENT, { detail }));
}

export function consumePendingFileWorkbenchPlanReview(): FileWorkbenchPlanReviewDetail | null {
  const detail = pendingPlanReview;
  pendingPlanReview = null;
  return detail;
}
