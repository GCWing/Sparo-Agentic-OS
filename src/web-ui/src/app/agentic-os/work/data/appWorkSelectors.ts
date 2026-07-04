import type { AppScope } from '@/shared/types/app-scope';
import { workspacePathFromAppScope } from '@/shared/types/app-scope';
import type { WorkAppRef, WorkRecord, WorkScope, WorkStatus } from '../domain/workTypes';
import { sameAppRef } from '../domain/productAppRefs';

export interface BestAppWork {
  work: WorkRecord;
  score: number;
}

function sameApp(left: WorkAppRef, right: WorkAppRef): boolean {
  return sameAppRef(left, right);
}

export function workReferencesApp(work: WorkRecord, app: WorkAppRef): boolean {
  return (work.subject.kind === 'app' && sameApp(work.subject.app, app))
    || work.appRefs.some((relation) => sameApp(relation.app, app));
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  const workspacePath = workspacePathFromAppScope(scope);
  return workspacePath ? { kind: 'workspace', workspacePath } : { kind: 'system' };
}

function sameScope(left: WorkScope, right: WorkScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'system') return true;
  return right.kind === 'workspace' && left.workspacePath === right.workspacePath;
}

function statusScore(status: WorkStatus): number {
  switch (status) {
    case 'running':
      return 70;
    case 'waiting_user':
    case 'blocked':
      return 65;
    case 'active':
      return 55;
    case 'paused':
      return 45;
    case 'interrupted':
      return 35;
    case 'draft':
      return 25;
    case 'completed':
      return 10;
    case 'failed':
    case 'cancelled':
      return -20;
    case 'archived':
      return -100;
  }
}

export function selectBestWorksForApp(
  works: WorkRecord[],
  app: WorkAppRef,
  scope: AppScope,
  limit = 5,
): BestAppWork[] {
  const targetScope = workScopeFromAppScope(scope);
  return works
    .filter((work) => workReferencesApp(work, app))
    .map((work) => {
      const sameTargetScope = sameScope(work.scope, targetScope);
      const subjectBonus = work.subject.kind === 'app' && sameApp(work.subject.app, app) ? 100 : 0;
      const scopeBonus = sameTargetScope ? 40 : 0;
      const recencyBonus = Math.max(0, 20 - Math.floor((Date.now() - work.updatedAt) / 86_400_000));
      return {
        work,
        score: subjectBonus + scopeBonus + statusScore(work.status) + recencyBonus,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.work.updatedAt - left.work.updatedAt
      || left.work.title.localeCompare(right.work.title)
    ))
    .slice(0, limit);
}
