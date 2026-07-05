import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  FolderOpen,
  Layers,
  Package,
  ShieldCheck,
  Trash2,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  Dialog,
  IconButton,
  Input,
  LoadingSkeleton,
  ModeSwitch,
  NavigationList,
  NavigationListItem,
  Pagination,
  Search,
  Select,
  Skeleton,
  StatusPill,
} from '@/design-system';
import { GalleryDetailModal } from '@/app/components';
import type { SkillInfo, SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import { workspaceAPI } from '@/infrastructure/api';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { getCardGradient } from '@/shared/utils/cardGradients';
import { useInstalledSkills } from './hooks/useInstalledSkills';
import { useSkillMarket } from './hooks/useSkillMarket';
import SkillCard from './components/SkillCard';
import './SkillsScene.scss';
import { useSkillsSceneStore, type InstalledFilter } from './skillsSceneStore';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';

const log = createLogger('SkillsScene');

type SkillTab = 'installed' | 'discover';

const INSTALLED_GRID_ROW_HEIGHT = 148;
const INSTALLED_GRID_MIN_ROWS = 3;

type CategoryId = InstalledFilter;

interface CategoryInfo {
  id: CategoryId;
  icon: React.ReactNode;
  labelKey: string;
  descKey: string;
}

const CATEGORIES: CategoryInfo[] = [
  { id: 'all', icon: <Layers size={15} strokeWidth={1.6} />, labelKey: 'filters.all', descKey: 'categories.all' },
  { id: 'builtin', icon: <ShieldCheck size={15} strokeWidth={1.6} />, labelKey: 'filters.builtin', descKey: 'categories.builtin' },
  { id: 'user', icon: <User size={15} strokeWidth={1.6} />, labelKey: 'filters.user', descKey: 'categories.user' },
  { id: 'project', icon: <FolderOpen size={15} strokeWidth={1.6} />, labelKey: 'filters.project', descKey: 'categories.project' },
  { id: 'suite', icon: <Zap size={15} strokeWidth={1.6} />, labelKey: 'filters.suite', descKey: 'categories.suite' },
];

const SkillGridSkeleton: React.FC<{ count: number; cardClassName?: string }> = ({
  count,
  cardClassName = 'skills-skeleton-card',
}) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={`skill-skeleton-${index}`}
        className={cardClassName}
        style={{ '--card-index': index } as React.CSSProperties}
      >
        <LoadingSkeleton avatar lines={3} />
        <Skeleton variant="block" height={28} />
      </div>
    ))}
  </>
);

