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

export type WorkTitleSource = 'user' | 'template' | 'session' | 'live_app' | 'objective' | 'agent';

export interface WorkTitleState {
  source: WorkTitleSource;
  locked: boolean;
  subjectRef?: string | null;
}

export type WorkScope =
  | { kind: 'system' }
  | { kind: 'workspace'; workspacePath: string };

export type WorkSurfaceRef =
  | { kind: 'os_agent_home'; dispatcherSessionId?: string | null }
  | { kind: 'work_session'; sessionId: string }
  | { kind: 'agent_session'; sessionId: string }
  | { kind: 'live_app'; appId: string }
  | { kind: 'work_center'; workId: WorkId }
  | { kind: 'application_surface'; applicationId: string; surfaceId: string };

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
  | { source: 'live_app_worker'; appId: string; workerId?: string | null }
  | { source: 'application_action'; applicationId: string; actionId: string }
  | { source: 'runtime_subagent_run'; runId: string }
  | { source: 'external'; label: string; reference: string };

export interface WorkExecutionBinding {
  id: string;
  status: WorkExecutionBindingStatus;
  source: WorkExecutionSource;
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
}

export interface MemoryRef {
  id: string;
  scope?: string | null;
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
  scope: WorkScope;
  primarySurface: WorkSurfaceRef;
  surfaces: WorkSurfaceRef[];
  assignment?: WorkAssignmentRef | null;
  lifecycle: WorkLifecycle;
  summary?: WorkSummary | null;
  sessionRefs: AgentSessionRef[];
  executionBindings: WorkExecutionBinding[];
  artifactRefs: ArtifactRef[];
  memoryRefs: MemoryRef[];
  createdAt: number;
  updatedAt: number;
}

export type PrimarySurfacePolicy = 'work_center' | 'work_session' | 'live_app';

export interface CreateWorkRequest {
  kind: WorkKind;
  title: string;
  objective: string;
  scope: WorkScope;
  visibility?: WorkVisibility;
  primarySurfacePolicy?: PrimarySurfacePolicy;
  assignment?: WorkAssignmentRef | null;
  liveAppId?: string | null;
  titleState?: WorkTitleState | null;
}

export interface StartWorkRequest {
  kind: WorkKind;
  title: string;
  objective: string;
  instructions: string;
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
