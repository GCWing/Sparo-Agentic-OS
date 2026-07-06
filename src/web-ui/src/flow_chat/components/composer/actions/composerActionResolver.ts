import type { SessionComposerActionProviderId } from '@/app/session-profiles';
import { normalizeSessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type {
  ComposerActionDescriptor,
  ComposerActionSection,
} from './composerActionTypes';
import { builtInContextProvider } from './providers/builtInContextProvider';
import { builtInOperationProvider } from './providers/builtInOperationProvider';
import { builtInTargetProvider } from './providers/builtInTargetProvider';
import {
  type ComposerActionProvider,
  type ComposerActionProviderContext,
} from './providers/composerActionProviderTypes';
import { mcpPromptProvider } from './providers/mcpPromptProvider';
import { getProfileComposerActionProvider } from './providers/profileComposerActionProvider';
import { sessionAgentSwitchProvider } from './providers/sessionAgentSwitchProvider';

export type ResolveComposerActionModelInput = ComposerActionProviderContext;

export interface ComposerActionModel {
  actions: ComposerActionDescriptor[];
  menuSections: ComposerActionSection[];
  canSwitchAgents: boolean;
  switchableAgents: ResolveComposerActionModelInput['availableAgents'];
  defaultAgentId: string;
  actionButtonVisible: boolean;
}

const BUILT_IN_PROVIDERS: readonly ComposerActionProvider[] = [
  builtInContextProvider,
  builtInTargetProvider,
  sessionAgentSwitchProvider,
  builtInOperationProvider,
  mcpPromptProvider,
];

const MENU_SECTION_ORDER: Record<ComposerActionSection['id'], number> = {
  agent: 100,
  context: 200,
  intent: 300,
  app: 400,
};

function isActionButtonVisible(input: ResolveComposerActionModelInput): boolean {
  const visibility = input.profile.composer?.visibility;
  if (input.isComposerActive) return visibility?.showActionButtonWhenActive ?? true;
  if (input.isProcessing) return visibility?.showActionButtonWhenProcessing ?? false;
  return visibility?.showActionButtonWhenCollapsed ?? false;
}

function getProfileProvider(id: SessionComposerActionProviderId): ComposerActionProvider | null {
  return getProfileComposerActionProvider(id);
}

function resolveProviders(input: ResolveComposerActionModelInput): ComposerActionProvider[] {
  const profileProviders = (input.profile.composer?.providers ?? [])
    .map(getProfileProvider)
    .filter((provider): provider is ComposerActionProvider => provider !== null);

  return [...BUILT_IN_PROVIDERS, ...profileProviders];
}

function uniqueActions(actions: ComposerActionDescriptor[]): ComposerActionDescriptor[] {
  const byId = new Map<string, ComposerActionDescriptor>();

  for (const action of actions) {
    if (!byId.has(action.id)) {
      byId.set(action.id, action);
    }
  }

  return Array.from(byId.values());
}

function buildMenuSections(actions: ComposerActionDescriptor[]): ComposerActionSection[] {
  const sections = new Map<ComposerActionSection['id'], ComposerActionDescriptor[]>();

  for (const action of actions) {
    if (!action.menu || action.availability.state === 'hidden') continue;
    const sectionActions = sections.get(action.menu.section) ?? [];
    sectionActions.push(action);
    sections.set(action.menu.section, sectionActions);
  }

  return Array.from(sections.entries())
    .sort(([a], [b]) => MENU_SECTION_ORDER[a] - MENU_SECTION_ORDER[b])
    .map(([id, sectionActions]) => ({
      id,
      actions: sectionActions.sort((a, b) => (a.menu?.order ?? a.order) - (b.menu?.order ?? b.order)),
    }));
}

function resolveSwitchableAgents(
  input: ResolveComposerActionModelInput,
  actions: ComposerActionDescriptor[],
): ResolveComposerActionModelInput['availableAgents'] {
  const enabledAgentIds = new Set(
    actions
      .filter(action => action.kind === 'agent-switch' && action.availability.state === 'enabled')
      .map(action => action.select.type === 'switch-agent' ? action.select.agentId : null)
      .filter((agentId): agentId is string => Boolean(agentId)),
  );

  return input.availableAgents.filter(agent => enabledAgentIds.has(agent.id) && agent.enabled);
}

export function resolveComposerActionModel(input: ResolveComposerActionModelInput): ComposerActionModel {
  const descriptor = input.descriptor ? normalizeSessionDescriptor(input.descriptor) : undefined;
  const normalizedInput = {
    ...input,
    descriptor,
  };
  const actions = uniqueActions(
    resolveProviders(normalizedInput).flatMap(provider => provider.resolve(normalizedInput)),
  ).sort((a, b) => a.order - b.order);
  const canSwitchAgents = actions.some(action => (
    action.kind === 'agent-switch' &&
    action.availability.state !== 'hidden'
  ));

  return {
    actions,
    menuSections: buildMenuSections(actions),
    canSwitchAgents,
    switchableAgents: resolveSwitchableAgents(normalizedInput, actions),
    defaultAgentId: descriptor?.agentPolicy.defaultAgentId ?? 'Runno',
    actionButtonVisible: isActionButtonVisible(normalizedInput),
  };
}
