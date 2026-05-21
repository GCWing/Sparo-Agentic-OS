/**
 * Overview tab - read-only product summary.
 *
 * Surfaces what the App is, what Agents it ships, and aggregate capability
 * counts. Designed so a returning user can decide in seconds whether to start
 * a session or jump to Agents / Shared for configuration.
 */
import React, { useMemo } from 'react';
import { BookOpen, ChevronRight, Cpu, Layers, Plug, Sparkles, Tag, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SparoAgentIcon } from '@/design-system';
import type { SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import type { AgentCapabilityConfigItem } from '@/infrastructure/config/types';
import { APP_ICON_MAP } from '../../appVisuals';
import type { AgentWithCapabilities, AppCardModel } from '../../hooks/useAppsData';
import { useAppDetailStore } from '../appDetailStore';

interface OverviewTabProps {
  app: AppCardModel;
  subagents: SubagentInfo[];
  getAgentConfig: (agentId: string) => AgentCapabilityConfigItem | null;
  getModelDisplayName: (modelRef?: string | null) => string;
}

export function OverviewTab({ app, subagents, getAgentConfig, getModelDisplayName }: OverviewTabProps) {
  const { t } = useTranslation('scenes/apps');
  const setTab = useAppDetailStore((s) => s.setTab);
  const setAgentId = useAppDetailStore((s) => s.setAgentId);

  const agents = app.includedAgents;
  const totalTools = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) {
      const cfg = getAgentConfig(agent.id);
      const tools = cfg?.enabled_tools ?? agent.defaultTools ?? [];
      tools.forEach((tool) => set.add(tool));
    }
    return set.size;
  }, [agents, getAgentConfig]);

  const enabledSubagents = subagents.filter((sa) => sa.enabled).length;

  const counts: Array<{ key: string; icon: React.ReactNode; value: number; tab: 'agents' | 'shared' }> = [
    { key: 'agents', icon: <Layers size={16} />, value: agents.length, tab: 'agents' },
    { key: 'tools', icon: <Cpu size={16} />, value: totalTools, tab: 'agents' },
    { key: 'subagents', icon: <Sparkles size={16} />, value: enabledSubagents, tab: 'agents' },
    { key: 'mcp', icon: <Plug size={16} />, value: 0, tab: 'shared' },
  ];

  const userAgentApp = app.kind === 'standalone-agent-app' && app.source === 'user'
    ? (agents[0] ?? null)
    : null;

  return (
    <div className="app-detail-overview">
      <div className="app-detail-overview__counts">
        {counts.map((c) => (
          <button
            key={c.key}
            type="button"
            className="app-detail-overview__count"
            onClick={() => setTab(c.tab)}
          >
            <span className="app-detail-overview__count-icon">{c.icon}</span>
            <span className="app-detail-overview__count-value">{c.value}</span>
            <span className="app-detail-overview__count-label">
              {t(`appDetail.overview.counts.${c.key}`)}
            </span>
          </button>
        ))}
      </div>

      {userAgentApp ? <AboutSection agent={userAgentApp} /> : null}

      <section className="app-detail-overview__section">
        <h3 className="app-detail-overview__section-title">{t('appDetail.overview.agentsTitle')}</h3>
        <ul className="app-detail-overview__agent-list">
          {agents.map((agent) => (
            <OverviewAgentRow
              key={agent.id}
              agent={agent}
              config={getAgentConfig(agent.id)}
              getModelDisplayName={getModelDisplayName}
              onOpen={() => {
                setAgentId(agent.id);
                setTab('agents');
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function AboutSection({ agent }: { agent: AgentWithCapabilities }) {
  const { t } = useTranslation('scenes/apps');
  const hasTags = agent.tags && agent.tags.length > 0;
  const hasExamples = agent.examples && agent.examples.length > 0;
  const hasServiceActions = agent.serviceActions && agent.serviceActions.length > 0;

  if (!hasTags && !hasExamples && !hasServiceActions && !agent.category) return null;

  return (
    <section className="app-detail-overview__section app-detail-about">
      <h3 className="app-detail-overview__section-title">
        {t('appDetail.overview.about.title')}
      </h3>

      {agent.category ? (
        <div className="app-detail-about__row">
          <span className="app-detail-about__label">
            <Tag size={11} aria-hidden="true" />
            {t('appDetail.overview.about.category')}
          </span>
          <span className="app-detail-about__value">{agent.category}</span>
        </div>
      ) : null}

      {hasTags ? (
        <div className="app-detail-about__row">
          <span className="app-detail-about__label">
            <Tag size={11} aria-hidden="true" />
            {t('appDetail.overview.about.tags')}
          </span>
          <div className="app-detail-about__tags">
            {agent.tags!.map((tag) => (
              <span key={tag} className="app-detail-about__tag">{tag}</span>
            ))}
          </div>
        </div>
      ) : null}

      {hasExamples ? (
        <div className="app-detail-about__block">
          <span className="app-detail-about__block-heading">
            <BookOpen size={11} aria-hidden="true" />
            {t('appDetail.overview.about.examples')}
          </span>
          <ul className="app-detail-about__examples">
            {agent.examples!.map((ex, i) => (
              <li key={i} className="app-detail-about__example">
                {ex.title ? (
                  <span className="app-detail-about__example-title">{ex.title}</span>
                ) : null}
                <span className="app-detail-about__example-prompt">{ex.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasServiceActions ? (
        <div className="app-detail-about__block">
          <span className="app-detail-about__block-heading">
            <Zap size={11} aria-hidden="true" />
            {t('appDetail.overview.about.serviceActions')}
          </span>
          <ul className="app-detail-about__resource-list">
            {agent.serviceActions!.map((action) => (
              <li key={action.name} className="app-detail-about__resource-row">
                <span className="app-detail-about__resource-name">
                  <code>{action.name}</code>
                </span>
                {action.description ? (
                  <span className="app-detail-about__resource-desc">{action.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OverviewAgentRow({
  agent,
  config,
  getModelDisplayName,
  onOpen,
}: {
  agent: AgentWithCapabilities;
  config: AgentCapabilityConfigItem | null;
  getModelDisplayName: (modelRef?: string | null) => string;
  onOpen: () => void;
}) {
  const { t } = useTranslation('scenes/apps');
  const Icon = APP_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof APP_ICON_MAP] ?? SparoAgentIcon;
  const toolCount = (config?.enabled_tools ?? agent.defaultTools ?? []).length;
  return (
    <li>
      <button type="button" className="app-detail-overview__agent-row" onClick={onOpen}>
        <span className="app-detail-overview__agent-row-icon">
          <Icon size={18} />
        </span>
        <span className="app-detail-overview__agent-row-main">
          <span className="app-detail-overview__agent-row-title">{agent.name}</span>
          <span className="app-detail-overview__agent-row-desc">
            {agent.description || t('appDetail.agents.noDescription')}
          </span>
          <span className="app-detail-overview__agent-row-meta">
            {t('appDetail.overview.toolCount', { count: toolCount })}
            {agent.model ? ` · ${getModelDisplayName(agent.model)}` : ''}
          </span>
        </span>
        <ChevronRight size={14} className="app-detail-overview__agent-row-chev" />
      </button>
    </li>
  );
}

