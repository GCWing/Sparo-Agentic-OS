import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import {
  ActionListRow,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  Input,
  LoadingSkeleton,
  TabPane,
  Tabs,
  Textarea,
} from '@/design-system';
import type {
  ArtifactRef,
  ControlWorkAction,
  RuntimeInstanceRef,
  WorkExecutionBindingStatus,
  WorkExecutionGraph,
  WorkExecutionSource,
  WorkKind,
  WorkLifecycleEvent,
  WorkRecord,
  WorkRuntimeIssueSeverity,
  WorkRuntimeLogLevel,
  WorkRuntimeRunStatus,
  WorkStatus,
  WorkSurfaceRef,
} from '@/app/agentic-os/work/domain/workTypes';
import { agenticOsWorkApi } from '@/app/agentic-os/work/data/workApi';
import type {
  BackgroundProcess,
  BackgroundProcessKind,
} from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import { getWorkspaceDisplayName } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n';
import type { WorkspaceInfo } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils/textSelection';
import { createLogger } from '@/shared/utils/logger';
import {
  deriveSystemWorkDetailPresentation,
  deriveWorkDetailPresentation,
  type WorkDetailPresentation,
} from './workDetailPresentation';
import './WorkDetailDialog.scss';

type WorkDetailTab = 'overview' | 'outputs' | 'runtime';
type WorkCenterTranslator = (key: string, params?: Record<string, string | number>) => string;

interface WorkDetailDialogProps {
  open: boolean;
  workId: string | null;
  work: WorkRecord | null;
  fallbackTitle?: string | null;
  works: WorkRecord[];
  workspaces: WorkspaceInfo[];
  selectedArtifactId: string | null;
  position: { current: number; total: number } | null;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  backgroundProcesses: BackgroundProcess[];
  systemRunSubmittingKind: string | null;
  reclassifySubmittingId: string | null;
  onClose: () => void;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  onOpenWork: (work: WorkRecord) => Promise<void>;
  onOpenSurface: (work: WorkRecord, surface: WorkSurfaceRef) => Promise<void>;
  onOpenArtifact: (artifact: ArtifactRef) => Promise<void>;
  onSaveObjective: (work: WorkRecord, objective: string) => Promise<boolean>;
  onAppendInstruction: (work: WorkRecord, instruction: string) => Promise<boolean>;
  onControlWork: (work: WorkRecord, action: ControlWorkAction) => Promise<boolean>;
  onReclassifyWork: (work: WorkRecord, kind: WorkKind) => Promise<boolean>;
  onRunSystemProcess: (kind: BackgroundProcessKind) => Promise<void>;
}

interface ActivityItem {
  id: string;
  label: string;
  meta?: string | null;
  reference?: string | null;
  time: number;
  tone: 'neutral' | 'running' | 'attention' | 'success' | 'danger';
}

interface ExecutionGraphSnapshot {
  revision: string;
  graph: WorkExecutionGraph;
}

const log = createLogger('WorkDetailDialog');

const RECLASSIFY_OPTIONS: Array<{ kind: WorkKind; labelKey: string }> = [
  { kind: 'topic', labelKey: 'detail.classify.asTopic' },
  { kind: 'tracking', labelKey: 'detail.classify.asTracking' },
  { kind: 'long_running_session', labelKey: 'detail.classify.asLongRunning' },
  { kind: 'recurring', labelKey: 'detail.classify.asRecurring' },
  { kind: 'multi_step', labelKey: 'detail.classify.asImmediate' },
];

const LIFECYCLE_LABEL_KEYS: Record<string, string> = {
  created: 'detail.lifecycleEvent.created',
  advanced: 'detail.lifecycleEvent.advanced',
  paused: 'detail.lifecycleEvent.paused',
  resumed: 'detail.lifecycleEvent.resumed',
  archived: 'detail.lifecycleEvent.archived',
  reopened: 'detail.lifecycleEvent.reopened',
  'status updated': 'detail.lifecycleEvent.statusUpdated',
  'application surface workflow started': 'detail.lifecycleEvent.applicationSurfaceWorkflowStarted',
  'current execution cancelled': 'detail.lifecycleEvent.currentExecutionCancelled',
  'agent session continued': 'detail.lifecycleEvent.agentSessionContinued',
  'agent session turn completed': 'detail.lifecycleEvent.agentSessionTurnCompleted',
  'agent session turn cancelled': 'detail.lifecycleEvent.agentSessionTurnCancelled',
  'agent session failed': 'detail.lifecycleEvent.agentSessionFailed',
  'agent session waiting for user': 'detail.lifecycleEvent.agentSessionWaitingUser',
  'agent session resumed': 'detail.lifecycleEvent.agentSessionResumed',
};

const EXECUTION_DUPLICATE_LIFECYCLE_LABELS = new Set([
  'agent session continued',
  'agent session turn completed',
  'agent session waiting for user',
]);

