import type { SessionStorageScope } from '@/shared/types/session-history';

export type SessionHostKind = 'system-agentic-os' | 'agent-app' | 'evolution-lab' | 'live-app-workbench';

export type SessionProfileId =
  | 'agentic-os'
  | 'coding'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'live-app-studio'
  | 'agent-app-studio'
  | 'live-app-workbench';

export type SessionIdentityId =
  | 'agentic-os'
  | 'code'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'live-app-studio'
  | 'agent-app-studio'
  | 'live-app-workbench';

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
  agenticOs: {
    hostKind: 'system-agentic-os',
    profileId: 'agentic-os',
    identityId: 'agentic-os',
    labelKey: 'apps.agenticOs.name',
    agentPolicy: createPolicy('OSAgent'),
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
  liveAppWorkbench: {
    hostKind: 'live-app-workbench',
    profileId: 'live-app-workbench',
    identityId: 'live-app-workbench',
    labelKey: 'apps.liveAppWorkbench.name',
    agentPolicy: createPolicy('agentic'),
    storageScope: 'agentic_os',
  },
} satisfies Record<string, SessionDescriptor>;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isCodingAgentId(agentId: string): boolean {
  return CODE_AGENT_IDS.includes(agentId as (typeof CODE_AGENT_IDS)[number]);
}

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

export function normalizeSessionDescriptor(descriptor: SessionDescriptor): SessionDescriptor {
  if (
    descriptor.profileId === 'coding' &&
    descriptor.identityId === 'code' &&
    descriptor.agentPolicy.defaultAgentId === SESSION_DESCRIPTORS.coding.agentPolicy.defaultAgentId &&
    isCodingAgentId(descriptor.agentPolicy.activeAgentId) &&
    descriptor.agentPolicy.switchableAgentIds.every(isCodingAgentId) &&
    !arraysEqual(descriptor.agentPolicy.switchableAgentIds, CODE_AGENT_IDS)
  ) {
    return {
      ...cloneDescriptor(SESSION_DESCRIPTORS.coding, descriptor.agentPolicy.activeAgentId),
      storageScope: descriptor.storageScope,
    };
  }

  return cloneDescriptor(descriptor);
}

export function getAgenticOsSessionDescriptor(): SessionDescriptor {
  return cloneDescriptor(SESSION_DESCRIPTORS.agenticOs);
}

export function getLiveAppWorkbenchSessionDescriptor(agentAppId?: string | null): SessionDescriptor {
  const normalizedAgentAppId = agentAppId?.trim();
  if (!normalizedAgentAppId) {
    return cloneDescriptor(SESSION_DESCRIPTORS.liveAppWorkbench);
  }
  return {
    ...cloneDescriptor(SESSION_DESCRIPTORS.liveAppWorkbench, normalizedAgentAppId),
    agentPolicy: createPolicy(normalizedAgentAppId),
  };
}

export function descriptorFromAgentType(agentType?: string | null): SessionDescriptor {
  const rawAgentType = agentType?.trim();
  const normalized = rawAgentType?.toLowerCase();
  if (
    normalized === 'osagent' ||
    normalized === 'os-agent' ||
    normalized === 'os_agent' ||
    normalized === 'dispatcher'
  ) {
    return getAgenticOsSessionDescriptor();
  }
  if (normalized === 'cowork') return cloneDescriptor(SESSION_DESCRIPTORS.cowork);
  if (normalized === 'design') return cloneDescriptor(SESSION_DESCRIPTORS.design);
  if (normalized === 'deepresearch') return cloneDescriptor(SESSION_DESCRIPTORS.deepResearch);
  if (normalized === 'liveappstudio' || normalized === 'live-app-studio') {
    return cloneDescriptor(SESSION_DESCRIPTORS.liveAppStudio);
  }
  if (normalized === 'agentappstudio' || normalized === 'agent-app-studio') {
    return cloneDescriptor(SESSION_DESCRIPTORS.agentAppStudio);
  }
  if (normalized === 'liveappworkbench' || normalized === 'live-app-workbench') {
    return cloneDescriptor(SESSION_DESCRIPTORS.liveAppWorkbench);
  }
  if (normalized === 'agentic' || normalized === 'code' || normalized === 'coding') {
    return getDefaultSessionDescriptor();
  }
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
  const normalizedDescriptor = normalizeSessionDescriptor(descriptor);
  const nextAgentId = normalizedDescriptor.agentPolicy.switchableAgentIds.includes(agentId)
    ? agentId
    : normalizedDescriptor.agentPolicy.defaultAgentId;
  return cloneDescriptor(normalizedDescriptor, nextAgentId);
}

export function isSystemAgenticOsSession(descriptor: SessionDescriptor): boolean {
  return descriptor.hostKind === 'system-agentic-os';
}

export function isEvolutionLabSession(descriptor: SessionDescriptor): boolean {
  return descriptor.hostKind === 'evolution-lab';
}
