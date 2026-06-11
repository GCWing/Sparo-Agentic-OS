import React from 'react';
import { Plus } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import type { WorkCenterScope } from '@/app/stores/workDockStore';
import type { WorkCategory } from '@/app/agentic-os/work/domain/workClassification';
import './ScopeRail.scss';

interface ScopeRailProps {
  scope: WorkCenterScope;
  openTotal: number;
  attentionTotal: number;
  runningTotal: number;
  unarchivedTotal: number;
  completedTotal: number;
  archivedTotal: number;
  activeWorkspaceCount: number;
  workspaceHistoryCount: number;
  activeWorkspaceRunningTotal: number;
  categoryCounts: Map<WorkCategory, { total: number; running: number }>;
  onScopeChange: (scope: WorkCenterScope) => void;
  onQuickCreateWork: () => void;
}

type ScopeItemTone = 'attention' | 'running';

interface ScopeItemProps {
  title: string;
  count: number;
  selected: boolean;
  countLabel?: string;
  tone?: ScopeItemTone;
  live?: boolean;
  onClick: () => void;
}

/**
 * One navigation entry — goal-list style: signal dot, title, bare mono numeral.
 * Hierarchy comes from ink opacity, the seed dot, and a soft fill when selected.
 */
const ScopeItem: React.FC<ScopeItemProps> = ({
  title,
  count,
  selected,
  countLabel,
  tone,
  live = false,
  onClick,
}) => (
  <button
    type="button"
    className={[
      'sr-item',
      tone && `sr-item--${tone}`,
      live && 'is-live',
      selected && 'is-selected',
    ].filter(Boolean).join(' ')}
    aria-pressed={selected}
    aria-label={countLabel ? `${title} · ${countLabel}` : title}
    title={countLabel}
    onClick={onClick}
  >
    <span className="sr-item__dot" aria-hidden="true" />
    <span className="sr-item__title">{title}</span>
    {count > 0 ? <span className="sr-item__count">{count}</span> : null}
  </button>
);

