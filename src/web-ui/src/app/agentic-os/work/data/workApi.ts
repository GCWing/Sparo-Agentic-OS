import { api } from '@/infrastructure/api/service-api/ApiClient';
import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import type {
  AdvanceWorkRequest,
  AgentSessionRef,
  ArtifactRef,
  ControlWorkRequest,
  CreateWorkRequest,
  LinkSessionToWorkRequest,
  MemoryRef,
  ResolveAppWorkRequest,
  ResolveComponentWorkRequest,
  RuntimeInstanceRef,
  RecordBuilderPreviewResultRequest,
  StartWorkRequest,
  UpdateWorkRequest,
  RecordBuilderValidationResultRequest,
  WorkAssignmentRef,
  WorkAppIntent,
  WorkAppRef,
  WorkAppRelation,
  WorkComponentIntent,
  WorkComponentRef,
  WorkArtifactNode,
  WorkExecutionBinding,
  WorkExecutionGraph,
  WorkExecutionGraphSummary,
  WorkExecutionSource,
  WorkLifecycle,
  WorkRecord,
  WorkRuntimeInstanceGraph,
  WorkRuntimeInstanceStatus,
  WorkRuntimeIssue,
  WorkRuntimeIssueSeverity,
  WorkRuntimeLog,
  WorkRuntimeLogLevel,
  WorkRuntimeRun,
  WorkRuntimeRunStatus,
  WorkScope,
  WorkBuilderFactStatus,
  WorkBuilderIssue,
  WorkBuilderIssueOrigin,
  WorkBuilderIssueStatus,
  WorkBuilderPreviewKind,
  WorkBuilderPreviewResult,
  WorkBuilderPreviewSource,
  WorkBuilderValidationResult,
  WorkCleanupAction,
  WorkCleanupItemReport,
  WorkCleanupItemStatus,
  WorkCleanupReport,
  WorkDeleteOptions,
  WorkDeleteResult,
  WorkSubject,
  WorkSurfaceRef,
  WorkTitleState,
  WorkResourceOwnership,
} from '../domain/workTypes';

type RawWorkScope =
  | { kind: 'system' }
  | { kind: 'workspace'; workspace_path: string };

type RawWorkSurfaceRef =
  | {
      kind: 'os_agent_home';
      agentic_os_session_id?: string | null;
      dispatcher_session_id?: string | null;
    }
  | { kind: 'work_session'; session_id: string }
  | { kind: 'agent_session'; session_id: string }
  | { kind: 'work_center'; work_id: string }
  | {
      kind: 'application_surface';
      product_app_id: string;
      product_app_surface_id: string;
      surface_id: string;
    };

type RawWorkAssignmentRef = {
  kind: WorkAssignmentRef['kind'];
  agent_type?: string | null;
  assistant_id?: string | null;
  application_id?: string | null;
  human_label?: string | null;
  external_label?: string | null;
};

type RawWorkExecutionSource =
  | { source: 'agent_session_run'; session_id: string; turn_id?: string | null }
  | { source: 'delegated_work_run'; parent_work_id: string; child_work_id: string }
  | { source: 'application_action'; application_id: string; action_id: string }
  | {
      source: 'runtime_instance_run';
      runtime_instance_id: string;
      run_id: string;
      component_id: string;
      action: string;
    }
  | { source: 'runtime_subagent_run'; run_id: string }
  | { source: 'external'; label: string; reference: string };

type RawWorkExecutionBinding = {
  id: string;
  status: WorkExecutionBinding['status'];
  source: RawWorkExecutionSource;
  app_builder?: WorkExecutionBinding['appBuilder'] | null;
  created_at: number;
  updated_at: number;
};

type RawAgentSessionRef = {
  session_id: string;
  workspace_path?: string | null;
};

type RawArtifactRef = {
  id: string;
  label?: string | null;
  uri?: string | null;
  runtime_provenance?: {
    runtimeInstanceId: string;
    runId: string;
    componentId: string;
    action: string;
  } | null;
};

type RawMemoryRef = {
  id: string;
  scope?: string | null;
};

type RawRuntimeInstanceRef = {
  id: string;
  slot_id: string;
  app_id: string;
  release_id: string;
  config_revision: string;
  product_app_surface_id: string;
  surface_id: string;
};

type RawWorkTitleState = {
  source?: WorkTitleState['source'];
  locked?: boolean;
  subject_ref?: string | null;
};

type RawWorkAppRef = {
  kind: WorkAppRef['kind'];
  slot_id: string;
  app_id: string;
  release_id: string;
  config_revision: string;
  data_schema_version: string;
};

