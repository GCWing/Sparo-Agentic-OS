import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  FolderOpen,
  Info,
  Layers,
  Package,
  Route,
  Settings2,
  Tag,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  DataList,
  DataListEmpty,
  DataListItem,
  FilterBar,
  FloatingCard,
  IconButton,
  Input,
  InspectorPanel,
  ListDetail,
  LoadingSkeleton,
  ModeSwitch,
  Pagination,
  Panel,
  PanelBody,
  PanelHeader,
  Search,
  Select,
  Skeleton,
  StatusPill,
  Switch,
} from '@/design-system';
import { GalleryDetailModal } from '@/app/components';
import type { SkillInfo, SkillLevel, SkillMarketItem } from '@/infrastructure/config/types';
import { workspaceAPI } from '@/infrastructure/api';
import {
  skillLibraryUnitCanDelete,
  skillLibraryUnitIsBuiltin,
  skillLibraryUnitLevel,
  skillLibraryUnitPath,
  type SkillLibrarySourceFilter,
  type SkillLibraryTypeFilter,
  type SkillLibraryUnit,
} from '@/shared/skillLibrary';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { getCardGradient } from '@/shared/utils/cardGradients';
import { useGallerySceneAutoRefresh } from '@/app/hooks/useGallerySceneAutoRefresh';
import SkillCard from './components/SkillCard';
import { useInstalledSkills } from './hooks/useInstalledSkills';
import { useSkillMarket } from './hooks/useSkillMarket';
import { useSkillsSceneStore } from './skillsSceneStore';
import './SkillsScene.scss';

const log = createLogger('SkillsScene');

type SkillTab = 'installed' | 'discover';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  OSAgent: 'Sparo OS',
  Runno: 'Runno',
  Cowork: 'Cowork',
  Design: 'Design',
  DeepResearch: 'Deep Research',
  'bitfun-coder': 'BitFun Coder',
};

