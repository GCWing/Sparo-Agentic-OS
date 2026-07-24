import {
  appScopeFromWorkspaceIdentity,
  appScopeFromWorkScope,
  systemAppScope,
  type AppScope,
} from '@/shared/types/app-scope';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { flowChatStore } from '../store/FlowChatStore';

export function resolveToolSessionAppScope(sessionId?: string | null): AppScope {
  if (sessionId) {
    const work = useWorkStore.getState().works.find((candidate) =>
      candidate.surfaces.some((surface) =>
        (surface.kind === 'work_session' || surface.kind === 'agent_session') &&
        surface.sessionId === sessionId
      )
    );
    if (work) {
      return appScopeFromWorkScope(work.scope, work.workspacePath);
    }
  }

  const session = sessionId
    ? flowChatStore.getState().sessions.get(sessionId)
    : undefined;
  if (!session?.workspacePath) return systemAppScope();
  return appScopeFromWorkspaceIdentity({
    workspaceId: session.workspaceId
      ?? (session.domain.kind === 'workspace' ? session.domain.workspace_id : null),
    workspacePath: session.workspacePath,
  });
}
