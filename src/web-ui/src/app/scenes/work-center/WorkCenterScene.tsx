import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { useScopedWorks } from '@/app/agentic-os/work/hooks/useScopedWorks';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import type {
  WorkCenterAppFilter,
  WorkCenterScope,
  WorkCenterWorkspaceFilter,
} from '@/app/stores/workDockStore';
import type { WorkAppRef } from '@/app/agentic-os/work/domain/workTypes';
import {
  getWorkRailSection,
  isQueueEligibleWork,
  isWorkAttentionStatus,
  isWorkArchivedStatus,
  isWorkCompletedStatus,
  isWorkOpenStatus,
  isWorkRunningStatus,
  isWorkUnarchivedStatus,
  type WorkRailSection,
} from '@/app/agentic-os/work/domain/workClassification';
import { NewWorkDialog } from '@/app/components/WorkDock/NewWorkDialog';
import { filterUserWorkspaces } from './workCenter/workspaceFilters';
import ScopeRail from './ScopeRail/ScopeRail';
import WorkBoard from './WorkBoard/WorkBoard';
import './WorkCenterScene.scss';

const WorkCenterScene: React.FC = () => {
  const { openedWorkspacesList, recentWorkspaces } = useWorkspaceContext();
  const { projections, refreshWorks } = useWorks();
  const scope = useWorkDockStore((state) => state.workCenterScope);
  const setScope = useWorkDockStore((state) => state.setWorkCenterScope);
  const workspaceFilter = useWorkDockStore((state) => state.workCenterWorkspaceFilter);
  const setWorkspaceFilter = useWorkDockStore((state) => state.setWorkCenterWorkspaceFilter);
  const appFilter = useWorkDockStore((state) => state.workCenterAppFilter);
  const setAppFilter = useWorkDockStore((state) => state.setWorkCenterAppFilter);
  const grouping = useWorkDockStore((state) => state.workCenterGrouping);
  const setGrouping = useWorkDockStore((state) => state.setWorkCenterGrouping);
  const selectedWorkId = useWorkDockStore((state) => state.workCenterSelectedWorkId);
  const setSelectedWorkId = useWorkDockStore((state) => state.setWorkCenterSelectedWorkId);
  const selectedArtifactId = useWorkDockStore((state) => state.workCenterSelectedArtifactId);
  const setSelectedArtifactId = useWorkDockStore((state) => state.setWorkCenterSelectedArtifactId);
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

  // System matter status is synced from BackgroundProcess only on list_works.
  // Poll while viewing the global running list or system rail so live jobs
  // (daily letter, etc.) appear without waiting for an agent turn event.
  useEffect(() => {
    if (scope.kind !== 'running' && scope.kind !== 'system') return;
    void refreshWorks();
    const timer = window.setInterval(() => {
      void refreshWorks();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refreshWorks, scope.kind]);

  const appOptions = useMemo(() => {
    const map = new Map<string, { app: WorkAppRef; count: number }>();
    for (const work of projections) {
      for (const relation of work.appRefs) {
        const key = `${relation.app.kind}:${relation.app.appId}`;
        const current = map.get(key);
        if (current) current.count += 1;
        else map.set(key, { app: relation.app, count: 1 });
      }
    }
    return Array.from(map.values()).sort((left, right) => (
      left.app.appId.localeCompare(right.app.appId)
      || left.app.kind.localeCompare(right.app.kind)
    ));
  }, [projections]);

  useEffect(() => {
    if (appFilter.kind !== 'app') return;
    if (appOptions.some((option) => option.app.kind === appFilter.app.kind && option.app.appId === appFilter.app.appId)) {
      return;
    }
    setAppFilter({ kind: 'all' });
  }, [appFilter, appOptions, setAppFilter]);

  const scopedWorks = useScopedWorks(scope, workspaceFilter, appFilter, workspaces, search);

  const handleScopeChange = (nextScope: WorkCenterScope) => {
    setScope(nextScope);
    if (workspaceFilter.kind !== 'all') {
      setWorkspaceFilter({ kind: 'all' });
    }
    if (nextScope.kind === 'running') {
      // Global live list: group by kind so user vs system runs stay scannable.
      setGrouping('kind');
      if (appFilter.kind !== 'all') {
        setAppFilter({ kind: 'all' });
      }
      return;
    }
    if (
      nextScope.kind === 'attention'
      || nextScope.kind === 'completed'
      || nextScope.kind === 'archived'
    ) {
      setGrouping('status');
      return;
    }
    if (nextScope.kind === 'system' || nextScope.kind === 'topic') {
      setGrouping('kind');
      return;
    }
    if (
      nextScope.kind === 'open'
      || nextScope.kind === 'all'
      || nextScope.kind === 'category'
    ) {
      setGrouping(nextScope.kind === 'category' && nextScope.category === 'immediate' ? 'priority' : 'kind');
    }
  };

  const handleWorkspaceFilterChange = (nextFilter: WorkCenterWorkspaceFilter) => {
    setWorkspaceFilter(nextFilter);
    if (scope.kind === 'workspaces' && nextFilter.kind === 'workspace') {
      setScope({ kind: 'open' });
      setGrouping('priority');
    }
  };

  const handleAppFilterChange = (nextFilter: WorkCenterAppFilter) => {
    setAppFilter(nextFilter);
  };

  const handleSelectedWorkChange = (workId: string | null) => {
    setSelectedWorkId(workId);
    if (workId !== selectedWorkId) {
      setSelectedArtifactId(null);
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
    const railCounts = new Map<WorkRailSection, { total: number; running: number }>([
      ['immediate', { total: 0, running: 0 }],
      ['long_term', { total: 0, running: 0 }],
      ['topic', { total: 0, running: 0 }],
      ['recurring', { total: 0, running: 0 }],
      ['system', { total: 0, running: 0 }],
    ]);
    for (const work of projections) {
      const running = isWorkRunningStatus(work.status);
      const attention = isWorkAttentionStatus(work.status);
      const open = isWorkOpenStatus(work.status);
      const unarchived = isWorkUnarchivedStatus(work.status);
      const completed = isWorkCompletedStatus(work.status);
      const archived = isWorkArchivedStatus(work.status);
      const queueEligible = isQueueEligibleWork(work);
      if (open && queueEligible) openTotal += 1;
      if (unarchived && !work.systemManaged) unarchivedTotal += 1;
      if (completed && !work.systemManaged) completedTotal += 1;
      if (archived && !work.systemManaged) archivedTotal += 1;
      const rail = getWorkRailSection(work);
      const railCount = railCounts.get(rail);
      if (railCount && (rail === 'system' || open)) {
        railCount.total += 1;
        if (running) railCount.running += 1;
      }
      if (attention && queueEligible) attentionTotal += 1;
      if (running) runningTotal += 1;
      if (!work.workspacePath) {
        continue;
      }
      const workspace = workspaces.find((item) => item.rootPath === work.workspacePath);
      if (!workspace) continue;
      const count = workspaceCounts.get(workspace.id);
      if (!count) continue;
      if (archived || work.systemManaged) continue;
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
      railCounts,
    };
  }, [activeWorkspaces, projections, workspaces]);

  return (
    <div
      className="tds"
      data-testid="work-center-scene"
      data-selected-work-id={selectedWorkId ?? ''}
      data-selected-artifact-id={selectedArtifactId ?? ''}
    >
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
          railCounts={counts.railCounts}
          onScopeChange={handleScopeChange}
          onQuickCreateWork={() => setNewWorkDialogOpen(true)}
        />
        <WorkBoard
          scope={scope}
          workspaces={workspaces}
          activeWorkspaces={activeWorkspaces}
          workspaceCounts={counts.workspaceCounts}
          workspaceFilter={workspaceFilter}
          appFilter={appFilter}
          appOptions={appOptions}
          result={scopedWorks}
          search={search}
          grouping={grouping}
          collapsedGroups={collapsedGroups}
          selectedWorkId={selectedWorkId}
          selectedArtifactId={selectedArtifactId}
          onSearchChange={setSearch}
          onScopeChange={handleScopeChange}
          onWorkspaceFilterChange={handleWorkspaceFilterChange}
          onAppFilterChange={handleAppFilterChange}
          onGroupingChange={setGrouping}
          onToggleGroup={toggleGroup}
          onSelectedWorkChange={handleSelectedWorkChange}
          onCreateWork={() => setNewWorkDialogOpen(true)}
        />
      </div>
      <NewWorkDialog open={newWorkDialogOpen} onClose={() => setNewWorkDialogOpen(false)} />
    </div>
  );
};

export default WorkCenterScene;
