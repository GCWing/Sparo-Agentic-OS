import type { Session, SessionLoadPhase } from '../types/flow-chat';

export function canHydrateSession(session?: Pick<Session, 'loadPhase'> | null): boolean {
  return session?.loadPhase === 'metadata-only' || session?.loadPhase === 'hydrate-failed';
}

export function isSessionHydrating(session?: Pick<Session, 'loadPhase'> | null): boolean {
  return session?.loadPhase === 'hydrating';
}

export function isSessionTranscriptReady(session?: Pick<Session, 'loadPhase'> | null): boolean {
  return session?.loadPhase === 'hydrated' || session?.loadPhase === 'live';
}

export function sessionHasLoadPhase(
  session: Pick<Session, 'loadPhase'>,
  ...phases: SessionLoadPhase[]
): boolean {
  return phases.includes(session.loadPhase);
}
