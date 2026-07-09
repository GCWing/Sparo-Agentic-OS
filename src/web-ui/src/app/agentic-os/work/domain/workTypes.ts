export type WorkId = string;

export type WorkKind =
  | 'one_shot'
  | 'multi_step'
  | 'long_running_session'
  | 'recurring'
  | 'tracking'
  | 'topic'
  | 'app_workflow'
  | 'delegated_work';

export type WorkStatus =
  | 'draft'
  | 'active'
  | 'running'
  | 'waiting_user'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'archived';

export type WorkVisibility = 'primary' | 'secondary' | 'hidden';

export type WorkTitleSource = 'user' | 'template' | 'session' | 'application_surface' | 'objective' | 'agent';

export interface WorkTitleState {
  source: WorkTitleSource;
  locked: boolean;
  subjectRef?: string | null;
}

export type WorkScope =
  | { kind: 'system' }
  | { kind: 'workspace'; workspacePath: string };

export type WorkAppKind = 'native_app' | 'product_app';

export interface WorkAppRef {
  kind: WorkAppKind;
  appId: string;
  appVersion?: string;
  componentLockDigest?: string;
}

export type WorkAppIntent = 'use' | 'run' | 'develop' | 'debug' | 'edit' | 'review';

export interface WorkComponentRef {
  componentId: string;
  componentKind: string;
  version?: string;
  packageRoot?: string;
}

export type WorkComponentIntent = 'develop' | 'debug' | 'edit' | 'review';

export type WorkSubject =
  | { kind: 'goal' }
  | { kind: 'project'; workspacePath: string }
  | { kind: 'app'; app: WorkAppRef; intent: WorkAppIntent }
  | { kind: 'component'; component: WorkComponentRef; intent: WorkComponentIntent }
  | { kind: 'artifact'; artifactId: string };

export type WorkAppRelationRole = 'subject' | 'executor' | 'surface' | 'origin' | 'context';

export interface WorkAppRelation {
  app: WorkAppRef;
  role: WorkAppRelationRole;
  surfaceId?: string | null;
}

export type WorkSurfaceRef =
  | { kind: 'os_agent_home'; agenticOsSessionId?: string | null }
  | { kind: 'work_session'; sessionId: string }
  | { kind: 'agent_session'; sessionId: string }
  | { kind: 'work_center'; workId: WorkId }
  | {
      kind: 'application_surface';
      productAppId: string;
      productAppSurfaceId: string;
      surfaceId: string;
    };

export type WorkAssignmentKind = 'agent' | 'assistant' | 'application' | 'human' | 'external';

export interface WorkAssignmentRef {
  kind: WorkAssignmentKind;
  agentType?: string;
  assistantId?: string;
  applicationId?: string;
  humanLabel?: string;
  externalLabel?: string;
}

export type WorkExecutionBindingStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type WorkExecutionSource =
  | { source: 'agent_session_run'; sessionId: string; turnId?: string | null }
  | { source: 'delegated_work_run'; parentWorkId: WorkId; childWorkId: WorkId }
  | { source: 'application_action'; applicationId: string; actionId: string }
  | {
      source: 'runtime_instance_run';
      runtimeInstanceId: string;
      runId: string;
      componentId: string;
      action: string;
    }
  | { source: 'runtime_subagent_run'; runId: string }
  | { source: 'external'; label: string; reference: string };

export interface WorkExecutionAppBuilderContext {
  workId?: WorkId | null;
  issueId: string;
  productAppId?: string | null;
  subjectKind?: string | null;
  componentKind?: string | null;
  runtimeInstanceId?: string | null;
  componentId?: string | null;
  previewResultId?: string | null;
  packageRoot?: string | null;
  severity?: string | null;
  category?: string | null;
  source?: string | null;
  message?: string | null;
}

