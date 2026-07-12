import type {
  WorkAssignmentRef,
  WorkExecutionGraph,
  WorkRecord,
  WorkStatus,
} from '@/app/agentic-os/work/domain/workTypes';
import { resolveEffectiveWorkStatus } from '@/app/agentic-os/work/domain/workStatus';
import type {
  BackgroundProcess,
  BackgroundProcessStatus,
} from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';

export type WorkDetailUserState =
  | 'ready'
  | 'needsAction'
  | 'inProgress'
  | 'resultReady'
  | 'paused'
  | 'inactive';

export type WorkDetailPrimaryAction =
  | 'handle'
  | 'inspectProgress'
  | 'viewResult'
  | 'enter'
  | 'resume'
  | 'reopen'
  | 'openAndHandle';

export interface WorkDetailPresentation {
  effectiveStatus: WorkStatus;
  userState: WorkDetailUserState;
  primaryAction: WorkDetailPrimaryAction;
  canAppendInstructions: boolean;
  canEditObjective: boolean;
  showObjective: boolean;
  showSummary: boolean;
  showAssignment: boolean;
  showTopic: boolean;
  showCreatedAt: boolean;
  hasArtifacts: boolean;
  hasDestinations: boolean;
  hasOutputs: boolean;
  hasRuntimeRecord: boolean;
  hasActivity: boolean;
  showOutputsTab: boolean;
  showRuntimeTab: boolean;
}

export type SystemWorkDetailState = 'healthy' | 'running' | 'scheduled' | 'attention' | 'disabled';
export type SystemWorkDetailTone = 'neutral' | 'accent' | 'warning' | 'error' | 'success' | 'info';

export interface SystemWorkDetailPresentation {
  titleKey: string | null;
  state: SystemWorkDetailState;
  statusKey: string;
  statusTone: SystemWorkDetailTone;
  summaryKey: string;
  summaryParams?: Record<string, string | number>;
  hasRuntimeRecord: boolean;
  lastFinishedAt: number | null;
}

const USER_STATE_BY_STATUS: Record<WorkStatus, WorkDetailUserState> = {
  draft: 'ready',
  active: 'ready',
  running: 'inProgress',
  waiting_user: 'needsAction',
  blocked: 'needsAction',
  paused: 'paused',
  completed: 'resultReady',
  failed: 'needsAction',
  cancelled: 'inactive',
  interrupted: 'needsAction',
  archived: 'inactive',
};

const PRIMARY_ACTION_BY_STATUS: Record<WorkStatus, WorkDetailPrimaryAction> = {
  draft: 'enter',
  active: 'enter',
  running: 'inspectProgress',
  waiting_user: 'handle',
  blocked: 'handle',
  paused: 'resume',
  completed: 'viewResult',
  failed: 'openAndHandle',
  cancelled: 'enter',
  interrupted: 'openAndHandle',
  archived: 'reopen',
};

export function getWorkDetailUserState(status: WorkStatus): WorkDetailUserState {
  return USER_STATE_BY_STATUS[status];
}