const ScopeRail: React.FC<ScopeRailProps> = ({
  scope,
  openTotal,
  attentionTotal,
  runningTotal,
  unarchivedTotal,
  completedTotal,
  archivedTotal,
  activeWorkspaceCount,
  workspaceHistoryCount,
  activeWorkspaceRunningTotal,
  categoryCounts,
  onScopeChange,
  onQuickCreateWork,
}) => {
  const { t } = useI18n('scenes/work-center');
  const categoryItems: WorkCategory[] = ['long_term', 'recurring'];

  const workspaceCountLabel = [
    t('scope.openWorkspaces', { count: activeWorkspaceCount }),
    workspaceHistoryCount > 0 ? t('scope.historyWorkspaces', { count: workspaceHistoryCount }) : null,
    activeWorkspaceRunningTotal > 0 ? t('scope.running', { count: activeWorkspaceRunningTotal }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <aside className="sr-rail" aria-label={t('scope.label')}>
      <header className="sr-header">
        {/* Eyebrow: brand seed + mono kicker + a rule that prints itself in. */}
        <div className="sr-header__eyebrow">
          <span className="sr-header__seed" aria-hidden="true" />
          <span className="sr-header__eyebrow-text">{t('header.eyebrow')}</span>
          <span className="sr-header__eyebrow-rule" aria-hidden="true" />
        </div>
        <div className="sr-header__row">
          <h2 className="sr-header__title">{t('title')}</h2>
          <IconButton
            className="sr-header__create-action"
            size="small"
            variant="brand"
            aria-label={t('actions.newWork')}
            tooltip={t('actions.newWork')}
            onClick={onQuickCreateWork}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        {/* Vitals: the center's global heartbeat in mono figures. */}
        <p className="sr-header__vitals">
          {runningTotal > 0 ? (
            <>
              <span className="sr-header__vitals-running">
                {t('scope.running', { count: runningTotal })}
              </span>
              {openTotal > 0 ? (
                <span className="sr-header__vitals-sep" aria-hidden="true">·</span>
              ) : null}
            </>
          ) : null}
          {openTotal > 0 ? (
            <span className="sr-header__vitals-open">
              {t('scope.openWorkCount', { count: openTotal })}
            </span>
          ) : null}
          {runningTotal === 0 && openTotal === 0 ? (
            <span className="sr-header__vitals-open">{t('header.quiet')}</span>
          ) : null}
        </p>
      </header>

      <div className="sr-main">
        <section className="sr-section">
          <div className="sr-section__head">
            <span className="sr-section__label">{t('scope.todaySection')}</span>
          </div>
          <ScopeItem
            title={t('scope.openWork')}
            count={openTotal}
            countLabel={t('scope.openWorkCount', { count: openTotal })}
            selected={scope.kind === 'open'}
            onClick={() => onScopeChange({ kind: 'open' })}
          />
          <ScopeItem
            title={t('scope.attention')}
            count={attentionTotal}
            countLabel={t('scope.needsAttention', { count: attentionTotal })}
            tone="attention"
            live={attentionTotal > 0}
            selected={scope.kind === 'attention'}
            onClick={() => onScopeChange({ kind: 'attention' })}
          />
          <ScopeItem
            title={t('scope.runningWorks')}
            count={runningTotal}
            countLabel={t('scope.running', { count: runningTotal })}
            tone="running"
            live={runningTotal > 0}
            selected={scope.kind === 'running'}
            onClick={() => onScopeChange({ kind: 'running' })}
          />
        </section>

        <section className="sr-section">
          <div className="sr-section__head">
            <span className="sr-section__label">{t('scope.continuitySection')}</span>
          </div>
          {categoryItems.map((category) => {
            const count = categoryCounts.get(category) ?? { total: 0, running: 0 };
            return (
              <ScopeItem
                key={category}
                title={t(`category.${category}`)}
                count={count.total}
                countLabel={[
                  t('scope.total', { count: count.total }),
                  count.running > 0 ? t('scope.running', { count: count.running }) : null,
                ].filter(Boolean).join(' · ')}
                tone={count.running > 0 ? 'running' : undefined}
                live={count.running > 0}
                selected={scope.kind === 'category' && scope.category === category}
                onClick={() => onScopeChange({ kind: 'category', category })}
              />
            );
          })}
        </section>

        <section className="sr-section">
          <div className="sr-section__head">
            <span className="sr-section__label">{t('scope.workspaceSection')}</span>
          </div>
          <ScopeItem
            title={t('scope.workspaces')}
            count={activeWorkspaceCount + workspaceHistoryCount}
            countLabel={workspaceCountLabel}
            tone={activeWorkspaceRunningTotal > 0 ? 'running' : undefined}
            live={activeWorkspaceRunningTotal > 0}
            selected={scope.kind === 'workspaces'}
            onClick={() => onScopeChange({ kind: 'workspaces' })}
          />
        </section>

        <section className="sr-section">
          <div className="sr-section__head">
            <span className="sr-section__label">{t('scope.librarySection')}</span>
          </div>
          <ScopeItem
            title={t('scope.unarchivedWork')}
            count={unarchivedTotal}
            countLabel={t('scope.unarchivedWorkCount', { count: unarchivedTotal })}
            selected={scope.kind === 'all'}
            onClick={() => onScopeChange({ kind: 'all' })}
          />
          <ScopeItem
            title={t('scope.completedWork')}
            count={completedTotal}
            countLabel={t('scope.completedWorkCount', { count: completedTotal })}
            selected={scope.kind === 'completed'}
            onClick={() => onScopeChange({ kind: 'completed' })}
          />
          <ScopeItem
            title={t('scope.archivedWork')}
            count={archivedTotal}
            countLabel={t('scope.archivedWorkCount', { count: archivedTotal })}
            selected={scope.kind === 'archived'}
            onClick={() => onScopeChange({ kind: 'archived' })}
          />
        </section>
      </div>
    </aside>
  );
};

export default ScopeRail;
