/**
 * Session Profile Registry.
 *
 * All registered profiles are tested in order; the first matching one wins.
 * If no profile matches, codingProfile is returned as the safe default.
 *
 * To add a new Agent: create a profile file under ./profiles/ and add it to PROFILES.
 */

import type { SessionProfile } from './types';
import { agenticOsProfile } from './profiles/agenticOsProfile';
import { codingProfile } from './profiles/codingProfile';
import { coworkProfile } from './profiles/coworkProfile';
import { designProfile } from './profiles/designProfile';
import { deepResearchProfile } from './profiles/deepResearchProfile';
import { liveAppStudioProfile } from './profiles/liveAppStudioProfile';
import { liveAppWorkbenchProfile } from './profiles/liveAppWorkbenchProfile';
import { agentAppStudioProfile } from './profiles/agentAppStudioProfile';
import {
  SESSION_DESCRIPTORS,
  type SessionDescriptor,
  type SessionProfileId,
} from '@/flow_chat/domain/sessionDescriptor';

/**
 * Ordered list of all registered profiles.
 * More-specific matchers should come before broader ones (e.g. Agentic OS before coding).
 */
const PROFILES: readonly SessionProfile[] = [
  agenticOsProfile,
  liveAppWorkbenchProfile,
  liveAppStudioProfile,
  agentAppStudioProfile,
  coworkProfile,
  designProfile,
  deepResearchProfile,
  codingProfile, // broadest matcher — also serves as the fallback
];

const PROFILES_BY_ID = new Map<SessionProfileId | string, SessionProfile>(
  PROFILES.map(profile => [profile.id, profile])
);

export type SessionDisplayMode =
  | 'code'
  | 'cowork'
  | 'design'
  | 'agentic-os'
  | 'liveappstudio'
  | 'agentappstudio'
  | 'liveappworkbench';

export type SessionDefaultSurface = 'session' | 'agentic-os-home' | 'background';

export interface SessionTypeDefinition {
  readonly typeId: SessionProfileId;
  readonly descriptorDefaults: SessionDescriptor;
  readonly profile: SessionProfile;
  readonly lifecycle: {
    readonly displayMode: SessionDisplayMode;
    readonly titleKey: string;
    readonly defaultSurface: SessionDefaultSurface;
  };
  readonly welcome: {
    readonly keySuffix: string;
    readonly aiPartnerKey: string;
    readonly narrativeKey?: string;
    readonly headingIcon?: 'agentic-os' | 'live-app-studio' | 'agent-app-studio';
    readonly workspaceCopy: 'default' | 'cowork' | 'design';
    readonly promptPanel?: 'cowork' | 'live-app-studio' | 'agent-app-studio';
  };
}

const SESSION_TYPE_DEFINITIONS: readonly SessionTypeDefinition[] = [
  {
    typeId: 'agentic-os',
    descriptorDefaults: SESSION_DESCRIPTORS.agenticOs,
    profile: agenticOsProfile,
    lifecycle: {
      displayMode: 'agentic-os',
      titleKey: 'flow-chat:session.agenticOs',
      defaultSurface: 'agentic-os-home',
    },
    welcome: {
      keySuffix: 'AgenticOs',
      aiPartnerKey: 'welcome.aiPartnerAgenticOs',
      narrativeKey: 'welcome.narrativeAgenticOs',
      headingIcon: 'agentic-os',
      workspaceCopy: 'default',
    },
  },
  {
    typeId: 'live-app-workbench',
    descriptorDefaults: SESSION_DESCRIPTORS.liveAppWorkbench,
    profile: liveAppWorkbenchProfile,
    lifecycle: {
      displayMode: 'liveappworkbench',
      titleKey: 'flow-chat:session.newLiveAppWorkbenchWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: '',
      aiPartnerKey: 'welcome.aiPartner',
      workspaceCopy: 'default',
    },
  },
  {
    typeId: 'live-app-studio',
    descriptorDefaults: SESSION_DESCRIPTORS.liveAppStudio,
    profile: liveAppStudioProfile,
    lifecycle: {
      displayMode: 'liveappstudio',
      titleKey: 'flow-chat:session.newLiveAppStudioWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'LiveAppStudio',
      aiPartnerKey: 'welcome.aiPartnerLiveAppStudio',
      narrativeKey: 'welcome.narrativeLiveAppStudio',
      headingIcon: 'live-app-studio',
      workspaceCopy: 'default',
      promptPanel: 'live-app-studio',
    },
  },
  {
    typeId: 'agent-app-studio',
    descriptorDefaults: SESSION_DESCRIPTORS.agentAppStudio,
    profile: agentAppStudioProfile,
    lifecycle: {
      displayMode: 'agentappstudio',
      titleKey: 'flow-chat:session.newAgentAppStudioWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'AgentAppStudio',
      aiPartnerKey: 'welcome.aiPartnerAgentAppStudio',
      narrativeKey: 'welcome.narrativeAgentAppStudio',
      headingIcon: 'agent-app-studio',
      workspaceCopy: 'default',
      promptPanel: 'agent-app-studio',
    },
  },
  {
    typeId: 'cowork',
    descriptorDefaults: SESSION_DESCRIPTORS.cowork,
    profile: coworkProfile,
    lifecycle: {
      displayMode: 'cowork',
      titleKey: 'flow-chat:session.newCoworkWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'Cowork',
      aiPartnerKey: 'welcome.aiPartnerCowork',
      workspaceCopy: 'cowork',
      promptPanel: 'cowork',
    },
  },
  {
    typeId: 'design',
    descriptorDefaults: SESSION_DESCRIPTORS.design,
    profile: designProfile,
    lifecycle: {
      displayMode: 'design',
      titleKey: 'flow-chat:session.newDesignWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'Design',
      aiPartnerKey: 'welcome.aiPartnerDesign',
      workspaceCopy: 'design',
    },
  },
  {
    typeId: 'deep-research',
    descriptorDefaults: SESSION_DESCRIPTORS.deepResearch,
    profile: deepResearchProfile,
    lifecycle: {
      displayMode: 'code',
      titleKey: 'flow-chat:session.newCodeWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'DeepResearch',
      aiPartnerKey: 'welcome.aiPartnerDeepResearch',
      workspaceCopy: 'default',
    },
  },
  {
    typeId: 'coding',
    descriptorDefaults: SESSION_DESCRIPTORS.coding,
    profile: codingProfile,
    lifecycle: {
      displayMode: 'code',
      titleKey: 'flow-chat:session.newCodeWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: '',
      aiPartnerKey: 'welcome.aiPartner',
      workspaceCopy: 'default',
    },
  },
];

const SESSION_TYPES_BY_ID = new Map<SessionProfileId | string, SessionTypeDefinition>(
  SESSION_TYPE_DEFINITIONS.map(definition => [definition.typeId, definition])
);

export function resolveProfile(profileId?: SessionProfileId | string | null): SessionProfile {
  return (profileId && PROFILES_BY_ID.get(profileId)) || codingProfile;
}

export function resolveSessionTypeDefinition(
  profileId?: SessionProfileId | string | null
): SessionTypeDefinition {
  return (profileId && SESSION_TYPES_BY_ID.get(profileId)) || SESSION_TYPES_BY_ID.get('coding')!;
}

export function resolveSessionTypeDefinitionForDescriptor(
  descriptor?: SessionDescriptor | null
): SessionTypeDefinition {
  return resolveSessionTypeDefinition(descriptor?.profileId);
}

export { PROFILES, SESSION_TYPE_DEFINITIONS };
