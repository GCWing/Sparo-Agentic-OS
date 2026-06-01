import type { SessionStorageScope } from '@/shared/types/session-history';

export type SessionHostKind = 'system-agentic-os' | 'agent-app' | 'evolution-lab';

export type SessionProfileId =
  | 'dispatcher'
  | 'coding'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'live-app-studio'
  | 'agent-app-studio';

export type SessionIdentityId =
  | 'agentic-os'
  | 'code'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'live-app-studio'
  | 'agent-app-studio';

export interface SessionAgentPolicy {
  defaultAgentId: string;
  activeAgentId: string;
  switchableAgentIds: string[];
}

export interface SessionDescriptor {
  hostKind: SessionHostKind;
  profileId: SessionProfileId;
  identityId: SessionIdentityId;
  labelKey: string;
  agentPolicy: SessionAgentPolicy;
  storageScope: SessionStorageScope;
}

const CODE_AGENT_IDS = ['agentic', 'Plan', 'debug', 'Team'] as const;

const createPolicy = (
  defaultAgentId: string,
  switchableAgentIds: readonly string[] = [defaultAgentId],
  activeAgentId = defaultAgentId,
): SessionAgentPolicy => ({
  defaultAgentId,
  activeAgentId,
  switchableAgentIds: [...switchableAgentIds],
});

export const SESSION_DESCRIPTORS = {
  dispatcher: {
    hostKind: 'system-agentic-os',
    profileId: 'dispatcher',
    identityId: 'agentic-os',
    labelKey: 'apps.agenticOs.name',
    agentPolicy: createPolicy('Dispatcher'),
    storageScope: 'agentic_os',
  },
  coding: {
    hostKind: 'agent-app',
    profileId: 'coding',
    identityId: 'code',
    labelKey: 'apps.coding.name',
    agentPolicy: createPolicy('agentic', CODE_AGENT_IDS),
    storageScope: 'workspace',
  },
  cowork: {
    hostKind: 'agent-app',
    profileId: 'cowork',
    identityId: 'cowork',
    labelKey: 'apps.cowork.name',
    agentPolicy: createPolicy('Cowork'),
    storageScope: 'workspace',
  },
  design: {
    hostKind: 'agent-app',
    profileId: 'design',
    identityId: 'design',
    labelKey: 'apps.design.name',
    agentPolicy: createPolicy('Design'),
    storageScope: 'workspace',
  },
  deepResearch: {
    hostKind: 'agent-app',
    profileId: 'deep-research',
    identityId: 'deep-research',
    labelKey: 'apps.deepResearch.name',
    agentPolicy: createPolicy('DeepResearch'),
    storageScope: 'workspace',
  },
  liveAppStudio: {
    hostKind: 'evolution-lab',
    profileId: 'live-app-studio',
    identityId: 'live-app-studio',
    labelKey: 'apps.liveAppStudio.name',
    agentPolicy: createPolicy('LiveAppStudio'),
    storageScope: 'agentic_os',
  },
  agentAppStudio: {
    hostKind: 'evolution-lab',
    profileId: 'agent-app-studio',
    identityId: 'agent-app-studio',
    labelKey: 'apps.agentAppStudio.name',
    agentPolicy: createPolicy('AgentAppStudio'),
    storageScope: 'agentic_os',
  },
} satisfies Record<string, SessionDescriptor>;

const cloneDescriptor = (
  descriptor: SessionDescriptor,
  activeAgentId = descriptor.agentPolicy.activeAgentId,
): SessionDescriptor => ({
  ...descriptor,
  agentPolicy: {
    ...descriptor.agentPolicy,
    activeAgentId,
    switchableAgentIds: [...descriptor.agentPolicy.switchableAgentIds],
  },
});

export function getDefaultSessionDescriptor(): SessionDescriptor {
  return cloneDescriptor(SESSION_DESCRIPTORS.coding);
}

export function getDispatcherSessionDescriptor(): SessionDescriptor {
  return cloneDescriptor(SESSION_DESCRIPTORS.dispatcher);
}

export function descriptorFromAgentType(agentType?: string | null): SessionDescriptor {
  const rawAgentType = agentType?.trim();
  const normalized = rawAgentType?.toLowerCase();
  if (normalized === 'dispatcher') return getDispatcherSessionDescriptor();
  if (normalized === 'cowork') return cloneDescriptor(SESSION_DESCRIPTORS.cowork);
  if (normalized === 'design') return cloneDescriptor(SESSION_DESCRIPTORS.design);
  if (normalized === 'deepresearch') return cloneDescriptor(SESSION_DESCRIPTORS.deepResearch);
  if (normalized === 'liveappstudio') return cloneDescriptor(SESSION_DESCRIPTORS.liveAppStudio);
  if (normalized === 'agentappstudio') return cloneDescriptor(SESSION_DESCRIPTORS.agentAppStudio);
  if (normalized === 'plan') return cloneDescriptor(SESSION_DESCRIPTORS.coding, 'Plan');
  if (normalized === 'debug') return cloneDescriptor(SESSION_DESCRIPTORS.coding, 'debug');
  if (normalized === 'team') return cloneDescriptor(SESSION_DESCRIPTORS.coding, 'Team');
  if (rawAgentType) {
    return {
      ...cloneDescriptor(SESSION_DESCRIPTORS.coding, rawAgentType),
      agentPolicy: createPolicy(rawAgentType),
    };
  }
  return getDefaultSessionDescriptor();
}

export function getBackendAgentType(descriptor?: SessionDescriptor | null): string {
  return descriptor?.agentPolicy.activeAgentId || descriptor?.agentPolicy.defaultAgentId || 'agentic';
}

export function withActiveAgentId(
  descriptor: SessionDescriptor,
  agentId: string,
): SessionDescriptor {
  const nextAgentId = descriptor.agentPolicy.switchableAgentIds.includes(agentId)
    ? agentId
    : descriptor.agentPolicy.defaultAgentId;
  return cloneDescriptor(descriptor, nextAgentId);
}

export function isSystemAgenticOsSession(descriptor: SessionDescriptor): boolean {
  return descriptor.hostKind === 'system-agentic-os';
}

export function isEvolutionLabSession(descriptor: SessionDescriptor): boolean {
  return descriptor.hostKind === 'evolution-lab';
}
