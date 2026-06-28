import React from 'react';
import {
  Wrench,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  InspectorPanel,
  ItemCard,
  ItemCardTitle,
  ItemCardTop,
  Panel,
  PanelBody,
  PanelHeader,
  Scene,
  SceneBody,
  SceneHeader,
  SearchToolbar,
  SegmentedControl,
  Tag,
} from '@/design-system';
import type {
  ComponentDefinition,
  ComponentKind,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ComponentCenterFilter } from '../appsStore';
import { componentIconFor } from '../iconUtils';
import { AppCenterModeNav } from './AppCenterModeNav';
import type { AppCenterMode } from './types';

const COMPONENT_FILTERS: Array<'all' | ComponentKind> = ['all', 'surface', 'agent', 'bridge', 'runtime', 'tool', 'skill'];

interface ComponentCenterProps {
  components: ComponentDefinition[];
  allComponents: ComponentDefinition[];
  componentCounts: Record<ComponentKind, number>;
  activeFilter: ComponentCenterFilter;
  selectedComponent: ComponentDefinition | null;
  loading: boolean;
  query: string;
  currentMode: AppCenterMode;
  onModeChange: (mode: AppCenterMode) => void;
  onSearch: (value: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onFilter: (filter: ComponentCenterFilter) => void;
  onSelect: (component: ComponentDefinition) => void;
  onCreateComponent: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const ComponentCenter: React.FC<ComponentCenterProps> = ({
  components,
  allComponents,
  componentCounts,
  activeFilter,
  selectedComponent,
  loading,
  query,
  currentMode,
  onModeChange,
  onSearch,
  onBack,
  onRefresh,
  onFilter,
  onSelect,
  onCreateComponent,
  t,
}) => {
  return (
    <Scene className="apps-scene apps-scene--component-center">
      <AppCenterModeNav currentMode={currentMode} onChange={onModeChange} t={t} />

      <SceneHeader
        eyebrow={t('productSystem.components.eyebrow')}
        title={t('productSystem.components.centerTitle')}
        description={t('productSystem.components.centerSubtitle')}
        actions={(
          <div className="apps-scene__header-actions">
            <Button variant="ghost" size="small" onClick={onBack}>
              {t('productSystem.actions.back')}
            </Button>
            <IconButton
              aria-label={t('productSystem.actions.refresh')}
              tooltip={t('productSystem.actions.refresh')}
              variant="ghost"
              size="small"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw size={14} aria-hidden />
            </IconButton>
            <Button variant="primary" size="small" onClick={onCreateComponent}>
              <Wrench size={14} aria-hidden />
              <span>{t('productSystem.actions.createComponent')}</span>
            </Button>
          </div>
        )}
      />

      <SearchToolbar
        className="apps-scene__search-toolbar"
        density="compact"
        search={{
          value: query,
          onChange: onSearch,
          placeholder: t('productSystem.components.searchPlaceholder'),
          size: 'medium',
          inputAriaLabel: t('productSystem.components.searchLabel'),
        }}
        filters={(
          <SegmentedControl
            value={activeFilter}
            onChange={(value) => onFilter(value as ComponentCenterFilter)}
            size="small"
            ariaLabel={t('productSystem.components.filterLabel')}
            options={COMPONENT_FILTERS.map((filter) => ({
              value: filter,
              label: filter === 'all'
                ? t('productSystem.components.allKinds')
                : t(`productSystem.componentKinds.${filter}`),
            }))}
          />
        )}
        actions={<Badge variant="neutral">{t('productSystem.components.count', { count: allComponents.length })}</Badge>}
      />

      <SceneBody className="apps-scene__component-layout">
        <Panel className="apps-scene__component-list-panel">
          <PanelHeader
            title={t('productSystem.components.listTitle')}
            description={t('productSystem.components.listDescription')}
          />
          <PanelBody>
            {components.length ? (
              <div className="apps-scene__component-card-grid">
                {components.map((component) => (
                  <ComponentCard
                    key={`${component.kind}:${component.id}:${component.version ?? 'private'}`}
                    component={component}
                    selected={selectedComponent?.id === component.id && selectedComponent?.kind === component.kind}
                    onSelect={() => onSelect(component)}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                imageSize="small"
                title={t('productSystem.components.emptyTitle')}
                description={t('productSystem.components.emptyDescription')}
              />
            )}
          </PanelBody>
        </Panel>

        <InspectorPanel
          className="apps-scene__component-inspector"
          title={selectedComponent ? selectedComponent.name : t('productSystem.components.summaryTitle')}
          description={selectedComponent ? selectedComponent.description : t('productSystem.components.summaryDescription')}
        >
          {selectedComponent ? (
            <ComponentInspector component={selectedComponent} t={t} />
          ) : (
            <div className="apps-scene__component-summary">
              <div className="apps-scene__component-metrics">
                {COMPONENT_FILTERS.filter((kind): kind is ComponentKind => kind !== 'all').map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="apps-scene__metric"
                    onClick={() => onFilter(kind)}
                  >
                    <span>{t(`productSystem.componentKinds.${kind}`)}</span>
                    <strong>{componentCounts[kind] ?? 0}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </InspectorPanel>
      </SceneBody>
    </Scene>
  );
};

function ComponentCard({
  component,
  selected,
  onSelect,
  t,
}: {
  component: ComponentDefinition;
  selected: boolean;
  onSelect: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const Icon = componentIconFor(component.kind);
  return (
    <ItemCard
      className="apps-scene__component-card"
      highlighted={selected}
      onActivate={onSelect}
      aria-label={component.name}
    >
      <ItemCardTop className="apps-scene__component-card-top">
        <span className="apps-scene__component-icon" aria-hidden>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <ItemCardTitle className="apps-scene__component-card-title">
          <span>{component.name}</span>
        </ItemCardTitle>
        <Badge variant="neutral">{t(`productSystem.componentKinds.${component.kind}`)}</Badge>
      </ItemCardTop>
      <p className="apps-scene__component-card-description">{component.description}</p>
    </ItemCard>
  );
}

function ComponentInspector({
  component,
  t,
}: {
  component: ComponentDefinition;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const Icon = componentIconFor(component.kind);
  return (
    <section className="apps-scene__inspector-card">
      <div className="apps-scene__component-overview">
        <span className="apps-scene__component-icon" aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <div className="apps-scene__tag-row">
          <Badge variant="neutral">{t(`productSystem.componentKinds.${component.kind}`)}</Badge>
          <Badge variant={component.packageSource === 'shared' ? 'info' : 'accent'}>
            {t(`productSystem.componentSource.${component.packageSource}`)}
          </Badge>
        </div>
      </div>
      <dl className="apps-scene__facts">
        <div>
          <dt>{t('productSystem.fields.id')}</dt>
          <dd>{component.id}</dd>
        </div>
        <div>
          <dt>{t('productSystem.fields.kind')}</dt>
          <dd>{t(`productSystem.componentKinds.${component.kind}`)}</dd>
        </div>
        <div>
          <dt>{t('productSystem.fields.version')}</dt>
          <dd>{component.version ?? component.ownerApp?.appVersion ?? '-'}</dd>
        </div>
        <div>
          <dt>{t('productSystem.fields.source')}</dt>
          <dd>{t(`productSystem.componentSource.${component.packageSource}`)}</dd>
        </div>
      </dl>
      <section className="apps-scene__inspector-section">
        <h3>{t('productSystem.components.capabilities')}</h3>
        {(component.capabilities ?? []).length ? (
          <div className="apps-scene__capability-list">
            {(component.capabilities ?? []).map((capability) => (
              <div key={capability.id} className="apps-scene__capability">
                <strong>{capability.title || capability.id}</strong>
                <span>{capability.description}</span>
                <small>{(capability.actions ?? []).join(', ')}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="apps-scene__muted">{t('productSystem.components.noCapabilities')}</p>
        )}
      </section>
      <section className="apps-scene__inspector-section">
        <h3>{t('productSystem.components.usedBy')}</h3>
        <div className="apps-scene__tag-row">
          {(component.usedByApps ?? []).length
            ? (component.usedByApps ?? []).map((appId) => <Tag key={appId} color="gray" size="small">{appId}</Tag>)
            : <span className="apps-scene__muted">{t('productSystem.components.noUsage')}</span>}
        </div>
      </section>
    </section>
  );
}

export default ComponentCenter;
