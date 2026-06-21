import type { FlowChatState, Session } from '../types/flow-chat';

function sessionSignature(session: Session): string {
  const parentThreadSignature = session.btwThreads
    ?.map(thread => [
      thread.childSessionId,
      thread.title,
      thread.status,
      thread.parentTurnIndex ?? '',
      thread.error ?? '',
    ].join(','))
    .join(';') ?? '';

  return [
    session.sessionId,
    session.title ?? '',
    session.titleStatus ?? '',
    session.status,
    session.descriptor.hostKind,
    session.descriptor.profileId,
    session.descriptor.identityId,
    session.descriptor.agentPolicy.activeAgentId,
    session.workspacePath ?? '',
    session.workspaceId ?? '',
    session.storageScope ?? '',
    session.parentSessionId ?? '',
    session.sessionKind,
    session.createdAt,
    session.lastFinishedAt ?? '',
    session.loadPhase,
    session.isTransient ? 't' : '',
    session.hasUnreadCompletion ?? '',
    session.needsUserAttention ?? '',
    session.error ?? '',
    parentThreadSignature,
  ].join('|');
}

export function getSessionNavigationSignature(
  state: FlowChatState,
  focusedSessionId: string | null = null
): string {
  return [
    focusedSessionId ?? '',
    state.sessions.size,
    ...Array.from(state.sessions.values()).map(sessionSignature),
  ].join('\n');
}
