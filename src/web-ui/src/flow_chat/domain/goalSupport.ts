import type { SessionDomain } from '@/shared/types/session-history';
import { isSystemAgenticOsSession, type SessionDescriptor } from './sessionDescriptor';

type WorkspaceScopeKind = 'workspace' | 'global';

interface GoalSupportTarget {
  workspacePath?: string | null;
  workspaceScopeKind?: WorkspaceScopeKind;
  domain?: SessionDomain | null;
  descriptor?: SessionDescriptor | null;
  agentId?: string | null;
}

function isAgenticOsAgentId(agentId?: string | null): boolean {
  const normalized = agentId?.trim().toLowerCase().replace(/[-_]/g, '') ?? '';
  return normalized === 'osagent' || normalized === 'dispatcher' || normalized === 'agenticos';
}

export function supportsSessionGoal(target: GoalSupportTarget): boolean {
  const workspacePath = target.workspacePath?.trim() ?? '';
  if (!workspacePath || target.workspaceScopeKind === 'global') {
    return false;
  }

  const descriptor = target.descriptor;
  if (
    target.domain?.kind !== 'workspace' ||
    descriptor?.sessionDomainKind !== 'workspace' ||
    (descriptor ? isSystemAgenticOsSession(descriptor) : false)
  ) {
    return false;
  }

  return !(
    isAgenticOsAgentId(target.agentId) ||
    isAgenticOsAgentId(descriptor?.agentPolicy.activeAgentId) ||
    isAgenticOsAgentId(descriptor?.agentPolicy.defaultAgentId)
  );
}
