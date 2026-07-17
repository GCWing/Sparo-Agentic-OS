import type {
  ProductAppRuntimeSessionMetadata,
  SessionStorageScope,
} from '@/shared/types/session-history';

export type SessionHostKind =
  | 'system-agentic-os'
  | 'system-settings'
  | 'agent-component'
  | 'evolution-lab'
  | 'product-app-runtime';

export type SessionProfileId =
  | 'agentic-os'
  | 'runno'
  | 'bitfun-coder'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'app-builder'
  | 'settings'
  | 'product-app-runtime';

export type SessionIdentityId =
  | 'agentic-os'
  | 'runno'
  | 'bitfun-coder'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'app-builder'
  | 'settings'
  | 'product-app-runtime';

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

const BITFUN_CODER_AGENT_IDS = ['bitfun-coder', 'bitfun-plan', 'bitfun-debug', 'bitfun-team'] as const;

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
  runno: {
    hostKind: 'agent-component',
    profileId: 'runno',
    identityId: 'runno',
    labelKey: 'apps.runno.name',
    agentPolicy: createPolicy('Runno'),
    storageScope: 'workspace',
  },
  bitfunCoder: {
    hostKind: 'agent-component',
    profileId: 'bitfun-coder',
    identityId: 'bitfun-coder',
    labelKey: 'apps.bitfunCoder.name',
    agentPolicy: createPolicy('bitfun-coder', BITFUN_CODER_AGENT_IDS),
    storageScope: 'workspace',
  },
  cowork: {
    hostKind: 'agent-component',
    profileId: 'cowork',
    identityId: 'cowork',
    labelKey: 'apps.cowork.name',
    agentPolicy: createPolicy('Cowork'),
    storageScope: 'workspace',
  },
  design: {
    hostKind: 'agent-component',
    profileId: 'design',
    identityId: 'design',
    labelKey: 'apps.design.name',
    agentPolicy: createPolicy('Design'),
    storageScope: 'workspace',
  },
  deepResearch: {
    hostKind: 'agent-component',
    profileId: 'deep-research',
    identityId: 'deep-research',
    labelKey: 'apps.deepResearch.name',
    agentPolicy: createPolicy('DeepResearch'),
    storageScope: 'workspace',
  },
  appBuilder: {
    hostKind: 'evolution-lab',
    profileId: 'app-builder',
    identityId: 'app-builder',
    labelKey: 'apps.appBuilder.name',
    agentPolicy: createPolicy('AppBuilder'),
    storageScope: 'agentic_os',
  },
  settings: {
    hostKind: 'system-settings',
    profileId: 'settings',
    identityId: 'settings',
    labelKey: 'settings/ai-mode:session.title',
    agentPolicy: createPolicy('SettingsAgent'),
    storageScope: 'agentic_os',
  },
  productAppRuntime: {
    hostKind: 'product-app-runtime',
    profileId: 'product-app-runtime',
    identityId: 'product-app-runtime',
    labelKey: 'apps.productAppRuntime.name',
    agentPolicy: createPolicy('Runno'),
    storageScope: 'agentic_os',
  },
} satisfies Record<string, SessionDescriptor>;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isBitfunCoderAgentId(agentId: string): boolean {
  return BITFUN_CODER_AGENT_IDS.includes(agentId as (typeof BITFUN_CODER_AGENT_IDS)[number]);
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
  return cloneDescriptor(SESSION_DESCRIPTORS.runno);
}

export function normalizeSessionDescriptor(descriptor: SessionDescriptor): SessionDescriptor {
  if (
    descriptor.profileId === 'bitfun-coder' &&
    descriptor.identityId === 'bitfun-coder' &&
    descriptor.agentPolicy.defaultAgentId === SESSION_DESCRIPTORS.bitfunCoder.agentPolicy.defaultAgentId &&
    isBitfunCoderAgentId(descriptor.agentPolicy.activeAgentId) &&
    descriptor.agentPolicy.switchableAgentIds.every(isBitfunCoderAgentId) &&
    !arraysEqual(descriptor.agentPolicy.switchableAgentIds, BITFUN_CODER_AGENT_IDS)
  ) {
    return {
      ...cloneDescriptor(SESSION_DESCRIPTORS.bitfunCoder, descriptor.agentPolicy.activeAgentId),
      storageScope: descriptor.storageScope,
    };
  }

  return cloneDescriptor(descriptor);
}

export function getAgenticOsSessionDescriptor(): SessionDescriptor {
  return cloneDescriptor(SESSION_DESCRIPTORS.agenticOs);
}

export function getProductAppRuntimeAgentType(
  metadata?: ProductAppRuntimeSessionMetadata | null,
): string | undefined {
  const agentType = metadata?.chat?.agentType?.trim();
  return agentType || undefined;
}

export function getProductAppRuntimeSessionDescriptor(agentType?: string | null): SessionDescriptor {
  const normalizedAgentType = agentType?.trim();
  if (!normalizedAgentType) {
    return cloneDescriptor(SESSION_DESCRIPTORS.productAppRuntime);
  }
  return {
    ...cloneDescriptor(SESSION_DESCRIPTORS.productAppRuntime, normalizedAgentType),
    agentPolicy: createPolicy(normalizedAgentType),
  };
}

export function descriptorFromBackendSessionCreated(
  agentType?: string | null,
  existingDescriptor?: SessionDescriptor | null,
): SessionDescriptor {
  if (existingDescriptor?.hostKind === 'product-app-runtime') {
    return normalizeSessionDescriptor(existingDescriptor);
  }
  return descriptorFromAgentType(agentType);
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
  if (normalized === 'runno') return cloneDescriptor(SESSION_DESCRIPTORS.runno);
  if (normalized === 'appbuilder' || normalized === 'app-builder' || normalized === 'app_builder') {
    return cloneDescriptor(SESSION_DESCRIPTORS.appBuilder);
  }
  if (normalized === 'settingsagent' || normalized === 'settings-agent' || normalized === 'settings_agent') {
    return cloneDescriptor(SESSION_DESCRIPTORS.settings);
  }
  if (normalized === 'productappruntime' || normalized === 'product-app-runtime') {
    return cloneDescriptor(SESSION_DESCRIPTORS.productAppRuntime);
  }
  if (normalized === 'bitfun-coder') {
    return cloneDescriptor(SESSION_DESCRIPTORS.bitfunCoder);
  }
  if (normalized === 'bitfun-plan') {
    return cloneDescriptor(SESSION_DESCRIPTORS.bitfunCoder, 'bitfun-plan');
  }
  if (normalized === 'bitfun-debug') {
    return cloneDescriptor(SESSION_DESCRIPTORS.bitfunCoder, 'bitfun-debug');
  }
  if (normalized === 'bitfun-team') {
    return cloneDescriptor(SESSION_DESCRIPTORS.bitfunCoder, 'bitfun-team');
  }
  return getDefaultSessionDescriptor();
}

export function getBackendAgentType(descriptor?: SessionDescriptor | null): string {
  return descriptor?.agentPolicy.activeAgentId || descriptor?.agentPolicy.defaultAgentId || 'Runno';
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
