import { useMemo } from 'react';
import type { WorkspaceInfo } from '@/shared/types';
import type { WorkCenterScope, WorkCenterWorkspaceFilter } from '@/app/stores/workDockStore';
import { useWorks } from './useWorks';
import { filterWorkProjections } from '../data/workSelectors';
import type { WorkProjection } from '../projections/workProjection';
import {
  getWorkCategory,
  isWorkAttentionStatus,
  isWorkArchivedStatus,
  isWorkCompletedStatus,
  isWorkOpenStatus,
  isWorkRunningStatus,
  isWorkUnarchivedStatus,
} from '../domain/workClassification';

export interface ScopedWorksResult {
  groups: Array<{ kind: WorkProjection['kind']; items: WorkProjection[] }>;
  all: WorkProjection[];
  runningCount: number;
  totalCount: number;
}

export function useScopedWorks(
  scope: WorkCenterScope,
  workspaceFilter: WorkCenterWorkspaceFilter,
  workspaces: WorkspaceInfo[],
  searchQuery: string
): ScopedWorksResult {
  const { projections } = useWorks();

  return useMemo(() => {
    const scoped = projections.filter((work) => {
      if (scope.kind === 'open') return isWorkOpenStatus(work.status);
      if (scope.kind === 'attention') return isWorkAttentionStatus(work.status);
      if (scope.kind === 'running') return isWorkRunningStatus(work.status);
      if (scope.kind === 'all' || scope.kind === 'workspaces') return isWorkUnarchivedStatus(work.status);
      if (scope.kind === 'completed') return isWorkCompletedStatus(work.status);
      if (scope.kind === 'archived') return isWorkArchivedStatus(work.status);
      if (scope.kind === 'category') {
        return isWorkOpenStatus(work.status) && getWorkCategory(work.kind) === scope.category;
      }
      return true;
    }).filter((work) => {
      if (workspaceFilter.kind === 'all') return true;
      const workspace = workspaces.find((item) => item.id === workspaceFilter.id);
      return Boolean(workspace && work.workspacePath === workspace.rootPath);
    });
    const all = filterWorkProjections(scoped, searchQuery);
    const map = new Map<WorkProjection['kind'], WorkProjection[]>();
    for (const work of all) {
      const bucket = map.get(work.kind);
      if (bucket) bucket.push(work);
      else map.set(work.kind, [work]);
    }
    return {
      groups: Array.from(map.entries()).map(([kind, items]) => ({ kind, items })),
      all,
      runningCount: all.filter((work) => isWorkRunningStatus(work.status)).length,
      totalCount: all.length,
    };
  }, [projections, scope, searchQuery, workspaceFilter, workspaces]);
}