export function getWorkDetailPrimaryAction(status: WorkStatus): WorkDetailPrimaryAction {
  return PRIMARY_ACTION_BY_STATUS[status];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasMeaningfulAssignment(assignment: WorkAssignmentRef | null | undefined): boolean {
  if (!assignment) return false;

  switch (assignment.kind) {
    case 'agent':
      return hasText(assignment.agentType);
    case 'assistant':
      return hasText(assignment.assistantId);
    case 'application':
      return hasText(assignment.applicationId);
    case 'human':
      return hasText(assignment.humanLabel);
    case 'external':
      return hasText(assignment.externalLabel);
  }
}

function hasDistinctCreationTime(work: WorkRecord): boolean {
  const hasCreatedAt = Number.isFinite(work.createdAt) && work.createdAt > 0;
  if (!hasCreatedAt) return false;

  const hasUpdatedAt = Number.isFinite(work.updatedAt) && work.updatedAt > 0;
  return !hasUpdatedAt || work.createdAt < work.updatedAt;
}

function hasDestination(work: WorkRecord): boolean {
  const surfaces = work.surfaces.length > 0 ? work.surfaces : [work.primarySurface];
  return surfaces.some((surface) => (
    surface.kind !== 'work_center' && surface.kind !== 'os_agent_home'
  ));
}

function graphHasArtifacts(graph: WorkExecutionGraph | null): boolean {
  return Boolean(
    graph
    && (graph.summary.artifactCount > 0 || graph.artifacts.length > 0)
  );
}

function graphHasRuntimeRecord(graph: WorkExecutionGraph | null): boolean {
  if (!graph) return false;

  return graph.summary.executionCount > 0
    || graph.summary.runtimeInstanceCount > 0
    || graph.summary.runtimeRunCount > 0
    || graph.summary.issueCount > 0
    || graph.executions.length > 0
    || graph.runtimeInstances.length > 0
    || graph.issues.length > 0
    || graph.logs.length > 0
    || graph.builderPreviewResults.length > 0
    || graph.builderValidationResults.length > 0
    || graph.builderIssues.length > 0;
}

function getSystemWorkDetailState(status: BackgroundProcessStatus): SystemWorkDetailState {
  if (status === 'running' || status === 'queued') return 'running';
  if (status === 'scheduled' || status === 'cooling_down') return 'scheduled';
  if (status === 'failed') return 'attention';
  if (status === 'disabled') return 'disabled';
  return 'healthy';
}

const SYSTEM_STATUS_TONE: Record<SystemWorkDetailState, SystemWorkDetailTone> = {
  healthy: 'success',
  running: 'accent',
  scheduled: 'info',
  attention: 'error',
  disabled: 'neutral',
};

export function deriveSystemWorkDetailPresentation(
  process: BackgroundProcess | null
): SystemWorkDetailPresentation {
  if (!process) {
    return {
      titleKey: null,
      state: 'healthy',
      statusKey: 'detail.systemStatus.healthy',
      statusTone: 'success',
      summaryKey: 'detail.currentState.systemManaged',
      hasRuntimeRecord: false,
      lastFinishedAt: null,
    };
  }

  const state = getSystemWorkDetailState(process.status);
  const rawResult = process.lastResult?.message?.trim() ?? '';
  const trackedSources = process.kind === 'memory_consolidation'
    ? /^(\d+)\s+source\(s\)\s+tracked$/i.exec(rawResult)
    : null;

  let summaryKey = `detail.currentState.system${state[0].toUpperCase()}${state.slice(1)}`;
  let summaryParams: Record<string, string | number> | undefined;
  if (trackedSources) {
    summaryKey = 'detail.currentState.memorySourcesTracked';
    summaryParams = { count: Number(trackedSources[1]) };
  }

  return {
    titleKey: `background.kinds.${process.kind}`,
    state,
    statusKey: `detail.systemStatus.${state}`,
    statusTone: SYSTEM_STATUS_TONE[state],
    summaryKey,
    summaryParams,
    hasRuntimeRecord: Boolean(
      process.startedAt
      || process.finishedAt
      || process.lastResult
      || process.lastError
      || process.status === 'running'
      || process.status === 'queued'
    ),
    lastFinishedAt: process.lastResult?.finishedAt ?? process.finishedAt ?? null,
  };
}

export function deriveWorkDetailPresentation(
  work: WorkRecord,
  executionGraph: WorkExecutionGraph | null = null
): WorkDetailPresentation {
  const effectiveStatus = resolveEffectiveWorkStatus(work);
  const hasArtifacts = work.artifactRefs.length > 0 || graphHasArtifacts(executionGraph);
  const hasDestinations = hasDestination(work);
  const hasOutputs = hasArtifacts || hasDestinations;
  const hasRuntimeRecord = work.executionBindings.length > 0
    || work.runtimeInstances.length > 0
    || graphHasRuntimeRecord(executionGraph);
  const hasActivity = hasRuntimeRecord || work.lifecycle.events.length > 0;

  return {
    effectiveStatus,
    userState: getWorkDetailUserState(effectiveStatus),
    primaryAction: getWorkDetailPrimaryAction(effectiveStatus),
    canAppendInstructions: !work.systemManaged && effectiveStatus !== 'archived',
    canEditObjective: !work.systemManaged,
    // System-managed Work currently stores internal English objective text and
    // machine-oriented `status=...` summaries. Its user-facing story comes
    // from the process runtime instead of leaking those persistence fields.
    showObjective: !work.systemManaged && hasText(work.objective),
    showSummary: !work.systemManaged && hasText(work.summary?.text),
    showAssignment: !work.systemManaged && hasMeaningfulAssignment(work.assignment),
    showTopic: hasText(work.topicWorkId),
    showCreatedAt: !work.systemManaged && hasDistinctCreationTime(work),
    hasArtifacts,
    hasDestinations,
    hasOutputs,
    hasRuntimeRecord,
    hasActivity,
    showOutputsTab: hasOutputs,
    showRuntimeTab: hasRuntimeRecord,
  };
}
