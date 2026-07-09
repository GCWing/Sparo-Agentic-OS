/**
 * Session Profile Registry.
 *
 * All registered profiles are tested in order; the first matching one wins.
 * If no profile matches, runnoProfile is returned as the safe default.
 *
 * To add a new Agent: create a profile file under ./profiles/ and add it to PROFILES.
 */

import type { SessionProfile } from './types';
import { agenticOsProfile } from './profiles/agenticOsProfile';
import { runnoProfile } from './profiles/runnoProfile';
import { bitfunCoderProfile } from './profiles/bitfunCoderProfile';
import { coworkProfile } from './profiles/coworkProfile';
import { designProfile } from './profiles/designProfile';
import { deepResearchProfile } from './profiles/deepResearchProfile';
import { appBuilderProfile } from './profiles/appBuilderProfile';
import { productAppRuntimeProfile } from './profiles/productAppRuntimeProfile';
import {
  SESSION_DESCRIPTORS,
  type SessionDescriptor,
  type SessionProfileId,
} from '@/flow_chat/domain/sessionDescriptor';

/**
 * Ordered list of all registered profiles.
 * More-specific matchers should come before broader ones (e.g. Agentic OS before BitFun Coder).
 */
const PROFILES: readonly SessionProfile[] = [
  agenticOsProfile,
  runnoProfile,
  productAppRuntimeProfile,
  appBuilderProfile,
  coworkProfile,
  designProfile,
  deepResearchProfile,
  bitfunCoderProfile,
];

const PROFILES_BY_ID = new Map<SessionProfileId | string, SessionProfile>(
  PROFILES.map(profile => [profile.id, profile])
);

export type SessionDisplayMode =
  | 'bitfun-coder'
  | 'runno'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'agentic-os'
  | 'app-builder'
  | 'productAppRuntime';

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
    readonly headingMode?: 'default' | 'greeting-only';
    readonly narrativeKey?: string;
    readonly headingIcon?: 'agentic-os' | 'app-builder';
    readonly workspaceCopy: 'default' | 'cowork' | 'design' | 'runno';
    readonly promptPanel?: 'cowork' | 'app-builder';
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
    typeId: 'runno',
    descriptorDefaults: SESSION_DESCRIPTORS.runno,
    profile: runnoProfile,
    lifecycle: {
      displayMode: 'runno',
      titleKey: 'flow-chat:session.newRunnoWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'Runno',
      aiPartnerKey: 'welcome.aiPartnerRunno',
      headingMode: 'greeting-only',
      workspaceCopy: 'runno',
    },
  },
  {
    typeId: 'product-app-runtime',
    descriptorDefaults: SESSION_DESCRIPTORS.productAppRuntime,
    profile: productAppRuntimeProfile,
    lifecycle: {
      displayMode: 'productAppRuntime',
      titleKey: 'flow-chat:session.newProductAppRuntimeWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: '',
      aiPartnerKey: 'welcome.aiPartner',
      workspaceCopy: 'default',
    },
  },
  {
    typeId: 'app-builder',
    descriptorDefaults: SESSION_DESCRIPTORS.appBuilder,
    profile: appBuilderProfile,
    lifecycle: {
      displayMode: 'app-builder',
      titleKey: 'flow-chat:session.newAppBuilderWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'AppBuilder',
      aiPartnerKey: 'welcome.aiPartnerAppBuilder',
      narrativeKey: 'welcome.narrativeAppBuilder',
      headingIcon: 'app-builder',
      workspaceCopy: 'default',
      promptPanel: 'app-builder',
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
      displayMode: 'deep-research',
      titleKey: 'flow-chat:session.newDeepResearchWithIndex',
      defaultSurface: 'session',
    },
    welcome: {
      keySuffix: 'DeepResearch',
      aiPartnerKey: 'welcome.aiPartnerDeepResearch',
      workspaceCopy: 'default',
    },
  },
  {
    typeId: 'bitfun-coder',
    descriptorDefaults: SESSION_DESCRIPTORS.bitfunCoder,
    profile: bitfunCoderProfile,
    lifecycle: {
      displayMode: 'bitfun-coder',
      titleKey: 'flow-chat:session.newBitfunCoderWithIndex',
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
  return (profileId && PROFILES_BY_ID.get(profileId)) || runnoProfile;
}

export function resolveSessionTypeDefinition(
  profileId?: SessionProfileId | string | null
): SessionTypeDefinition {
  return (profileId && SESSION_TYPES_BY_ID.get(profileId)) || SESSION_TYPES_BY_ID.get('runno')!;
}

export function resolveSessionTypeDefinitionForDescriptor(
  descriptor?: SessionDescriptor | null
): SessionTypeDefinition {
  return resolveSessionTypeDefinition(descriptor?.profileId);
}

export { PROFILES, SESSION_TYPE_DEFINITIONS };