type RawWorkComponentRef = {
  component_id: string;
  component_kind: string;
  version?: string;
  package_root?: string;
};

type RawWorkSubject =
  | { kind: 'goal' }
  | { kind: 'project'; workspace_path: string }
  | { kind: 'app'; app: RawWorkAppRef; intent?: WorkAppIntent | null }
  | { kind: 'component'; component: RawWorkComponentRef; intent?: WorkComponentIntent | null }
  | { kind: 'artifact'; artifact_id: string };

type RawWorkAppRelation = {
  app: RawWorkAppRef;
  role: WorkAppRelation['role'];
  surface_id?: string | null;
};

type RawWorkRecord = {
  id: string;
  kind: WorkRecord['kind'];
  title: string;
  title_state?: RawWorkTitleState | null;
  objective: string;
  status: WorkRecord['status'];
  visibility: WorkRecord['visibility'];
  subject: RawWorkSubject;
  app_refs: RawWorkAppRelation[];
  scope: RawWorkScope;
  primary_surface: RawWorkSurfaceRef;
  surfaces: RawWorkSurfaceRef[];
  assignment?: RawWorkAssignmentRef | null;
  lifecycle: {
    events: Array<{ status: WorkRecord['status']; label: string; at: number }>;
  };
  summary?: { text: string; updated_at: number } | null;
  session_refs: RawAgentSessionRef[];
  execution_bindings: RawWorkExecutionBinding[];
  runtime_instances?: RawRuntimeInstanceRef[];
  artifact_refs: RawArtifactRef[];
  memory_refs: RawMemoryRef[];
  system_managed?: boolean;
  system_process_kind?: string | null;
  topic_work_id?: string | null;
  created_at: number;
  updated_at: number;
};

type RawWorkDeleteOptions = {
  cascade_child_works: boolean;
  delete_linked_sessions: boolean;
};

type RawWorkCleanupResourceRef = {
  kind: string;
  id: string;
  ownership: WorkResourceOwnership;
  metadata?: Record<string, string> | null;
};

type RawWorkCleanupItem = {
  id: string;
  handler_id: string;
  resource: RawWorkCleanupResourceRef;
  action: WorkCleanupAction;
  required?: boolean;
};

type RawWorkCleanupItemReport = {
  item: RawWorkCleanupItem;
  status: WorkCleanupItemStatus;
  message?: string | null;
};

type RawWorkCleanupReport = {
  work_id: string;
  items?: RawWorkCleanupItemReport[];
};

type RawWorkRuntimeRun = {
  runId: string;
  runtimeInstanceId: string;
  componentId: string;
  componentKind: string;
  action: string;
  status: WorkRuntimeRunStatus;
  startedAt: number;
  updatedAt: number;
  artifactCount?: number;
  eventCount?: number;
  error?: string | null;
};

type RawWorkRuntimeIssue = {
  runtimeInstanceId: string;
  productAppId: string;
  componentId: string;
  severity: WorkRuntimeIssueSeverity;
  message: string;
  source?: string | null;
  category?: string | null;
  timestampMs: number;
};

type RawWorkRuntimeLog = {
  runtimeInstanceId: string;
  productAppId: string;
  componentId: string;
  level: WorkRuntimeLogLevel;
  category: string;
  message: string;
  source?: string | null;
  timestampMs: number;
};

type RawWorkBuilderPreviewResult = {
  id: string;
  kind: WorkBuilderPreviewKind;
  status: WorkBuilderFactStatus;
  source?: WorkBuilderPreviewSource;
  harnessMode?: string | null;
  triggerTurnId?: string | null;
  detail?: string | null;
  checks?: RawWorkBuilderFactCheck[];
  workId: string;
  runtimeInstanceId?: string | null;
  productAppId?: string | null;
  componentId?: string | null;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
  observedAt: number;
  issueCount: number;
  fatalIssueCount: number;
  warningIssueCount: number;
};

type RawWorkBuilderFactCheck = {
  id: string;
  status: WorkBuilderFactStatus;
  detail?: string | null;
};

type RawWorkBuilderValidationResult = {
  id: string;
  toolName: string;
  targetKind: WorkBuilderValidationResult['targetKind'];
  status: WorkBuilderValidationResult['status'];
  workId: string;
  appId?: string | null;
  componentId?: string | null;
  componentKind?: string | null;
  version?: string | null;
  packageRoot?: string | null;
  observedAt: number;
  failedCount: number;
  warningCount: number;
  checks?: RawWorkBuilderFactCheck[];
};

