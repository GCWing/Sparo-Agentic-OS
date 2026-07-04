type AppsT = (key: string, options?: Record<string, unknown>) => string;

export interface AgentWithCapabilities {
  id: string;
  name: string;
  enabled: boolean;
  capabilities: Array<{ category: string; level: number }>;
  iconKey?: string;
  toolCount?: number;
  defaultTools?: string[];
  model?: string | null;
  isAgentComponent?: boolean;
}

function humanizeCategory(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getAppCategoryLabel(category: string | null | undefined, t: AppsT): string {
  const value = category?.trim();
  if (!value) return '';
  const key = value.toLowerCase().replace(/[\s_]+/g, '-');
  return t(`appCategories.${key}`, { defaultValue: humanizeCategory(value) });
}

export function getCapabilityCategoryLabel(category: string, t: AppsT): string {
  return t(`page.standaloneMeta.capability.${category}`, { defaultValue: category });
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
  if (id === 'appstudio') {
    return { ...agent, capabilities: [{ category: 'Coding', level: 5 }, { category: 'Creative', level: 4 }] };
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

/** Single-line meta for standalone core agent list rows (tools, model, focus, status). */
export function getStandaloneAppRowMeta(
  agent: AgentWithCapabilities,
  t: (key: string, options?: Record<string, unknown>) => string,
  getModelDisplayName?: (modelRef?: string | null) => string,
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
    const displayModel = getModelDisplayName?.(rawModel) || rawModel;
    const model =
      displayModel.length > STANDALONE_META_MODEL_MAX
        ? `${displayModel.slice(0, STANDALONE_META_MODEL_MAX - 1)}…`
        : displayModel;
    parts.push(t('page.standaloneMeta.model', { model }));
  }

  const topCaps = [...agent.capabilities]
    .sort((a, b) => b.level - a.level || a.category.localeCompare(b.category))
    .slice(0, 2);
  if (topCaps.length > 0) {
    const labels = topCaps.map((c) => getCapabilityCategoryLabel(c.category, t));
    parts.push(labels.join(sep));
  }

  if (agent.isAgentComponent) {
    parts.push(t('page.standaloneMeta.userApp'));
  }

  if (parts.length > 0) {
    return parts.join(sep);
  }
  return agent.name?.trim() || agent.id;
}
