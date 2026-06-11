import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { useScopedWorks } from '@/app/agentic-os/work/hooks/useScopedWorks';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type { WorkCenterScope, WorkCenterWorkspaceFilter } from '@/app/stores/workDockStore';
import {
  getWorkCategory,
  isWorkAttentionStatus,
  isWorkArchivedStatus,
  isWorkCompletedStatus,
  isWorkOpenStatus,
  isWorkRunningStatus,
  isWorkUnarchivedStatus,
  type WorkCategory,
} from '@/app/agentic-os/work/domain/workClassification';
import { NewWorkDialog } from '@/app/components/WorkDock/NewWorkDialog';
import { filterUserWorkspaces } from './workCenter/workspaceFilters';
import ScopeRail from './ScopeRail/ScopeRail';
import WorkBoard from './WorkBoard/WorkBoard';
import './WorkCenterScene.scss';

const WorkCenterScene: React.FC = () => {
  const { openedWorkspacesList, recentWorkspaces } = useWorkspaceContext();
  const { projections } = useWorks();
  const scope = useWorkDockStore((state) => state.workCenterScope);
  const setScope = useWorkDockStore((state) => state.setWorkCenterScope);
  const workspaceFilter = useWorkDockStore((state) => state.workCenterWorkspaceFilter);
  const setWorkspaceFilter = useWorkDockStore((state) => state.setWorkCenterWorkspaceFilter);
  const grouping = useWorkDockStore((state) => state.workCenterGrouping);
  const setGrouping = useWorkDockStore((state) => state.setWorkCenterGrouping);
  const selectedWorkId = useWorkDockStore((state) => state.workCenterSelectedWorkId);
  const setSelectedWorkId = useWorkDockStore((state) => state.setWorkCenterSelectedWorkId);
  const collapsedGroups = useWorkDockStore((state) => state.workCenterCollapsedGroups);
  const toggleGroup = useWorkDockStore((state) => state.toggleWorkCenterGroupCollapsed);
  const [search, setSearch] = useState('');
  const [newWorkDialogOpen, setNewWorkDialogOpen] = useState(false);

  const workspaces = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...openedWorkspacesList, ...recentWorkspaces]
      .filter((workspace) => {
        if (seen.has(workspace.id)) return false;
        seen.add(workspace.id);
        return true;
      });
    return filterUserWorkspaces(merged);
  }, [openedWorkspacesList, recentWorkspaces]);

  const activeWorkspaces = useMemo(
    () => filterUserWorkspaces(openedWorkspacesList),
    [openedWorkspacesList]
  );

  useEffect(() => {
    if (workspaceFilter.kind !== 'workspace') return;
    if (workspaces.some((workspace) => workspace.id === workspaceFilter.id)) return;
    setWorkspaceFilter({ kind: 'all' });
  }, [setWorkspaceFilter, workspaceFilter, workspaces]);

  const scopedWorks = useScopedWorks(scope, workspaceFilter, workspaces, search);

  const handleScopeChange = (nextScope: WorkCenterScope) => {
    setScope(nextScope);
    if (workspaceFilter.kind !== 'all') {
      setWorkspaceFilter({ kind: 'all' });
    }
    if (
      nextScope.kind === 'attention'
      || nextScope.kind === 'running'
      || nextScope.kind === 'completed'
      || nextScope.kind === 'archived'
    ) {
      setGrouping('status');
      return;
    }
    if (nextScope.kind === 'open' || nextScope.kind === 'all' || nextScope.kind === 'category') {
      setGrouping('priority');
    }
  };

  const handleWorkspaceFilterChange = (nextFilter: WorkCenterWorkspaceFilter) => {
    setWorkspaceFilter(nextFilter);
    if (scope.kind === 'workspaces' && nextFilter.kind === 'workspace') {
      setScope({ kind: 'open' });
      setGrouping('priority');
    }
  };

  const counts = useMemo(() => {
    const workspaceCounts = new Map<string, { total: number; running: number; attention: number }>();
    const activeWorkspaceIds = new Set(activeWorkspaces.map((workspace) => workspace.id));
    for (const workspace of workspaces) {
      workspaceCounts.set(workspace.id, { total: 0, running: 0, attention: 0 });
    }
    let attentionTotal = 0;
    let runningTotal = 0;
    let openTotal = 0;
    let unarchivedTotal = 0;
    let completedTotal = 0;
    let archivedTotal = 0;
    let activeWorkspaceRunningTotal = 0;
    const categoryCounts = new Map<WorkCategory, { total: number; running: number }>([
      ['immediate', { total: 0, running: 0 }],
      ['long_term', { total: 0, running: 0 }],
      ['recurring', { total: 0, running: 0 }],
    ]);
    for (const work of projections) {
      const running = isWorkRunningStatus(work.status);
      const attention = isWorkAttentionStatus(work.status);
      const open = isWorkOpenStatus(work.status);
      const unarchived = isWorkUnarchivedStatus(work.status);
      const completed = isWorkCompletedStatus(work.status);
      const archived = isWorkArchivedStatus(work.status);
      if (open) openTotal += 1;
      if (unarchived) unarchivedTotal += 1;
      if (completed) completedTotal += 1;
      if (archived) archivedTotal += 1;
      const category = getWorkCategory(work.kind);
      const categoryCount = categoryCounts.get(category);
      if (open && categoryCount) {
        categoryCount.total += 1;
        if (running) categoryCount.running += 1;
      }
      if (attention) attentionTotal += 1;
      if (running) runningTotal += 1;
      if (!work.workspacePath) {
        continue;
      }
      const workspace = workspaces.find((item) => item.rootPath === work.workspacePath);
      if (!workspace) continue;
      const count = workspaceCounts.get(workspace.id);
      if (!count) continue;
      if (archived) continue;
      count.total += 1;
      if (running) count.running += 1;
      if (attention) count.attention += 1;
      if (activeWorkspaceIds.has(workspace.id)) {
        if (running) activeWorkspaceRunningTotal += 1;
      }
    }
    return {
      workspaceCounts,
      attentionTotal,
      runningTotal,
      openTotal,
      unarchivedTotal,
      completedTotal,
      archivedTotal,
      activeWorkspaceRunningTotal,
      categoryCounts,
    };
  }, [activeWorkspaces, projections, workspaces]);

  return (
    <div className="tds" data-testid="work-center-scene">
      <div className="tds-layout tds-layout--v2">
        <ScopeRail
          scope={scope}
          openTotal={counts.openTotal}
          attentionTotal={counts.attentionTotal}
          runningTotal={counts.runningTotal}
          unarchivedTotal={counts.unarchivedTotal}
          completedTotal={counts.completedTotal}
          archivedTotal={counts.archivedTotal}
          activeWorkspaceCount={activeWorkspaces.length}
          workspaceHistoryCount={Math.max(0, workspaces.length - activeWorkspaces.length)}
          activeWorkspaceRunningTotal={counts.activeWorkspaceRunningTotal}
          categoryCounts={counts.categoryCounts}
          onScopeChange={handleScopeChange}
          onQuickCreateWork={() => setNewWorkDialogOpen(true)}
        />
        <WorkBoard
          scope={scope}
          workspaces={workspaces}
          activeWorkspaces={activeWorkspaces}
          workspaceCounts={counts.workspaceCounts}
          workspaceFilter={workspaceFilter}
          result={scopedWorks}
          search={search}
          grouping={grouping}
          collapsedGroups={collapsedGroups}
          selectedWorkId={selectedWorkId}
          onSearchChange={setSearch}
          onScopeChange={handleScopeChange}
          onWorkspaceFilterChange={handleWorkspaceFilterChange}
          onGroupingChange={setGrouping}
          onToggleGroup={toggleGroup}
          onSelectedWorkChange={setSelectedWorkId}
          onCreateWork={() => setNewWorkDialogOpen(true)}
        />
      </div>
      <NewWorkDialog open={newWorkDialogOpen} onClose={() => setNewWorkDialogOpen(false)} />
    </div>
  );
};

export default WorkCenterScene;