type RawWorkBuilderIssue = {
  id: string;
  appId: string;
  productAppId?: string | null;
  componentId?: string | null;
  runtimeInstanceId?: string | null;
  previewResultId?: string | null;
  severity: WorkRuntimeIssueSeverity;
  status: WorkBuilderIssueStatus;
  message: string;
  source?: string | null;
  category?: string | null;
  timestampMs: number;
  origin: WorkBuilderIssueOrigin;
  resolvedAt?: number | null;
};

type RawWorkArtifactNode = {
  artifact: RawArtifactRef;
  runtimeInstanceId?: string | null;
  runId?: string | null;
};

type RawWorkRuntimeInstanceGraph = {
  instance: RawRuntimeInstanceRef;
  status: WorkRuntimeInstanceStatus;
  runs?: RawWorkRuntimeRun[];
  issues?: RawWorkRuntimeIssue[];
  logs?: RawWorkRuntimeLog[];
  artifacts?: RawWorkArtifactNode[];
};

type RawWorkExecutionGraphSummary = {
  executionCount: number;
  runtimeInstanceCount: number;
  runtimeRunCount: number;
  artifactCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  lastActivityAt?: number | null;
};

type RawWorkExecutionGraph = {
  workId: string;
  updatedAt: number;
  executions: RawWorkExecutionBinding[];
  runtimeInstances: RawWorkRuntimeInstanceGraph[];
  artifacts: RawWorkArtifactNode[];
  issues?: RawWorkRuntimeIssue[];
  logs?: RawWorkRuntimeLog[];
  builderPreviewResults?: RawWorkBuilderPreviewResult[];
  builderValidationResults?: RawWorkBuilderValidationResult[];
  builderIssues?: RawWorkBuilderIssue[];
  summary: RawWorkExecutionGraphSummary;
};

function toRawScope(scope: WorkScope): RawWorkScope {
  return scope.kind === 'workspace'
    ? { kind: 'workspace', workspace_path: scope.workspacePath }
    : { kind: 'system' };
}

function fromRawScope(scope: RawWorkScope): WorkScope {
  return scope.kind === 'workspace'
    ? { kind: 'workspace', workspacePath: scope.workspace_path }
    : { kind: 'system' };
}

function toRawAppRef(app: WorkAppRef): RawWorkAppRef {
  return {
    kind: app.kind,
    slot_id: app.slotId,
    app_id: app.appId,
    release_id: app.releaseId,
    config_revision: app.configRevision,
    data_schema_version: app.dataSchemaVersion,
  };
}

function fromRawAppRef(app: RawWorkAppRef): WorkAppRef {
  return {
    kind: app.kind,
    slotId: app.slot_id,
    appId: app.app_id,
    releaseId: app.release_id,
    configRevision: app.config_revision,
    dataSchemaVersion: app.data_schema_version,
  };
}

function toRawComponentRef(component: WorkComponentRef): RawWorkComponentRef {
  return {
    component_id: component.componentId,
    component_kind: component.componentKind,
    version: component.version ?? '',
    package_root: component.packageRoot ?? '',
  };
}

function fromRawComponentRef(component: RawWorkComponentRef): WorkComponentRef {
  return {
    componentId: component.component_id,
    componentKind: component.component_kind,
    version: component.version || undefined,
    packageRoot: component.package_root || undefined,
  };
}

function toRawSubject(subject: WorkSubject): RawWorkSubject {
  switch (subject.kind) {
    case 'goal':
      return { kind: 'goal' };
    case 'project':
      return { kind: 'project', workspace_path: subject.workspacePath };
    case 'app':
      return { kind: 'app', app: toRawAppRef(subject.app), intent: subject.intent };
    case 'component':
      return {
        kind: 'component',
        component: toRawComponentRef(subject.component),
        intent: subject.intent,
      };
    case 'artifact':
      return { kind: 'artifact', artifact_id: subject.artifactId };
  }
}

function fromRawSubject(subject: RawWorkSubject): WorkSubject {
  switch (subject.kind) {
    case 'goal':
      return { kind: 'goal' };
    case 'project':
      return { kind: 'project', workspacePath: subject.workspace_path };
    case 'app':
      return { kind: 'app', app: fromRawAppRef(subject.app), intent: subject.intent ?? 'use' };
    case 'component':
      return {
        kind: 'component',
        component: fromRawComponentRef(subject.component),
        intent: subject.intent ?? 'develop',
      };
    case 'artifact':
      return { kind: 'artifact', artifactId: subject.artifact_id };
  }
}

