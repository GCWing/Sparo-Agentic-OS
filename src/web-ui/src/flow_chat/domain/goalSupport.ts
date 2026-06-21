import type { Session } from '../types/flow-chat';
import type { SessionDescriptor } from './sessionDescriptor';

type WorkspaceScopeKind = 'workspace' | 'global';

interface GoalSupportTarget {
  workspacePath?: string | null;
  workspaceScopeKind?: WorkspaceScopeKind;
  storageScope?: Session['storageScope'] | SessionDescriptor['storageScope'] | null;
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
    target.storageScope === 'agentic_os' ||
    descriptor?.storageScope === 'agentic_os' ||
    descriptor?.profileId === 'agentic-os' ||
    descriptor?.hostKind === 'system-agentic-os'
  ) {
    return false;
  }

  return !(
    isAgenticOsAgentId(target.agentId) ||
    isAgenticOsAgentId(descriptor?.agentPolicy.activeAgentId) ||
    isAgenticOsAgentId(descriptor?.agentPolicy.defaultAgentId)
  );
}
