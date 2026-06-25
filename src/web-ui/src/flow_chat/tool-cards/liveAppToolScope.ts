import {
  appScopeFromWorkspacePath,
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
      return work.scope.kind === 'workspace'
        ? appScopeFromWorkspacePath(work.scope.workspacePath) ?? systemAppScope()
        : systemAppScope();
    }
  }

  const workspacePath = sessionId
    ? flowChatStore.getState().sessions.get(sessionId)?.workspacePath
    : undefined;
  return appScopeFromWorkspacePath(workspacePath) ?? systemAppScope();
}