const SkillsScene: React.FC = () => {
  const { t } = useTranslation('scenes/skills');
  const notification = useNotification();
  const {
    searchDraft,
    marketQuery,
    installedFilter,
    isAddFormOpen,
    setSearchDraft,
    submitMarketQuery,
    setInstalledFilter,
    setAddFormOpen,
  } = useSkillsSceneStore();

  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [deleteTarget, setDeleteTarget] = useState<SkillInfo | null>(null);
  const [installedListPage, setInstalledListPage] = useState(0);
  const [installedPageSize, setInstalledPageSize] = useState(INSTALLED_GRID_MIN_ROWS * 3);
  const [installedSearch, setInstalledSearch] = useState('');
  const installedGridRef = useRef<HTMLDivElement | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<
    | { type: 'installed'; skill: SkillInfo }
    | { type: 'market'; skill: SkillMarketItem }
    | null
  >(null);

  const installed = useInstalledSkills({
    searchQuery: installedSearch,
    activeFilter: installedFilter,
  });

  const installedSkillNames = useMemo(
    () => new Set(installed.skills.map((skill) => skill.name)),
    [installed.skills],
  );
  const installedSkillByName = useMemo(
    () => new Map(installed.skills.map((skill) => [skill.name, skill])),
    [installed.skills],
  );
  const installedSuiteById = useMemo(
    () => new Map(installed.suites.map((suite) => [suite.id, suite])),
    [installed.suites],
  );

  const market = useSkillMarket({
    searchQuery: marketQuery,
    installedSkillNames,
    pageSize: 15,
    onInstalledChanged: async () => {
      await installed.loadSkills(true);
    },
  });

  const refetchSkillsScene = useCallback(async () => {
    await Promise.all([installed.loadSkills(true), market.refresh()]);
  }, [installed, market]);

  useGallerySceneAutoRefresh({
    sceneId: 'skills',
    refetch: refetchSkillsScene,
  });

  const canRevealSkillPath = true;

  const handleRevealSkillPath = useCallback(
    async (path: string) => {
      if (!canRevealSkillPath || !path.trim()) {
        return;
      }
      try {
        await workspaceAPI.revealInExplorer(path);
      } catch (error) {
        log.error('Failed to reveal skill path in explorer', { path, error });
        notification.error(t('messages.revealPathFailed', { error: String(error) }));
      }
    },
    [canRevealSkillPath, notification, t],
  );

  const handleAddSkill = async () => {
    const added = await installed.handleAdd();
    if (added) {
      setAddFormOpen(false);
      await market.refresh();
    }
  };

  const selectedInstalledSkill = selectedDetail?.type === 'installed' ? selectedDetail.skill : null;
  const selectedMarketSkill = selectedDetail?.type === 'market' ? selectedDetail.skill : null;

  const installedFiltered = installed.filteredSkills;
  const installedTotalPages = Math.max(
    1,
    Math.ceil(installedFiltered.length / installedPageSize),
  );
  const currentInstalledPage = Math.min(installedListPage, installedTotalPages - 1);
  const pagedInstalledSkills = installedFiltered.slice(
    currentInstalledPage * installedPageSize,
    (currentInstalledPage + 1) * installedPageSize,
  );

  useLayoutEffect(() => {
    const grid = installedGridRef.current;
    if (!grid) {
      return undefined;
    }

    const updateInstalledPageSize = () => {
      const styles = window.getComputedStyle(grid);
      const columns = styles.gridTemplateColumns === 'none'
        ? 1
        : styles.gridTemplateColumns.split(' ').filter(Boolean).length;
      const rowGap = Number.parseFloat(styles.rowGap) || 0;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const availableHeight = Math.max(0, grid.clientHeight - paddingTop - paddingBottom);
      const rows = Math.max(
        INSTALLED_GRID_MIN_ROWS,
        Math.floor((availableHeight + rowGap) / (INSTALLED_GRID_ROW_HEIGHT + rowGap)),
      );
      const nextPageSize = Math.max(1, columns) * rows;

      setInstalledPageSize((current) => (current === nextPageSize ? current : nextPageSize));
    };

    updateInstalledPageSize();

    const observer = new ResizeObserver(updateInstalledPageSize);
    observer.observe(grid);

    return () => observer.disconnect();
  }, [activeTab, installed.error, installed.loading]);

  useEffect(() => {
    setInstalledListPage(0);
  }, [installedFilter, installedSearch]);

  useEffect(() => {
    setInstalledListPage((page) => Math.min(page, Math.max(0, installedTotalPages - 1)));
  }, [installedTotalPages]);

  return (
    <div className="sparo-skills-scene">
      <div className="skills-tabs-bar">
        <ModeSwitch
          value={activeTab}
          onChange={(value) => setActiveTab(value as SkillTab)}
          options={[
            { value: 'installed', label: t('installed.titleAll') },
            { value: 'discover', label: t('market.title') },
          ]}
          ariaLabel={t('nav.title')}
        />
      </div>

      <div className="skills-page">
        {activeTab === 'installed' && (
          <div className="skills-installed">
            <aside className="skills-sidebar">
              <div className="skills-sidebar__header">
                <h2 className="skills-sidebar__title">{t('installed.titleAll')}</h2>
              </div>
              <NavigationList className="skills-sidebar__nav" variant="plain" aria-label={t('installed.titleAll')}>
                {CATEGORIES.map((cat) => {
                  const count = installed.counts[cat.id];
                  const isEmpty = count === 0;
                  return (
                    <NavigationListItem
                      key={cat.id}
                      active={installedFilter === cat.id}
                      disabled={isEmpty}
                      icon={cat.icon}
                      meta={(
                        <StatusPill tone="neutral" size="small" leadingDot={false}>
                          {isEmpty ? '-' : count}
                        </StatusPill>
                      )}
                      onClick={() => setInstalledFilter(cat.id)}
                    >
                      {t(cat.labelKey)}
                    </NavigationListItem>
                  );
                })}
              </NavigationList>
            </aside>

            <div className="skills-main">
              <div className="skills-main__search">
                <Search
                  value={installedSearch}
                  onChange={setInstalledSearch}
                  onClear={() => setInstalledSearch('')}
                  placeholder={t('toolbar.searchPlaceholder')}
                  size="small"
                  clearable
                />
              </div>

              {installed.loading && (
                <div className="skills-main__loading" aria-busy="true" aria-label={t('list.loading')}>
                  <SkillGridSkeleton count={8} />
                </div>
              )}

              {!installed.loading && installed.error && (
                <div className="skills-main__empty skills-main__empty--error">
                  <Package size={28} strokeWidth={1.2} />
                  <span>{installed.error}</span>
                </div>
              )}

              {!installed.loading && !installed.error && installedFiltered.length === 0 && (
                <div className="skills-main__empty">
                  <Package size={28} strokeWidth={1.2} />
                  <span>
                    {installed.skills.length === 0
                      ? t('list.empty.noSkills')
                      : t('list.empty.noMatch')}
                  </span>
                </div>
              )}

              {!installed.loading && !installed.error && (
                <>
                  <div className="skills-main__grid" ref={installedGridRef}>
                    {pagedInstalledSkills.map((skill, index) => (
                      <SkillCard
                        key={skill.key}
                        name={skill.name}
                        description={skill.description}
                        index={index}
                        compact
                        badges={(
                          <span className="skills-installed-card__badges">
                            {skill.isBuiltin ? (
                              <StatusPill tone="accent" size="small">{t('list.item.builtin')}</StatusPill>
                            ) : null}
                            <StatusPill tone={skill.level === 'user' ? 'info' : 'success'} size="small">
                              {skill.level === 'user' ? t('list.item.user') : t('list.item.project')}
                            </StatusPill>
                            <StatusPill tone={skill.suiteKey ? 'warning' : 'neutral'} size="small">
                              {skill.suiteKey
                                ? (installedSuiteById.get(skill.suiteKey)?.name ?? skill.suiteKey)
                                : t('list.item.standalone')}
                            </StatusPill>
                          </span>
                        )}
                        actions={[
                          ...(skill.path ? [{
                            id: 'open-path',
                            icon: <FolderOpen size={13} />,
                            ariaLabel: t('list.item.openPathInExplorer'),
                            title: skill.path,
                            tone: 'muted' as const,
                            onClick: () => void handleRevealSkillPath(skill.path),
                          }] : []),
                          ...(skill.canDelete ? [{
                            id: 'delete',
                            icon: <Trash2 size={13} />,
                            ariaLabel: t('list.item.deleteTooltip'),
                            title: t('list.item.deleteTooltip'),
                            tone: 'danger' as const,
                            onClick: () => setDeleteTarget(skill),
                          }] : []),
                        ]}
                        onOpenDetails={() => setSelectedDetail({ type: 'installed', skill })}
                      />
                    ))}
                  </div>

                  {installedFiltered.length > 0 && installedTotalPages > 1 && (
                    <div className="skills-installed__pagination">
                      <Pagination
                        page={currentInstalledPage + 1}
                        pageCount={installedTotalPages}
                        onChange={(page) => setInstalledListPage(page - 1)}
                        label={t('market.pagination.info', {
                          current: currentInstalledPage + 1,
                          total: installedTotalPages,
                        })}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'discover' && (
          <div className="skills-discover">
            <div className="skills-discover__hero">
              <div className="skills-discover__hero-content">
                <h1 className="skills-discover__title">{t('market.title')}</h1>
                <p className="skills-discover__subtitle">
                  {t('market.subtitle')}
                </p>
                <div className="skills-discover__search-wrapper">
                  <Search
                    className="skills-discover__search"
                    value={searchDraft}
                    onChange={setSearchDraft}
                    onSearch={submitMarketQuery}
                    onClear={submitMarketQuery}
                    placeholder={t('market.searchPlaceholder')}
                    size="medium"
                    shape="pill"
                    clearable
                    enterToSearch
                  />
                </div>
              </div>
            </div>

            <div className="skills-discover__content">
              {market.marketLoading && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')}>
                  <SkillGridSkeleton count={12} cardClassName="skills-discover__skeleton-card" />
                </div>
              )}

              {!market.marketLoading && market.marketError && (
                <div className="skills-discover__empty skills-discover__empty--error">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{market.marketError}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && market.loadingMore && (
                <div className="skills-discover__grid" aria-busy="true" aria-label={t('list.loading')}>
                  <SkillGridSkeleton count={12} cardClassName="skills-discover__skeleton-card" />
                </div>
              )}

              {!market.marketLoading && !market.marketError && !market.loadingMore && market.marketSkills.length === 0 && (
                <div className="skills-discover__empty">
                  <Package size={28} strokeWidth={1.5} />
                  <span>{marketQuery ? t('market.empty.noMatch') : t('market.empty.noSkills')}</span>
                </div>
              )}

              {!market.marketLoading && !market.marketError && !market.loadingMore && market.marketSkills.length > 0 && (
                <>
                  {marketQuery && (
                    <div className="skills-discover__results-info">
                      <span>
                        {t('market.resultsInfo', { query: marketQuery, count: market.totalLoaded })}
                      </span>
                    </div>
                  )}

                  <div className="skills-discover__grid">
                    {market.marketSkills.map((skill, index) => {
                      const isInstalled = installedSkillNames.has(skill.name);
                      const installedSkill = installedSkillByName.get(skill.name);
                      const isDownloading = market.downloadingPackage === skill.installId;
                      return (
                        <SkillCard
                          key={skill.installId}
                          name={skill.name}
                          description={skill.description}
                          index={index}
                          iconKind="market"
                          installed={isInstalled}
                          badges={isInstalled ? <Check size={16} strokeWidth={2.25} aria-hidden="true" /> : null}
                          meta={(
                            <span className="sparo-skills-scene__market-meta">
                              <TrendingUp size={12} />
                              {skill.installs ?? 0}
                            </span>
                          )}
                          actions={[
                            isInstalled && installedSkill
                              ? {
                                  id: 'uninstall',
                                  icon: <Trash2 size={13} />,
                                  ariaLabel: t('list.item.deleteTooltip'),
                                  title: t('list.item.deleteTooltip'),
                                  tone: 'muted',
                                  onClick: () => setDeleteTarget(installedSkill),
                                }
                              : {
                                  id: 'download',
                                  icon: isDownloading ? <CheckCircle2 size={13} /> : <Download size={13} />,
                                  ariaLabel: t('market.item.downloadProject'),
                                  title: isDownloading
                                    ? t('market.item.downloading')
                                    : t('market.item.downloadProject'),
                                  disabled: isDownloading || !market.hasWorkspace,
                                  tone: 'primary',
                                  onClick: () => market.handleDownload(skill),
                                },
                          ]}
                          onOpenDetails={() => setSelectedDetail({ type: 'market', skill })}
                        />
                      );
                    })}
                  </div>

                  {(market.totalPages > 1 || market.hasMore) && (
                    <div className="skills-discover__pagination">
                      <Pagination
                        compact
                        page={market.currentPage + 1}
                        pageCount={market.hasMore ? market.currentPage + 2 : market.totalPages}
                        onChange={(page) => {
                          if (page < market.currentPage + 1) {
                            market.goToPrevPage();
                          } else if (page > market.currentPage + 1) {
                            void market.goToNextPage();
                          }
                        }}
                        disabled={market.loadingMore}
                        loading={market.loadingMore}
                        label={
                          market.hasMore
                            ? t('market.pagination.infoMore', { current: market.currentPage + 1 })
                            : t('market.pagination.info', { current: market.currentPage + 1, total: market.totalPages })
                        }
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <GalleryDetailModal
        isOpen={Boolean(selectedDetail)}
        onClose={() => setSelectedDetail(null)}
        icon={selectedMarketSkill ? <Package size={24} strokeWidth={1.6} /> : <BookOpen size={24} strokeWidth={1.6} />}
        iconGradient={getCardGradient(
          selectedInstalledSkill?.name
          ?? selectedMarketSkill?.installId
          ?? selectedMarketSkill?.name
          ?? 'skill'
        )}
        title={selectedInstalledSkill?.name ?? selectedMarketSkill?.name ?? ''}
        badges={selectedInstalledSkill ? (
          <>
            <StatusPill tone={selectedInstalledSkill.isBuiltin ? 'accent' : 'success'} size="small">
              {selectedInstalledSkill.isBuiltin ? t('list.item.builtin') : t('list.item.userInstalled')}
            </StatusPill>
            <StatusPill tone={selectedInstalledSkill.level === 'user' ? 'info' : 'success'} size="small">
              {selectedInstalledSkill.level === 'user' ? t('list.item.user') : t('list.item.project')}
            </StatusPill>
            <StatusPill tone={selectedInstalledSkill.suiteKey ? 'warning' : 'neutral'} size="small">
              {selectedInstalledSkill.suiteKey
                ? (installedSuiteById.get(selectedInstalledSkill.suiteKey)?.name ?? selectedInstalledSkill.suiteKey)
                : t('list.item.standalone')}
            </StatusPill>
          </>
        ) : selectedMarketSkill && installedSkillNames.has(selectedMarketSkill.name) ? (
          <StatusPill tone="success" size="small">
            {t('market.item.installed')}
          </StatusPill>
        ) : null}
        description={selectedInstalledSkill?.description ?? selectedMarketSkill?.description}
        meta={selectedMarketSkill ? (
          <span className="sparo-skills-scene__market-meta">
            <TrendingUp size={12} />
            {selectedMarketSkill.installs ?? 0}
          </span>
        ) : null}
        actions={selectedInstalledSkill && selectedInstalledSkill.canDelete ? (
          <Button
            variant="danger"
            size="small"
            onClick={() => {
              setDeleteTarget(selectedInstalledSkill);
              setSelectedDetail(null);
            }}
          >
            <Trash2 size={14} />
            {t('deleteModal.delete')}
          </Button>
        ) : selectedMarketSkill ? (
          <Button
            variant={installedSkillNames.has(selectedMarketSkill.name) ? 'secondary' : 'primary'}
            size="small"
            onClick={() => void market.handleDownload(selectedMarketSkill)}
            disabled={
              market.downloadingPackage === selectedMarketSkill.installId
              || !market.hasWorkspace
              || installedSkillNames.has(selectedMarketSkill.name)
            }
          >
            {installedSkillNames.has(selectedMarketSkill.name)
              ? t('market.item.installed')
              : t('market.item.downloadProject')}
          </Button>
        ) : null}
      >
        {selectedInstalledSkill ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('list.item.pathLabel')}</span>
            {canRevealSkillPath ? (
              <Button
                variant="ghost"
                size="small"
                className="sparo-skills-scene__detail-path-control"
                title={t('list.item.openPathInExplorer')}
                onClick={() => void handleRevealSkillPath(selectedInstalledSkill.path)}
              >
                {selectedInstalledSkill.path}
              </Button>
            ) : (
              <code className="sparo-skills-scene__detail-value">{selectedInstalledSkill.path}</code>
            )}
          </div>
        ) : null}

        {selectedMarketSkill?.source ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('market.item.sourceLabel')}</span>
            <span className="sparo-skills-scene__detail-value">{selectedMarketSkill.source}</span>
          </div>
        ) : null}

        {selectedMarketSkill ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('market.detail.installsLabel')}</span>
            <span className="sparo-skills-scene__detail-value">{selectedMarketSkill.installs ?? 0}</span>
          </div>
        ) : null}

        {selectedMarketSkill?.url ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
            <a
              href={selectedMarketSkill.url}
              target="_blank"
              rel="noreferrer"
              className="sparo-skills-scene__detail-link"
            >
              {selectedMarketSkill.url}
            </a>
          </div>
        ) : null}
      </GalleryDetailModal>

      <Dialog
        open={isAddFormOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            installed.resetForm();
            setAddFormOpen(false);
          }
        }}
        title={t('form.title')}
        size="small"
      >
        <div className="sparo-skills-scene__modal-form">
          <Select
            label={t('form.level.label')}
            options={[
              { label: t('form.level.user'), value: 'user' },
              {
                label: `${t('form.level.project')}${installed.hasWorkspace ? '' : t('form.level.projectDisabled')}`,
                value: 'project',
                disabled: !installed.hasWorkspace,
              },
            ]}
            value={installed.formLevel}
            onChange={(value) => installed.setFormLevel(value as SkillLevel)}
            size="medium"
          />

          {installed.formLevel === 'project' && installed.hasWorkspace ? (
            <div className="sparo-skills-scene__form-hint">
              {t('form.level.selectedProjectPath', { path: installed.workspacePath })}
            </div>
          ) : null}

          <div className="sparo-skills-scene__path-input">
            <Input
              label={t('form.path.label')}
              placeholder={t('form.path.placeholder')}
              value={installed.formPath}
              onChange={(event) => installed.setFormPath(event.target.value)}
              variant="outlined"
            />
            <IconButton
              variant="ghost"
              size="medium"
              onClick={installed.handleBrowse}
              aria-label={t('form.path.browseTooltip')}
              tooltip={t('form.path.browseTooltip')}
            >
              <FolderOpen size={15} />
            </IconButton>
          </div>
          <div className="sparo-skills-scene__path-hint">
            {t('form.path.hint')}
          </div>

          {installed.isValidating ? (
            <div className="sparo-skills-scene__validating">{t('form.validating')}</div>
          ) : null}

          {installed.validationResult ? (
            <div
              className={[
                'sparo-skills-scene__validation',
                installed.validationResult.valid ? 'is-valid' : 'is-invalid',
              ].filter(Boolean).join(' ')}
            >
              {installed.validationResult.valid ? (
                <>
                  <div className="sparo-skills-scene__validation-name">
                    {installed.validationResult.name}
                  </div>
                  <div className="sparo-skills-scene__validation-desc">
                    {installed.validationResult.description}
                  </div>
                </>
              ) : (
                <div className="sparo-skills-scene__validation-error">
                  {installed.validationResult.error}
                </div>
              )}
            </div>
          ) : null}

          <div className="sparo-skills-scene__modal-form-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                installed.resetForm();
                setAddFormOpen(false);
              }}
            >
              {t('form.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleAddSkill}
              disabled={!installed.validationResult?.valid || installed.isAdding}
            >
              {installed.isAdding ? t('form.actions.adding') : t('form.actions.add')}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={async () => {
          if (!deleteTarget) {
            return;
          }
          const deleted = await installed.handleDelete(deleteTarget);
          if (deleted) {
            setDeleteTarget(null);
          }
        }}
        title={t('deleteModal.title')}
        message={t('deleteModal.message', { name: deleteTarget?.name ?? '' })}
        type="warning"
        confirmDanger
        confirmText={t('deleteModal.delete')}
        cancelText={t('deleteModal.cancel')}
      />
    </div>
  );
};

export default SkillsScene;
