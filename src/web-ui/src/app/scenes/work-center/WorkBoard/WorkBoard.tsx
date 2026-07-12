import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, FolderOpen, ListChecks, Plus, Trash2, X, XCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  IconButton,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkSurface } from '@/app/agentic-os/work/navigation/openWork';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useBackgroundProcesses } from '@/app/agentic-os/background-process/hooks/useBackgroundProcesses';
import type { BackgroundProcessKind } from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import type {
  ArtifactRef,
  ControlWorkAction,
  WorkKind,
  WorkRecord,
  WorkDeleteResult,
  WorkStatus,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import type { ScopedWorksResult } from '@/app/agentic-os/work/hooks/useScopedWorks';
import type { WorkspaceInfo } from '@/shared/types';
import type {
  WorkCenterAppFilter,
  WorkCenterGrouping,
  WorkCenterScope,
  WorkCenterWorkspaceFilter,
} from '@/app/stores/workDockStore';
import type { WorkAppRef } from '@/app/agentic-os/work/domain/workTypes';
import {
  getWorkCategory,
  getWorkPriorityGroup,
} from '@/app/agentic-os/work/domain/workClassification';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { appScopeFromWorkspacePath, systemAppScope } from '@/shared/types/app-scope';
import { externalRuntimeScope } from '@/shared/types/runtime-scope';
import { workspaceAPI } from '@/infrastructure/api/service-api/WorkspaceAPI';
import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import BoardHeader from './BoardHeader';
import RunningWorkProcessTable from './RunningWorkProcessTable';
import WorkDetailDialog from './WorkDetailDialog';
import './WorkBoard.scss';

const log = createLogger('WorkBoard');

interface WorkBoardProps {
  scope: WorkCenterScope;
  workspaces: WorkspaceInfo[];
  activeWorkspaces: WorkspaceInfo[];
  workspaceCounts: Map<string, { total: number; running: number; attention: number }>;
  workspaceFilter: WorkCenterWorkspaceFilter;
  appFilter: WorkCenterAppFilter;
  appOptions: Array<{ app: WorkAppRef; count: number }>;
  result: ScopedWorksResult;
  search: string;
  grouping: WorkCenterGrouping;
  collapsedGroups: string[];
  selectedWorkId: string | null;
  selectedArtifactId: string | null;
  onSearchChange: (value: string) => void;
  onScopeChange: (scope: WorkCenterScope) => void;
  onWorkspaceFilterChange: (filter: WorkCenterWorkspaceFilter) => void;
  onAppFilterChange: (filter: WorkCenterAppFilter) => void;
  onGroupingChange: (value: WorkCenterGrouping) => void;
  onToggleGroup: (key: string) => void;
  onSelectedWorkChange: (workId: string | null) => void;
  onCreateWork: () => void;
}

function kindKey(kind: WorkKind): string {
  return kind.replace(/_/g, '-');
}

function isCancellableStatus(status: WorkStatus): boolean {
  return status === 'running' || status === 'waiting_user' || status === 'blocked';
}

function timeBucket(timestamp: number): 'today' | 'week' | 'older' {
  const now = new Date();
  const date = new Date(timestamp);
  if (date.toDateString() === now.toDateString()) return 'today';
  if (now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'older';
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return normalized;
  if (index === 0) return '/';
  const parent = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

const GROUP_ORDER: Record<WorkCenterGrouping, string[]> = {
  priority: ['needs_attention', 'running', 'recurring', 'long_term', 'immediate', 'done'],
  status: ['waiting_user', 'blocked', 'failed', 'running', 'active', 'paused', 'draft', 'completed', 'cancelled', 'interrupted', 'archived'],
  kind: ['recurring', 'long_running_session', 'tracking', 'topic', 'app_workflow', 'multi_step', 'delegated_work', 'one_shot'],
  time: ['today', 'week', 'older'],
};

function buildGroups(
  works: WorkProjection[],
  grouping: WorkCenterGrouping
): Array<{ key: string; labelKey: string; items: WorkProjection[] }> {
  const map = new Map<string, WorkProjection[]>();
  for (const work of works) {
    const key =
      grouping === 'priority'
        ? getWorkPriorityGroup(work.kind, work.status)
        : grouping === 'status'
        ? work.status
        : grouping === 'time'
          ? timeBucket(work.updatedAt)
          : work.kind;
    const current = map.get(key);
    if (current) current.push(work);
    else map.set(key, [work]);
  }

  const order = GROUP_ORDER[grouping];
  return Array.from(map.entries())
    .sort(([left], [right]) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([key, items]) => ({
      key,
      labelKey:
        grouping === 'priority'
          ? `priority.${key}`
          : grouping === 'status'
            ? `status.${key}`
            : grouping === 'time'
              ? `time.${key}`
              : `kind.${kindKey(key as WorkKind)}`,
      items,
    }));
}

type WorkspaceCardStatus = 'attention' | 'running' | 'active' | 'quiet';

function getWorkspaceCardStatus(count: { total: number; running: number; attention: number }): WorkspaceCardStatus {
  if (count.attention > 0) return 'attention';
  if (count.running > 0) return 'running';
  if (count.total === 0) return 'quiet';
  return 'active';
}

const WorkBoard: React.FC<WorkBoardProps> = ({
  scope,
  workspaces,
  activeWorkspaces,
  workspaceCounts,
  workspaceFilter,
  appFilter,
  appOptions,
  result,
  search,
  grouping,
  collapsedGroups,
  selectedWorkId,
  selectedArtifactId,
  onSearchChange,
  onScopeChange,
  onWorkspaceFilterChange,
  onAppFilterChange,
  onGroupingChange,
  onToggleGroup,
  onSelectedWorkChange,
  onCreateWork,
}) => {
  const { t } = useI18n('scenes/work-center');
  const works = useWorkStore((state) => state.works);
  const worksLoaded = useWorkStore((state) => state.loaded);
  const getWork = useWorkStore((state) => state.getWork);
  const updateWork = useWorkStore((state) => state.updateWork);
  const advanceWork = useWorkStore((state) => state.advanceWork);
  const controlWork = useWorkStore((state) => state.controlWork);
  const deleteWork = useWorkStore((state) => state.deleteWork);
  const refreshWorks = useWorkStore((state) => state.refreshWorks);
  const {
    processes: backgroundProcesses,
    runProcess: runBackgroundProcess,
    refreshProcesses: refreshBackgroundProcesses,
  } = useBackgroundProcesses();
  const {
    openWorkspace,
    switchWorkspace,
    closeWorkspaceById,
    removeWorkspaceFromRecent,
  } = useWorkspaceContext();
  const [workspaceActionId, setWorkspaceActionId] = useState<string | null>(null);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [reclassifySubmittingId, setReclassifySubmittingId] = useState<string | null>(null);
  const [systemRunSubmittingKind, setSystemRunSubmittingKind] = useState<string | null>(null);
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [deleteDialogWorkIds, setDeleteDialogWorkIds] = useState<string[] | null>(null);
  const [deleteLinkedSessions, setDeleteLinkedSessions] = useState(true);

  const groups = useMemo(
    () => buildGroups(result.all, grouping),
    [grouping, result.all]
  );

  const selectedWorkIdSet = useMemo(
    () => new Set(selectedWorkIds),
    [selectedWorkIds]
  );

  const selectedWorks = useMemo(
    () => result.all.filter((work) => selectedWorkIdSet.has(work.id)),
    [result.all, selectedWorkIdSet]
  );

  const batchArchiveTargets = useMemo(
    () => selectedWorks.filter((work) => !work.systemManaged && work.status !== 'archived'),
    [selectedWorks]
  );

  const batchReopenTargets = useMemo(
    () => selectedWorks.filter((work) => !work.systemManaged && work.status === 'archived'),
    [selectedWorks]
  );

  const batchCancelTargets = useMemo(
    () => selectedWorks.filter((work) => !work.systemManaged && isCancellableStatus(work.status)),
    [selectedWorks]
  );

  const batchDeleteTargets = useMemo(
    () => selectedWorks.filter((work) => !work.systemManaged),
    [selectedWorks]
  );

  const selectedWorkCount = selectedWorks.length;
  const selectableWorkCount = result.all.length;
  const allVisibleWorkSelected = selectableWorkCount > 0 && selectedWorkCount === selectableWorkCount;
  const someVisibleWorkSelected = selectedWorkCount > 0 && selectedWorkCount < selectableWorkCount;

  const activeWorkspaceIds = useMemo(
    () => new Set(activeWorkspaces.map((workspace) => workspace.id)),
    [activeWorkspaces]
  );

  const historyWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !activeWorkspaceIds.has(workspace.id)),
    [activeWorkspaceIds, workspaces]
  );

  const visibleActiveWorkspaces = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeWorkspaces;
    return activeWorkspaces.filter((workspace) => (
      workspace.name.toLowerCase().includes(query)
      || workspace.rootPath.toLowerCase().includes(query)
      || workspace.identity?.emoji?.toLowerCase().includes(query)
    ));
  }, [activeWorkspaces, search]);

  const visibleHistoryWorkspaces = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return historyWorkspaces;
    return historyWorkspaces.filter((workspace) => (
      workspace.name.toLowerCase().includes(query)
      || workspace.rootPath.toLowerCase().includes(query)
      || workspace.identity?.emoji?.toLowerCase().includes(query)
    ));
  }, [historyWorkspaces, search]);

  const activeWorkspaceRunningCount = useMemo(
    () => [...visibleActiveWorkspaces, ...visibleHistoryWorkspaces].reduce(
      (total, workspace) => total + (workspaceCounts.get(workspace.id)?.running ?? 0),
      0
    ),
    [visibleActiveWorkspaces, visibleHistoryWorkspaces, workspaceCounts]
  );

  const selectedWork = useMemo(
    () => selectedWorkId ? works.find((work) => work.id === selectedWorkId) ?? null : null,
    [selectedWorkId, works]
  );
  const selectedProjectionIndex = useMemo(
    () => selectedWorkId ? result.all.findIndex((work) => work.id === selectedWorkId) : -1,
    [result.all, selectedWorkId]
  );
  const selectedProjection = selectedProjectionIndex >= 0
    ? result.all[selectedProjectionIndex]
    : null;
  const detailPosition = selectedProjectionIndex >= 0
    ? { current: selectedProjectionIndex + 1, total: result.all.length }
    : null;

  const showWorkspaceOverview = scope.kind === 'workspaces';

  useEffect(() => {
    if (showWorkspaceOverview) {
      setSelectedWorkIds([]);
      return;
    }
    const visibleIds = new Set(result.all.map((work) => work.id));
    setSelectedWorkIds((current) => {
      const next = current.filter((workId) => visibleIds.has(workId));
      return next.length === current.length ? current : next;
    });
  }, [result.all, showWorkspaceOverview]);

  useEffect(() => {
    if (!selectedWorkId) return;
    if (!worksLoaded) return;
    if (showWorkspaceOverview || !result.all.some((work) => work.id === selectedWorkId)) {
      onSelectedWorkChange(null);
    }
  }, [onSelectedWorkChange, result.all, selectedWorkId, showWorkspaceOverview, worksLoaded]);


  const handleOpenWorkspaceFilter = useCallback((workspace: WorkspaceInfo) => {
    onWorkspaceFilterChange({ kind: 'workspace', id: workspace.id });
    onScopeChange({ kind: 'open' });
  }, [onScopeChange, onWorkspaceFilterChange]);

  const handleBrowseWorkspace = useCallback(async () => {
    try {
      setOpeningWorkspace(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('workspaceOverview.openDialogTitle'),
      });
      if (!selected || typeof selected !== 'string') return;
      await openWorkspace(selected);
    } catch (error) {
      log.error('Failed to open workspace from Work Center', { error });
      notificationService.error(t('errors.openWorkspaceFailed'));
    } finally {
      setOpeningWorkspace(false);
    }
  }, [openWorkspace, t]);

  const handleSwitchWorkspace = useCallback(async (workspace: WorkspaceInfo) => {
    const actionId = `switch:${workspace.id}`;
    try {
      setWorkspaceActionId(actionId);
      await switchWorkspace(workspace);
    } catch (error) {
      log.error('Failed to switch workspace from Work Center', { workspaceId: workspace.id, error });
      notificationService.error(t('errors.switchWorkspaceFailed'));
    } finally {
      setWorkspaceActionId((current) => current === actionId ? null : current);
    }
  }, [switchWorkspace, t]);

  const handleCloseWorkspace = useCallback(async (workspace: WorkspaceInfo) => {
    const actionId = `close:${workspace.id}`;
    try {
      setWorkspaceActionId(actionId);
      await closeWorkspaceById(workspace.id);
    } catch (error) {
      log.error('Failed to close workspace from Work Center', { workspaceId: workspace.id, error });
      notificationService.error(t('errors.closeWorkspaceFailed'));
    } finally {
      setWorkspaceActionId((current) => current === actionId ? null : current);
    }
  }, [closeWorkspaceById, t]);

  const handleRemoveWorkspaceFromHistory = useCallback(async (workspace: WorkspaceInfo) => {
    const actionId = `remove:${workspace.id}`;
    try {
      setWorkspaceActionId(actionId);
      await removeWorkspaceFromRecent(workspace.id);
    } catch (error) {
      log.error('Failed to remove workspace history from Work Center', { workspaceId: workspace.id, error });
      notificationService.error(t('errors.removeWorkspaceFailed'));
    } finally {
      setWorkspaceActionId((current) => current === actionId ? null : current);
    }
  }, [removeWorkspaceFromRecent, t]);

  const handleSelectWork = useCallback((work: WorkProjection) => {
    onSelectedWorkChange(work.id);
    if (works.some((item) => item.id === work.id)) return;
    void getWork(work.id).catch((error) => {
      log.error('Failed to load work details from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.openFailed'));
    });
  }, [getWork, onSelectedWorkChange, t, works]);

  const handleSelectPreviousWork = useCallback(() => {
    if (selectedProjectionIndex <= 0) return;
    const previous = result.all[selectedProjectionIndex - 1];
    if (previous) handleSelectWork(previous);
  }, [handleSelectWork, result.all, selectedProjectionIndex]);

  const handleSelectNextWork = useCallback(() => {
    if (selectedProjectionIndex < 0 || selectedProjectionIndex >= result.all.length - 1) return;
    const next = result.all[selectedProjectionIndex + 1];
    if (next) handleSelectWork(next);
  }, [handleSelectWork, result.all, selectedProjectionIndex]);

  const handleOpenWorkRecord = useCallback(async (work: WorkRecord) => {
    try {
      await openWork(work);
    } catch (error) {
      log.error('Failed to open work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.openFailed'));
    }
  }, [t]);

  const handleOpenSurface = useCallback(async (work: WorkRecord, surface: WorkSurfaceRef) => {
    try {
      await openWorkSurface(surface, work.id, {
        scope: work.scope.kind === 'workspace'
          ? appScopeFromWorkspacePath(work.scope.workspacePath) ?? systemAppScope()
          : systemAppScope(),
      });
    } catch (error) {
      log.error('Failed to open work surface from Work Center', { workId: work.id, surfaceKind: surface.kind, error });
      notificationService.error(t('errors.openSurfaceFailed'));
    }
  }, [t]);

  const handleOpenArtifact = useCallback(async (artifact: ArtifactRef) => {
    const artifactUri = artifact.uri?.trim();
    if (!artifactUri) {
      notificationService.error(t('errors.openArtifactFailed'));
      return;
    }

    try {
      const metadata = await workspaceAPI.getFileMetadata(artifactUri);
      const targetPath = metadata.resolvedPath?.trim() || metadata.path;
      if (!targetPath) {
        throw new Error('Artifact path did not resolve to a local target');
      }

      if (metadata.isDir) {
        const scope = externalRuntimeScope(targetPath);
        if (!scope) {
          throw new Error('Artifact directory did not resolve to an external scope');
        }
        openWorkspaceScene('file-viewer', { scope });
        return;
      }

      if (metadata.isFile) {
        const parentPath = dirname(targetPath);
        const scope = externalRuntimeScope(parentPath);
        if (!scope) {
          throw new Error('Artifact file parent did not resolve to an external scope');
        }
        openFileInBestTarget({
          filePath: targetPath,
          fileName: artifact.label?.trim() || basename(targetPath),
          workspacePath: parentPath,
        }, {
          source: 'project-nav',
          scope,
        });
        return;
      }

      throw new Error('Artifact target is neither a file nor a directory');
    } catch (error) {
      log.error('Failed to open artifact from Work Center', { artifactId: artifact.id, artifactUri, error });
      notificationService.error(t('errors.openArtifactFailed'));
    }
  }, [t]);

  const handleCancelWork = useCallback(async (
    work: Pick<WorkProjection, 'id' | 'systemManaged'>
  ): Promise<boolean> => {
    if (work.systemManaged) return false;
    try {
      await controlWork({ workId: work.id, action: 'cancel_current_execution' });
      return true;
    } catch (error) {
      log.error('Failed to cancel work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.cancelFailed'));
      return false;
    }
  }, [controlWork, t]);

  const handleArchiveWork = useCallback(async (
    work: Pick<WorkProjection, 'id' | 'systemManaged'>
  ): Promise<boolean> => {
    if (work.systemManaged) return false;
    try {
      await controlWork({ workId: work.id, action: 'archive' });
      notificationService.success(t('messages.archived'), { duration: 2500 });
      return true;
    } catch (error) {
      log.error('Failed to archive work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.removeFailed'));
      return false;
    }
  }, [controlWork, t]);

  const handleReclassifyWork = useCallback(async (
    work: WorkRecord,
    kind: WorkKind
  ): Promise<boolean> => {
    if (work.systemManaged || work.kind === kind || reclassifySubmittingId) return false;
    try {
      setReclassifySubmittingId(work.id);
      await updateWork({ workId: work.id, kind });
      notificationService.success(t('detail.classify.updated'), { duration: 2500 });
      return true;
    } catch (error) {
      log.error('Failed to reclassify work from Work Center', { workId: work.id, kind, error });
      notificationService.error(t('errors.reclassifyFailed'));
      return false;
    } finally {
      setReclassifySubmittingId(null);
    }
  }, [reclassifySubmittingId, t, updateWork]);

  const handleRunSystemProcess = useCallback(async (kind: BackgroundProcessKind) => {
    if (systemRunSubmittingKind) return;
    try {
      setSystemRunSubmittingKind(kind);
      const response = await runBackgroundProcess(kind);
      if (response.started) {
        notificationService.success(t('background.messages.runStarted'), { duration: 2500 });
      } else {
        notificationService.warning(
          response.reason?.trim()
            ? t('background.messages.runSkipped', { reason: response.reason })
            : t('background.messages.runSkippedDefault'),
          { duration: 3000 }
        );
      }
      await Promise.all([
        refreshWorks(),
        refreshBackgroundProcesses(),
      ]);
    } catch (error) {
      log.error('Failed to run system process from Work Center', { kind, error });
      notificationService.error(t('background.messages.runFailed'));
    } finally {
      setSystemRunSubmittingKind(null);
    }
  }, [refreshBackgroundProcesses, refreshWorks, runBackgroundProcess, systemRunSubmittingKind, t]);

  const handleToggleWorkSelection = useCallback((workId: string, checked: boolean) => {
    setSelectedWorkIds((current) => {
      if (checked) {
        return current.includes(workId) ? current : [...current, workId];
      }
      return current.filter((id) => id !== workId);
    });
  }, []);

  const handleToggleAllVisibleWork = useCallback((checked: boolean) => {
    setSelectedWorkIds(checked ? result.all.map((work) => work.id) : []);
  }, [result.all]);

  const handleClearWorkSelection = useCallback(() => {
    setSelectedWorkIds([]);
  }, []);

  const handleBatchControl = useCallback(async (action: ControlWorkAction) => {
    const targets = action === 'archive'
      ? batchArchiveTargets
      : action === 'reopen'
        ? batchReopenTargets
        : batchCancelTargets;
    if (targets.length === 0 || batchSubmitting) return;

    setBatchSubmitting(true);
    const results = await Promise.allSettled(
      targets.map((work) => controlWork({ workId: work.id, action }))
    );
    const succeededIds = targets
      .filter((_, index) => results[index]?.status === 'fulfilled')
      .map((work) => work.id);
    const failedCount = results.filter((result) => result.status === 'rejected').length;

    if (succeededIds.length > 0) {
      const succeededSet = new Set(succeededIds);
      setSelectedWorkIds((current) => current.filter((workId) => !succeededSet.has(workId)));
    }

    if (failedCount > 0) {
      const firstFailure = results.find((result) => result.status === 'rejected');
      log.error('Failed to run batch work control from Work Center', {
        action,
        failedCount,
        error: firstFailure && firstFailure.status === 'rejected' ? firstFailure.reason : undefined,
      });
      notificationService.error(t('errors.bulkActionFailed', { count: failedCount }));
    } else {
      const messageKey = action === 'archive'
        ? 'messages.bulkArchived'
        : action === 'reopen'
          ? 'messages.bulkReopened'
          : 'messages.bulkCancelled';
      notificationService.success(t(messageKey, { count: succeededIds.length }), { duration: 2500 });
    }

    setBatchSubmitting(false);
  }, [
    batchArchiveTargets,
    batchCancelTargets,
    batchReopenTargets,
    batchSubmitting,
    controlWork,
    t,
  ]);

  const handleOpenDeleteDialog = useCallback(() => {
    if (batchDeleteTargets.length === 0 || batchSubmitting) return;
    setDeleteLinkedSessions(true);
    setDeleteDialogWorkIds(batchDeleteTargets.map((work) => work.id));
  }, [batchDeleteTargets, batchSubmitting]);

  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open && !batchSubmitting) {
      setDeleteLinkedSessions(true);
      setDeleteDialogWorkIds(null);
    }
  }, [batchSubmitting]);

  const handleConfirmDeleteSelected = useCallback(async () => {
    const workIds = deleteDialogWorkIds ?? [];
    if (workIds.length === 0 || batchSubmitting) return;

    setBatchSubmitting(true);
    const results = await Promise.allSettled(
      workIds.map((workId) => deleteWork(workId, { deleteLinkedSessions }))
    );
    const settledIds = workIds.filter((_, index) => results[index]?.status === 'fulfilled');
    const fulfilledResults = results.flatMap((result): WorkDeleteResult[] => (
      result.status === 'fulfilled' ? [result.value] : []
    ));
    const linkedSessionReports = fulfilledResults
      .flatMap((result) => result.cleanupReport.items)
      .filter((report) => (
        report.item.resource.kind === 'agent_session'
        && report.item.resource.ownership === 'linked'
        && report.item.action === 'delete'
      ));
    const linkedSessionDeletedCount = linkedSessionReports.filter(
      (report) => report.status === 'succeeded'
    ).length;
    const linkedSessionFailedCount = linkedSessionReports.filter((report) => (
      report.status === 'failed' || report.status === 'skipped'
    )).length;
    const failedCount = results.filter((result) => result.status === 'rejected').length;

    if (settledIds.length > 0) {
      const settledSet = new Set(settledIds);
      setSelectedWorkIds((current) => current.filter((workId) => !settledSet.has(workId)));
      if (selectedWorkId && settledSet.has(selectedWorkId)) {
        onSelectedWorkChange(null);
      }
    }

    if (failedCount > 0) {
      const firstFailure = results.find((result) => result.status === 'rejected');
      log.error('Failed to delete selected work from Work Center', {
        failedCount,
        error: firstFailure && firstFailure.status === 'rejected' ? firstFailure.reason : undefined,
      });
      notificationService.error(t('errors.bulkDeleteFailed', { count: failedCount }));
    } else {
      if (linkedSessionFailedCount > 0) {
        notificationService.warning(
          t('messages.bulkDeletedWithCleanupWarnings', {
            count: settledIds.length,
            failed: linkedSessionFailedCount,
          }),
          { duration: 3500 }
        );
      } else if (deleteLinkedSessions && linkedSessionDeletedCount > 0) {
        notificationService.success(
          t('messages.bulkDeletedWithSessions', {
            count: settledIds.length,
            sessions: linkedSessionDeletedCount,
          }),
          { duration: 2500 }
        );
      } else {
        notificationService.success(t('messages.bulkDeleted', { count: settledIds.length }), { duration: 2500 });
      }
      setDeleteLinkedSessions(true);
      setDeleteDialogWorkIds(null);
    }

    setBatchSubmitting(false);
  }, [
    batchSubmitting,
    deleteDialogWorkIds,
    deleteLinkedSessions,
    deleteWork,
    onSelectedWorkChange,
    selectedWorkId,
    t,
  ]);

  const handleSaveObjective = useCallback(async (
    work: WorkRecord,
    objective: string
  ): Promise<boolean> => {
    const nextObjective = objective.trim();
    if (!nextObjective) {
      notificationService.error(t('errors.objectiveRequired'));
      return false;
    }

    try {
      await updateWork({
        workId: work.id,
        objective: nextObjective,
      });
      notificationService.success(t('messages.objectiveSaved'), { duration: 2500 });
      return true;
    } catch (error) {
      log.error('Failed to update work objective from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.updateObjectiveFailed'));
      return false;
    }
  }, [t, updateWork]);

  const handleAdvanceWork = useCallback(async (
    work: WorkRecord,
    instruction: string
  ): Promise<boolean> => {
    const instructions = instruction.trim();
    if (!instructions) {
      notificationService.error(t('errors.advanceRequired'));
      return false;
    }

    try {
      await advanceWork({
        workId: work.id,
        instructions,
        advancePolicy: 'start_if_idle',
      });
      notificationService.success(t('messages.advanceSent'), { duration: 2500 });
      return true;
    } catch (error) {
      log.error('Failed to advance work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.advanceFailed'));
      return false;
    }
  }, [advanceWork, t]);

  const handleDialogControlWork = useCallback(async (
    work: WorkRecord,
    action: ControlWorkAction
  ): Promise<boolean> => {
    if (work.systemManaged) return false;
    try {
      await controlWork({ workId: work.id, action });
      if (action === 'resume') {
        notificationService.success(t('messages.resumed'), { duration: 2500 });
      } else if (action === 'reopen') {
        notificationService.success(t('messages.reopened'), { duration: 2500 });
      } else if (action === 'archive') {
        notificationService.success(t('messages.archived'), { duration: 2500 });
      }
      return true;
    } catch (error) {
      const errorKey = action === 'resume'
        ? 'errors.resumeFailed'
        : action === 'reopen'
          ? 'errors.reopenFailed'
          : action === 'cancel_current_execution'
            ? 'errors.cancelFailed'
            : 'errors.removeFailed';
      log.error('Failed to control work from detail dialog', { workId: work.id, action, error });
      notificationService.error(t(errorKey));
      return false;
    }
  }, [controlWork, t]);

  const visibleWorkspaceCount = visibleActiveWorkspaces.length + visibleHistoryWorkspaces.length;
  const headerTotalCount = showWorkspaceOverview ? visibleWorkspaceCount : result.totalCount;
  const headerRunningCount = showWorkspaceOverview ? activeWorkspaceRunningCount : result.runningCount;
  const hasSearch = search.trim().length > 0;
  const hasScopedFilter = scope.kind !== 'open' || workspaceFilter.kind !== 'all' || appFilter.kind !== 'all';
  const hasBoardFilters = hasSearch || hasScopedFilter;

  const handleClearBoardFilters = useCallback(() => {
    onScopeChange({ kind: 'open' });
    onWorkspaceFilterChange({ kind: 'all' });
    onAppFilterChange({ kind: 'all' });
    onSearchChange('');
  }, [onAppFilterChange, onScopeChange, onSearchChange, onWorkspaceFilterChange]);

  const handleShowAllWork = useCallback(() => {
    onScopeChange({ kind: 'all' });
    onWorkspaceFilterChange({ kind: 'all' });
    onAppFilterChange({ kind: 'all' });
    onSearchChange('');
  }, [onAppFilterChange, onScopeChange, onSearchChange, onWorkspaceFilterChange]);

  const renderBatchToolbar = () => {
    if (showWorkspaceOverview || selectableWorkCount === 0) return null;

    if (selectedWorkCount === 0) {
      return (
        <Checkbox
          className="ab-board__bulk-toggle-check"
          size="small"
          checked={false}
          disabled={batchSubmitting}
          onChange={() => handleToggleAllVisibleWork(true)}
          aria-label={t('bulk.selectAllVisible')}
        />
      );
    }

    return (
      <div
        className={['ab-board__bulk', selectedWorkCount > 0 && 'has-selection'].filter(Boolean).join(' ')}
        role="toolbar"
        aria-label={t('bulk.label')}
      >
        <Checkbox
          className="ab-board__bulk-check"
          size="small"
          checked={allVisibleWorkSelected}
          indeterminate={someVisibleWorkSelected}
          disabled={batchSubmitting}
          onChange={(event) => handleToggleAllVisibleWork(event.currentTarget.checked)}
          aria-label={t('bulk.selectAllVisible')}
        />
        <span className="ab-board__bulk-copy">
          {selectedWorkCount > 0
            ? t('bulk.selectedCount', { count: selectedWorkCount, total: selectableWorkCount })
            : t('bulk.selectHint', { count: selectableWorkCount })}
        </span>
        {selectedWorkCount > 0 ? (
          <>
            <span className="ab-board__bulk-divider" aria-hidden="true" />
            <div className="ab-board__bulk-actions">
              <IconButton
                className="ab-board__bulk-action"
                size="xs"
                variant="ghost"
                aria-label={t('bulk.archive', { count: batchArchiveTargets.length })}
                tooltip={t('bulk.archive', { count: batchArchiveTargets.length })}
                disabled={batchSubmitting || batchArchiveTargets.length === 0}
                onClick={() => void handleBatchControl('archive')}
              >
                <Archive size={13} />
              </IconButton>
              <IconButton
                className="ab-board__bulk-action"
                size="xs"
                variant="ghost"
                aria-label={t('bulk.reopen', { count: batchReopenTargets.length })}
                tooltip={t('bulk.reopen', { count: batchReopenTargets.length })}
                disabled={batchSubmitting || batchReopenTargets.length === 0}
                onClick={() => void handleBatchControl('reopen')}
              >
                <ArchiveRestore size={13} />
              </IconButton>
              <IconButton
                className="ab-board__bulk-action"
                size="xs"
                variant="ghost"
                aria-label={t('bulk.cancel', { count: batchCancelTargets.length })}
                tooltip={t('bulk.cancel', { count: batchCancelTargets.length })}
                disabled={batchSubmitting || batchCancelTargets.length === 0}
                onClick={() => void handleBatchControl('cancel_current_execution')}
              >
                <XCircle size={13} />
              </IconButton>
              <IconButton
                className="ab-board__bulk-action"
                size="xs"
                variant="danger"
                aria-label={t('bulk.delete')}
                tooltip={t('bulk.delete')}
                disabled={batchSubmitting || batchDeleteTargets.length === 0}
                onClick={handleOpenDeleteDialog}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          </>
        ) : null}
        <IconButton
          className="ab-board__bulk-action ab-board__bulk-close"
          size="xs"
          variant="ghost"
          aria-label={t('bulk.clearSelection')}
          tooltip={t('bulk.clearSelection')}
          disabled={batchSubmitting}
          onClick={handleClearWorkSelection}
        >
          <X size={13} />
        </IconButton>
      </div>
    );
  };

  const renderWorkspaceCard = (workspace: WorkspaceInfo, placement: 'active' | 'history', cardIndex: number) => {
    const count = workspaceCounts.get(workspace.id) ?? { total: 0, running: 0, attention: 0 };
    const selected = workspaceFilter.kind === 'workspace' && workspaceFilter.id === workspace.id;
    const workspaceStatus = getWorkspaceCardStatus(count);
    const statusModifier = workspaceStatus;
    const actionsBusy = workspaceActionId !== null || openingWorkspace;

    return (
      <article
        key={workspace.id}
        className={[
          'wc-card',
          'wc-card--workspace',
          `wc-card--ws-${statusModifier}`,
          selected && 'is-selected',
        ].filter(Boolean).join(' ')}
        style={{ '--wc-i': Math.min(cardIndex, 11) } as React.CSSProperties}
        onClick={() => handleOpenWorkspaceFilter(workspace)}
        tabIndex={0}
        role="button"
        aria-label={t('workspaceOverview.openWorkFor', { title: workspace.name })}
        aria-pressed={selected}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleOpenWorkspaceFilter(workspace);
          }
        }}
      >
        <span className="wc-card__top">
          <span className={`wc-card__status wc-card__status--${statusModifier}`}>
            <span className="wc-card__status-dot" aria-hidden="true" />
            {t(`workspaceOverview.status.${workspaceStatus}`)}
          </span>
          <span className="wc-card__top-actions">
            <IconButton
              className="wc-card__action"
              size="xs"
              variant="ghost"
              aria-label={placement === 'active' ? t('workspaceOverview.switchWorkspace') : t('workspaceOverview.openHistoryWorkspace')}
              tooltip={placement === 'active' ? t('workspaceOverview.switchWorkspace') : t('workspaceOverview.openHistoryWorkspace')}
              disabled={actionsBusy}
              onClick={(event) => {
                event.stopPropagation();
                void handleSwitchWorkspace(workspace);
              }}
            >
              <FolderOpen size={13} />
            </IconButton>
            {placement === 'active' ? (
              <IconButton
                className="wc-card__action"
                size="xs"
                variant="ghost"
                aria-label={t('workspaceOverview.closeWorkspace')}
                tooltip={t('workspaceOverview.closeWorkspace')}
                disabled={actionsBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCloseWorkspace(workspace);
                }}
              >
                <XCircle size={13} />
              </IconButton>
            ) : (
              <IconButton
                className="wc-card__action"
                size="xs"
                variant="ghost"
                aria-label={t('workspaceOverview.removeHistoryWorkspace')}
                tooltip={t('workspaceOverview.removeHistoryWorkspace')}
                disabled={actionsBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRemoveWorkspaceFromHistory(workspace);
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            )}
          </span>
        </span>
        <span className="wc-card__title">
          {workspace.identity?.emoji ? (
            <span className="wc-card__workspace-emoji" aria-hidden="true">{workspace.identity.emoji}</span>
          ) : null}
          {workspace.name}
        </span>
        <span className="wc-card__objective wc-card__workspace-path">{workspace.rootPath}</span>
        <span className="wc-card__meta">
          <span className="wc-card__kind">{t('workspaceOverview.workCount', { count: count.total })}</span>
          {count.running > 0 ? (
            <>
              <span className="wc-card__meta-rule" aria-hidden="true" />
              <span className="wc-card__time wc-card__time--running">
                {t('workspaceOverview.runningCount', { count: count.running })}
              </span>
            </>
          ) : null}
          {count.attention > 0 ? (
            <>
              <span className="wc-card__meta-rule" aria-hidden="true" />
              <span className="wc-card__time wc-card__time--attention">
                {t('workspaceOverview.attentionCount', { count: count.attention })}
              </span>
            </>
          ) : null}
        </span>
      </article>
    );
  };

  return (
    <section className="ab-board" aria-label={t('board.label')}>
      <BoardHeader
        scope={scope}
        workspaces={workspaces}
        workspaceFilter={workspaceFilter}
        appFilter={appFilter}
        appOptions={appOptions}
        totalCount={headerTotalCount}
        runningCount={headerRunningCount}
        search={search}
        grouping={grouping}
        showWorkControls={!showWorkspaceOverview && scope.kind !== 'running'}
        showWorkspaceFilter={!showWorkspaceOverview && scope.kind !== 'running'}
        searchPlaceholder={showWorkspaceOverview ? t('workspaceOverview.searchPlaceholder') : undefined}
        canClearFilters={hasBoardFilters}
        onSearchChange={onSearchChange}
        onWorkspaceFilterChange={onWorkspaceFilterChange}
        onAppFilterChange={onAppFilterChange}
        onClearFilters={handleClearBoardFilters}
        onGroupingChange={onGroupingChange}
        rightControls={renderBatchToolbar()}
      />
      {showWorkspaceOverview ? (
        <div className={[
          'ab-board__scroll',
          'ab-board__scroll--workspaces',
          visibleWorkspaceCount === 0 && 'ab-board__scroll--empty',
        ].filter(Boolean).join(' ')}>
          <div className="ab-workspace-overview">
            <div className="ab-workspace-overview__toolbar">
              <Button
                size="small"
                variant="secondary"
                onClick={() => void handleBrowseWorkspace()}
                disabled={openingWorkspace}
                isLoading={openingWorkspace}
                loadingLabel={t('workspaceOverview.openingWorkspace')}
              >
                <FolderOpen size={13} />
                {t('workspaceOverview.openWorkspace')}
              </Button>
            </div>

            {visibleWorkspaceCount === 0 ? (
              <div className="ab-board__empty ab-board__empty--workspaces">
                <ListChecks size={28} />
                <p>{workspaces.length === 0 ? t('workspaceOverview.empty') : t('workspaceOverview.noMatches')}</p>
                {hasSearch ? (
                  <div className="ab-board__empty-actions">
                    <Button size="small" variant="ghost" onClick={() => onSearchChange('')}>
                      <X size={13} />
                      {t('emptyState.clearSearch')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <section className="ab-workspace-section">
                  <div className="ab-workspace-section__head">
                    <span className="ab-workspace-section__title">{t('workspaceOverview.activeSection')}</span>
                    <span className="ab-workspace-section__count">{visibleActiveWorkspaces.length}</span>
                  </div>
                  {visibleActiveWorkspaces.length > 0 ? (
                    <div className="wc-group__grid">
                      {visibleActiveWorkspaces.map((workspace, index) => renderWorkspaceCard(workspace, 'active', index))}
                    </div>
                  ) : (
                    <div className="ab-workspace-section__empty">{t('workspaceOverview.noActive')}</div>
                  )}
                </section>

                <section className="ab-workspace-section">
                  <div className="ab-workspace-section__head">
                    <span className="ab-workspace-section__title">{t('workspaceOverview.historySection')}</span>
                    <span className="ab-workspace-section__count">{visibleHistoryWorkspaces.length}</span>
                  </div>
                  {visibleHistoryWorkspaces.length > 0 ? (
                    <div className="wc-group__grid">
                      {visibleHistoryWorkspaces.map((workspace, index) => renderWorkspaceCard(workspace, 'history', index))}
                    </div>
                  ) : (
                    <div className="ab-workspace-section__empty">{t('workspaceOverview.noHistory')}</div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      ) : (
      <div className={[
        'ab-board__content',
        scope.kind === 'running' && 'ab-board__content--process-table',
      ].filter(Boolean).join(' ')}>
      {scope.kind === 'running' ? (
        result.all.length === 0 ? (
          <div className={['ab-board__scroll', 'ab-board__scroll--empty'].filter(Boolean).join(' ')}>
            <div className="ab-board__empty">
              <ListChecks size={28} />
              <p>{hasSearch ? t('emptyState.noMatches') : t('emptyState.noRunning')}</p>
              <div className="ab-board__empty-actions">
                {hasSearch ? (
                  <Button size="small" variant="ghost" onClick={() => onSearchChange('')}>
                    <X size={13} />
                    {t('emptyState.clearSearch')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <RunningWorkProcessTable
            works={result.all}
            workspaces={workspaces}
            backgroundProcesses={backgroundProcesses}
            selectedWorkId={selectedWorkId}
            onSelectWork={handleSelectWork}
            onCancelWork={(work) => void handleCancelWork(work)}
            onRunSystemProcess={(kind) => void handleRunSystemProcess(kind)}
            systemRunSubmittingKind={systemRunSubmittingKind}
          />
        )
      ) : (
      <div className={['ab-board__scroll', result.all.length === 0 && 'ab-board__scroll--empty'].filter(Boolean).join(' ')}>
        {result.all.length === 0 ? (
          <div className="ab-board__empty">
            <ListChecks size={28} />
            {hasSearch ? (
              <p>{t('emptyState.noMatches')}</p>
            ) : null}
            <div className="ab-board__empty-actions">
              {hasSearch ? (
                <Button size="small" variant="ghost" onClick={() => onSearchChange('')}>
                  <X size={13} />
                  {t('emptyState.clearSearch')}
                </Button>
              ) : null}
              {hasScopedFilter ? (
                <Button size="small" variant="ghost" onClick={handleShowAllWork}>
                  <ListChecks size={13} />
                  {t('emptyState.showAllWork')}
                </Button>
              ) : null}
              {(hasSearch || hasScopedFilter) ? (
                <span className="ab-board__empty-actions-divider" role="presentation" />
              ) : null}
              <Button
                size="small"
                variant="ghost"
                className="ab-board__empty-create"
                onClick={onCreateWork}
              >
                <span className="ab-board__empty-create-flood" aria-hidden />
                <span className="ab-board__empty-create-icon" aria-hidden>
                  <Plus size={13} />
                </span>
                <span className="ab-board__empty-create-label">{t('actions.newWork')}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="ab-board__groups">
            {groups.map((group) => {
              const collapsed = collapsedGroups.includes(group.key);
              return (
                <section className="wc-group" key={group.key}>
                  <button
                    type="button"
                    className={['wc-group__head', collapsed && 'is-collapsed'].filter(Boolean).join(' ')}
                    onClick={() => onToggleGroup(group.key)}
                    aria-expanded={!collapsed}
                  >
                    <ChevronDown className="wc-group__chevron" size={13} aria-hidden="true" />
                    <span className="wc-group__title">{t(group.labelKey)}</span>
                    <span className="wc-group__count">{group.items.length}</span>
                  </button>
                  {!collapsed ? (
                    <div className="wc-group__grid">
                      {group.items.map((work, workIndex) => {
                        const showCancelAction = !work.systemManaged && isCancellableStatus(work.status);
                        const showArchiveAction = !work.systemManaged && work.status !== 'archived';
                        const category = getWorkCategory(work.kind);
                        const statusModifier = work.status.replace('_', '-');
                        const bulkSelected = selectedWorkIdSet.has(work.id);
                        const showBackgroundRuntime = work.systemManaged && work.status === 'running';
                        return (
                          <article
                            key={work.id}
                            className={[
                              'wc-card',
                              `wc-card--${statusModifier}`,
                              selectedWorkId === work.id && 'is-selected',
                              bulkSelected && 'is-bulk-selected',
                            ].filter(Boolean).join(' ')}
                            style={{ '--wc-i': Math.min(workIndex, 11) } as React.CSSProperties}
                            data-sparo-work-id={work.id}
                            data-sparo-work-title={work.title}
                            onClick={() => handleSelectWork(work)}
                            tabIndex={0}
                            role="button"
                            aria-label={t('detail.openDetailsFor', { title: work.title })}
                            aria-haspopup="dialog"
                            aria-expanded={selectedWorkId === work.id}
                            aria-selected={bulkSelected}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleSelectWork(work);
                              }
                            }}
                          >
                            <span className="wc-card__top">
                              <span className="wc-card__status-line">
                                <span
                                  className="wc-card__select"
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={bulkSelected}
                                    disabled={batchSubmitting}
                                    onChange={(event) => handleToggleWorkSelection(work.id, event.currentTarget.checked)}
                                    aria-label={t('bulk.selectWork', { title: work.title })}
                                  />
                                </span>
                                <span className={`wc-card__status wc-card__status--${statusModifier}`}>
                                  <span className="wc-card__status-dot" aria-hidden="true" />
                                  {showBackgroundRuntime
                                    ? t('runtime.background')
                                    : t(`status.${work.status}`)}
                                </span>
                                {work.systemManaged ? (
                                  <span className="wc-card__system-marker" title={t('rail.system')}>
                                    {t('rail.system')}
                                  </span>
                                ) : null}
                              </span>
                              {showArchiveAction || showCancelAction ? (
                                <span className="wc-card__top-actions">
                                  {showArchiveAction ? (
                                    <IconButton
                                      className="wc-card__action"
                                      size="xs"
                                      variant="ghost"
                                      shape="circle"
                                      aria-label={t('actions.removeWork')}
                                      tooltip={t('actions.removeWork')}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleArchiveWork(work);
                                      }}
                                    >
                                      <Archive size={13} />
                                    </IconButton>
                                  ) : null}
                                  {showCancelAction ? (
                                  <IconButton
                                    className="wc-card__action"
                                    size="xs"
                                    variant="ghost"
                                    shape="circle"
                                    aria-label={t('actions.cancelWork')}
                                    tooltip={t('actions.cancelWork')}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleCancelWork(work);
                                    }}
                                  >
                                    <XCircle size={13} />
                                  </IconButton>
                                  ) : null}
                                </span>
                              ) : null}
                            </span>
                            <span className="wc-card__title">{work.title}</span>
                            {work.objective ? (
                              <span className="wc-card__objective">{work.objective}</span>
                            ) : null}
                            <span className="wc-card__meta">
                              <span className="wc-card__kind">{t(`category.${category}`)}</span>
                              <span className="wc-card__meta-rule" aria-hidden="true" />
                              <span className="wc-card__time">{formatTime(work.updatedAt)}</span>
                            </span>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
      )}
      </div>
      )}
      <WorkDetailDialog
        open={selectedWorkId !== null}
        workId={selectedWorkId}
        work={selectedWork}
        fallbackTitle={selectedProjection?.title}
        works={works}
        workspaces={workspaces}
        selectedArtifactId={selectedArtifactId}
        position={detailPosition}
        canSelectPrevious={selectedProjectionIndex > 0}
        canSelectNext={selectedProjectionIndex >= 0 && selectedProjectionIndex < result.all.length - 1}
        backgroundProcesses={backgroundProcesses}
        systemRunSubmittingKind={systemRunSubmittingKind}
        reclassifySubmittingId={reclassifySubmittingId}
        onClose={() => onSelectedWorkChange(null)}
        onSelectPrevious={handleSelectPreviousWork}
        onSelectNext={handleSelectNextWork}
        onOpenWork={handleOpenWorkRecord}
        onOpenSurface={handleOpenSurface}
        onOpenArtifact={handleOpenArtifact}
        onSaveObjective={handleSaveObjective}
        onAppendInstruction={handleAdvanceWork}
        onControlWork={handleDialogControlWork}
        onReclassifyWork={handleReclassifyWork}
        onRunSystemProcess={handleRunSystemProcess}
      />
      <Dialog
        open={deleteDialogWorkIds !== null}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('bulk.deleteDialog.title', { count: deleteDialogWorkIds?.length ?? 0 })}
        size="small"
        closeLabel={t('bulk.deleteDialog.cancel')}
      >
        <DialogBody className="ab-bulk-delete-dialog__body">
          <p className="ab-bulk-delete-dialog__copy">
            {t('bulk.deleteDialog.description', { count: deleteDialogWorkIds?.length ?? 0 })}
          </p>
          <Checkbox
            className="ab-bulk-delete-dialog__option"
            size="small"
            checked={deleteLinkedSessions}
            disabled={batchSubmitting}
            onChange={(event) => setDeleteLinkedSessions(event.currentTarget.checked)}
            label={t('bulk.deleteDialog.deleteLinkedSessionsLabel')}
            description={t('bulk.deleteDialog.deleteLinkedSessionsDescription')}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            size="small"
            variant="ghost"
            disabled={batchSubmitting}
            onClick={() => {
              setDeleteLinkedSessions(true);
              setDeleteDialogWorkIds(null);
            }}
          >
            {t('bulk.deleteDialog.cancel')}
          </Button>
          <Button
            size="small"
            variant="danger"
            isLoading={batchSubmitting}
            loadingLabel={t('bulk.deleteDialog.deleting')}
            disabled={!deleteDialogWorkIds || deleteDialogWorkIds.length === 0 || batchSubmitting}
            onClick={() => void handleConfirmDeleteSelected()}
          >
            <Trash2 size={13} />
            {t('bulk.deleteDialog.confirm')}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
};

export default WorkBoard;
