/**
 * AgentSwitcher — horizontal pill row that selects the active Agent.
 *
 * Conceptually identical to the top-of-chat agent switcher: each Agent is one
 * pill; the active pill is filled with a soft accent; pills can carry a
 * default-star, a dirty count, and a disabled marker.
 *
 * Layout-wise this lives at the top of the Agents tab and stays sticky while
 * the workspace scrolls. Trailing "+ Add" pill is a separate ghost slot so it
 * never competes with real Agent selection.
 */
import { Plus, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SparoAgentIcon } from '@/design-system';
import { APP_ICON_MAP } from '../../appVisuals';
import type { AgentWithCapabilities } from '../../hooks/useAppsData';

export interface AgentSwitcherItem {
  agent: AgentWithCapabilities;
  isDefault: boolean;
  isDirty: boolean;
  dirtyCount: number;
}

export interface AgentSwitcherProps {
  items: AgentSwitcherItem[];
  activeId: string | null;
  onSelect: (agentId: string) => void;
  onAddAgent?: () => void;
}

export function AgentSwitcher({ items, activeId, onSelect, onAddAgent }: AgentSwitcherProps) {
  const { t } = useTranslation('scenes/apps');

  return (
    <div className="app-detail-agent-switcher" role="tablist" aria-label={t('appDetail.agents.switcherLabel')}>
      <div className="app-detail-agent-switcher__inner">
        <div className="app-detail-agent-switcher__pills">
          {items.map(({ agent, isDefault, isDirty, dirtyCount }) => {
            const Icon =
              APP_ICON_MAP[(agent.iconKey ?? 'bot') as keyof typeof APP_ICON_MAP] ?? SparoAgentIcon;
            const isActive = agent.id === activeId;
            const isDisabled = !agent.enabled;
            return (
              <button
                key={agent.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={[
                  'app-detail-agent-pill',
                  isActive && 'app-detail-agent-pill--active',
                  isDisabled && 'app-detail-agent-pill--disabled',
                  isDirty && 'app-detail-agent-pill--dirty',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(agent.id)}
                title={
                  isDirty
                    ? t('appDetail.agents.dirtyHint', { count: dirtyCount })
                    : agent.description || agent.name
                }
              >
                <span className="app-detail-agent-pill__icon">
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                <span className="app-detail-agent-pill__label">{agent.name}</span>
                {isDefault ? (
                  <Star
                    size={11}
                    strokeWidth={1.75}
                    className="app-detail-agent-pill__star"
                    aria-label={t('appDetail.overview.defaultBadge')}
                  />
                ) : null}
                {isDirty ? (
                  <span className="app-detail-agent-pill__dirty" aria-hidden="true">
                    {dirtyCount}
                  </span>
                ) : null}
              </button>
            );
          })}

          {onAddAgent ? (
            <button
              type="button"
              className="app-detail-agent-pill app-detail-agent-pill--add"
              onClick={onAddAgent}
              title={t('appDetail.agents.actions.addAgent')}
            >
              <Plus size={13} strokeWidth={2} />
              <span className="app-detail-agent-pill__label">
                {t('appDetail.agents.actions.addAgent')}
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
