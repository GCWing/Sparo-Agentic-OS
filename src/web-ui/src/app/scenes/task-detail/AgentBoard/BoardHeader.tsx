/**
 * BoardHeader — task board header: scope row + bottom toolbar row (aligned with tall `.sr-header`).
 */

import React from 'react';
import { ChevronRight, LayoutGrid, List, Radio } from 'lucide-react';
import { Search, FilterPill, FilterPillGroup, Tooltip } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import type { TaskCenterScope, TaskCenterGrouping, TaskCenterView } from '@/app/stores/sessionCapsuleStore';
import './BoardHeader.scss';

interface BoardHeaderProps {
  scope: TaskCenterScope;
  scopeName: string;
  scopePath?: string;
  runningCount: number;
  totalCount: number;
  searchQuery: string;
  grouping: TaskCenterGrouping;
  view: TaskCenterView;
  onSearchChange: (q: string) => void;
  onGroupingChange: (g: TaskCenterGrouping) => void;
  onViewChange: (v: TaskCenterView) => void;
}

const BoardHeader: React.FC<BoardHeaderProps> = ({
  scope,
  scopeName,
  scopePath,
  runningCount,
  totalCount,
  searchQuery,
  grouping,
  view,
  onSearchChange,
  onGroupingChange,
  onViewChange,
}) => {
  const { t } = useI18n('scenes/task-detail');

  const groupingOptions: Array<{ id: TaskCenterGrouping; label: string }> = [
    { id: 'agent', label: t('board.grouping.agent') },
    { id: 'status', label: t('board.grouping.status') },
    { id: 'time', label: t('board.grouping.time') },
  ];

  return (
    <div className="bh-header">
      <div className="bh-header__left">
        <div className="bh-breadcrumb">
          {scope.kind === 'workspace' && (
            <>
              <span className="bh-breadcrumb__segment bh-breadcrumb__segment--muted">
                {t('board.breadcrumb.workspace')}
              </span>
              <ChevronRight size={11} className="bh-breadcrumb__sep" aria-hidden />
            </>
          )}
          <Tooltip content={scopePath ?? scopeName} placement="bottom" disabled={!scopePath}>
            <span className="bh-breadcrumb__segment">{scopeName}</span>
          </Tooltip>
        </div>

        {runningCount > 0 && (
          <span className="bh-running-badge">
            <Radio size={9} />
            {t('runningCount', { count: runningCount })}
          </span>
        )}

        <span className="bh-total-badge">{totalCount}</span>
      </div>

      <div className="bh-header__tools">
        <Search
          className="bh-search"
          size="small"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={t('searchSessionsPlaceholder')}
          clearable
        />

        {scope.kind !== 'running' ? (
          <FilterPillGroup>
            {groupingOptions.map((opt) => (
              <FilterPill
                key={opt.id}
                label={opt.label}
                active={grouping === opt.id}
                onClick={() => onGroupingChange(opt.id)}
              />
            ))}
          </FilterPillGroup>
        ) : null}

        <div className="bh-view-toggle" role="group" aria-label={t('board.viewToggleLabel')}>
          <button
            type="button"
            className={['bh-view-btn', view === 'cards' && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => onViewChange('cards')}
            title={t('board.view.cards')}
            aria-label={t('board.view.cards')}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid size={13} />
          </button>
          <button
            type="button"
            className={['bh-view-btn', view === 'rows' && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => onViewChange('rows')}
            title={t('board.view.rows')}
            aria-label={t('board.view.rows')}
            aria-pressed={view === 'rows'}
          >
            <List size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoardHeader;
