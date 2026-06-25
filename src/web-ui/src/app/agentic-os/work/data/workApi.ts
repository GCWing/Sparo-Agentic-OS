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
  StartWorkRequest,
  UpdateWorkRequest,
  WorkAssignmentRef,
  WorkAppIntent,
  WorkAppRef,
  WorkAppRelation,
  WorkExecutionBinding,
  WorkExecutionSource,
  WorkLifecycle,
  WorkRecord,
  WorkScope,
  WorkSubject,
  WorkSurfaceRef,
  WorkTitleState,
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
  | { kind: 'live_app'; app_id: string }
  | { kind: 'work_center'; work_id: string }
  | { kind: 'application_surface'; application_id: string; surface_id: string };

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
  | { source: 'live_app_worker'; app_id: string; worker_id?: string | null }
  | { source: 'application_action'; application_id: string; action_id: string }
  | { source: 'runtime_subagent_run'; run_id: string }
  | { source: 'external'; label: string; reference: string };

type RawWorkExecutionBinding = {
  id: string;
  status: WorkExecutionBinding['status'];
  source: RawWorkExecutionSource;
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
};

type RawMemoryRef = {
  id: string;
  scope?: string | null;
};

type RawWorkTitleState = {
  source?: WorkTitleState['source'];
  locked?: boolean;
  subject_ref?: string | null;
};

type RawWorkAppRef = {
  kind: WorkAppRef['kind'];
  app_id: string;
};

type RawWorkSubject =
  | { kind: 'goal' }
  | { kind: 'project'; workspace_path: string }
  | { kind: 'app'; app: RawWorkAppRef; intent?: WorkAppIntent | null }
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
  artifact_refs: RawArtifactRef[];
  memory_refs: RawMemoryRef[];
  created_at: number;
  updated_at: number;
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
  return { kind: app.kind, app_id: app.appId };
}

function fromRawAppRef(app: RawWorkAppRef): WorkAppRef {
  return { kind: app.kind, appId: app.app_id };
}

function toRawSubject(subject: WorkSubject): RawWorkSubject {
  switch (subject.kind) {
    case 'goal':
      return { kind: 'goal' };
    case 'project':
      return { kind: 'project', workspace_path: subject.workspacePath };
    case 'app':
      return { kind: 'app', app: toRawAppRef(subject.app), intent: subject.intent };
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
    case 'live_app':
      return { kind: 'live_app', app_id: surface.appId };
    case 'work_center':
      return { kind: 'work_center', work_id: surface.workId };
    case 'application_surface':
      return {
        kind: 'application_surface',
        application_id: surface.applicationId,
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
    case 'live_app':
      return { kind: 'live_app', appId: surface.app_id };
    case 'work_center':
      return { kind: 'work_center', workId: surface.work_id };
    case 'application_surface':
      return {
        kind: 'application_surface',
        applicationId: surface.application_id,
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
    case 'live_app_worker':
      return { source: 'live_app_worker', appId: source.app_id, workerId: source.worker_id };
    case 'application_action':
      return {
        source: 'application_action',
        applicationId: source.application_id,
        actionId: source.action_id,
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
  return { id: ref.id, label: ref.label, uri: ref.uri };
}

function fromRawMemoryRef(ref: RawMemoryRef): MemoryRef {
  return { id: ref.id, scope: ref.scope };
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
    artifactRefs: record.artifact_refs.map(fromRawArtifactRef),
    memoryRefs: record.memory_refs.map(fromRawMemoryRef),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
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
    assignment: toRawAssignment(request.assignment),
    title_state: toRawTitleState(request.titleState),
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
          primary_surface_policy: request.primarySurfacePolicy ?? 'live_app',
          assignment: toRawAssignment(request.assignment),
          app_refs: (request.appRefs ?? []).map(toRawAppRelation),
        },
      });
      return { work: fromRawWorkRecord(response.work), created: response.created };
    } catch (error) {
      throw createTauriCommandError('agentic_os_resolve_app_work', error, request);
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
}

export const agenticOsWorkApi = new AgenticOsWorkApi();
