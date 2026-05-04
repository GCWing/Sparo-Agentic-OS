import type { SubagentSource } from '@/infrastructure/api/service-api/SubagentAPI';
import type { AgentWithCapabilities } from './hooks/useAppsData';

interface AppBadgeConfig {
  variant: 'accent' | 'info' | 'success' | 'purple' | 'neutral';
  label: string;
}

export function getAgentBadge(
  t: (key: string, options?: Record<string, unknown>) => string,
  source?: SubagentSource,
): AppBadgeConfig {
  switch (source) {
    case 'user':
      return { variant: 'success', label: t('agent.badges.userAgent') };
    case 'project':
      return { variant: 'purple', label: t('agent.badges.projectAgent') };
    default:
      return { variant: 'accent', label: t('agent.badges.agent') };
  }
}

export function enrichAgentCapabilities(agent: AgentWithCapabilities): AgentWithCapabilities {
  if (agent.capabilities.length > 0) return agent;

  const id = agent.id.toLowerCase();
  const name = agent.name.toLowerCase();

  if (id === 'agentic') {
    return { ...agent, iconKey: 'code2', capabilities: [{ category: 'Coding', level: 5 }, { category: 'Analysis', level: 4 }] };
  }
  if (id === 'plan') {
    return { ...agent, iconKey: 'layers', capabilities: [{ category: 'Analysis', level: 5 }, { category: 'Documents', level: 3 }] };
  }
  if (id === 'debug') {
    return { ...agent, iconKey: 'bug', capabilities: [{ category: 'Coding', level: 5 }, { category: 'Analysis', level: 3 }] };
  }
  if (id === 'team') {
    return { ...agent, iconKey: 'cpu', capabilities: [{ category: 'Analysis', level: 5 }, { category: 'Testing', level: 4 }] };
  }
  if (id === 'cowork') {
    return { ...agent, iconKey: 'briefcase', capabilities: [{ category: 'Documents', level: 4 }, { category: 'Creative', level: 3 }] };
  }
  if (id === 'design') {
    return { ...agent, iconKey: 'penline', capabilities: [{ category: 'Creative', level: 5 }, { category: 'Coding', level: 3 }] };
  }
  if (id === 'deepresearch') {
    return { ...agent, capabilities: [{ category: 'Analysis', level: 5 }, { category: 'Documents', level: 4 }] };
  }
  if (id === 'liveappstudio') {
    return { ...agent, capabilities: [{ category: 'Coding', level: 5 }, { category: 'Creative', level: 4 }] };
  }
  if (id === 'agentappstudio') {
    return { ...agent, capabilities: [{ category: 'Coding', level: 5 }, { category: 'Operations', level: 3 }] };
  }

  if (name.includes('code') || name.includes('debug') || name.includes('test')) {
    return { ...agent, capabilities: [{ category: 'Coding', level: 4 }] };
  }
  if (name.includes('doc') || name.includes('write')) {
    return { ...agent, capabilities: [{ category: 'Documents', level: 4 }] };
  }

  return { ...agent, capabilities: [{ category: 'Analysis', level: 3 }] };
}

const STANDALONE_META_MODEL_MAX = 26;

/** Single-line meta for standalone agent app list rows (tools, model, focus, status). */
export function getStandaloneAppRowMeta(
  agent: AgentWithCapabilities,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const sep = t('page.standaloneMeta.separator');
  const parts: string[] = [];

  if (!agent.enabled) {
    parts.push(t('page.standaloneMeta.disabled'));
  }

  const toolCount = agent.toolCount ?? agent.defaultTools?.length ?? 0;
  if (toolCount > 0) {
    parts.push(
      toolCount === 1
        ? t('page.standaloneMeta.toolsSingular', { count: toolCount })
        : t('page.standaloneMeta.toolsPlural', { count: toolCount }),
    );
  }

  const rawModel = agent.model?.trim();
  if (rawModel) {
    const model =
      rawModel.length > STANDALONE_META_MODEL_MAX
        ? `${rawModel.slice(0, STANDALONE_META_MODEL_MAX - 1)}…`
        : rawModel;
    parts.push(t('page.standaloneMeta.model', { model }));
  }

  const topCaps = [...agent.capabilities]
    .sort((a, b) => b.level - a.level || a.category.localeCompare(b.category))
    .slice(0, 2);
  if (topCaps.length > 0) {
    const labels = topCaps.map((c) => t(`page.standaloneMeta.capability.${c.category}`));
    parts.push(labels.join(sep));
  }

  if (agent.isAgentApp) {
    parts.push(t('page.standaloneMeta.userApp'));
  }

  if (parts.length > 0) {
    return parts.join(sep);
  }
  return agent.name?.trim() || agent.id;
}
