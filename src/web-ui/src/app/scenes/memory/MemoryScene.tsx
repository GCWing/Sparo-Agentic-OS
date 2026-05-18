import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutList,
  RefreshCcw,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  IconButton,
  Search,
  Select,
  type SelectOption,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { notificationService } from '@/shared/notification-system';
import { openWorkspaceScene } from '../../navigation/workspaceNavigation';
import { useSettingsStore } from '../settings/settingsStore';
import {
  memoryLibraryAPI,
  type ManualMemoryAction,
  type MemoryRecord,
  type MemoryRecordType,
  type MemoryScopeKey,
  type MemorySpace,
} from './MemoryLibraryAPI';
import MemoryGraph from './components/MemoryGraph';
import MemoryList from './components/MemoryList';
import MemoryDetailDrawer from './components/MemoryDetailDrawer';
import { TYPE_COLORS } from './utils/memoryLayout';
import './MemoryScene.scss';

type TypeFilter = 'all' | MemoryRecordType;

const MEMORY_TYPES: TypeFilter[] = [
  'all',
  'memory',
  'soul',
  'user',
  'milestone',
  'host_overview',
  'memory_log',
  'workspace_overview',
  'unknown',
];

function formatDate(timestamp?: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

const deriveWorkspaceLabel = (
  workspaceName: string | undefined,
  workspacePath: string | undefined,
  memoryDir: string | undefined,
  fallback: string,
): string => {
  if (workspaceName && workspaceName.trim()) return workspaceName;
  const candidate = (workspacePath || memoryDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (candidate) {
    const tail = candidate.split('/').pop();
    if (tail) return tail;
  }
  return fallback;
};

const MemoryScene: React.FC = () => {
  const { t } = useI18n('scenes/memory');
  const { workspacePath, workspaceName, hasWorkspace } = useLastUsedWorkspace();
  const setSettingsTab = useSettingsStore((state) => state.setActiveTab);

  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [spaces, setSpaces] = useState<MemorySpace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<MemoryScopeKey | 'both'>('both');
  const [listOpen, setListOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionWrapRef = useRef<HTMLDivElement>(null);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const storagePaths = await memoryLibraryAPI.getStoragePaths();

      const nextSpaces: MemorySpace[] = [
        {
          scope: 'global',
          label: t('scopes.global'),
          memoryDir: storagePaths.agenticOsMemoryDir,
          available: true,
        },
        {
          scope: 'global',
          label: t('scopes.global'),
          memoryDir: storagePaths.agenticOsHostDir,
          available: true,
        },
      ];

      if (hasWorkspace && workspacePath) {
        try {
          const projectPaths = await memoryLibraryAPI.getProjectStoragePaths(workspacePath);
          nextSpaces.push({
            scope: 'workspace',
            label: t('scopes.workspace'),
            memoryDir: projectPaths.memoryDir,
            available: true,
          });
        } catch {
          nextSpaces.push({
            scope: 'workspace',
            label: t('scopes.workspace'),
            memoryDir: '',
            available: false,
          });
        }
      }

      const nextRecords = (await Promise.all(
        nextSpaces.map((space) => memoryLibraryAPI.listMemoryRecords(space)),
      )).flat();

      const globalOverviewRecords = await memoryLibraryAPI.listMemoryRecords({
        scope: 'global',
        label: t('scopes.global'),
        memoryDir: storagePaths.agenticOsWorkspacesOverviewDir,
        available: true,
      });

      setSpaces(nextSpaces);
      setRecords([...nextRecords, ...globalOverviewRecords]);
    } catch {
      notificationService.error(t('messages.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [hasWorkspace, t, workspacePath]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!actionMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const element = actionWrapRef.current;
      if (element && !element.contains(event.target as Node)) {
        setActionMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [actionMenuOpen]);

  const workspaceLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const space of spaces) {
      if (space.scope !== 'workspace' || !space.memoryDir) continue;
      map[space.memoryDir] = deriveWorkspaceLabel(
        workspaceName,
        workspacePath,
        space.memoryDir,
        space.label,
      );
    }
    return map;
  }, [spaces, workspaceName, workspacePath]);

  const globalLabel = t('scopes.global');

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (typeFilter !== 'all' && record.type !== typeFilter) return false;
      if (scopeFilter !== 'both' && record.scope !== scopeFilter && !record.isWorkspaceOverview) {
        return false;
      }
      if (!normalizedQuery) return true;
      const haystack = [
        record.title,
        record.description,
        record.relativePath,
        record.type,
        record.scope,
        record.content,
        record.workspaceLabel ?? '',
        ...(record.tags ?? []),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, records, scopeFilter, typeFilter]);

  const highlightedIds = useMemo<Set<string> | undefined>(() => {
    if (typeFilter === 'all' && !query.trim()) return undefined;
    return new Set(filteredRecords.map((record) => record.id));
  }, [filteredRecords, query, typeFilter]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const counts = useMemo(() => ({
    total: records.length,
    global: records.filter((record) => record.scope === 'global' && !record.isWorkspaceOverview).length,
    workspaceCount: new Set(
      records
        .filter((record) => record.scope === 'workspace')
        .map((record) => record.groupKey),
    ).size,
  }), [records]);

  const handleSelect = useCallback((record: MemoryRecord) => {
    setSelectedId(record.id);
    setDrawerOpen(true);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    setDrawerOpen(false);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const handleSave = useCallback(async (record: MemoryRecord, content: string) => {
    setIsSaving(true);
    try {
      const refreshed = await memoryLibraryAPI.saveMemoryRecord(record, content);
      setRecords((current) => current.map((item) => (
        item.id === record.id ? refreshed : item
      )));
      setSelectedId(refreshed.id);
      notificationService.success(t('messages.saveSuccess'));
    } catch {
      notificationService.error(t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [t]);

  const handleReveal = useCallback(async (record: MemoryRecord) => {
    try {
      await memoryLibraryAPI.revealMemoryRecord(record);
    } catch {
      notificationService.error(t('messages.revealFailed'));
    }
  }, [t]);

  const handleRunManualAction = useCallback(async (action: ManualMemoryAction) => {
    setActionMenuOpen(false);
    try {
      await memoryLibraryAPI.runManualAction(action);
      notificationService.success(t('messages.consolidationTriggered'));
    } catch {
      notificationService.error(t('messages.consolidationFailed'));
    }
    void loadRecords();
  }, [loadRecords, t]);

  const handleOpenSettings = () => {
    setSettingsTab('memory');
    openWorkspaceScene('settings');
  };

  const typeLabel = useCallback(
    (type: MemoryRecordType) => t(`types.${type}`),
    [t],
  );
  const scopeLabel = useCallback(
    (scope: MemoryScopeKey) => t(`scopes.${scope}`),
    [t],
  );

  const typeSelectOptions = useMemo<SelectOption[]>(
    () =>
      MEMORY_TYPES.map((type) => ({
        value: type,
        label: t(`types.${type}`),
        icon:
          type !== 'all' ? (
            <span
              className="memory-scene__filter-type-dot"
              style={{ background: TYPE_COLORS[type as MemoryRecordType] }}
              aria-hidden
            />
          ) : undefined,
      })),
    [t],
  );

  const scopeSelectOptions = useMemo<SelectOption[]>(
    () =>
      (['both', 'global', 'workspace'] as const).map((scope) => ({
        value: scope,
        label: t(`scopes.${scope}`),
      })),
    [t],
  );
  const reasonLabel = useCallback(
    (reason: 'index' | 'same-folder' | 'cross-scope') => t(`drawer.relations.reasons.${reason}`),
    [t],
  );
  const usageHint = useCallback(
    (type: MemoryRecordType) => t(`usageHints.${type}`),
    [t],
  );

  const headerSubtitle = isLoading
    ? t('loading')
    : t('overview.summary', {
        total: counts.total,
        global: counts.global,
        workspaces: counts.workspaceCount,
      });

  return (
    <div className="memory-scene">
      <div className="memory-scene__stage">
        <header className="memory-scene__header">
          <div className="memory-scene__header-text">
            <h2>{t('title')}</h2>
            <div className="memory-scene__header-subline">
              <p>{headerSubtitle}</p>
            </div>
          </div>
        </header>

        <div className="memory-scene__toolbar">
          <div className="memory-scene__toolbar-start">
            <IconButton
              className={listOpen ? 'is-active' : ''}
              size="small"
              variant={listOpen ? 'default' : 'ghost'}
              onClick={() => setListOpen((current) => !current)}
              aria-label={t('overview.modes.list')}
              tooltip={t('overview.modes.list')}
              tooltipPlacement="bottom"
            >
              <LayoutList size={15} />
            </IconButton>

            <div className="memory-scene__search">
              <Search
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
                placeholder={t('searchPlaceholder')}
                size="medium"
              />
            </div>
          </div>

          <div className="memory-scene__toolbar-filters">
            <div className="memory-scene__filter-field">
              <span className="memory-scene__filter-field-label">
                {t('filters.category')}
              </span>
              <div className="memory-scene__filter-select-wrap memory-scene__filter-select-wrap--type">
                <Select
                  size="small"
                  searchable
                  options={typeSelectOptions}
                  value={typeFilter}
                  onChange={(value) => setTypeFilter(value as TypeFilter)}
                  className="memory-scene__filter-select-inner"
                />
              </div>
            </div>

            <div className="memory-scene__filter-field">
              <span className="memory-scene__filter-field-label">
                {t('sidebar.scope')}
              </span>
              <div className="memory-scene__filter-select-wrap memory-scene__filter-select-wrap--scope">
                <Select
                  size="small"
                  options={scopeSelectOptions}
                  value={scopeFilter}
                  onChange={(value) => setScopeFilter(value as MemoryScopeKey | 'both')}
                  className="memory-scene__filter-select-inner"
                />
              </div>
            </div>
          </div>

          <div className="memory-scene__toolbar-end">
            <div ref={actionWrapRef} className="memory-scene__consolidation-wrap">
              <IconButton
                className={actionMenuOpen ? 'is-active' : ''}
                size="small"
                variant={actionMenuOpen ? 'default' : 'ghost'}
                onClick={() => setActionMenuOpen((open) => !open)}
                aria-expanded={actionMenuOpen}
                aria-haspopup="menu"
                aria-label={t('actions.triggerConsolidation')}
                tooltip={t('actions.triggerConsolidation')}
                tooltipPlacement="bottom"
              >
                <Sparkles size={15} />
              </IconButton>
              {actionMenuOpen && (
                <div className="memory-scene__consolidation-menu" role="menu">
                  <div className="memory-scene__consolidation-menu-heading">
                    {t('actions.triggerConsolidation')}
                  </div>
                  {(['memory_consolidation', 'host_scan', 'workspace_overview', 'milestone'] as ManualMemoryAction[]).map((action) => (
                    <Button
                      key={action}
                      size="small"
                      variant="ghost"
                      className="memory-scene__consolidation-option"
                      role="menuitem"
                      onClick={() => void handleRunManualAction(action)}
                    >
                      {t(`actions.consolidation.${action}`)}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <IconButton
              size="small"
              variant="ghost"
              onClick={() => void loadRecords()}
              aria-label={t('actions.refresh')}
              tooltip={t('actions.refresh')}
              tooltipPlacement="bottom"
            >
              <RefreshCcw size={15} />
            </IconButton>
            <IconButton
              size="small"
              variant="ghost"
              onClick={handleOpenSettings}
              aria-label={t('actions.openSettings')}
              tooltip={t('actions.openSettings')}
              tooltipPlacement="bottom"
            >
              <Settings size={15} />
            </IconButton>
          </div>
        </div>

        <div className="memory-scene__canvas">
          <MemoryGraph
            records={records}
            workspaceLabels={workspaceLabels}
            globalLabel={globalLabel}
            selectedId={selectedId}
            highlightedIds={highlightedIds}
            onSelect={handleSelect}
            onClearSelection={handleClearSelection}
            emptyMessage={
              isLoading ? t('loading') : t('empty.noResults')
            }
          />

          <aside
            className={`memory-scene__list-panel${listOpen ? ' is-open' : ''}`}
            aria-hidden={!listOpen}
          >
            <header className="memory-scene__list-panel-header">
              <span className="memory-scene__list-panel-title">
                {t('overview.modes.list')}
              </span>
              <Badge className="memory-scene__list-panel-count" variant="neutral">
                {filteredRecords.length}
              </Badge>
              <IconButton
                size="xs"
                variant="ghost"
                onClick={() => setListOpen(false)}
                aria-label={t('actions.cancel')}
                tooltip={t('actions.cancel')}
                tooltipPlacement="bottom"
              >
                <X size={14} />
              </IconButton>
            </header>
            <div className="memory-scene__list-panel-body">
              <MemoryList
                records={filteredRecords}
                workspaceLabels={workspaceLabels}
                globalLabel={globalLabel}
                selectedId={selectedId}
                onSelect={handleSelect}
                emptyMessage={
                  isLoading ? t('loading') : t('empty.noResults')
                }
                formatDate={formatDate}
              />
            </div>
          </aside>

          <MemoryDetailDrawer
            record={selectedRecord}
            allRecords={records}
            workspaceLabels={workspaceLabels}
            isOpen={drawerOpen}
            isSaving={isSaving}
            onClose={handleCloseDrawer}
            onSave={handleSave}
            onReveal={(record) => void handleReveal(record)}
            onSelectRelated={handleSelect}
            formatDate={formatDate}
            typeLabel={typeLabel}
            scopeLabel={scopeLabel}
            reasonLabel={reasonLabel}
            usageHint={usageHint}
            t={t}
          />
        </div>
      </div>
    </div>
  );
};

export default MemoryScene;
