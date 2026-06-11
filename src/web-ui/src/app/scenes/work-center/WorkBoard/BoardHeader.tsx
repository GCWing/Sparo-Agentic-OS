import React, { useMemo } from 'react';
import { Search as SearchIcon, X } from 'lucide-react';
import { Search, Select, type SelectOption } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import type { WorkspaceInfo } from '@/shared/types';
import type {
  WorkCenterGrouping,
  WorkCenterScope,
  WorkCenterWorkspaceFilter,
} from '@/app/stores/workDockStore';
import './BoardHeader.scss';

interface BoardHeaderProps {
  scope: WorkCenterScope;
  workspaces: WorkspaceInfo[];
  workspaceFilter: WorkCenterWorkspaceFilter;
  totalCount: number;
  runningCount: number;
  search: string;
  grouping: WorkCenterGrouping;
  showWorkControls?: boolean;
  showWorkspaceFilter?: boolean;
  searchPlaceholder?: string;
  canClearFilters?: boolean;
  onSearchChange: (value: string) => void;
  onWorkspaceFilterChange: (filter: WorkCenterWorkspaceFilter) => void;
  onClearFilters?: () => void;
  onGroupingChange: (value: WorkCenterGrouping) => void;
}

const BoardHeader: React.FC<BoardHeaderProps> = ({
  scope,
  workspaces,
  workspaceFilter,
  totalCount,
  runningCount,
  search,
  grouping,
  showWorkControls = true,
  showWorkspaceFilter = true,
  searchPlaceholder,
  canClearFilters = false,
  onSearchChange,
  onWorkspaceFilterChange,
  onClearFilters,
  onGroupingChange,
}) => {
  const { t } = useI18n('scenes/work-center');
  const scopeLabel = (() => {
    if (scope.kind === 'category') {
      return t(`category.${scope.category}`);
    }
    if (scope.kind === 'open') return t('scope.openWork');
    if (scope.kind === 'attention') return t('scope.attention');
    if (scope.kind === 'running') return t('scope.runningWorks');
    if (scope.kind === 'all') return t('scope.unarchivedWork');
    if (scope.kind === 'completed') return t('scope.completedWork');
    if (scope.kind === 'archived') return t('scope.archivedWork');
    if (scope.kind === 'workspaces') return t('scope.workspaces');
    return t('scope.openWork');
  })();

  const groupingOptions: WorkCenterGrouping[] = ['priority', 'status', 'kind', 'time'];
  const workspaceOptions = useMemo<SelectOption[]>(() => [
    { label: t('workspaceFilter.all'), value: 'all' },
    ...workspaces.map((workspace) => ({
      label: workspace.name,
      value: workspace.id,
      description: workspace.rootPath,
    })),
  ], [t, workspaces]);

  const selectedWorkspaceValue = workspaceFilter.kind === 'workspace' ? workspaceFilter.id : 'all';
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('search.placeholder');

  return (
    <header className="bh-header">
      {/* Identity line: the scope and its vital signs. */}
      <div className="bh-header__title-line">
        <h2 className="bh-header__title">{scopeLabel}</h2>
        {totalCount > 0 ? <span className="bh-header__count">{totalCount}</span> : null}
        {runningCount > 0 ? (
          <span className="bh-header__live">
            <span className="bh-header__live-dot" aria-hidden="true" />
            {t('scope.running', { count: runningCount })}
          </span>
        ) : null}
      </div>
      {/* Tool line: search and workspace filter fused into one instrument,
          grouping views speaking the rail's signal-dot grammar on the right. */}
      <div className="bh-header__tool-line">
        <div className="bh-instrument">
          <Search
            className="bh-search"
            value={search}
            onChange={onSearchChange}
            onClear={() => onSearchChange('')}
            placeholder={resolvedSearchPlaceholder}
            inputAriaLabel={resolvedSearchPlaceholder}
            prefixIcon={<SearchIcon size={13} />}
            size="small"
            clearable
          />
          {showWorkspaceFilter && workspaces.length > 0 ? (
            <>
              <span className="bh-instrument__rule" aria-hidden="true" />
              <Select
                className={[
                  'bh-workspace-select',
                  selectedWorkspaceValue !== 'all' && 'is-filtered',
                ].filter(Boolean).join(' ')}
                size="small"
                searchable={workspaces.length > 6}
                options={workspaceOptions}
                value={selectedWorkspaceValue}
                searchPlaceholder={t('workspaceFilter.searchPlaceholder')}
                onChange={(value) => {
                  const nextValue = String(value);
                  onWorkspaceFilterChange(
                    nextValue === 'all'
                      ? { kind: 'all' }
                      : { kind: 'workspace', id: nextValue }
                  );
                }}
              />
            </>
          ) : null}
          {canClearFilters && onClearFilters ? (
            <>
              <span className="bh-instrument__rule bh-instrument__rule--clear" aria-hidden="true" />
              <button
                type="button"
                className="bh-instrument__clear"
                onClick={onClearFilters}
                aria-label={t('actions.clearFilters')}
                title={t('actions.clearFilters')}
              >
                <X size={12} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
        <span className="bh-header__spacer" aria-hidden="true" />
        {showWorkControls ? (
          <div className="bh-views" role="group" aria-label={t('grouping.label')}>
            {groupingOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={['bh-view', grouping === option && 'is-active'].filter(Boolean).join(' ')}
                aria-pressed={grouping === option}
                onClick={() => onGroupingChange(option)}
              >
                <span className="bh-view__dot" aria-hidden="true" />
                {t(`grouping.${option}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
};

export default BoardHeader;