function toRawAppRelation(relation: WorkAppRelation): RawWorkAppRelation {
  return {
    app: toRawAppRef(relation.app),
    role: relation.role,
    surface_id: relation.surfaceId,
  };
}

function fromRawAppRelation(relation: RawWorkAppRelation): WorkAppRelation {
  return {
    app: fromRawAppRef(relation.app),
    role: relation.role,
    surfaceId: relation.surface_id ?? undefined,
  };
}

function toRawSurface(surface: WorkSurfaceRef): RawWorkSurfaceRef {
  switch (surface.kind) {
    case 'os_agent_home':
      return { kind: 'os_agent_home', agentic_os_session_id: surface.agenticOsSessionId };
    case 'work_session':
      return { kind: 'work_session', session_id: surface.sessionId };
    case 'agent_session':
      return { kind: 'agent_session', session_id: surface.sessionId };
    case 'work_center':
      return { kind: 'work_center', work_id: surface.workId };
    case 'application_surface':
      return {
        kind: 'application_surface',
        product_app_id: surface.productAppId,
        product_app_surface_id: surface.productAppSurfaceId,
        surface_id: surface.surfaceId,
      };
  }
}

function fromRawSurface(surface: RawWorkSurfaceRef): WorkSurfaceRef {
  switch (surface.kind) {
    case 'os_agent_home':
      return {
        kind: 'os_agent_home',
        agenticOsSessionId: surface.agentic_os_session_id ?? surface.dispatcher_session_id,
      };
    case 'work_session':
      return { kind: 'work_session', sessionId: surface.session_id };
    case 'agent_session':
      return { kind: 'agent_session', sessionId: surface.session_id };
    case 'work_center':
      return { kind: 'work_center', workId: surface.work_id };
    case 'application_surface':
      return {
        kind: 'application_surface',
        productAppId: surface.product_app_id,
        productAppSurfaceId: surface.product_app_surface_id,
        surfaceId: surface.surface_id,
      };
  }
}

function toRawAssignment(assignment?: WorkAssignmentRef | null): RawWorkAssignmentRef | null | undefined {
  if (!assignment) return assignment;
  return {
    kind: assignment.kind,
    agent_type: assignment.agentType,
    assistant_id: assignment.assistantId,
    application_id: assignment.applicationId,
    human_label: assignment.humanLabel,
    external_label: assignment.externalLabel,
  };
}

function fromRawAssignment(assignment?: RawWorkAssignmentRef | null): WorkAssignmentRef | null | undefined {
  if (!assignment) return assignment;
  return {
    kind: assignment.kind,
    agentType: assignment.agent_type ?? undefined,
    assistantId: assignment.assistant_id ?? undefined,
    applicationId: assignment.application_id ?? undefined,
    humanLabel: assignment.human_label ?? undefined,
    externalLabel: assignment.external_label ?? undefined,
  };
}

function fromRawExecutionSource(source: RawWorkExecutionSource): WorkExecutionSource {
  switch (source.source) {
    case 'agent_session_run':
      return { source: 'agent_session_run', sessionId: source.session_id, turnId: source.turn_id };
    case 'delegated_work_run':
      return {
        source: 'delegated_work_run',
        parentWorkId: source.parent_work_id,
        childWorkId: source.child_work_id,
      };
    case 'application_action':
      return {
        source: 'application_action',
        applicationId: source.application_id,
        actionId: source.action_id,
      };
    case 'runtime_instance_run':
      return {
        source: 'runtime_instance_run',
        runtimeInstanceId: source.runtime_instance_id,
        runId: source.run_id,
        componentId: source.component_id,
        action: source.action,
      };
    case 'runtime_subagent_run':
      return { source: 'runtime_subagent_run', runId: source.run_id };
    case 'external':
      return { source: 'external', label: source.label, reference: source.reference };
  }
}

function fromRawExecutionBinding(binding: RawWorkExecutionBinding): WorkExecutionBinding {
  return {
    id: binding.id,
    status: binding.status,
    source: fromRawExecutionSource(binding.source),
    appBuilder: binding.app_builder ?? undefined,
    createdAt: binding.created_at,
    updatedAt: binding.updated_at,
  };
}

function fromRawLifecycle(lifecycle: RawWorkRecord['lifecycle']): WorkLifecycle {
  return { events: lifecycle.events };
}

function fromRawSessionRef(ref: RawAgentSessionRef): AgentSessionRef {
  return { sessionId: ref.session_id, workspacePath: ref.workspace_path };
}

