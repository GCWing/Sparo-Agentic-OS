import type {
  WorkAppRef,
  WorkAppRelation,
  WorkKind,
  WorkSubject,
} from './workTypes';

export interface WorkAppIdentitySource {
  kind: WorkKind;
  subject: WorkSubject;
  appRefs: WorkAppRelation[];
  primaryAppRef?: WorkAppRef;
}

const DISPLAY_ROLE_ORDER: WorkAppRelation['role'][] = [
  'subject',
  'executor',
  'surface',
  'origin',
  'context',
];

/** Resolves the App that owns the Work's primary user-facing identity. */
export function getPrimaryWorkAppRef(work: WorkAppIdentitySource): WorkAppRef | undefined {
  if (work.subject.kind === 'app') return work.subject.app;
  if (work.primaryAppRef) return work.primaryAppRef;

  for (const role of DISPLAY_ROLE_ORDER) {
    const app = work.appRefs.find((relation) => relation.role === role)?.app;
    if (app) return app;
  }
  return undefined;
}

/** Only App-owned Work replaces its semantic Work glyph with an App logo. */
export function workUsesOwnAppIcon(work: WorkAppIdentitySource): boolean {
  return work.subject.kind === 'app' || work.kind === 'app_workflow';
}
