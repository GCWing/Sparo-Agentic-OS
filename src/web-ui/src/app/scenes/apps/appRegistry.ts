export type AppKind = 'multi-agent-app' | 'standalone-agent-app' | 'evolution-lab';

export interface BaseAppEntity {
  id: string;
  kind: AppKind;
  nameKey: string;
  descriptionKey: string;
  badgeKey: string;
  dynamicName?: string;
  dynamicDescription?: string;
  iconKey?: string;
  source?: 'builtin' | 'user' | 'project';
}

export interface MultiAgentAppEntity extends BaseAppEntity {
  kind: 'multi-agent-app';
  agentIds: string[];
}

export interface StandaloneAgentAppEntity extends BaseAppEntity {
  kind: 'standalone-agent-app';
  agentId: string;
}

export interface EvolutionLabAppEntity extends BaseAppEntity {
  kind: 'evolution-lab';
  agentId: string;
}

export type AppEntity = MultiAgentAppEntity | StandaloneAgentAppEntity | EvolutionLabAppEntity;

export const APP_REGISTRY: readonly AppEntity[] = [
  {
    id: 'coding-app',
    kind: 'multi-agent-app',
    nameKey: 'apps.coding.name',
    descriptionKey: 'apps.coding.description',
    badgeKey: 'apps.badges.multiAgentApp',
    agentIds: ['agentic', 'Plan', 'debug', 'Team'],
  },
  {
    id: 'cowork-app',
    kind: 'standalone-agent-app',
    nameKey: 'apps.cowork.name',
    descriptionKey: 'apps.cowork.description',
    badgeKey: 'apps.badges.standaloneAgentApp',
    agentId: 'Cowork',
  },
  {
    id: 'design-app',
    kind: 'standalone-agent-app',
    nameKey: 'apps.design.name',
    descriptionKey: 'apps.design.description',
    badgeKey: 'apps.badges.standaloneAgentApp',
    agentId: 'Design',
  },
  {
    id: 'deep-research-app',
    kind: 'standalone-agent-app',
    nameKey: 'apps.deepResearch.name',
    descriptionKey: 'apps.deepResearch.description',
    badgeKey: 'apps.badges.standaloneAgentApp',
    agentId: 'DeepResearch',
  },
  {
    id: 'live-app-studio-app',
    kind: 'evolution-lab',
    nameKey: 'apps.liveAppStudio.name',
    descriptionKey: 'apps.liveAppStudio.description',
    badgeKey: 'apps.badges.evolutionLab',
    agentId: 'LiveAppStudio',
  },
  {
    id: 'agent-app-studio-app',
    kind: 'evolution-lab',
    nameKey: 'apps.agentAppStudio.name',
    descriptionKey: 'apps.agentAppStudio.description',
    badgeKey: 'apps.badges.evolutionLab',
    agentId: 'AgentAppStudio',
  },
] as const;

export const HIDDEN_AGENT_IDS = new Set<string>(['Dispatcher']);

export function isTopLevelAgent(agent: { id: string; agentKind?: string }): boolean {
  if (HIDDEN_AGENT_IDS.has(agent.id)) return false;
  return agent.agentKind === undefined || agent.agentKind === 'agent';
}