export interface WorkExecutionBinding {
  id: string;
  status: WorkExecutionBindingStatus;
  source: WorkExecutionSource;
  appBuilder?: WorkExecutionAppBuilderContext | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSessionRef {
  sessionId: string;
  workspacePath?: string | null;
}

export interface ArtifactRef {
  id: string;
  label?: string | null;
  uri?: string | null;
  runtimeProvenance?: {
    runtimeInstanceId: string;
    runId: string;
    componentId: string;
    action: string;
  } | null;
}

export interface MemoryRef {
  id: string;
  scope?: string | null;
}

export interface RuntimeInstanceRef {
  id: string;
  productAppId: string;
  appVersion: string;
  componentLockDigest: string;
  productAppSurfaceId: string;
  surfaceId: string;
}

export type WorkRuntimeRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkRuntimeInstanceStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'degraded';

export type WorkRuntimeIssueSeverity = 'fatal' | 'warning' | 'noise';
export type WorkRuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type WorkBuilderPreviewKind =
  | 'product-app-preview'
  | 'agent-chat'
  | 'sidecar'
  | 'full-app'
  | 'embedded'
  | 'capability'
  | 'agent-eval'
  | 'runtime-boundary'
  | 'runtime-dependencies'
  | 'permission-review'
  | 'user-path-rehearsal'
  | 'release-rehearsal';
export type WorkBuilderPreviewSource =
  | 'runtime-fact'
  | 'runtime-observation'
  | 'preview-harness'
  | 'fix-rerun'
  | 'release-rehearsal';
export type WorkBuilderFactStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'notRun'
  | 'notVerified'
  | 'blocked'
  | 'running'
  | 'ready'
  | 'waiting';
export type WorkBuilderValidationTargetKind = 'product-app' | 'component';
export type WorkBuilderIssueStatus = 'open' | 'acknowledged' | 'stillOpen' | 'regressed' | 'fixed';
export type WorkBuilderIssueOrigin =
  | 'runtime-event'
  | 'work-execution-graph'
  | 'validation'
  | 'preview'
  | 'user-feedback';

export interface WorkRuntimeRun {
  runId: string;
  runtimeInstanceId: string;
  componentId: string;
  componentKind: string;
  action: string;
  status: WorkRuntimeRunStatus;
  startedAt: number;
  updatedAt: number;
  artifactCount: number;
  eventCount: number;
  error?: string | null;
}

export interface WorkRuntimeIssue {
  runtimeInstanceId: string;
  productAppId: string;
  componentId: string;
  severity: WorkRuntimeIssueSeverity;
  message: string;
  source?: string | null;
  category?: string | null;
  timestampMs: number;
}

export interface WorkRuntimeLog {
  runtimeInstanceId: string;
  productAppId: string;
  componentId: string;
  level: WorkRuntimeLogLevel;
  category: string;
  message: string;
  source?: string | null;
  timestampMs: number;
}

export interface WorkBuilderPreviewResult {
  id: string;
  kind: WorkBuilderPreviewKind;
  status: WorkBuilderFactStatus;
  source: WorkBuilderPreviewSource;
  harnessMode?: string | null;
  triggerTurnId?: string | null;
  detail?: string | null;
  checks?: WorkBuilderFactCheck[];
  workId: WorkId;
  runtimeInstanceId?: string | null;
  productAppId?: string | null;
  componentId?: string | null;
  productAppSurfaceId?: string | null;
  surfaceId?: string | null;
  observedAt: number;
  issueCount: number;
  fatalIssueCount: number;
  warningIssueCount: number;
}

export interface WorkBuilderFactCheck {
  id: string;
  status: WorkBuilderFactStatus;
  detail?: string | null;
}

export interface WorkBuilderValidationResult {
  id: string;
  toolName: string;
  targetKind: WorkBuilderValidationTargetKind;
  status: WorkBuilderFactStatus;
  workId: WorkId;
  appId?: string | null;
  componentId?: string | null;
  componentKind?: string | null;
  version?: string | null;
  packageRoot?: string | null;
  observedAt: number;
  failedCount: number;
  warningCount: number;
  checks: WorkBuilderFactCheck[];
}

export interface WorkBuilderIssue {
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
}

export interface WorkArtifactNode {
  artifact: ArtifactRef;
  runtimeInstanceId?: string | null;
  runId?: string | null;
}

export interface WorkRuntimeInstanceGraph {
  instance: RuntimeInstanceRef;
  status: WorkRuntimeInstanceStatus;
  runs: WorkRuntimeRun[];
  issues: WorkRuntimeIssue[];
  logs: WorkRuntimeLog[];
  artifacts: WorkArtifactNode[];
}

export interface WorkExecutionGraphSummary {
  executionCount: number;
  runtimeInstanceCount: number;
  runtimeRunCount: number;
  artifactCount: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  lastActivityAt?: number | null;
}

export interface WorkExecutionGraph {
  workId: WorkId;
  updatedAt: number;
  executions: WorkExecutionBinding[];
  runtimeInstances: WorkRuntimeInstanceGraph[];
  artifacts: WorkArtifactNode[];
  issues: WorkRuntimeIssue[];
  logs: WorkRuntimeLog[];
  builderPreviewResults: WorkBuilderPreviewResult[];
  builderValidationResults: WorkBuilderValidationResult[];
  builderIssues: WorkBuilderIssue[];
  summary: WorkExecutionGraphSummary;
}

export interface WorkSummary {
  text: string;
  updatedAt: number;
}

export interface WorkLifecycleEvent {
  status: WorkStatus;
  label: string;
  at: number;
}

export interface WorkLifecycle {
  events: WorkLifecycleEvent[];
}

export interface WorkRecord {
  id: WorkId;
  kind: WorkKind;
  title: string;
  titleState?: WorkTitleState;
  objective: string;
  status: WorkStatus;
  visibility: WorkVisibility;
  subject: WorkSubject;
  appRefs: WorkAppRelation[];
  scope: WorkScope;
  primarySurface: WorkSurfaceRef;
  surfaces: WorkSurfaceRef[];
  assignment?: WorkAssignmentRef | null;
  lifecycle: WorkLifecycle;
  summary?: WorkSummary | null;
  sessionRefs: AgentSessionRef[];
  executionBindings: WorkExecutionBinding[];
  runtimeInstances: RuntimeInstanceRef[];
  artifactRefs: ArtifactRef[];
  memoryRefs: MemoryRef[];
  systemManaged: boolean;
  systemProcessKind?: string | null;
  topicWorkId?: WorkId | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkDeleteOptions {
  cascadeChildWorks?: boolean;
  deleteLinkedSessions?: boolean;
}

export type WorkResourceOwnership = 'owned' | 'linked' | 'derived' | 'external';
export type WorkCleanupAction = 'delete' | 'detach' | 'retain' | 'archive' | 'stop';
export type WorkCleanupItemStatus = 'planned' | 'succeeded' | 'failed' | 'retained' | 'skipped';

export interface WorkCleanupResourceRef {
  kind: string;
  id: string;
  ownership: WorkResourceOwnership;
  metadata?: Record<string, string>;
}

export interface WorkCleanupItem {
  id: string;
  handlerId: string;
  resource: WorkCleanupResourceRef;
  action: WorkCleanupAction;
  required: boolean;
}

export interface WorkCleanupItemReport {
  item: WorkCleanupItem;
  status: WorkCleanupItemStatus;
  message?: string | null;
}

export interface WorkCleanupReport {
  workId: string;
  items: WorkCleanupItemReport[];
}

export interface WorkDeleteResult {
  deleted: boolean;
  cleanupReport: WorkCleanupReport;
}

export type PrimarySurfacePolicy = 'work_center' | 'work_session' | 'application_surface';

export interface CreateWorkRequest {
  kind: WorkKind;
  title: string;
  objective: string;
  subject: WorkSubject;
  appRefs?: WorkAppRelation[];
  scope: WorkScope;
  visibility?: WorkVisibility;
  primarySurfacePolicy?: PrimarySurfacePolicy;
  primarySurface?: WorkSurfaceRef | null;
  assignment?: WorkAssignmentRef | null;
  titleState?: WorkTitleState | null;
  topicWorkId?: WorkId | null;
}

export interface StartWorkRequest {
  kind: WorkKind;
  title: string;
  objective: string;
  instructions: string;
  subject: WorkSubject;
  appRefs?: WorkAppRelation[];
  scope: WorkScope;
  visibility?: WorkVisibility;
  primarySurfacePolicy?: 'work_session';
  assignment: { kind: 'agent'; agentType: string };
  idempotencyKey?: string | null;
}

export interface UpdateWorkRequest {
  workId: WorkId;
  title?: string;
  objective?: string;
  summary?: string;
  status?: WorkStatus;
  primarySurface?: WorkSurfaceRef;
  titleState?: WorkTitleState | null;
  kind?: WorkKind;
  topicWorkId?: WorkId | null;
  clearTopicWorkId?: boolean;
  visibility?: WorkVisibility;
}

export interface ResolveAppWorkRequest {
  app: WorkAppRef;
  intent: WorkAppIntent;
  title: string;
  objective: string;
  scope: WorkScope;
  visibility?: WorkVisibility;
  primarySurfacePolicy?: PrimarySurfacePolicy;
  primarySurface?: WorkSurfaceRef | null;
  assignment?: WorkAssignmentRef | null;
  appRefs?: WorkAppRelation[];
}

export interface ResolveComponentWorkRequest {
  component: WorkComponentRef;
  intent: WorkComponentIntent;
  title: string;
  objective: string;
  scope: WorkScope;
  visibility?: WorkVisibility;
  primarySurfacePolicy?: PrimarySurfacePolicy;
  assignment?: WorkAssignmentRef | null;
}

export interface LinkSessionToWorkRequest {
  workId: WorkId;
  sessionId: string;
  workspacePath?: string | null;
  surface?: WorkSurfaceRef | null;
  setPrimary?: boolean;
}

export interface AdvanceWorkRequest {
  workId: WorkId;
  instructions: string;
  advancePolicy?: 'start_if_idle' | 'enqueue' | 'retry' | string;
}

export type ControlWorkAction =
  | 'pause'
  | 'resume'
  | 'cancel_current_execution'
  | 'archive'
  | 'reopen';

export interface ControlWorkRequest {
  workId: WorkId;
  action: ControlWorkAction;
}

export interface RecordBuilderValidationResultRequest {
  workId: WorkId;
  validationResult: WorkBuilderValidationResult;
}

export interface RecordBuilderPreviewResultRequest {
  workId: WorkId;
  previewResult: WorkBuilderPreviewResult;
}
