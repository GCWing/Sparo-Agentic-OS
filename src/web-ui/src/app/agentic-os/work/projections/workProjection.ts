import type {
  WorkAppRef,
  WorkAppRelation,
  WorkKind,
  WorkRecord,
  WorkScope,
  WorkStatus,
  WorkSubject,
  WorkSurfaceRef,
} from '../domain/workTypes';
import { resolveEffectiveWorkStatus } from '../domain/workStatus';
import { resolveDefaultWorkSurface } from '../domain/workSurface';
import { getPrimaryWorkAppRef } from '../domain/workAppIdentity';

export interface WorkProjection {
  id: string;
  scope: WorkScope;
  kind: WorkKind;
  title: string;
  objective: string;
  status: WorkStatus;
  subject: WorkSubject;
  appRefs: WorkAppRelation[];
  primaryAppRef?: WorkAppRef;
  workspacePath?: string;
  primarySurface: WorkSurfaceRef;
  surfaces?: WorkSurfaceRef[];
  sessionId?: string;
  systemManaged: boolean;
  systemProcessKind?: string | null;
  topicWorkId?: string | null;
  visibility: WorkRecord['visibility'];
  updatedAt: number;
}

export function projectWork(work: WorkRecord): WorkProjection {
  const primarySurface = resolveDefaultWorkSurface(work);
  const primaryAppRef = getPrimaryWorkAppRef(work);
  return {
    id: work.id,
    scope: work.scope,
    kind: work.kind,
    title: work.title.trim() || work.id.slice(0, 10),
    objective: work.objective,
    status: resolveEffectiveWorkStatus(work),
    subject: work.subject,
    appRefs: work.appRefs,
    primaryAppRef,
    workspacePath: work.workspacePath ?? undefined,
    primarySurface,
    surfaces: work.surfaces,
    sessionId:
      primarySurface.kind === 'work_session' || primarySurface.kind === 'agent_session'
        ? primarySurface.sessionId
        : undefined,
    systemManaged: Boolean(work.systemManaged),
    systemProcessKind: work.systemProcessKind,
    topicWorkId: work.topicWorkId,
    visibility: work.visibility,
    updatedAt: work.updatedAt,
  };
}