function kindKey(kind: WorkKind): string {
  return kind.replace(/_/g, '-');
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

function getSurfaceReference(surface: WorkSurfaceRef): string | null {
  switch (surface.kind) {
    case 'work_session':
    case 'agent_session':
      return surface.sessionId;
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
  if (surface.kind === 'os_agent_home') return `${surface.kind}:${surface.agenticOsSessionId ?? 'home'}`;
  return surface.kind;
}

function getSurfaceLabelKey(surface: WorkSurfaceRef): string {
  switch (surface.kind) {
    case 'work_session':
      return 'detail.surface.workSession';
    case 'agent_session':
      return 'detail.surface.agentSession';
    case 'application_surface':
      return 'detail.surface.application';
    case 'os_agent_home':
      return 'detail.surface.agentHome';
    case 'work_center':
      return 'detail.surfaces';
  }
}

function getWorkWorkspaceLabel(
  work: WorkRecord,
  workspaces: WorkspaceInfo[],
  t: WorkCenterTranslator
): string {
  if (work.scope.kind === 'system') return t('detail.globalWorkspace');
  const workspacePath = work.scope.workspacePath;
  const workspace = workspaces.find((item) => item.rootPath === workspacePath);
  return workspace ? getWorkspaceDisplayName(workspace) : workspacePath;
}

function getAssignmentLabel(work: WorkRecord, t: WorkCenterTranslator): string {
  const assignment = work.assignment;
  if (!assignment) return t('detail.assignment.unassigned');
  switch (assignment.kind) {
    case 'agent':
      return t('detail.assignment.agent', { label: assignment.agentType ?? t('detail.assignment.unknown') });
    case 'assistant':
      return t('detail.assignment.assistant', { label: assignment.assistantId ?? t('detail.assignment.unknown') });
    case 'application':
      return t('detail.assignment.application', { label: assignment.applicationId ?? t('detail.assignment.unknown') });
    case 'human':
      return t('detail.assignment.human', { label: assignment.humanLabel ?? t('detail.assignment.unknown') });
    case 'external':
      return t('detail.assignment.external', { label: assignment.externalLabel ?? t('detail.assignment.unknown') });
  }
}

function getExecutionSourceLabel(source: WorkExecutionSource, t: WorkCenterTranslator): string {
  switch (source.source) {
    case 'agent_session_run':
      return t('detail.executionSource.agentSessionRun');
    case 'delegated_work_run':
      return t('detail.executionSource.delegatedWorkRun');
    case 'application_action':
      return t('detail.executionSource.applicationAction');
    case 'runtime_instance_run':
      return t('detail.executionSource.runtimeInstanceRun');
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
    case 'application_action':
      return `${source.applicationId}:${source.actionId}`;
    case 'runtime_instance_run':
    case 'runtime_subagent_run':
      return source.runId;
    case 'external':
      return source.reference || null;
  }
}

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

function getDetailActivityTone(
  status: WorkStatus | WorkExecutionBindingStatus
): ActivityItem['tone'] {
  if (status === 'failed' || status === 'interrupted') return 'danger';
  if (status === 'waiting_user' || status === 'blocked') return 'attention';
  if (status === 'running' || status === 'queued') return 'running';
  if (status === 'completed') return 'success';
  return 'neutral';
}

function getRuntimeRunTone(status: WorkRuntimeRunStatus): ActivityItem['tone'] {
  if (status === 'failed') return 'danger';
  if (status === 'waiting_user') return 'attention';
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'completed') return 'success';
  return 'neutral';
}

function getRuntimeIssueTone(severity: WorkRuntimeIssueSeverity): ActivityItem['tone'] {
  if (severity === 'fatal') return 'danger';
  if (severity === 'warning') return 'attention';
  return 'neutral';
}

function getRuntimeLogTone(level: WorkRuntimeLogLevel): ActivityItem['tone'] {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'attention';
  return 'neutral';
}

function formatRuntimeLockDigest(digest: string): string {
  const value = digest.trim();
  if (!value) return '';
  const prefix = 'sha256:';
  return value.startsWith(prefix)
    ? `${prefix}${value.slice(prefix.length, prefix.length + 12)}`
    : value;
}

function getRuntimeInstanceReference(instance: RuntimeInstanceRef): string {
  return [
    instance.id,
    instance.slotId,
    instance.appId,
    instance.releaseId,
    instance.configRevision,
    instance.productAppSurfaceId,
    instance.surfaceId,
  ].filter(Boolean).join(' | ');
}

function buildLocalActivity(work: WorkRecord, t: WorkCenterTranslator): ActivityItem[] {
  return [
    ...work.executionBindings.map((execution) => ({
      id: `execution:${execution.id}`,
      label: t(`detail.executionStatus.${execution.status}`),
      meta: getExecutionSourceLabel(execution.source, t),
      reference: getExecutionSourceReference(execution.source),
      time: execution.updatedAt || execution.createdAt,
      tone: getDetailActivityTone(execution.status),
    })),
    ...work.lifecycle.events
      .filter((event) => (
        work.executionBindings.length === 0
        || !EXECUTION_DUPLICATE_LIFECYCLE_LABELS.has(event.label.trim().toLowerCase())
      ))
      .map((event, index) => ({
        id: `event:${event.status}:${event.at}:${index}`,
        label: getLifecycleEventLabel(event, t),
        meta: t('detail.lifecycle'),
        reference: null,
        time: event.at,
        tone: getDetailActivityTone(event.status),
      })),
  ].sort((left, right) => right.time - left.time);
}

function buildSystemActivity(
  process: BackgroundProcess | null,
  t: WorkCenterTranslator
): ActivityItem[] {
  if (!process) return [];

  const items: ActivityItem[] = [];
  if ((process.status === 'running' || process.status === 'queued') && process.startedAt) {
    items.push({
      id: `system-running:${process.id}:${process.startedAt}`,
      label: t('detail.systemActivity.running'),
      meta: process.phase ? t(`background.phase.${process.phase}`) : null,
      reference: null,
      time: process.startedAt,
      tone: 'running',
    });
  }

  const finishedAt = process.lastResult?.finishedAt ?? process.finishedAt ?? null;
  if (finishedAt) {
    const status = process.lastResult?.status ?? process.status;
    items.push({
      id: `system-finished:${process.id}:${finishedAt}`,
      label: t('detail.systemActivity.lastRun', {
        status: t(`background.status.${status}`),
      }),
      meta: process.trigger ? t(`background.trigger.${process.trigger}`) : null,
      reference: null,
      time: finishedAt,
      tone: status === 'failed'
        ? 'danger'
        : status === 'succeeded'
          ? 'success'
          : 'neutral',
    });
  }

  return items.sort((left, right) => right.time - left.time);
}

function buildRuntimeActivity(
  work: WorkRecord,
  graph: WorkExecutionGraph | null,
  t: WorkCenterTranslator
): ActivityItem[] {
  if (!graph) return buildLocalActivity(work, t);
  const graphRuntimeRuns = graph.runtimeInstances.flatMap((runtime) => runtime.runs);
  return [
    ...graphRuntimeRuns.map((run) => ({
      id: `runtime-run:${run.runId}`,
      label: t(`detail.runtimeRunStatus.${run.status}`),
      meta: t('detail.runtimeRunMeta', { component: run.componentId, action: run.action }),
      reference: run.runId,
      time: run.updatedAt || run.startedAt,
      tone: getRuntimeRunTone(run.status),
    })),
    ...graph.issues.map((issue, index) => ({
      id: `runtime-issue:${issue.runtimeInstanceId}:${issue.timestampMs}:${index}`,
      label: t(`detail.runtimeIssueSeverity.${issue.severity}`),
      meta: issue.message,
      reference: issue.source ?? issue.category ?? null,
      time: issue.timestampMs,
      tone: getRuntimeIssueTone(issue.severity),
    })),
    ...graph.logs.map((entry, index) => ({
      id: `runtime-log:${entry.runtimeInstanceId}:${entry.timestampMs}:${index}`,
      label: t(`detail.runtimeLogLevel.${entry.level}`),
      meta: entry.message,
      reference: entry.source ?? entry.category,
      time: entry.timestampMs,
      tone: getRuntimeLogTone(entry.level),
    })),
    ...buildLocalActivity(work, t),
  ].sort((left, right) => right.time - left.time).slice(0, 16);
}

function renderActivityList(items: ActivityItem[], emptyLabel: string) {
  if (items.length === 0) {
    return <p className="work-detail-dialog__empty">{emptyLabel}</p>;
  }
  return (
    <div className="work-detail-dialog__timeline">
      {items.map((item) => (
        <div className="work-detail-dialog__timeline-item" key={item.id}>
          <span
            className={`work-detail-dialog__timeline-dot is-${item.tone}`}
            aria-hidden="true"
          />
          <div className="work-detail-dialog__timeline-copy">
            <strong>{item.label}</strong>
            <span className="work-detail-dialog__timeline-meta">
              {item.meta ? <span>{item.meta}</span> : null}
              {item.meta ? <span aria-hidden="true">·</span> : null}
              <time dateTime={new Date(item.time).toISOString()}>{formatTime(item.time)}</time>
            </span>
            {item.reference ? <code>{item.reference}</code> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

const WorkDetailDialog: React.FC<WorkDetailDialogProps> = ({
  open,
  workId,
  work,
  fallbackTitle,
  works,
  workspaces,
  selectedArtifactId,
  position,
  canSelectPrevious,
  canSelectNext,
  backgroundProcesses,
  systemRunSubmittingKind,
  reclassifySubmittingId,
  onClose,
  onSelectPrevious,
  onSelectNext,
  onOpenWork,
  onOpenSurface,
  onOpenArtifact,
  onSaveObjective,
  onAppendInstruction,
  onControlWork,
  onReclassifyWork,
  onRunSystemProcess,
}) => {
  const { t } = useI18n('scenes/work-center');
  const [tabState, setTabState] = useState<{
    workId: string | null;
    artifactId: string | null;
    tab: WorkDetailTab;
  }>({ workId: null, artifactId: null, tab: 'overview' });
  const [editingObjective, setEditingObjective] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [objectiveSaving, setObjectiveSaving] = useState(false);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [instructionSubmitting, setInstructionSubmitting] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [primarySubmitting, setPrimarySubmitting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [executionGraphSnapshot, setExecutionGraphSnapshot] = useState<ExecutionGraphSnapshot | null>(null);
  const [executionGraphLoading, setExecutionGraphLoading] = useState(false);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const selectedArtifactRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  const requestedTab: WorkDetailTab = selectedArtifactId ? 'outputs' : 'overview';
  const activeTab = tabState.workId === workId && tabState.artifactId === selectedArtifactId
    ? tabState.tab
    : requestedTab;
  const revision = work ? `${work.id}:${work.updatedAt}` : null;
  const executionGraph = revision && executionGraphSnapshot?.revision === revision
    ? executionGraphSnapshot.graph
    : null;
  const presentation = useMemo(
    () => work ? deriveWorkDetailPresentation(work, executionGraph) : null,
    [executionGraph, work]
  );
  const systemProcess = work?.systemManaged && work.systemProcessKind
    ? backgroundProcesses.find((process) => process.kind === work.systemProcessKind) ?? null
    : null;
  const systemPresentation = useMemo(
    () => work?.systemManaged ? deriveSystemWorkDetailPresentation(systemProcess) : null,
    [systemProcess, work?.systemManaged]
  );

  const surfaces = useMemo(() => {
    if (!work) return [];
    const raw = work.surfaces.length > 0 ? work.surfaces : [work.primarySurface];
    const keys = new Set<string>();
    return raw.filter((surface) => {
      if (surface.kind === 'work_center') return false;
      const key = getSurfaceKey(surface);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  }, [work]);

  const artifacts = useMemo(() => {
    if (!work) return [];
    const byId = new Map<string, ArtifactRef>();
    for (const artifact of work.artifactRefs) byId.set(artifact.id, artifact);
    for (const node of executionGraph?.artifacts ?? []) {
      if (!byId.has(node.artifact.id)) byId.set(node.artifact.id, node.artifact);
    }
    return [...byId.values()];
  }, [executionGraph, work]);

  const hasOutputsTab = Boolean(presentation?.showOutputsTab && (artifacts.length > 0 || surfaces.length > 0));
  const hasRuntimeTab = Boolean(
    presentation
    && (presentation.showRuntimeTab || (work?.systemManaged && systemPresentation?.hasRuntimeRecord))
  );
  const resolvedTab: WorkDetailTab = activeTab === 'outputs' && !hasOutputsTab
    ? 'overview'
    : activeTab === 'runtime' && !hasRuntimeTab
      ? 'overview'
      : activeTab;

  const localActivity = useMemo(
    () => work && !work.systemManaged
      ? buildLocalActivity(work, t)
        .map((item) => ({ ...item, reference: null }))
        .slice(0, 3)
      : [],
    [t, work]
  );
  const runtimeActivity = useMemo(
    () => work
      ? work.systemManaged
        ? buildSystemActivity(systemProcess, t)
        : buildRuntimeActivity(work, executionGraph, t)
      : [],
    [executionGraph, systemProcess, t, work]
  );

  const workspaceLabel = work ? getWorkWorkspaceLabel(work, workspaces, t) : '';
  const assignmentLabel = work ? getAssignmentLabel(work, t) : '';
  const topicWork = work?.topicWorkId
    ? works.find((item) => item.id === work.topicWorkId) ?? null
    : null;
  const interactionOpen = editingObjective || managementOpen;
  const busy = objectiveSaving
    || instructionSubmitting
    || primarySubmitting
    || reclassifySubmittingId === work?.id
    || Boolean(systemRunSubmittingKind);

  useEffect(() => {
    setEditingObjective(false);
    setObjectiveDraft('');
    setInstructionDraft('');
    setManagementOpen(false);
    setTechnicalOpen(false);
    setCopiedKey(null);
    setExecutionGraphSnapshot(null);
    setExecutionGraphLoading(false);
  }, [workId]);

  useEffect(() => {
    if (open) return;
    setEditingObjective(false);
    setManagementOpen(false);
    setTechnicalOpen(false);
  }, [open]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!open || resolvedTab !== 'runtime' || !work || !revision) {
      setExecutionGraphLoading(false);
      return;
    }
    if (executionGraphSnapshot?.revision === revision) return;

    let cancelled = false;
    setExecutionGraphLoading(true);
    void agenticOsWorkApi.getWorkExecutionGraph(work.id)
      .then((graph) => {
        if (!cancelled) setExecutionGraphSnapshot({ revision, graph });
      })
      .catch((error) => {
        if (!cancelled) {
          log.error('Failed to load work execution graph', { workId: work.id, error });
        }
      })
      .finally(() => {
        if (!cancelled) setExecutionGraphLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [executionGraphSnapshot?.revision, open, resolvedTab, revision, work]);

  useEffect(() => {
    if (!editingObjective) return;
    window.requestAnimationFrame(() => objectiveRef.current?.focus());
  }, [editingObjective]);

  useEffect(() => {
    if (!selectedArtifactId || resolvedTab !== 'outputs') return;
    window.requestAnimationFrame(() => {
      selectedArtifactRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }, [resolvedTab, selectedArtifactId]);

  const handleCloseRequest = useCallback(() => {
    if (busy) return;
    if (editingObjective) {
      setEditingObjective(false);
      setObjectiveDraft('');
      return;
    }
    onClose();
  }, [busy, editingObjective, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCloseRequest();
        return;
      }

      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || interactionOpen) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]')) return;
      }
      if (event.key === 'ArrowLeft' && canSelectPrevious) {
        event.preventDefault();
        onSelectPrevious();
      } else if (event.key === 'ArrowRight' && canSelectNext) {
        event.preventDefault();
        onSelectNext();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [
    canSelectNext,
    canSelectPrevious,
    handleCloseRequest,
    interactionOpen,
    onSelectNext,
    onSelectPrevious,
    open,
  ]);

  const handleCopy = useCallback(async (key: string, value: string) => {
    if (!await copyTextToClipboard(value)) return;
    setCopiedKey(key);
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1600);
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    if (!workId || objectiveSaving || instructionSubmitting) return;
    setEditingObjective(false);
    setObjectiveDraft('');
    setManagementOpen(false);
    setTabState({ workId, artifactId: selectedArtifactId, tab: tab as WorkDetailTab });
  }, [instructionSubmitting, objectiveSaving, selectedArtifactId, workId]);

  const handleStartObjectiveEdit = useCallback(() => {
    if (!work) return;
    setManagementOpen(false);
    setObjectiveDraft(work.objective);
    setEditingObjective(true);
  }, [work]);

  const handleSaveObjective = useCallback(async () => {
    if (!work || objectiveSaving) return;
    setObjectiveSaving(true);
    const saved = await onSaveObjective(work, objectiveDraft);
    setObjectiveSaving(false);
    if (saved) {
      setEditingObjective(false);
      setObjectiveDraft('');
    }
  }, [objectiveDraft, objectiveSaving, onSaveObjective, work]);

  const handleSendInstruction = useCallback(async () => {
    if (!work || instructionSubmitting || !instructionDraft.trim()) return;
    setInstructionSubmitting(true);
    const sent = await onAppendInstruction(work, instructionDraft);
    setInstructionSubmitting(false);
    if (sent) {
      setInstructionDraft('');
    }
  }, [instructionDraft, instructionSubmitting, onAppendInstruction, work]);

  const handlePrimaryAction = useCallback(async () => {
    if (!work || !presentation || primarySubmitting) return;
    setPrimarySubmitting(true);
    try {
      if (presentation.primaryAction === 'resume') {
        await onControlWork(work, 'resume');
      } else if (presentation.primaryAction === 'reopen') {
        await onControlWork(work, 'reopen');
      } else {
        await onOpenWork(work);
      }
    } finally {
      setPrimarySubmitting(false);
    }
  }, [onControlWork, onOpenWork, presentation, primarySubmitting, work]);

  const handleManagementControl = useCallback(async (action: ControlWorkAction) => {
    if (!work || primarySubmitting) return;
    setPrimarySubmitting(true);
    try {
      await onControlWork(work, action);
    } finally {
      setPrimarySubmitting(false);
    }
  }, [onControlWork, primarySubmitting, work]);

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && !busy && !interactionOpen) onClose();
  }, [busy, interactionOpen, onClose]);

  const currentStateText = systemPresentation
    ? t(systemPresentation.summaryKey, systemPresentation.summaryParams)
    : work?.summary?.text?.trim() || t('detail.currentState.fallback');
  const displayTitle = work && systemPresentation?.titleKey
    ? t(systemPresentation.titleKey)
    : work?.title ?? fallbackTitle ?? t('detail.loading');
  const displayStatusLabel = systemPresentation
    ? t(systemPresentation.statusKey)
    : presentation
      ? t(`status.${presentation.effectiveStatus}`)
      : '';
  const displayStatusState = systemPresentation?.state ?? presentation?.userState ?? 'inactive';

  const renderContextLine = () => (
    <div className="work-detail-dialog__context-line">
      <span className={`work-detail-dialog__status is-${displayStatusState}`}>
        <span className="work-detail-dialog__status-dot" aria-hidden="true" />
        {displayStatusLabel}
      </span>
      {work?.systemManaged ? <span>{t('rail.system')}</span> : null}
      {!work?.systemManaged && work ? (
        <>
          <span>{t(`kind.${kindKey(work.kind)}`)}</span>
          <span>{t('detail.updatedAt', { time: formatTime(work.updatedAt) })}</span>
        </>
      ) : null}
    </div>
  );

  const renderManagementControls = (workValue: WorkRecord, detail: WorkDetailPresentation) => (
    <section className="work-detail-dialog__section work-detail-dialog__more-actions">
      <div className="work-detail-dialog__management-toolbar">
        <Button
          size="small"
          variant={managementOpen ? 'secondary' : 'ghost'}
          shape="pill"
          aria-expanded={managementOpen}
          aria-controls="work-detail-management-panel"
          onClick={() => {
            setManagementOpen((current) => !current);
          }}
        >
          {managementOpen ? <ChevronUp size={14} /> : <MoreHorizontal size={14} />}
          {t(managementOpen ? 'detail.more.collapse' : 'detail.more.label')}
        </Button>
        {detail.effectiveStatus !== 'archived' ? (
          <Button
            size="small"
            variant="ghost"
            shape="pill"
            disabled={primarySubmitting}
            onClick={() => void handleManagementControl('archive')}
          >
            <Archive size={13} />
            {t('actions.removeWork')}
          </Button>
        ) : null}
      </div>
      {managementOpen ? (
        <div id="work-detail-management-panel" className="work-detail-dialog__management">
          <div className="work-detail-dialog__management-group">
            <span>{t('detail.more.changeType')}</span>
            <div>
              {RECLASSIFY_OPTIONS.map((option) => (
                <Button
                  key={option.kind}
                  size="small"
                  variant={workValue.kind === option.kind ? 'secondary' : 'ghost'}
                  disabled={workValue.kind === option.kind || reclassifySubmittingId === workValue.id || primarySubmitting}
                  onClick={() => void onReclassifyWork(workValue, option.kind)}
                >
                  {t(option.labelKey)}
                </Button>
              ))}
            </div>
          </div>
          <div className="work-detail-dialog__management-actions">
            {['running', 'waiting_user', 'blocked'].includes(detail.effectiveStatus) ? (
              <Button
                size="small"
                variant="ghost"
                disabled={primarySubmitting}
                onClick={() => void handleManagementControl('cancel_current_execution')}
              >
                <XCircle size={13} />
                {t('actions.cancelWork')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );

  const renderSystemOverview = () => (
    <div className="work-detail-dialog__pane work-detail-dialog__pane--system">
      {renderContextLine()}
      <section
        className={`work-detail-dialog__system-hero is-${systemPresentation?.state ?? 'healthy'}`}
        aria-live="polite"
      >
        <div className="work-detail-dialog__system-hero-label">
          <span>{t('detail.systemOverview.automatic')}</span>
        </div>
        <p className="work-detail-dialog__system-hero-message">{currentStateText}</p>
        {systemPresentation
          && systemPresentation.summaryKey !== 'detail.currentState.systemManaged'
          && ['healthy', 'running', 'scheduled'].includes(systemPresentation.state) ? (
          <p className="work-detail-dialog__system-hero-support">
            {t('detail.currentState.systemManaged')}
          </p>
        ) : null}
        {systemProcess && systemPresentation ? (
          <dl className="work-detail-dialog__system-metrics" aria-label={t('detail.systemOverview.title')}>
            {systemPresentation.lastFinishedAt ? (
              <div>
                <dt>{t('detail.systemOverview.lastFinished')}</dt>
                <dd>{formatTime(systemPresentation.lastFinishedAt)}</dd>
              </div>
            ) : null}
            {systemProcess.nextRunAt ? (
              <div>
                <dt>{t('detail.systemRuntime.nextRun')}</dt>
                <dd>{formatTime(systemProcess.nextRunAt)}</dd>
              </div>
            ) : null}
            {!systemPresentation.lastFinishedAt && !systemProcess.nextRunAt && systemProcess.trigger ? (
              <div>
                <dt>{t('detail.systemOverview.trigger')}</dt>
                <dd>{t(`background.trigger.${systemProcess.trigger}`)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>
    </div>
  );

  const renderOverview = (
    workValue: WorkRecord,
    detail: WorkDetailPresentation
  ) => (
    <div className="work-detail-dialog__pane work-detail-dialog__pane--overview">
      <section
        className={`work-detail-dialog__state-card is-${detail.userState}`}
        aria-live="polite"
      >
        <span className="work-detail-dialog__eyebrow">{t('detail.currentState.title')}</span>
        <p>{currentStateText}</p>
      </section>

      {renderContextLine()}

      {(detail.showObjective || detail.canEditObjective) ? (
        <section className="work-detail-dialog__section">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.objective')}</h3>
            {detail.canEditObjective && !editingObjective ? (
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={t('detail.editObjective')}
                tooltip={t('detail.editObjective')}
                onClick={handleStartObjectiveEdit}
              >
                <Pencil size={13} />
              </IconButton>
            ) : null}
          </div>
          {editingObjective ? (
            <div className="work-detail-dialog__inline-editor">
              <Textarea
                ref={objectiveRef}
                value={objectiveDraft}
                rows={4}
                disabled={objectiveSaving}
                placeholder={t('detail.objectivePlaceholder')}
                aria-label={t('detail.objective')}
                onChange={(event) => setObjectiveDraft(event.target.value)}
              />
              <div className="work-detail-dialog__inline-actions">
                <Button
                  size="small"
                  variant="ghost"
                  disabled={objectiveSaving}
                  onClick={() => {
                    setEditingObjective(false);
                    setObjectiveDraft('');
                  }}
                >
                  {t('detail.cancelEdit')}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  isLoading={objectiveSaving}
                  disabled={!objectiveDraft.trim()}
                  onClick={() => void handleSaveObjective()}
                >
                  {t('detail.saveObjective')}
                </Button>
              </div>
            </div>
          ) : (
            <p className={workValue.objective.trim() ? undefined : 'is-muted'}>
              {workValue.objective.trim() || t('detail.emptyObjective')}
            </p>
          )}
        </section>
      ) : null}

      {(detail.showAssignment || detail.showTopic || detail.showCreatedAt) ? (
        <dl className="work-detail-dialog__facts" aria-label={t('detail.context.title')}>
          {detail.showAssignment ? (
            <div>
              <dt>{t('detail.assignment.label')}</dt>
              <dd>{assignmentLabel}</dd>
            </div>
          ) : null}
          {detail.showTopic ? (
            <div>
              <dt>{t('detail.attachments.topic')}</dt>
              <dd>{topicWork?.title ?? workValue.topicWorkId}</dd>
            </div>
          ) : null}
          {detail.showCreatedAt ? (
            <div>
              <dt>{t('detail.created')}</dt>
              <dd>{formatTime(workValue.createdAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {localActivity.length > 0 ? (
        <section className="work-detail-dialog__section">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.activity')}</h3>
          </div>
          {renderActivityList(localActivity, t('detail.empty.activity'))}
        </section>
      ) : null}

      {renderManagementControls(workValue, detail)}
    </div>
  );

  const renderOutputs = (workValue: WorkRecord) => (
    <div className="work-detail-dialog__pane">
      {artifacts.length > 0 ? (
        <section className="work-detail-dialog__section">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.outputs.artifacts')}</h3>
          </div>
          <div className="work-detail-dialog__action-list" role="list">
            {artifacts.map((artifact) => {
              const reference = artifact.uri?.trim() || artifact.id;
              const key = `artifact:${artifact.id}`;
              const selected = selectedArtifactId === artifact.id;
              return (
                <ActionListRow
                  ref={selected ? selectedArtifactRef : undefined}
                  role="listitem"
                  key={artifact.id}
                  className={selected ? 'is-selected' : ''}
                  leading={<FileText size={15} />}
                  title={artifact.label?.trim() || artifact.id}
                  description={reference}
                  actions={(
                    <>
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label={t('detail.copyReference')}
                        tooltip={t('detail.copyReference')}
                        onClick={() => void handleCopy(key, reference)}
                      >
                        {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
                      </IconButton>
                      {artifact.uri?.trim() ? (
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t('detail.openArtifact')}
                          tooltip={t('detail.openArtifact')}
                          onClick={() => void onOpenArtifact(artifact)}
                        >
                          <ExternalLink size={13} />
                        </IconButton>
                      ) : null}
                    </>
                  )}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {surfaces.length > 0 ? (
        <section className="work-detail-dialog__section">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.outputs.destinations')}</h3>
          </div>
          <div className="work-detail-dialog__action-list" role="list">
            {surfaces.map((surface) => {
              const key = getSurfaceKey(surface);
              const reference = getSurfaceReference(surface);
              const isPrimary = getSurfaceKey(workValue.primarySurface) === key;
              return (
                <ActionListRow
                  role="listitem"
                  key={key}
                  leading={<ExternalLink size={15} />}
                  title={t(getSurfaceLabelKey(surface))}
                  description={reference || undefined}
                  meta={isPrimary ? <Badge variant="neutral">{t('detail.outputs.primary')}</Badge> : undefined}
                  actions={(
                    <>
                      {reference ? (
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t('detail.copyReference')}
                          tooltip={t('detail.copyReference')}
                          onClick={() => void handleCopy(key, reference)}
                        >
                          {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
                        </IconButton>
                      ) : null}
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label={t('detail.openSurface')}
                        tooltip={t('detail.openSurface')}
                        onClick={() => void onOpenSurface(workValue, surface)}
                      >
                        <ExternalLink size={13} />
                      </IconButton>
                    </>
                  )}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {artifacts.length === 0 && surfaces.length === 0 ? (
        <p className="work-detail-dialog__empty">{t('detail.empty.outputs')}</p>
      ) : null}
    </div>
  );

  const renderRuntime = (workValue: WorkRecord) => (
    <div className="work-detail-dialog__pane">
      {workValue.systemManaged ? (
        <section className="work-detail-dialog__section work-detail-dialog__system-runtime">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.systemRuntime.title')}</h3>
          </div>
          {systemProcess ? (
            <>
              <dl className="work-detail-dialog__facts">
                <div>
                  <dt>{t('background.columns.status')}</dt>
                  <dd>{t(`background.status.${systemProcess.status}`)}</dd>
                </div>
                {systemProcess.phase ? (
                  <div>
                    <dt>{t('background.columns.phase')}</dt>
                    <dd>{t(`background.phase.${systemProcess.phase}`)}</dd>
                  </div>
                ) : null}
                {systemProcess.nextRunAt ? (
                  <div>
                    <dt>{t('detail.systemRuntime.nextRun')}</dt>
                    <dd>{formatTime(systemProcess.nextRunAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {systemProcess.actions.includes('run_now') ? (
                <div className="work-detail-dialog__system-actions">
                  <Button
                    size="small"
                    variant="secondary"
                    isLoading={systemRunSubmittingKind === systemProcess.kind}
                    disabled={Boolean(systemRunSubmittingKind)}
                    onClick={() => void onRunSystemProcess(systemProcess.kind)}
                  >
                    <Play size={13} />
                    {t('detail.systemRuntime.runNow')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="work-detail-dialog__empty">{t('detail.systemRuntime.unavailable')}</p>
          )}
        </section>
      ) : null}

      {workValue.runtimeInstances.length > 0 ? (
        <section className="work-detail-dialog__section">
          <div className="work-detail-dialog__section-head">
            <h3>{t('detail.runtimeInstances')}</h3>
          </div>
          <div className="work-detail-dialog__action-list" role="list">
            {workValue.runtimeInstances.map((instance) => (
              <ActionListRow
                role="listitem"
                key={instance.id}
                leading={<History size={15} />}
                title={instance.appId}
                description={t('detail.runtimeRelease', {
                  release: instance.releaseId,
                  config: formatRuntimeLockDigest(instance.configRevision),
                })}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="work-detail-dialog__section">
        <div className="work-detail-dialog__section-head">
          <h3>{t('detail.runtimeEvents')}</h3>
        </div>
        {executionGraphLoading ? (
          <LoadingSkeleton lines={5} compact aria-label={t('detail.graphLoading')} />
        ) : renderActivityList(runtimeActivity, t('detail.empty.runtime'))}
      </section>

      <section className="work-detail-dialog__technical">
        <Button
          size="small"
          variant="ghost"
          aria-expanded={technicalOpen}
          onClick={() => setTechnicalOpen((current) => !current)}
        >
          {technicalOpen ? t('detail.technical.hide') : t('detail.technical.show')}
        </Button>
        {technicalOpen ? (
          <div className="work-detail-dialog__technical-list">
            <ActionListRow
              title={t('detail.technical.workId')}
              description={workValue.id}
              actions={(
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label={t('detail.copyReference')}
                  tooltip={t('detail.copyReference')}
                  onClick={() => void handleCopy('work-id', workValue.id)}
                >
                  {copiedKey === 'work-id' ? <Check size={13} /> : <Copy size={13} />}
                </IconButton>
              )}
            />
            {workValue.runtimeInstances.map((instance) => {
              const key = `runtime:${instance.id}`;
              const reference = getRuntimeInstanceReference(instance);
              return (
                <ActionListRow
                  key={key}
                  title={t('detail.technical.runtimeInstanceId')}
                  description={reference}
                  actions={(
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label={t('detail.copyReference')}
                      tooltip={t('detail.copyReference')}
                      onClick={() => void handleCopy(key, reference)}
                    >
                      {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
                    </IconButton>
                  )}
                />
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
      size={work?.systemManaged ? 'medium' : 'large'}
      showCloseButton={false}
      closeOnEscape={false}
      closeOnOverlayClick={!busy && !interactionOpen}
      initialFocusRef={dialogTitleRef}
      ariaLabel={t('detail.label')}
      className={`work-detail-dialog${work?.systemManaged ? ' is-system' : ''}`}
      overlayClassName="work-detail-dialog__overlay"
    >
      <DialogHeader className="work-detail-dialog__header">
        {work && presentation ? (
          <div className="work-detail-dialog__identity">
            <div className="work-detail-dialog__title-line">
              <h2 ref={dialogTitleRef} tabIndex={-1}>{displayTitle}</h2>
              <span className="work-detail-dialog__workspace">{workspaceLabel}</span>
            </div>
          </div>
        ) : (
          <div className="work-detail-dialog__loading-title">
            <h2 ref={dialogTitleRef} tabIndex={-1}>{fallbackTitle || t('detail.loading')}</h2>
            <LoadingSkeleton lines={1} compact />
          </div>
        )}
        <div className="work-detail-dialog__header-actions">
          {position ? (
            <span className="work-detail-dialog__position">
              {t('detail.navigation.positionCompact', position)}
            </span>
          ) : null}
          <IconButton
            size="xs"
            variant="ghost"
            shape="circle"
            disabled={!canSelectPrevious || busy}
            aria-label={t('detail.navigation.previous')}
            tooltip={t('detail.navigation.previous')}
            onClick={onSelectPrevious}
          >
            <ArrowLeft size={13} />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            shape="circle"
            disabled={!canSelectNext || busy}
            aria-label={t('detail.navigation.next')}
            tooltip={t('detail.navigation.next')}
            onClick={onSelectNext}
          >
            <ArrowRight size={13} />
          </IconButton>
          <IconButton
            size="xs"
            variant="ghost"
            shape="circle"
            disabled={busy}
            aria-label={t('detail.close')}
            tooltip={t('detail.close')}
            onClick={handleCloseRequest}
          >
            <X size={14} />
          </IconButton>
        </div>
      </DialogHeader>

      <DialogBody className="work-detail-dialog__body">
        {work && presentation ? (
          <Tabs
            activeKey={resolvedTab}
            onChange={handleTabChange}
            type="line"
            size="small"
            className="work-detail-dialog__tabs"
          >
            <TabPane tabKey="overview" label={t('detail.tabs.overview')}>
              {work.systemManaged ? renderSystemOverview() : renderOverview(work, presentation)}
            </TabPane>
            {hasOutputsTab ? (
              <TabPane tabKey="outputs" label={t('detail.tabs.outputs')}>
                {renderOutputs(work)}
              </TabPane>
            ) : null}
            {hasRuntimeTab ? (
              <TabPane tabKey="runtime" label={t('detail.tabs.runtime')}>
                {renderRuntime(work)}
              </TabPane>
            ) : null}
          </Tabs>
        ) : (
          <div className="work-detail-dialog__loading-body">
            <LoadingSkeleton lines={7} />
          </div>
        )}
      </DialogBody>

      {work && presentation && !work.systemManaged ? (
        <DialogFooter className="work-detail-dialog__footer">
          <div className="work-detail-dialog__footer-bar">
            {presentation.canAppendInstructions ? (
              <form
                className="work-detail-dialog__instruction-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSendInstruction();
                }}
              >
                <Input
                  shape="pill"
                  focusTone="danger"
                  inputSize="small"
                  variant="filled"
                  value={instructionDraft}
                  disabled={instructionSubmitting}
                  placeholder={t('detail.appendInstruction.placeholder')}
                  aria-label={t('detail.appendInstruction.label')}
                  onChange={(event) => setInstructionDraft(event.target.value)}
                  suffix={(
                    <IconButton
                      size="xs"
                      variant="ghost"
                      shape="circle"
                      isLoading={instructionSubmitting}
                      disabled={!instructionDraft.trim()}
                      aria-label={t('detail.appendInstruction.send')}
                      tooltip={t('detail.appendInstruction.send')}
                      type="submit"
                    >
                      <ArrowRight size={13} />
                    </IconButton>
                  )}
                />
              </form>
            ) : null}
            <div className="work-detail-dialog__footer-actions">
              <Button
                size="small"
                variant="primary"
                shape={presentation.primaryAction === 'enter' || presentation.primaryAction === 'inspectProgress'
                  ? 'pill'
                  : 'default'}
                isLoading={primarySubmitting}
                onClick={() => void handlePrimaryAction()}
              >
                {presentation.primaryAction !== 'enter'
                  && presentation.primaryAction !== 'inspectProgress'
                  && (presentation.primaryAction === 'resume' || presentation.primaryAction === 'reopen'
                  ? <RotateCcw size={13} />
                  : <ArrowRight size={13} />)}
                {t(`detail.primaryAction.${presentation.primaryAction}`)}
              </Button>
            </div>
          </div>
        </DialogFooter>
      ) : null}
    </Dialog>
  );
};

export default WorkDetailDialog;
