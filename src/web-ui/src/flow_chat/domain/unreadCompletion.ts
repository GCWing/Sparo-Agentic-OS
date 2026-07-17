import type { Session } from '../types/flow-chat';

export function canTrackUnreadCompletion(
  session?: Pick<Session, 'isTransient' | 'sessionKind'> | null,
): boolean {
  return Boolean(
    session
    && session.isTransient !== true
    && session.sessionKind !== 'internal',
  );
}
