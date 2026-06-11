import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, Check, ChevronDown, FolderOpen, ListChecks, Pencil, Plus, Send, Trash2, X, XCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  IconButton,
  Textarea,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork, openWorkSurface } from '@/app/agentic-os/work/navigation/openWork';
import type {
  WorkExecutionSource,
  WorkExecutionBindingStatus,
  WorkKind,
  WorkLifecycleEvent,
  WorkRecord,
  WorkStatus,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import { resolveEffectiveWorkStatus } from '@/app/agentic-os/work/domain/workStatus';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import type { ScopedWorksResult } from '@/app/agentic-os/work/hooks/useScopedWorks';
import type { WorkspaceInfo } from '@/shared/types';
import type {
  WorkCenterGrouping,
  WorkCenterScope,
  WorkCenterWorkspaceFilter,
} from '@/app/stores/workDockStore';
import {
  getWorkCategory,
  getWorkPriorityGroup,
} from '@/app/agentic-os/work/domain/workClassification';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import BoardHeader from './BoardHeader';
import './WorkBoard.scss';

const log = createLogger('WorkBoard');

type WorkCenterTranslator = (key: string, params?: Record<string, string | number>) => string;

interface WorkBoardProps {
  scope: WorkCenterScope;
  workspaces: WorkspaceInfo[];
  activeWorkspaces: WorkspaceInfo[];
  workspaceCounts: Map<string, { total: number; running: number; attention: number }>;
  workspaceFilter: WorkCenterWorkspaceFilter;
  result: ScopedWorksResult;
  search: string;
  grouping: WorkCenterGrouping;
  collapsedGroups: string[];
  selectedWorkId: string | null;
  onSearchChange: (value: string) => void;
  onScopeChange: (scope: WorkCenterScope) => void;
  onWorkspaceFilterChange: (filter: WorkCenterWorkspaceFilter) => void;
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

function getSurfaceLabelKey(surface: WorkSurfaceRef): string {
  switch (surface.kind) {
    case 'work_session':
      return 'detail.surface.workSession';
    case 'agent_session':
      return 'detail.surface.agentSession';
    case 'live_app':
      return 'detail.surface.liveApp';
    case 'work_center':
      return 'detail.surfaces';
    case 'application_surface':
      return 'detail.surface.application';
    case 'os_agent_home':
      return 'detail.surface.agentHome';
  }
}

function getSurfaceReference(surface: WorkSurfaceRef): string | null {
  switch (surface.kind) {
    case 'work_session':
    case 'agent_session':
      return surface.sessionId;
    case 'live_app':
      return surface.appId;
    case 'application_surface':
      return surface.surfaceId;
    case 'os_agent_home':
    case 'work_center':
      return null;
  }
}

function getSurfaceKey(surface: WorkSurfaceRef): string {
  const reference = getSurfaceReference(surface);
  if (reference) return `${surface.kind}:${reference}`;
  if (surface.kind === 'work_center') return `${surface.kind}:${surface.workId}`;
  if (surface.kind === 'os_agent_home') return `${surface.kind}:${surface.dispatcherSessionId ?? 'home'}`;
  return surface.kind;
}

function getAssignmentLabel(work: WorkRecord, t: WorkCenterTranslator): string {
  const assignment = work.assignment;
  if (!assignment) return t('detail.assignment.unassigned');
  if (assignment.kind === 'agent') {
    return t('detail.assignment.agent', { label: assignment.agentType ?? t('detail.assignment.unknown') });
  }
  if (assignment.kind === 'assistant') {
    return t('detail.assignment.assistant', { label: assignment.assistantId ?? t('detail.assignment.unknown') });
  }
  if (assignment.kind === 'application') {
    return t('detail.assignment.application', { label: assignment.applicationId ?? t('detail.assignment.unknown') });
  }
  if (assignment.kind === 'human') {
    return t('detail.assignment.human', { label: assignment.humanLabel ?? t('detail.assignment.unknown') });
  }
  return t('detail.assignment.external', { label: assignment.externalLabel ?? t('detail.assignment.unknown') });
}

function getWorkWorkspaceLabel(work: WorkRecord, workspaces: WorkspaceInfo[], t: WorkCenterTranslator): string {
  const scope = work.scope;
  if (scope.kind === 'system') return t('detail.globalWorkspace');
  const workspace = workspaces.find((item) => item.rootPath === scope.workspacePath);
  return workspace ? getWorkspaceDisplayName(workspace) : scope.workspacePath;
}

function getExecutionSourceLabel(source: WorkExecutionSource, t: WorkCenterTranslator): string {
  switch (source.source) {
    case 'agent_session_run':
      return t('detail.executionSource.agentSessionRun');
    case 'delegated_work_run':
      return t('detail.executionSource.delegatedWorkRun');
    case 'live_app_worker':
      return t('detail.executionSource.liveAppWorker');
    case 'application_action':
      return t('detail.executionSource.applicationAction');
    case 'runtime_subagent_run':
      return t('detail.executionSource.runtimeSubagentRun');
    case 'external':
      return source.label || t('detail.executionSource.external');
  }
}

function getExecutionSourceReference(source: WorkExecutionSource): string | null {
  switch (source.source) {
    case 'agent_session_run':
      return source.turnId ?? source.sessionId;
    case 'delegated_work_run':
      return source.childWorkId;
    case 'live_app_worker':
      return source.workerId ?? source.appId;
    case 'application_action':
      return `${source.applicationId}:${source.actionId}`;
    case 'runtime_subagent_run':
      return source.runId;
    case 'external':
      return source.reference || null;
  }
}

const LIFECYCLE_LABEL_KEYS: Record<string, string> = {
  'created': 'detail.lifecycleEvent.created',
  'advanced': 'detail.lifecycleEvent.advanced',
  'paused': 'detail.lifecycleEvent.paused',
  'resumed': 'detail.lifecycleEvent.resumed',
  'archived': 'detail.lifecycleEvent.archived',
  'reopened': 'detail.lifecycleEvent.reopened',
  'status updated': 'detail.lifecycleEvent.statusUpdated',
  'live app workflow started': 'detail.lifecycleEvent.liveAppWorkflowStarted',
  'current execution cancelled': 'detail.lifecycleEvent.currentExecutionCancelled',
  'agent session continued': 'detail.lifecycleEvent.agentSessionContinued',
  'agent session turn completed': 'detail.lifecycleEvent.agentSessionTurnCompleted',
  'agent session turn cancelled': 'detail.lifecycleEvent.agentSessionTurnCancelled',
  'agent session failed': 'detail.lifecycleEvent.agentSessionFailed',
  'agent session waiting for user': 'detail.lifecycleEvent.agentSessionWaitingUser',
  'agent session resumed': 'detail.lifecycleEvent.agentSessionResumed',
};

function getLifecycleEventLabel(event: WorkLifecycleEvent, t: WorkCenterTranslator): string {
  const label = event.label.trim();
  if (!label) return t(`status.${event.status}`);

  const normalized = label.toLowerCase();
  const failurePrefix = 'agent session failed:';
  if (normalized.startsWith(failurePrefix)) {
    return t('detail.lifecycleEvent.agentSessionFailedWithReason', {
      reason: label.slice(failurePrefix.length).trim(),
    });
  }

  const labelKey = LIFECYCLE_LABEL_KEYS[normalized];
  return labelKey ? t(labelKey) : label;
}

const GROUP_ORDER: Record<WorkCenterGrouping, string[]> = {
  priority: ['needs_attention', 'running', 'recurring', 'long_term', 'immediate', 'done'],
  status: ['waiting_user', 'blocked', 'failed', 'running', 'active', 'paused', 'draft', 'completed', 'archived'],
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

function getDetailActivityTone(status: WorkStatus | WorkExecutionBindingStatus): 'neutral' | 'running' | 'attention' | 'success' | 'danger' {
  if (status === 'failed') return 'danger';
  if (status === 'waiting_user' || status === 'blocked') return 'attention';
  if (status === 'running' || status === 'queued') return 'running';
  if (status === 'completed') return 'success';
  return 'neutral';
}

const WorkBoard: React.FC<WorkBoardProps> = ({
  scope,
  workspaces,
  activeWorkspaces,
  workspaceCounts,
  workspaceFilter,
  result,
  search,
  grouping,
  collapsedGroups,
  selectedWorkId,
  onSearchChange,
  onScopeChange,
  onWorkspaceFilterChange,
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
  const {
    openWorkspace,
    switchWorkspace,
    closeWorkspaceById,
    removeWorkspaceFromRecent,
  } = useWorkspaceContext();
  const [workspaceActionId, setWorkspaceActionId] = useState<string | null>(null);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [objectiveDialogWorkId, setObjectiveDialogWorkId] = useState<string | null>(null);
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [advanceDraft, setAdvanceDraft] = useState('');
  const [advanceDialogWorkId, setAdvanceDialogWorkId] = useState<string | null>(null);
  const [advanceSubmitting, setAdvanceSubmitting] = useState(false);
  const [copiedSurfaceKey, setCopiedSurfaceKey] = useState<string | null>(null);
  const objectiveTextareaRef = useRef<HTMLTextAreaElement>(null);
  const advanceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  const groups = useMemo(
    () => buildGroups(result.all, grouping),
    [grouping, result.all]
  );

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

  const showWorkspaceOverview = scope.kind === 'workspaces';

  useEffect(() => {
    if (!selectedWorkId) return;
    if (!worksLoaded) return;
    if (showWorkspaceOverview || !result.all.some((work) => work.id === selectedWorkId)) {
      onSelectedWorkChange(null);
    }
  }, [onSelectedWorkChange, result.all, selectedWorkId, showWorkspaceOverview, worksLoaded]);

  useEffect(() => {
    setAdvanceDraft('');
    setAdvanceDialogWorkId(null);
    setObjectiveDialogWorkId(null);
    setObjectiveDraft('');
    setCopiedSurfaceKey(null);
  }, [selectedWorkId]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCopyReference = useCallback(async (surfaceKey: string, reference: string) => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopiedSurfaceKey(surfaceKey);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => setCopiedSurfaceKey(null), 1600);
    } catch (error) {
      log.error('Failed to copy surface reference', { reference, error });
    }
  }, []);

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
      await openWorkSurface(surface, work.id);
    } catch (error) {
      log.error('Failed to open work surface from Work Center', { workId: work.id, surfaceKind: surface.kind, error });
      notificationService.error(t('errors.openSurfaceFailed'));
    }
  }, [t]);

  const handleCancelWork = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ workId: work.id, action: 'cancel_current_execution' });
    } catch (error) {
      log.error('Failed to cancel work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.cancelFailed'));
    }
  }, [controlWork, t]);

  const handleRemoveWork = useCallback(async (work: WorkProjection) => {
    try {
      await controlWork({ workId: work.id, action: 'archive' });
    } catch (error) {
      log.error('Failed to remove work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.removeFailed'));
    }
  }, [controlWork, t]);

  const handleOpenObjectiveDialog = useCallback((work: WorkRecord) => {
    setObjectiveDialogWorkId(work.id);
    setObjectiveDraft(work.objective);
  }, []);

  const handleCloseObjectiveDialog = useCallback(() => {
    setObjectiveDialogWorkId(null);
    setObjectiveDraft('');
  }, []);

  const handleObjectiveDialogOpenChange = useCallback((open: boolean) => {
    if (open) return;
    if (!objectiveSaving) {
      handleCloseObjectiveDialog();
    }
  }, [handleCloseObjectiveDialog, objectiveSaving]);

  const handleAdvanceDialogOpenChange = useCallback((open: boolean) => {
    if (open) return;
    if (!advanceSubmitting) {
      setAdvanceDialogWorkId(null);
      setAdvanceDraft('');
    }
  }, [advanceSubmitting]);

  const handleCloseAdvanceDialog = useCallback(() => {
    setAdvanceDialogWorkId(null);
    setAdvanceDraft('');
  }, []);

  const handleSaveObjective = useCallback(async (work: WorkRecord) => {
    const nextObjective = objectiveDraft.trim();
    if (!nextObjective) {
      notificationService.error(t('errors.objectiveRequired'));
      return;
    }

    try {
      setObjectiveSaving(true);
      await updateWork({
        workId: work.id,
        objective: nextObjective,
      });
      setObjectiveDialogWorkId(null);
      setObjectiveDraft('');
      notificationService.success(t('messages.objectiveSaved'), { duration: 2500 });
    } catch (error) {
      log.error('Failed to update work objective from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.updateObjectiveFailed'));
    } finally {
      setObjectiveSaving(false);
    }
  }, [objectiveDraft, t, updateWork]);

  const handleAdvanceWork = useCallback(async (work: WorkRecord) => {
    const instructions = advanceDraft.trim();
    if (!instructions) {
      notificationService.error(t('errors.advanceRequired'));
      return;
    }

    try {
      setAdvanceSubmitting(true);
      await advanceWork({
        workId: work.id,
        instructions,
        advancePolicy: 'start_if_idle',
      });
      setAdvanceDraft('');
      setAdvanceDialogWorkId(null);
      notificationService.success(t('messages.advanceSent'), { duration: 2500 });
    } catch (error) {
      log.error('Failed to advance work from Work Center', { workId: work.id, error });
      notificationService.error(t('errors.advanceFailed'));
    } finally {
      setAdvanceSubmitting(false);
    }
  }, [advanceDraft, advanceWork, t]);

  const visibleWorkspaceCount = visibleActiveWorkspaces.length + visibleHistoryWorkspaces.length;
  const headerTotalCount = showWorkspaceOverview ? visibleWorkspaceCount : result.totalCount;
  const headerRunningCount = showWorkspaceOverview ? activeWorkspaceRunningCount : result.runningCount;
  const hasSearch = search.trim().length > 0;
  const hasScopedFilter = scope.kind !== 'open' || workspaceFilter.kind !== 'all';
  const hasBoardFilters = hasSearch || hasScopedFilter;

  const handleClearBoardFilters = useCallback(() => {
    onScopeChange({ kind: 'open' });
    onWorkspaceFilterChange({ kind: 'all' });
    onSearchChange('');
  }, [onScopeChange, onSearchChange, onWorkspaceFilterChange]);

  const handleShowAllWork = useCallback(() => {
    onScopeChange({ kind: 'all' });
    onWorkspaceFilterChange({ kind: 'all' });
    onSearchChange('');
  }, [onScopeChange, onSearchChange, onWorkspaceFilterChange]);

  const renderWorkDetail = (work: WorkRecord) => {
    const status = resolveEffectiveWorkStatus(work);
    const statusModifier = status.replace(/_/g, '-');
    const category = getWorkCategory(work.kind);
    const canCancel = isCancellableStatus(status);
    const canArchive = status !== 'archived';
    const canAdvance = status !== 'archived';
    const rawSurfaces = work.surfaces.length > 0 ? work.surfaces : [work.primarySurface];
    const seenSurfaceKeys = new Set<string>();
    const surfaces = rawSurfaces.filter((surface) => {
      if (surface.kind === 'work_center') return false;
      const key = getSurfaceKey(surface);
      if (seenSurfaceKeys.has(key)) return false;
      seenSurfaceKeys.add(key);
      return true;
    });
    const objectiveDialogOpen = objectiveDialogWorkId === work.id;
    const workspaceLabel = getWorkWorkspaceLabel(work, workspaces, t);
    const assignmentLabel = getAssignmentLabel(work, t);
    const referenceCounts = [
      work.artifactRefs.length > 0 ? t('detail.artifacts', { count: work.artifactRefs.length }) : null,
      work.memoryRefs.length > 0 ? t('detail.memories', { count: work.memoryRefs.length }) : null,
      work.sessionRefs.length > 0 ? t('detail.sessions', { count: work.sessionRefs.length }) : null,
    ].filter((item): item is string => item !== null);
    const advanceDialogOpen = advanceDialogWorkId === work.id;
    const activityItems = [
      ...work.executionBindings.map((execution) => ({
        id: `execution:${execution.id}`,
        label: t(`detail.executionStatus.${execution.status}`),
        meta: getExecutionSourceLabel(execution.source, t),
        reference: getExecutionSourceReference(execution.source),
        time: execution.updatedAt || execution.createdAt,
        tone: getDetailActivityTone(execution.status),
      })),
      ...work.lifecycle.events.map((event, index) => ({
        id: `event:${event.status}:${event.at}:${index}`,
        label: getLifecycleEventLabel(event, t),
        meta: t('detail.lifecycle'),
        reference: null,
        time: event.at,
        tone: getDetailActivityTone(event.status),
      })),
    ].sort((left, right) => right.time - left.time).slice(0, 6);

    return (
      <>
      <aside className="ab-detail" aria-label={t('detail.label')} key={work.id}>
        <header className="ab-detail__header">
          <div className="ab-detail__status-row">
            {/* Keyed by status: a live status change replays the seed ping. */}
            <span className={`ab-detail__status ab-detail__status--${statusModifier}`} key={status}>
              <span className="ab-detail__status-dot" aria-hidden="true" />
              {t(`status.${status}`)}
            </span>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('detail.close')}
              tooltip={t('detail.close')}
              onClick={() => onSelectedWorkChange(null)}
            >
              <X size={13} />
            </IconButton>
          </div>
          <h2 className="ab-detail__title">{work.title}</h2>
          <div className="ab-detail__meta">
            <span className="ab-detail__meta-item">{workspaceLabel}</span>
            <span className="ab-detail__meta-rule" aria-hidden="true" />
            <span className="ab-detail__meta-item">{t(`category.${category}`)}</span>
            <span className="ab-detail__meta-rule" aria-hidden="true" />
            <span className="ab-detail__meta-item">{t('detail.updatedAt', { time: formatTime(work.updatedAt) })}</span>
          </div>
          <div className="ab-detail__actions">
            {canAdvance ? (
              <Button
                className="ab-detail__cmd ab-detail__cmd--advance"
                size="small"
                variant="primary"
                onClick={() => {
                  setAdvanceDraft('');
                  setAdvanceDialogWorkId(work.id);
                }}
              >
                <Send size={13} />
                {t('detail.command.advance')}
              </Button>
            ) : null}
            <Button
              className="ab-detail__cmd ab-detail__cmd--open"
              size="small"
              variant="secondary"
              onClick={() => void handleOpenWorkRecord(work)}
            >
              {t('detail.command.open')}
              <ArrowRight size={13} />
            </Button>
            <span className="ab-detail__actions-spacer" aria-hidden="true" />
            {canCancel ? (
              <IconButton
                className="ab-detail__command-icon"
                size="small"
                variant="ghost"
                aria-label={t('detail.command.cancel')}
                tooltip={t('actions.cancelWork')}
                onClick={() => void handleCancelWork({
                  id: work.id,
                  kind: work.kind,
                  title: work.title,
                  objective: work.objective,
                  status,
                  workspacePath: work.scope.kind === 'workspace' ? work.scope.workspacePath : undefined,
                  primarySurface: work.primarySurface,
                  updatedAt: work.updatedAt,
                })}
              >
                <XCircle size={13} />
              </IconButton>
            ) : null}
            {canArchive ? (
              <IconButton
                className="ab-detail__command-icon"
                size="small"
                variant="ghost"
                aria-label={t('detail.command.archive')}
                tooltip={t('actions.removeWork')}
                onClick={() => void handleRemoveWork({
                  id: work.id,
                  kind: work.kind,
                  title: work.title,
                  objective: work.objective,
                  status,
                  workspacePath: work.scope.kind === 'workspace' ? work.scope.workspacePath : undefined,
                  primarySurface: work.primarySurface,
                  updatedAt: work.updatedAt,
                })}
              >
                <Archive size={13} />
              </IconButton>
            ) : null}
          </div>
        </header>

        <div className="ab-detail__body">
        <div className="ab-detail__section ab-detail__section--brief">
          <div className="ab-detail__section-head">
            <h3 className="ab-detail__section-title">
              {t('detail.brief')}
            </h3>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('detail.editObjective')}
              tooltip={t('detail.editObjective')}
              onClick={() => handleOpenObjectiveDialog(work)}
            >
              <Pencil size={12} />
            </IconButton>
          </div>
          <div className="ab-detail__brief">
            <div className="ab-detail__brief-block">
              <span className="ab-detail__field-label">{t('detail.objective')}</span>
              <p className={['ab-detail__body-text', !work.objective && 'ab-detail__body-text--muted'].filter(Boolean).join(' ')}>
                {work.objective || t('detail.emptyObjective')}
              </p>
            </div>
            {work.summary?.text ? (
              <div className="ab-detail__brief-block">
                <span className="ab-detail__field-label">{t('detail.summary')}</span>
                <p className="ab-detail__body-text">{work.summary.text}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="ab-detail__section ab-detail__section--facts">
          <div className="ab-detail__facts">
            <div className="ab-detail__fact">
              <span>{t('detail.assignment.label')}</span>
              <strong>{assignmentLabel}</strong>
            </div>
            <div className="ab-detail__fact">
              <span>{t('detail.created')}</span>
              <strong>{formatTime(work.createdAt)}</strong>
            </div>
          </div>
        </div>

        {(surfaces.length > 0 || referenceCounts.length > 0) ? (
          <div className="ab-detail__section ab-detail__section--links">
            <div className="ab-detail__section-head">
              <h3 className="ab-detail__section-title">
                {t('detail.links')}
              </h3>
            </div>
            {referenceCounts.length > 0 ? (
              <div className="ab-detail__reference-row">
                {referenceCounts.map((label) => (
                  <Badge key={label} className="ab-detail__reference-badge" variant="neutral">
                    {label}
                  </Badge>
                ))}
              </div>
            ) : null}
            {surfaces.length > 0 ? (
              <div className="ab-detail__list">
                {surfaces.map((surface) => {
                  const surfaceKey = getSurfaceKey(surface);
                  const reference = getSurfaceReference(surface);
                  const copied = copiedSurfaceKey === surfaceKey;
                  return (
                    <div className="ab-detail__list-row" key={surfaceKey}>
                      <div className="ab-detail__list-row-copy">
                        <span>{t(getSurfaceLabelKey(surface))}</span>
                        {reference ? (
                          <button
                            type="button"
                            className={['ab-detail__list-ref', copied && 'is-copied'].filter(Boolean).join(' ')}
                            title={t('detail.copyReference')}
                            aria-label={t('detail.copyReference')}
                            onClick={() => void handleCopyReference(surfaceKey, reference)}
                          >
                            {copied ? <Check size={11} aria-hidden /> : null}
                            <code>{copied ? t('detail.copied') : reference}</code>
                          </button>
                        ) : null}
                      </div>
                      <IconButton
                        className="ab-detail__list-open"
                        size="xs"
                        variant="ghost"
                        aria-label={t('detail.openSurface')}
                        tooltip={t('detail.openSurface')}
                        onClick={() => void handleOpenSurface(work, surface)}
                      >
                        <ArrowRight size={12} />
                      </IconButton>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {activityItems.length > 0 ? (
          <div className="ab-detail__section ab-detail__section--activity">
            <div className="ab-detail__section-head">
              <h3 className="ab-detail__section-title">
                {t('detail.activity')}
              </h3>
            </div>
            <div className="ab-detail__timeline">
              <span className="ab-detail__timeline-spine" aria-hidden="true" />
              {activityItems.map((item, itemIndex) => (
                <div
                  className="ab-detail__timeline-item"
                  key={item.id}
                  style={{ '--wc-i': itemIndex } as React.CSSProperties}
                >
                  <span className={`ab-detail__timeline-dot ab-detail__timeline-dot--${item.tone}`} aria-hidden="true" />
                  <div className="ab-detail__timeline-copy">
                    <strong>{item.label}</strong>
                    <span>{item.meta}</span>
                  </div>
                  <time dateTime={new Date(item.time).toISOString()}>{formatTime(item.time)}</time>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </div>
      </aside>
      <Dialog
        open={objectiveDialogOpen}
        onOpenChange={handleObjectiveDialogOpenChange}
        title={t('detail.editObjective')}
        titleExtra={<span className="ab-objective-dialog__title-extra">{work.title}</span>}
        size="small"
        closeLabel={t('detail.cancelEdit')}
        initialFocusRef={objectiveTextareaRef}
      >
        <DialogBody className="ab-objective-dialog__body">
          <Textarea
            ref={objectiveTextareaRef}
            className="ab-work-prompt-dialog__editor"
            value={objectiveDraft}
            onChange={(event) => setObjectiveDraft(event.target.value)}
            placeholder={t('detail.objectivePlaceholder')}
            rows={5}
            maxLength={1200}
            showCount
            autoResize
            disabled={objectiveSaving}
            aria-label={t('detail.objective')}
            data-testid="work-objective-dialog-input"
          />
        </DialogBody>
        <DialogFooter>
          <Button
            size="small"
            variant="ghost"
            disabled={objectiveSaving}
            onClick={handleCloseObjectiveDialog}
          >
            {t('detail.cancelEdit')}
          </Button>
          <Button
            size="small"
            variant="primary"
            isLoading={objectiveSaving}
            onClick={() => void handleSaveObjective(work)}
            disabled={objectiveSaving || objectiveDraft.trim().length === 0}
          >
            <Check size={13} />
            {t('detail.saveObjective')}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={advanceDialogOpen}
        onOpenChange={handleAdvanceDialogOpenChange}
        title={t('detail.advance')}
        titleExtra={<span className="ab-advance-dialog__title-extra">{work.title}</span>}
        size="small"
        closeLabel={t('detail.cancelEdit')}
        initialFocusRef={advanceTextareaRef}
      >
        <DialogBody className="ab-advance-dialog__body">
          <Textarea
            ref={advanceTextareaRef}
            className="ab-work-prompt-dialog__editor"
            value={advanceDraft}
            onChange={(event) => setAdvanceDraft(event.target.value)}
            placeholder={t('detail.advancePlaceholder')}
            rows={5}
            maxLength={1000}
            showCount
            autoResize
            disabled={!canAdvance || advanceSubmitting}
            aria-label={t('detail.advance')}
            data-testid="work-advance-dialog-input"
          />
        </DialogBody>
        <DialogFooter>
          <Button
            size="small"
            variant="ghost"
            disabled={advanceSubmitting}
            onClick={handleCloseAdvanceDialog}
          >
            {t('detail.cancelEdit')}
          </Button>
          <Button
            size="small"
            variant="primary"
            isLoading={advanceSubmitting}
            onClick={() => void handleAdvanceWork(work)}
            disabled={!canAdvance || advanceSubmitting || advanceDraft.trim().length === 0}
          >
            <Send size={13} />
            {t('detail.sendAdvance')}
          </Button>
        </DialogFooter>
      </Dialog>
      </>
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
        totalCount={headerTotalCount}
        runningCount={headerRunningCount}
        search={search}
        grouping={grouping}
        showWorkControls={!showWorkspaceOverview}
        showWorkspaceFilter={!showWorkspaceOverview}
        searchPlaceholder={showWorkspaceOverview ? t('workspaceOverview.searchPlaceholder') : undefined}
        canClearFilters={hasBoardFilters}
        onSearchChange={onSearchChange}
        onWorkspaceFilterChange={onWorkspaceFilterChange}
        onClearFilters={handleClearBoardFilters}
        onGroupingChange={onGroupingChange}
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
      <div className={['ab-board__content', selectedWork && 'ab-board__content--with-detail'].filter(Boolean).join(' ')}>
      <div className={['ab-board__scroll', result.all.length === 0 && 'ab-board__scroll--empty'].filter(Boolean).join(' ')}>
        {result.all.length === 0 ? (
          <div className="ab-board__empty">
            <ListChecks size={28} />
            {hasSearch ? <p>{t('emptyState.noMatches')}</p> : null}
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
                        const showCancelAction = isCancellableStatus(work.status);
                        const showRemoveAction = !showCancelAction && work.status !== 'archived';
                        const category = getWorkCategory(work.kind);
                        const statusModifier = work.status.replace('_', '-');
                        return (
                          <article
                            key={work.id}
                            className={[
                              'wc-card',
                              `wc-card--${statusModifier}`,
                              selectedWorkId === work.id && 'is-selected',
                            ].filter(Boolean).join(' ')}
                            style={{ '--wc-i': Math.min(workIndex, 11) } as React.CSSProperties}
                            data-sparo-work-id={work.id}
                            data-sparo-work-title={work.title}
                            onClick={() => handleSelectWork(work)}
                            tabIndex={0}
                            role="button"
                            aria-label={t('detail.openDetailsFor', { title: work.title })}
                            aria-pressed={selectedWorkId === work.id}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleSelectWork(work);
                              }
                            }}
                          >
                            <span className="wc-card__top">
                              <span className={`wc-card__status wc-card__status--${statusModifier}`}>
                                <span className="wc-card__status-dot" aria-hidden="true" />
                                {t(`status.${work.status}`)}
                              </span>
                              {showCancelAction || showRemoveAction ? (
                                <span className="wc-card__top-actions">
                                  {showCancelAction ? (
                                    <IconButton
                                      className="wc-card__action"
                                      size="xs"
                                      variant="ghost"
                                      aria-label={t('actions.cancelWork')}
                                      tooltip={t('actions.cancelWork')}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleCancelWork(work);
                                      }}
                                    >
                                      <XCircle size={13} />
                                    </IconButton>
                                  ) : (
                                    <IconButton
                                      className="wc-card__action"
                                      size="xs"
                                      variant="ghost"
                                      aria-label={t('actions.removeWork')}
                                      tooltip={t('actions.removeWork')}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleRemoveWork(work);
                                      }}
                                    >
                                      <Trash2 size={13} />
                                    </IconButton>
                                  )}
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
      {selectedWork ? renderWorkDetail(selectedWork) : null}
      </div>
      )}
    </section>
  );
};

export default WorkBoard;