function fromRawArtifactRef(ref: RawArtifactRef): ArtifactRef {
  return {
    id: ref.id,
    label: ref.label,
    uri: ref.uri,
    runtimeProvenance: ref.runtime_provenance
      ? {
          runtimeInstanceId: ref.runtime_provenance.runtimeInstanceId,
          runId: ref.runtime_provenance.runId,
          componentId: ref.runtime_provenance.componentId,
          action: ref.runtime_provenance.action,
        }
      : ref.runtime_provenance,
  };
}

function fromRawMemoryRef(ref: RawMemoryRef): MemoryRef {
  return { id: ref.id, scope: ref.scope };
}

function fromRawRuntimeInstanceRef(ref: RawRuntimeInstanceRef): RuntimeInstanceRef {
  return {
    id: ref.id,
    slotId: ref.slot_id,
    appId: ref.app_id,
    releaseId: ref.release_id,
    configRevision: ref.config_revision,
    productAppSurfaceId: ref.product_app_surface_id,
    surfaceId: ref.surface_id,
  };
}

function toRawTitleState(titleState?: WorkTitleState | null): RawWorkTitleState | null | undefined {
  if (!titleState) return titleState;
  return {
    source: titleState.source,
    locked: titleState.locked,
    subject_ref: titleState.subjectRef,
  };
}

function fromRawTitleState(titleState?: RawWorkTitleState | null): WorkTitleState | undefined {
  if (!titleState) return undefined;
  return {
    source: titleState.source ?? 'user',
    locked: titleState.locked ?? true,
    subjectRef: titleState.subject_ref ?? undefined,
  };
}