function agentDisplayName(agentId: string): string {
  return AGENT_DISPLAY_NAMES[agentId]
    ?? agentId.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

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
    installedTypeFilter,
    installedSourceFilter,
    isAddFormOpen,
    setSearchDraft,
    submitMarketQuery,
    setInstalledTypeFilter,
    setInstalledSourceFilter,
    setAddFormOpen,
  } = useSkillsSceneStore();

  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [deleteTarget, setDeleteTarget] = useState<SkillLibraryUnit | null>(null);
  const [installedSearch, setInstalledSearch] = useState('');
  const [selectedUnitKey, setSelectedUnitKey] = useState<string | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [selectedMarketSkill, setSelectedMarketSkill] = useState<SkillMarketItem | null>(null);
  const addPackageCardRef = useRef<HTMLDivElement | null>(null);

  const installed = useInstalledSkills({
    searchQuery: installedSearch,
    typeFilter: installedTypeFilter,
    sourceFilter: installedSourceFilter,
  });
  const loadInstalledSkills = installed.loadSkills;
  const resetInstalledForm = installed.resetForm;
  const installedSkillNames = useMemo(
    () => new Set(installed.skills.map(skill => skill.name)),
    [installed.skills],
  );
  const standaloneUnitByName = useMemo(
    () => new Map(installed.units
      .filter((unit): unit is Extract<SkillLibraryUnit, { kind: 'skill' }> => unit.kind === 'skill')
      .map(unit => [unit.skill.name, unit])),
    [installed.units],
  );

  const market = useSkillMarket({
    searchQuery: marketQuery,
    installedSkillNames,
    pageSize: 15,
    onInstalledChanged: async () => {
      await loadInstalledSkills(true);
    },
  });
  const refreshMarket = market.refresh;

  const refetchSkillsScene = useCallback(async () => {
    await Promise.all([loadInstalledSkills(true), refreshMarket()]);
  }, [loadInstalledSkills, refreshMarket]);

  useGallerySceneAutoRefresh({ sceneId: 'skills', refetch: refetchSkillsScene });

  const selectedUnit = useMemo(
    () => installed.filteredUnits.find(unit => unit.key === selectedUnitKey)
      ?? installed.filteredUnits[0]
      ?? null,
    [installed.filteredUnits, selectedUnitKey],
  );
  const selectedMember = useMemo(() => {
    if (selectedUnit?.kind !== 'suite' || !selectedMemberKey) return null;
    return selectedUnit.members.find(member => member.key === selectedMemberKey) ?? null;
  }, [selectedMemberKey, selectedUnit]);

  const handleRevealPath = useCallback(async (path: string) => {
    if (!path.trim()) return;
    try {
      await workspaceAPI.revealInExplorer(path);
    } catch (error) {
      log.error('Failed to reveal Skill package path', { path, error });
      notification.error(t('messages.revealPathFailed', { error: String(error) }));
    }
  }, [notification, t]);

  const handleAddPackage = async () => {
    const added = await installed.handleAdd();
    if (added) {
      setAddFormOpen(false);
      await market.refresh();
    }
  };

  const closeAddPackageCard = useCallback(() => {
    resetInstalledForm();
    setAddFormOpen(false);
  }, [resetInstalledForm, setAddFormOpen]);

  useEffect(() => {
    if (!isAddFormOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAddPackageCard();
    };
    const focusFrame = window.requestAnimationFrame(() => {
      addPackageCardRef.current?.focus();
    });

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAddPackageCard, isAddFormOpen]);

  const sourceLabel = (unit: SkillLibraryUnit) => {
    if (skillLibraryUnitIsBuiltin(unit)) return t('filters.source.builtin');
    return skillLibraryUnitLevel(unit) === 'user'
      ? t('filters.source.user')
      : t('filters.source.project');
  };

  const renderDetailFacts = (item: SkillInfo | SkillLibraryUnit) => {
    let path: string;
    let level: SkillLevel;
    let command: string;
    if ('kind' in item) {
      path = skillLibraryUnitPath(item);
      level = skillLibraryUnitLevel(item);
      command = item.kind === 'suite' ? `suite:${item.suite.id}` : item.name;
    } else {
      path = item.path;
      level = item.level;
      command = item.name;
    }
    const location = 'kind' in item
      ? sourceLabel(item)
      : item.isBuiltin
        ? t('filters.source.builtin')
        : level === 'user'
          ? t('filters.source.user')
          : t('filters.source.project');
    const type = 'kind' in item
      ? item.kind === 'suite' ? t('filters.type.suite') : t('filters.type.standalone')
      : item.suiteKey ? t('detail.member') : t('filters.type.standalone');
    return (
      <section className="skills-inspector__section skills-inspector__section--runtime">
        <h3><Info size={17} aria-hidden="true" />{t('detail.runtime')}</h3>
        <dl className="skills-inspector__facts">
          <div>
            <dt>{t('detail.command')}</dt>
            <dd><code>{command}</code></dd>
          </div>
          <div>
            <dt>{t('detail.type')}</dt>
            <dd>{type}</dd>
          </div>
          <div>
            <dt>{t('detail.level')}</dt>
            <dd>{location}</dd>
          </div>
          <div>
            <dt>{t('detail.path')}</dt>
            <dd>
              <button type="button" onClick={() => void handleRevealPath(path)} title={path}>
                {path}
              </button>
            </dd>
          </div>
          {'kind' in item && item.kind === 'suite' ? (
            <div>
              <dt>{t('detail.status')}</dt>
              <dd>
                {item.suite.missingRefs.length > 0
                  ? t('detail.healthMissing', { count: item.suite.missingRefs.length })
                  : t('detail.healthReady')}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    );
  };

  const renderInspectorIdentity = (
    name: string,
    description: string,
    kind: 'suite' | 'skill',
  ) => (
    <span className="skills-inspector__identity">
      <span className="skills-inspector__identity-icon" aria-hidden="true">
        {kind === 'suite' ? <Layers size={24} /> : <BookOpen size={24} />}
      </span>
      <span className="skills-inspector__identity-copy">
        <strong>{name}</strong>
        <small>{description}</small>
      </span>
    </span>
  );

  const renderManagementSection = (unit: SkillLibraryUnit) => {
    const isDisabled = installed.isUnitDisabledForAgent(unit);
    const selectedAgentName = installed.selectedAgentId
      ? agentDisplayName(installed.selectedAgentId)
      : '';
    const isUpdating = installed.updatingAvailabilityKey === unit.key;
    const canDelete = skillLibraryUnitCanDelete(unit);
    return (
      <section className="skills-inspector__section skills-inspector__management">
        <h3><Settings2 size={17} aria-hidden="true" />{t('management.title')}</h3>
        <div className="skills-inspector__management-controls">
          <Select
            className="skills-inspector__agent-select"
            label={t('management.agentLabel')}
            options={installed.agentIds.length > 0
              ? installed.agentIds.map(agentId => ({
                  value: agentId,
                  label: agentDisplayName(agentId),
                }))
              : [{ value: '', label: t('management.noAgents'), disabled: true }]}
            value={installed.selectedAgentId}
            onChange={value => installed.setSelectedAgentId(String(value))}
            size="small"
            disabled={installed.agentIds.length === 0}
          />
          <Switch
            className="skills-inspector__availability-switch"
            size="small"
            checked={Boolean(installed.selectedAgentId) && !isDisabled}
            disabled={!installed.selectedAgentId}
            loading={installed.isAgentSkillsLoading || isUpdating}
            label={t('management.availabilityLabel')}
            description={!installed.selectedAgentId
              ? t('management.noAgents')
              : isDisabled
                ? t('management.availabilityDisabled', { agent: selectedAgentName })
                : t('management.availabilityEnabled', { agent: selectedAgentName })}
            onChange={event => void installed.setUnitDisabledForAgent(unit, !event.target.checked)}
          />
        </div>
        <div className="skills-inspector__management-row">
          <div className="skills-inspector__management-copy">
            <strong>{t('management.filesTitle')}</strong>
            <small>{t(canDelete ? 'management.removableDescription' : 'management.builtinDescription')}</small>
          </div>
          <div className="skills-inspector__management-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={() => void handleRevealPath(skillLibraryUnitPath(unit))}
            >
              <FolderOpen size={14} />
              {t('management.openFolder')}
            </Button>
            {canDelete ? (
              <Button variant="danger" size="small" onClick={() => setDeleteTarget(unit)}>
                <Trash2 size={14} />
                {t('management.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    );
  };

  const inspector = selectedMember ? (
    <InspectorPanel
      className="skills-inspector"
      title={renderInspectorIdentity(
        selectedMember.name,
        selectedMember.description,
        'skill',
      )}
      actions={(
        <div className="skills-inspector__actions">
          <Button variant="ghost" size="small" onClick={() => setSelectedMemberKey(null)}>
            <ArrowLeft size={14} />
            {t('detail.backToSuite')}
          </Button>
          <IconButton
            variant="ghost"
            size="small"
            aria-label={t('detail.reveal')}
            tooltip={t('detail.reveal')}
            onClick={() => void handleRevealPath(selectedMember.path)}
          >
            <FolderOpen size={14} />
          </IconButton>
        </div>
      )}
    >
      {renderDetailFacts(selectedMember)}
      {selectedMember.tags.length > 0 ? (
        <div className="skills-inspector__section">
          <h3><Tag size={17} aria-hidden="true" />{t('detail.tags')}</h3>
          <div className="skills-inspector__tags">
            {selectedMember.tags.map(tag => <StatusPill key={tag} tone="neutral" size="small">{tag}</StatusPill>)}
          </div>
        </div>
      ) : null}
    </InspectorPanel>
  ) : selectedUnit ? (
    <InspectorPanel
      className="skills-inspector"
      title={renderInspectorIdentity(
        selectedUnit.name,
        selectedUnit.description,
        selectedUnit.kind,
      )}
    >
      {renderDetailFacts(selectedUnit)}
      {renderManagementSection(selectedUnit)}

      {selectedUnit.kind === 'suite' ? (
        <>
          {selectedUnit.suite.routerPath ? (
            <div className="skills-inspector__section">
              <h3><Route size={17} aria-hidden="true" />{t('detail.router')}</h3>
              <code className="skills-inspector__code">{selectedUnit.suite.routerPath}</code>
            </div>
          ) : null}
          {selectedUnit.suite.tags.length > 0 ? (
            <div className="skills-inspector__section">
              <h3><Tag size={17} aria-hidden="true" />{t('detail.tags')}</h3>
              <div className="skills-inspector__tags">
                {selectedUnit.suite.tags.map(tag => <StatusPill key={tag} tone="neutral" size="small">{tag}</StatusPill>)}
              </div>
            </div>
          ) : null}
          <div className="skills-inspector__section skills-inspector__members">
            <div className="skills-inspector__section-heading">
              <h3><Layers size={17} aria-hidden="true" />{t('detail.members')}</h3>
              <span>{t('detail.memberCount', { count: selectedUnit.members.length })}</span>
            </div>
            <DataList>
              {selectedUnit.members.map(member => (
                <DataListItem
                  key={member.key}
                  onClick={() => setSelectedMemberKey(member.key)}
                  className="skills-member-row"
                >
                  <BookOpen size={15} aria-hidden="true" />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.description}</small>
                  </span>
                </DataListItem>
              ))}
              {selectedUnit.members.length === 0 ? (
                <DataListEmpty>{t('detail.noMembers')}</DataListEmpty>
              ) : null}
            </DataList>
          </div>
          {selectedUnit.suite.missingRefs.length > 0 ? (
            <div className="skills-inspector__section skills-inspector__missing">
              <h3><AlertTriangle size={14} />{t('detail.missingMembers')}</h3>
              <ul>
                {selectedUnit.suite.missingRefs.map(ref => <li key={ref.skillId}>{ref.skillId}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      ) : selectedUnit.skill.tags.length > 0 ? (
        <div className="skills-inspector__section">
          <h3><Tag size={17} aria-hidden="true" />{t('detail.tags')}</h3>
          <div className="skills-inspector__tags">
            {selectedUnit.skill.tags.map(tag => <StatusPill key={tag} tone="neutral" size="small">{tag}</StatusPill>)}
          </div>
        </div>
      ) : null}
    </InspectorPanel>
  ) : (
    <InspectorPanel
      className="skills-inspector"
      title={t('detail.emptyTitle')}
      description={t('detail.emptyDescription')}
    >
      <div className="skills-inspector__empty"><Package size={28} /></div>
    </InspectorPanel>
  );

  const addPackageCard = isAddFormOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="sparo-skills-scene__add-card-layer"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeAddPackageCard();
      }}
    >
      <FloatingCard
        ref={addPackageCardRef}
        id="skills-add-package-card"
        className="sparo-skills-scene__add-card"
        padding="spacious"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-add-package-title"
        tabIndex={-1}
        onDismiss={closeAddPackageCard}
        dismissLabel={t('form.actions.close')}
        dismissTooltip={t('form.actions.close')}
      >
        <div className="sparo-skills-scene__add-card-heading">
          <strong id="skills-add-package-title">{t('form.title')}</strong>
        </div>
        <div className="sparo-skills-scene__add-form">
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
          onChange={value => installed.setFormLevel(value as SkillLevel)}
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
            onChange={event => installed.setFormPath(event.target.value)}
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
        <div className="sparo-skills-scene__path-hint">{t('form.path.hint')}</div>
        {installed.isValidating ? (
          <div className="sparo-skills-scene__validating">{t('form.validating')}</div>
        ) : null}
        {installed.validationResult ? (
          <div className={[
            'sparo-skills-scene__validation',
            installed.validationResult.valid ? 'is-valid' : 'is-invalid',
          ].join(' ')}>
            {installed.validationResult.valid ? (
              <>
                <div className="sparo-skills-scene__validation-heading">
                  <strong>{installed.validationResult.name}</strong>
                  <StatusPill tone="success" size="small">
                    {installed.validationResult.kind === 'suite'
                      ? t('filters.type.suite')
                      : t('filters.type.standalone')}
                  </StatusPill>
                </div>
                <div className="sparo-skills-scene__validation-desc">
                  {installed.validationResult.description}
                </div>
                {installed.validationResult.kind === 'suite' ? (
                  <div className="sparo-skills-scene__validation-meta">
                    {t('detail.memberCount', { count: installed.validationResult.memberCount ?? 0 })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="sparo-skills-scene__validation-error">{installed.validationResult.error}</div>
            )}
          </div>
        ) : null}
          <div className="sparo-skills-scene__add-form-actions">
            <Button variant="secondary" size="small" onClick={closeAddPackageCard}>
              {t('form.actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleAddPackage}
              disabled={!installed.validationResult?.valid || installed.isAdding}
            >
              {installed.isAdding ? t('form.actions.adding') : t('form.actions.add')}
            </Button>
          </div>
        </div>
      </FloatingCard>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="sparo-skills-scene">
      <div className="skills-tabs-bar">
        <ModeSwitch
          value={activeTab}
          onChange={value => setActiveTab(value as SkillTab)}
          options={[
            { value: 'installed', label: t('installed.titleAll') },
            { value: 'discover', label: t('market.title') },
          ]}
          ariaLabel={t('nav.title')}
        />
      </div>

      <div className="skills-page">
        {activeTab === 'installed' ? (
          <ListDetail
            className="skills-library"
            ratio="balanced"
            listLabel={t('library.listLabel')}
            detailLabel={t('library.detailLabel')}
            list={(
              <Panel className="skills-library__list-panel">
                <PanelHeader
                  title={t('installed.titleAll')}
                  description={t('installed.summary', { count: installed.units.length })}
                  actions={(
                    <div className="skills-library__add-package">
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => setAddFormOpen(!isAddFormOpen)}
                        aria-expanded={isAddFormOpen}
                        aria-controls={isAddFormOpen ? 'skills-add-package-card' : undefined}
                      >
                        {t('toolbar.addPackage')}
                      </Button>
                      {addPackageCard}
                    </div>
                  )}
                />
                <PanelBody className="skills-library__list-body">
                  <FilterBar className="skills-library__filters">
                    <Search
                      className="skills-library__search"
                      value={installedSearch}
                      onChange={setInstalledSearch}
                      onClear={() => setInstalledSearch('')}
                      placeholder={t('toolbar.searchPlaceholder')}
                      size="small"
                      clearable
                    />
                    <div className="skills-library__filter-fields">
                      <Select
                        className="skills-library__filter-select"
                        label={t('filters.typeLabel')}
                        value={installedTypeFilter}
                        options={(['all', 'suite', 'standalone'] as SkillLibraryTypeFilter[]).map(type => ({
                          value: type,
                          label: `${t(`filters.type.${type}`)} (${installed.counts.type[type]})`,
                        }))}
                        onChange={value => setInstalledTypeFilter(value as SkillLibraryTypeFilter)}
                        size="small"
                      />
                      <Select
                        className="skills-library__filter-select"
                        label={t('filters.sourceLabel')}
                        value={installedSourceFilter}
                        options={(['all', 'builtin', 'user', 'project'] as SkillLibrarySourceFilter[]).map(source => ({
                          value: source,
                          label: `${t(`filters.source.${source}`)} (${installed.counts.source[source]})`,
                        }))}
                        onChange={value => setInstalledSourceFilter(value as SkillLibrarySourceFilter)}
                        size="small"
                      />
                    </div>
                  </FilterBar>

                  {installed.loading ? (
                    <div className="skills-library__loading" aria-busy="true">
                      <LoadingSkeleton lines={6} />
                    </div>
                  ) : installed.error ? (
                    <DataListEmpty className="skills-library__error">{installed.error}</DataListEmpty>
                  ) : (
                    <DataList className="skills-library__data-list" aria-label={t('library.listLabel')}>
                      {installed.filteredUnits.map(unit => (
                        <DataListItem
                          key={unit.key}
                          selected={selectedUnit?.key === unit.key}
                          onClick={() => {
                            setSelectedUnitKey(unit.key);
                            setSelectedMemberKey(null);
                          }}
                          className="skills-library-row"
                        >
                          <span className="skills-library-row__icon" aria-hidden="true">
                            {unit.kind === 'suite' ? <Layers size={17} /> : <BookOpen size={17} />}
                          </span>
                          <span className="skills-library-row__copy">
                            <strong>{unit.name}</strong>
                            <small>{unit.description}</small>
                          </span>
                          <span className="skills-library-row__meta">
                            <StatusPill tone="neutral" size="small">
                              {unit.kind === 'suite'
                                ? t('detail.memberCount', { count: unit.members.length })
                                : t('filters.type.standalone')}
                            </StatusPill>
                            <span>{sourceLabel(unit)}</span>
                            {unit.kind === 'suite' && unit.suite.missingRefs.length > 0 ? (
                              <AlertTriangle size={13} aria-label={t('detail.healthMissing', { count: unit.suite.missingRefs.length })} />
                            ) : null}
                          </span>
                        </DataListItem>
                      ))}
                      {installed.filteredUnits.length === 0 ? (
                        <DataListEmpty>
                          {installed.units.length === 0 ? t('list.empty.noSkills') : t('list.empty.noMatch')}
                        </DataListEmpty>
                      ) : null}
                    </DataList>
                  )}
                </PanelBody>
              </Panel>
            )}
            detail={inspector}
          />
        ) : (
          <div className="skills-discover">
            <div className="skills-discover__hero">
              <div className="skills-discover__hero-content">
                <h1 className="skills-discover__title">{t('market.title')}</h1>
                <p className="skills-discover__subtitle">{t('market.subtitle')}</p>
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

            <div className="skills-discover__content">
              {market.marketLoading || market.loadingMore ? (
                <div className="skills-discover__grid" aria-busy="true">
                  <SkillGridSkeleton count={12} cardClassName="skills-discover__skeleton-card" />
                </div>
              ) : market.marketError ? (
                <div className="skills-discover__empty skills-discover__empty--error">
                  <Package size={28} />
                  <span>{market.marketError}</span>
                </div>
              ) : market.marketSkills.length === 0 ? (
                <div className="skills-discover__empty">
                  <Package size={28} />
                  <span>{marketQuery ? t('market.empty.noMatch') : t('market.empty.noSkills')}</span>
                </div>
              ) : (
                <>
                  {marketQuery ? (
                    <div className="skills-discover__results-info">
                      {t('market.resultsInfo', { query: marketQuery, count: market.totalLoaded })}
                    </div>
                  ) : null}
                  <div className="skills-discover__grid">
                    {market.marketSkills.map((skill, index) => {
                      const isInstalled = installedSkillNames.has(skill.name);
                      const standaloneUnit = standaloneUnitByName.get(skill.name);
                      const isDownloading = market.downloadingPackage === skill.installId;
                      return (
                        <SkillCard
                          key={skill.installId}
                          name={skill.name}
                          description={skill.description}
                          index={index}
                          iconKind="market"
                          installed={isInstalled}
                          badges={isInstalled ? <Check size={16} aria-hidden="true" /> : null}
                          meta={(
                            <span className="sparo-skills-scene__market-meta">
                              <TrendingUp size={12} />
                              {skill.installs ?? 0}
                            </span>
                          )}
                          actions={isInstalled
                            ? standaloneUnit ? [{
                                id: 'uninstall',
                                icon: <Trash2 size={13} />,
                                ariaLabel: t('detail.deletePackage'),
                                title: t('detail.deletePackage'),
                                tone: 'muted',
                                onClick: () => setDeleteTarget(standaloneUnit),
                              }] : []
                            : [{
                                id: 'download',
                                icon: isDownloading ? <CheckCircle2 size={13} /> : <Download size={13} />,
                                ariaLabel: t('market.item.downloadProject'),
                                title: isDownloading ? t('market.item.downloading') : t('market.item.downloadProject'),
                                disabled: isDownloading || !market.hasWorkspace,
                                tone: 'primary',
                                onClick: () => market.handleDownload(skill),
                              }]}
                          onOpenDetails={() => setSelectedMarketSkill(skill)}
                        />
                      );
                    })}
                  </div>
                  {(market.totalPages > 1 || market.hasMore) ? (
                    <div className="skills-discover__pagination">
                      <Pagination
                        compact
                        page={market.currentPage + 1}
                        pageCount={market.hasMore ? market.currentPage + 2 : market.totalPages}
                        onChange={page => {
                          if (page < market.currentPage + 1) market.goToPrevPage();
                          else if (page > market.currentPage + 1) void market.goToNextPage();
                        }}
                        disabled={market.loadingMore}
                        loading={market.loadingMore}
                        label={market.hasMore
                          ? t('market.pagination.infoMore', { current: market.currentPage + 1 })
                          : t('market.pagination.info', { current: market.currentPage + 1, total: market.totalPages })}
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <GalleryDetailModal
        isOpen={Boolean(selectedMarketSkill)}
        onClose={() => setSelectedMarketSkill(null)}
        icon={<Package size={24} />}
        iconGradient={getCardGradient(selectedMarketSkill?.installId ?? selectedMarketSkill?.name ?? 'skill')}
        title={selectedMarketSkill?.name ?? ''}
        badges={selectedMarketSkill && installedSkillNames.has(selectedMarketSkill.name) ? (
          <StatusPill tone="success" size="small">{t('market.item.installed')}</StatusPill>
        ) : null}
        description={selectedMarketSkill?.description}
        meta={selectedMarketSkill ? (
          <span className="sparo-skills-scene__market-meta">
            <TrendingUp size={12} />{selectedMarketSkill.installs ?? 0}
          </span>
        ) : null}
        actions={selectedMarketSkill ? (
          <Button
            variant={installedSkillNames.has(selectedMarketSkill.name) ? 'secondary' : 'primary'}
            size="small"
            onClick={() => void market.handleDownload(selectedMarketSkill)}
            disabled={market.downloadingPackage === selectedMarketSkill.installId
              || !market.hasWorkspace
              || installedSkillNames.has(selectedMarketSkill.name)}
          >
            {installedSkillNames.has(selectedMarketSkill.name)
              ? t('market.item.installed')
              : t('market.item.downloadProject')}
          </Button>
        ) : null}
      >
        {selectedMarketSkill?.source ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('market.item.sourceLabel')}</span>
            <span className="sparo-skills-scene__detail-value">{selectedMarketSkill.source}</span>
          </div>
        ) : null}
        {selectedMarketSkill?.url ? (
          <div className="sparo-skills-scene__detail-row">
            <span className="sparo-skills-scene__detail-label">{t('market.detail.linkLabel')}</span>
            <a href={selectedMarketSkill.url} target="_blank" rel="noreferrer" className="sparo-skills-scene__detail-link">
              {selectedMarketSkill.url}
            </a>
          </div>
        ) : null}
      </GalleryDetailModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={nextOpen => {
          if (!nextOpen) setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const deleted = await installed.handleDelete(deleteTarget);
          if (deleted) {
            setDeleteTarget(null);
            setSelectedUnitKey(null);
            setSelectedMemberKey(null);
          }
        }}
        title={t('deleteModal.title')}
        message={t('deleteModal.message', {
          name: deleteTarget?.name ?? '',
          type: deleteTarget?.kind === 'suite' ? t('filters.type.suite') : t('filters.type.standalone'),
        })}
        type="warning"
        confirmDanger
        confirmText={t('deleteModal.delete')}
        cancelText={t('deleteModal.cancel')}
      />
    </div>
  );
};

export default SkillsScene;