export function fromRawWorkRecord(record: RawWorkRecord): WorkRecord {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    titleState: fromRawTitleState(record.title_state),
    objective: record.objective,
    status: record.status,
    visibility: record.visibility,
    subject: fromRawSubject(record.subject),
    appRefs: record.app_refs.map(fromRawAppRelation),
    scope: fromRawScope(record.scope),
    primarySurface: fromRawSurface(record.primary_surface),
    surfaces: record.surfaces.map(fromRawSurface),
    assignment: fromRawAssignment(record.assignment),
    lifecycle: fromRawLifecycle(record.lifecycle),
    summary: record.summary ? { text: record.summary.text, updatedAt: record.summary.updated_at } : record.summary,
    sessionRefs: record.session_refs.map(fromRawSessionRef),
    executionBindings: record.execution_bindings.map(fromRawExecutionBinding),
    runtimeInstances: (record.runtime_instances ?? []).map(fromRawRuntimeInstanceRef),
    artifactRefs: record.artifact_refs.map(fromRawArtifactRef),
    memoryRefs: record.memory_refs.map(fromRawMemoryRef),
    systemManaged: Boolean(record.system_managed),
    systemProcessKind: record.system_process_kind ?? null,
    topicWorkId: record.topic_work_id ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function toRawWorkDeleteOptions(options?: WorkDeleteOptions): RawWorkDeleteOptions {
  return {
    cascade_child_works: Boolean(options?.cascadeChildWorks),
    delete_linked_sessions: Boolean(options?.deleteLinkedSessions),
  };
}

function fromRawWorkCleanupReport(
  report: RawWorkCleanupReport | undefined,
  workId: string
): WorkCleanupReport {
  return {
    workId: report?.work_id ?? workId,
    items: (report?.items ?? []).map((itemReport): WorkCleanupItemReport => ({
      item: {
        id: itemReport.item.id,
        handlerId: itemReport.item.handler_id,
        resource: {
          kind: itemReport.item.resource.kind,
          id: itemReport.item.resource.id,
          ownership: itemReport.item.resource.ownership,
          metadata: itemReport.item.resource.metadata ?? undefined,
        },
        action: itemReport.item.action,
        required: itemReport.item.required ?? false,
      },
      status: itemReport.status,
      message: itemReport.message,
    })),
  };
}

function toRawCreateWorkRequest(request: CreateWorkRequest): Record<string, unknown> {
  return {
    kind: request.kind,
    title: request.title,
    objective: request.objective,
    subject: toRawSubject(request.subject),
    app_refs: (request.appRefs ?? []).map(toRawAppRelation),
    scope: toRawScope(request.scope),
    visibility: request.visibility ?? 'primary',
    primary_surface_policy: request.primarySurfacePolicy ?? 'work_session',
    primary_surface: request.primarySurface ? toRawSurface(request.primarySurface) : undefined,
    assignment: toRawAssignment(request.assignment),
    title_state: toRawTitleState(request.titleState),
    topic_work_id: request.topicWorkId ?? undefined,
  };
}

function fromRawRuntimeRun(run: RawWorkRuntimeRun): WorkRuntimeRun {
  return {
    runId: run.runId,
    runtimeInstanceId: run.runtimeInstanceId,
    componentId: run.componentId,
    componentKind: run.componentKind,
    action: run.action,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    artifactCount: run.artifactCount ?? 0,
    eventCount: run.eventCount ?? 0,
    error: run.error,
  };
}

function fromRawRuntimeIssue(issue: RawWorkRuntimeIssue): WorkRuntimeIssue {
  return {
    runtimeInstanceId: issue.runtimeInstanceId,
    productAppId: issue.productAppId,
    componentId: issue.componentId,
    severity: issue.severity,
    message: issue.message,
    source: issue.source,
    category: issue.category,
    timestampMs: issue.timestampMs,
  };
}

function fromRawRuntimeLog(log: RawWorkRuntimeLog): WorkRuntimeLog {
  return {
    runtimeInstanceId: log.runtimeInstanceId,
    productAppId: log.productAppId,
    componentId: log.componentId,
    level: log.level,
    category: log.category,
    message: log.message,
    source: log.source,
    timestampMs: log.timestampMs,
  };
}

function fromRawBuilderPreviewResult(preview: RawWorkBuilderPreviewResult): WorkBuilderPreviewResult {
  return {
    id: preview.id,
    kind: preview.kind,
    status: preview.status,
    source: preview.source ?? 'runtime-fact',
    harnessMode: preview.harnessMode,
    triggerTurnId: preview.triggerTurnId,
    detail: preview.detail,
    checks: (preview.checks ?? []).map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
    workId: preview.workId,
    runtimeInstanceId: preview.runtimeInstanceId,
    productAppId: preview.productAppId,
    componentId: preview.componentId,
    productAppSurfaceId: preview.productAppSurfaceId,
    surfaceId: preview.surfaceId,
    observedAt: preview.observedAt,
    issueCount: preview.issueCount,
    fatalIssueCount: preview.fatalIssueCount,
    warningIssueCount: preview.warningIssueCount,
  };
}

function toRawBuilderPreviewResult(preview: WorkBuilderPreviewResult): RawWorkBuilderPreviewResult {
  return {
    id: preview.id,
    kind: preview.kind,
    status: preview.status,
    source: preview.source,
    harnessMode: preview.harnessMode,
    triggerTurnId: preview.triggerTurnId,
    detail: preview.detail,
    checks: (preview.checks ?? []).map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
    workId: preview.workId,
    runtimeInstanceId: preview.runtimeInstanceId,
    productAppId: preview.productAppId,
    componentId: preview.componentId,
    productAppSurfaceId: preview.productAppSurfaceId,
    surfaceId: preview.surfaceId,
    observedAt: preview.observedAt,
    issueCount: preview.issueCount,
    fatalIssueCount: preview.fatalIssueCount,
    warningIssueCount: preview.warningIssueCount,
  };
}

function fromRawBuilderValidationResult(validation: RawWorkBuilderValidationResult): WorkBuilderValidationResult {
  return {
    id: validation.id,
    toolName: validation.toolName,
    targetKind: validation.targetKind,
    status: validation.status,
    workId: validation.workId,
    appId: validation.appId,
    componentId: validation.componentId,
    componentKind: validation.componentKind,
    version: validation.version,
    packageRoot: validation.packageRoot,
    observedAt: validation.observedAt,
    failedCount: validation.failedCount,
    warningCount: validation.warningCount,
    checks: (validation.checks ?? []).map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
  };
}

function fromRawBuilderIssue(issue: RawWorkBuilderIssue): WorkBuilderIssue {
  return {
    id: issue.id,
    appId: issue.appId,
    productAppId: issue.productAppId,
    componentId: issue.componentId,
    runtimeInstanceId: issue.runtimeInstanceId,
    previewResultId: issue.previewResultId,
    severity: issue.severity,
    status: issue.status,
    message: issue.message,
    source: issue.source,
    category: issue.category,
    timestampMs: issue.timestampMs,
    origin: issue.origin,
    resolvedAt: issue.resolvedAt,
  };
}

function fromRawArtifactNode(node: RawWorkArtifactNode): WorkArtifactNode {
  return {
    artifact: fromRawArtifactRef(node.artifact),
    runtimeInstanceId: node.runtimeInstanceId,
    runId: node.runId,
  };
}

function fromRawRuntimeInstanceGraph(instance: RawWorkRuntimeInstanceGraph): WorkRuntimeInstanceGraph {
  return {
    instance: fromRawRuntimeInstanceRef(instance.instance),
    status: instance.status,
    runs: (instance.runs ?? []).map(fromRawRuntimeRun),
    issues: (instance.issues ?? []).map(fromRawRuntimeIssue),
    logs: (instance.logs ?? []).map(fromRawRuntimeLog),
    artifacts: (instance.artifacts ?? []).map(fromRawArtifactNode),
  };
}

function fromRawExecutionGraphSummary(summary: RawWorkExecutionGraphSummary): WorkExecutionGraphSummary {
  return {
    executionCount: summary.executionCount,
    runtimeInstanceCount: summary.runtimeInstanceCount,
    runtimeRunCount: summary.runtimeRunCount,
    artifactCount: summary.artifactCount,
    issueCount: summary.issueCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    lastActivityAt: summary.lastActivityAt,
  };
}

function fromRawExecutionGraph(graph: RawWorkExecutionGraph): WorkExecutionGraph {
  return {
    workId: graph.workId,
    updatedAt: graph.updatedAt,
    executions: graph.executions.map(fromRawExecutionBinding),
    runtimeInstances: graph.runtimeInstances.map(fromRawRuntimeInstanceGraph),
    artifacts: graph.artifacts.map(fromRawArtifactNode),
    issues: (graph.issues ?? []).map(fromRawRuntimeIssue),
    logs: (graph.logs ?? []).map(fromRawRuntimeLog),
    builderPreviewResults: (graph.builderPreviewResults ?? []).map(fromRawBuilderPreviewResult),
    builderValidationResults: (graph.builderValidationResults ?? []).map(fromRawBuilderValidationResult),
    builderIssues: (graph.builderIssues ?? []).map(fromRawBuilderIssue),
    summary: fromRawExecutionGraphSummary(graph.summary),
  };
}

function toRawStartWorkRequest(request: StartWorkRequest): Record<string, unknown> {
  return {
    kind: request.kind,
    title: request.title,
    objective: request.objective,
    instructions: request.instructions,
    subject: toRawSubject(request.subject),
    app_refs: (request.appRefs ?? []).map(toRawAppRelation),
    scope: toRawScope(request.scope),
    visibility: request.visibility ?? 'primary',
    primary_surface_policy: request.primarySurfacePolicy ?? 'work_session',
    assignment: toRawAssignment(request.assignment),
    idempotency_key: request.idempotencyKey,
  };
}

function toRawUpdateWorkRequest(request: UpdateWorkRequest): Record<string, unknown> {
  return {
    work_id: request.workId,
    title: request.title,
    objective: request.objective,
    summary: request.summary,
    status: request.status,
    primary_surface: request.primarySurface ? toRawSurface(request.primarySurface) : undefined,
    title_state: toRawTitleState(request.titleState),
    kind: request.kind,
    topic_work_id: request.clearTopicWorkId ? undefined : (request.topicWorkId ?? undefined),
    clear_topic_work_id: request.clearTopicWorkId ?? false,
    visibility: request.visibility,
  };
}

function toRawBuilderValidationResult(validation: WorkBuilderValidationResult): RawWorkBuilderValidationResult {
  return {
    id: validation.id,
    toolName: validation.toolName,
    targetKind: validation.targetKind,
    status: validation.status,
    workId: validation.workId,
    appId: validation.appId,
    componentId: validation.componentId,
    componentKind: validation.componentKind,
    version: validation.version,
    packageRoot: validation.packageRoot,
    observedAt: validation.observedAt,
    failedCount: validation.failedCount,
    warningCount: validation.warningCount,
    checks: validation.checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
  };
}

export class AgenticOsWorkApi {
  async listWorks(request: { workspacePath?: string | null; app?: WorkAppRef | null } = {}): Promise<WorkRecord[]> {
    try {
      const response = await api.invoke<{ works: RawWorkRecord[] }>('agentic_os_list_works', {
        request: {
          workspace_path: request.workspacePath,
          app: request.app ? toRawAppRef(request.app) : undefined,
        },
      });
      return response.works.map(fromRawWorkRecord);
    } catch (error) {
      throw createTauriCommandError('agentic_os_list_works', error, request);
    }
  }

  async getWork(workId: string): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_get_work', {
        request: { work_id: workId },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_get_work', error, { workId });
    }
  }

  async deleteWork(workId: string, options?: WorkDeleteOptions): Promise<WorkDeleteResult> {
    try {
      const response = await api.invoke<{ deleted: boolean; cleanup_report?: RawWorkCleanupReport }>(
        'agentic_os_delete_work',
        {
          request: { work_id: workId, options: toRawWorkDeleteOptions(options) },
        }
      );
      return {
        deleted: response.deleted,
        cleanupReport: fromRawWorkCleanupReport(response.cleanup_report, workId),
      };
    } catch (error) {
      throw createTauriCommandError('agentic_os_delete_work', error, { workId, options });
    }
  }

  async getWorkExecutionGraph(workId: string): Promise<WorkExecutionGraph> {
    try {
      const response = await api.invoke<{ graph: RawWorkExecutionGraph }>('agentic_os_get_work_execution_graph', {
        request: { workId },
      });
      return fromRawExecutionGraph(response.graph);
    } catch (error) {
      throw createTauriCommandError('agentic_os_get_work_execution_graph', error, { workId });
    }
  }

  async createWork(request: CreateWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_create_work', {
        request: toRawCreateWorkRequest(request),
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_create_work', error, request);
    }
  }

  async resolveAppWork(request: ResolveAppWorkRequest): Promise<{ work: WorkRecord; created: boolean }> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord; created: boolean }>('agentic_os_resolve_app_work', {
        request: {
          app: toRawAppRef(request.app),
          intent: request.intent,
          title: request.title,
          objective: request.objective,
          scope: toRawScope(request.scope),
          visibility: request.visibility ?? 'primary',
          primary_surface_policy: request.primarySurfacePolicy ?? 'application_surface',
          primary_surface: request.primarySurface ? toRawSurface(request.primarySurface) : undefined,
          assignment: toRawAssignment(request.assignment),
          app_refs: (request.appRefs ?? []).map(toRawAppRelation),
        },
      });
      return { work: fromRawWorkRecord(response.work), created: response.created };
    } catch (error) {
      throw createTauriCommandError('agentic_os_resolve_app_work', error, request);
    }
  }

  async resolveComponentWork(request: ResolveComponentWorkRequest): Promise<{ work: WorkRecord; created: boolean }> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord; created: boolean }>('agentic_os_resolve_component_work', {
        request: {
          component: toRawComponentRef(request.component),
          intent: request.intent,
          title: request.title,
          objective: request.objective,
          scope: toRawScope(request.scope),
          visibility: request.visibility ?? 'secondary',
          primary_surface_policy: request.primarySurfacePolicy ?? 'work_center',
          assignment: toRawAssignment(request.assignment),
          app_refs: (request.appRefs ?? []).map(toRawAppRelation),
        },
      });
      return { work: fromRawWorkRecord(response.work), created: response.created };
    } catch (error) {
      throw createTauriCommandError('agentic_os_resolve_component_work', error, request);
    }
  }

  async startWork(request: StartWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_start_work', {
        request: toRawStartWorkRequest(request),
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_start_work', error, request);
    }
  }

  async updateWork(request: UpdateWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_update_work', {
        request: toRawUpdateWorkRequest(request),
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_update_work', error, request);
    }
  }

  async linkSessionToWork(request: LinkSessionToWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_link_session_to_work', {
        request: {
          work_id: request.workId,
          session_id: request.sessionId,
          workspace_path: request.workspacePath,
          surface: request.surface ? toRawSurface(request.surface) : undefined,
          set_primary: request.setPrimary ?? false,
        },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_link_session_to_work', error, request);
    }
  }

  async advanceWork(request: AdvanceWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_advance_work', {
        request: {
          work_id: request.workId,
          instructions: request.instructions,
          advance_policy: request.advancePolicy,
        },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_advance_work', error, request);
    }
  }

  async controlWork(request: ControlWorkRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_control_work', {
        request: { work_id: request.workId, action: request.action },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_control_work', error, request);
    }
  }

  async recordBuilderPreviewResult(request: RecordBuilderPreviewResultRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_record_builder_preview_result', {
        request: {
          work_id: request.workId,
          preview_result: toRawBuilderPreviewResult(request.previewResult),
        },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_record_builder_preview_result', error, request);
    }
  }

  async recordBuilderValidationResult(request: RecordBuilderValidationResultRequest): Promise<WorkRecord> {
    try {
      const response = await api.invoke<{ work: RawWorkRecord }>('agentic_os_record_builder_validation_result', {
        request: {
          work_id: request.workId,
          validation_result: toRawBuilderValidationResult(request.validationResult),
        },
      });
      return fromRawWorkRecord(response.work);
    } catch (error) {
      throw createTauriCommandError('agentic_os_record_builder_validation_result', error, request);
    }
  }
}

export const agenticOsWorkApi = new AgenticOsWorkApi();
