import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  LocateFixed,
  Wrench,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Button,
  DataList,
  DataListItem,
  EmptyState,
  IconButton,
  ItemCard,
  SearchToolbar,
  SegmentedControl,
  StatusDot,
  TabPane,
  Tabs,
  Tag,
} from '@/design-system';
import type {
  ComponentDiagnosticAction,
  ComponentHealthResponse,
  ComponentDefinition,
  ComponentKind,
  ComponentRuntimeFailure,
  ComponentRuntimeLogEntry,
  ComponentUsageResponse,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { appCatalogAPI } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { ComponentCenterFilter } from '../appsStore';
import { componentIconFor } from '../iconUtils';
import { ManageViewToggle, type ManageViewMode } from './ManagementList';
import './ComponentCenter.scss';

const COMPONENT_FILTERS: Array<'all' | ComponentKind> = ['all', 'surface', 'agent', 'bridge', 'runtime', 'tool', 'skill'];

function componentKey(component: ComponentDefinition): string {
  return `${component.kind}:${component.id}:${component.version ?? 'private'}`;
}

function countForFilter(items: ComponentDefinition[], filter: ComponentCenterFilter): number {
  if (filter === 'all') return items.length;
  return items.filter((component) => component.kind === filter).length;
}

function buildComponentMeta(component: ComponentDefinition, t: ComponentCenterProps['t']): string {
  const version = component.version ?? component.ownerApp?.appVersion ?? '-';
  return [
    t(`productSystem.componentKinds.${component.kind}`),
    version,
    t(`productSystem.componentSource.${component.packageSource}`),
  ].join(' | ');
}

interface ComponentCenterProps {
  components: ComponentDefinition[];
  allComponents: ComponentDefinition[];
  activeFilter: ComponentCenterFilter;
  selectedComponent: ComponentDefinition | null;
  workspacePath?: string | null;
  loading: boolean;
  query: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onFilter: (filter: ComponentCenterFilter) => void;
  onSelect: (component: ComponentDefinition) => void;
  onClearSelection: () => void;
  onCreateComponent: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const ComponentCenter: React.FC<ComponentCenterProps> = ({
  components,
  allComponents,
  activeFilter,
  selectedComponent,
  workspacePath,
  loading,
  query,
  onSearch,
  onRefresh,
  onFilter,
  onSelect,
  onClearSelection,
  onCreateComponent,
  t,
}) => {
  const [componentHealth, setComponentHealth] = useState<ComponentHealthResponse | null>(null);
  const [componentUsage, setComponentUsage] = useState<ComponentUsageResponse | null>(null);
  const [componentDiagnosticsLoading, setComponentDiagnosticsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ManageViewMode>('cards');

  useEffect(() => {
    let cancelled = false;
    setComponentHealth(null);
    setComponentUsage(null);
    if (!selectedComponent) return;
    setComponentDiagnosticsLoading(true);
    Promise.all([
      appCatalogAPI.componentHealth(selectedComponent.id, selectedComponent.kind, workspacePath),
      appCatalogAPI.componentUsage(selectedComponent.id, selectedComponent.kind),
    ])
      .then(([health, usage]) => {
        if (cancelled) return;
        setComponentHealth(health);
        setComponentUsage(usage);
      })
      .catch(() => {
        if (cancelled) return;
        setComponentHealth({
          componentId: selectedComponent.id,
          status: 'degraded',
          detail: t('productSystem.components.healthFailed'),
          checks: [],
          runtime: {
            recentRunCount: 0,
            recentFailureCount: 0,
            runtimeIssueCount: 0,
            runtimeWarningCount: 0,
            lastActivityAt: null,
          },
        });
        setComponentUsage({ componentId: selectedComponent.id, usedByApps: selectedComponent.usedByApps ?? [] });
      })
      .finally(() => {
        if (!cancelled) setComponentDiagnosticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedComponent, t, workspacePath]);

  return (
    <div className="component-center component-center--embedded" data-testid="component-center-scene">
      <div className="component-center__toolbar">
        <SegmentedControl
          className="component-center__kind-switch"
          value={activeFilter}
          size="small"
          ariaLabel={t('productSystem.components.categoriesLabel')}
          onChange={(value) => {
            onFilter(value as ComponentCenterFilter);
            onClearSelection();
          }}
          options={COMPONENT_FILTERS.map((filter) => ({
            value: filter,
            label: `${filter === 'all'
              ? t('productSystem.components.allKinds')
              : t(`productSystem.componentKinds.${filter}`)} ${countForFilter(allComponents, filter)}`,
          }))}
        />
        <div className="apps-scene__header-actions">
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
          <Button variant="secondary" size="small" onClick={onCreateComponent}>
            <Wrench size={14} aria-hidden />
            <span>{t('productSystem.actions.createComponent')}</span>
          </Button>
        </div>
      </div>

      <div className="component-center__content">
          {selectedComponent ? (
            <div className="component-center__inspector-view">
              <div className="component-center__inspector-toolbar">
                <Button variant="ghost" size="small" onClick={onClearSelection}>
                  {t('productSystem.actions.back')}
                </Button>
                <span className="component-center__inspector-title">{selectedComponent.name}</span>
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
              </div>
              <div className="component-center__inspector-body">
                <ComponentInspector
                  component={selectedComponent}
                  allComponents={allComponents}
                  health={componentHealth}
                  usage={componentUsage}
                  diagnosticsLoading={componentDiagnosticsLoading}
                  onRefresh={onRefresh}
                  onSelectComponent={onSelect}
                  t={t}
                />
              </div>
            </div>
          ) : (
            <>
              <SearchToolbar
                className="component-center__search-toolbar"
                density="compact"
                search={{
                  value: query,
                  onChange: onSearch,
                  placeholder: t('productSystem.components.searchPlaceholder'),
                  size: 'medium',
                  inputAriaLabel: t('productSystem.components.searchLabel'),
                }}
                actions={<ManageViewToggle viewMode={viewMode} onChange={setViewMode} t={t} />}
              />

              {components.length ? (
                viewMode === 'cards' ? (
                  <div className="component-center__tile-grid" role="list" aria-label={t('productSystem.components.listTitle')}>
                    {components.map((component) => (
                      <ComponentTile
                        key={componentKey(component)}
                        component={component}
                        onSelect={() => onSelect(component)}
                        t={t}
                      />
                    ))}
                  </div>
                ) : (
                  <DataList className="component-center__data-list" aria-label={t('productSystem.components.listTitle')}>
                    {components.map((component) => (
                      <ComponentRow
                        key={componentKey(component)}
                        component={component}
                        onSelect={() => onSelect(component)}
                        t={t}
                      />
                    ))}
                  </DataList>
                )
              ) : (
                <EmptyState
                  imageSize="small"
                  title={t('productSystem.components.emptyTitle')}
                  description={t('productSystem.components.emptyDescription')}
                />
              )}
            </>
          )}
      </div>
    </div>
  );
};

function ComponentRow({
  component,
  onSelect,
  t,
}: {
  component: ComponentDefinition;
  onSelect: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const Icon = componentIconFor(component.kind);
  const isUnused = (component.usedByApps ?? []).length === 0;
  const usedByCount = (component.usedByApps ?? []).length;

  return (
    <DataListItem
      className="component-center__row"
      interactive
      onClick={onSelect}
      data-testid="component-center-row"
      data-component-id={component.id}
      data-component-kind={component.kind}
      data-unused={isUnused ? 'true' : 'false'}
    >
      <div className="component-center__row-main">
        <span className="component-center__row-icon" aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <div className="component-center__row-info">
          <div className="component-center__row-name-line">
            <strong className="component-center__row-name">{component.name}</strong>
            {isUnused ? (
              <StatusDot tone="warning" size="small" aria-label={t('productSystem.components.unusedHint')} />
            ) : null}
          </div>
          <span className="component-center__row-description">{component.description}</span>
          <div className="component-center__row-meta">
            <Tag size="small" color="gray">{t(`productSystem.componentKinds.${component.kind}`)}</Tag>
            <Tag size="small" color="gray">{t(`productSystem.componentSource.${component.packageSource}`)}</Tag>
            <span className="component-center__row-usage">
              {usedByCount > 0
                ? t('productSystem.components.usedByCount', { count: usedByCount })
                : t('productSystem.components.noUsage')}
            </span>
          </div>
        </div>
      </div>
    </DataListItem>
  );
}

function ComponentTile({
  component,
  onSelect,
  t,
}: {
  component: ComponentDefinition;
  onSelect: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const Icon = componentIconFor(component.kind);
  const isUnused = (component.usedByApps ?? []).length === 0;

  return (
    <ItemCard
      className="component-center__tile"
      onActivate={onSelect}
      aria-label={component.name}
      data-testid="component-center-card"
      data-component-id={component.id}
      data-component-kind={component.kind}
      data-unused={isUnused ? 'true' : 'false'}
    >
      <div className="component-center__tile-body">
        <span className="component-center__tile-icon" aria-hidden>
          <Icon size={36} strokeWidth={1.6} />
        </span>
        <div className="component-center__tile-name-row">
          <strong className="component-center__tile-name">{component.name}</strong>
          {isUnused ? (
            <StatusDot tone="warning" size="small" aria-label={t('productSystem.components.unusedHint')} />
          ) : null}
        </div>
        <span className="component-center__tile-meta">{buildComponentMeta(component, t)}</span>
      </div>
      <div className="component-center__tile-footer">
        <Button
          variant="ghost"
          size="small"
          className="component-center__tile-action"
          onClick={(event) => { event.stopPropagation(); onSelect(); }}
        >
          {t('productSystem.components.inspect')}
        </Button>
      </div>
    </ItemCard>
  );
}

function healthBadgeVariant(status: string | undefined): 'success' | 'warning' | 'neutral' {
  if (status === 'available') return 'success';
  if (status === 'degraded') return 'warning';
  return 'neutral';
}

function ComponentInspector({
  component,
  allComponents,
  health,
  usage,
  diagnosticsLoading,
  onRefresh,
  onSelectComponent,
  t,
}: {
  component: ComponentDefinition;
  allComponents: ComponentDefinition[];
  health: ComponentHealthResponse | null;
  usage: ComponentUsageResponse | null;
  diagnosticsLoading: boolean;
  onRefresh: () => void;
  onSelectComponent: (component: ComponentDefinition) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const Icon = componentIconFor(component.kind);
  const usedByApps = usage?.usedByApps ?? component.usedByApps ?? [];
  const runtimeUsages = usage?.runtimeUsages ?? [];
  const healthStatus = health?.status ?? 'checking';
  const healthVariant = healthBadgeVariant(healthStatus);
  const healthChecks = health?.checks ?? [];
  const runtimeHealth = health?.runtime;
  const diagnosticActions = runtimeHealth?.actions ?? [];
  const recentFailures = runtimeHealth?.recentFailures ?? [];
  const recentLogs = runtimeHealth?.recentLogs ?? [];
  const openWorkFromDiagnostic = (workId: string | null | undefined) => {
    if (!workId) return;
    openWorkInCenter(workId);
  };
  const findActionWorkId = (action: ComponentDiagnosticAction): string | null => {
    if (action.kind === 'openRuntimeLogs') {
      return recentLogs[0]?.workId ?? recentFailures[0]?.workId ?? runtimeUsages[0]?.workId ?? null;
    }
    if (action.kind === 'inspectRuntimeUsage') {
      return runtimeUsages[0]?.workId ?? recentFailures[0]?.workId ?? recentLogs[0]?.workId ?? null;
    }
    return null;
  };
  const handleDiagnosticAction = (action: ComponentDiagnosticAction) => {
    if (action.kind === 'runHealthAction') {
      onRefresh();
      return;
    }
    if (action.kind === 'installDependency') {
      const target = action.target
        ? allComponents.find((candidate) => candidate.id === action.target)
        : null;
      if (target) {
        onSelectComponent(target);
      } else {
        onRefresh();
      }
      return;
    }
    openWorkFromDiagnostic(findActionWorkId(action));
  };
  const isDiagnosticActionDisabled = (action: ComponentDiagnosticAction): boolean => {
    if (action.kind === 'runHealthAction' || action.kind === 'installDependency') return false;
    return !findActionWorkId(action);
  };
  const diagnosticActionTooltip = (action: ComponentDiagnosticAction): string => {
    if (action.kind === 'runHealthAction') return t('productSystem.components.actionTooltip.runHealthAction');
    if (action.kind === 'installDependency') return t('productSystem.components.actionTooltip.installDependency');
    if (action.kind === 'openRuntimeLogs') return t('productSystem.components.actionTooltip.openRuntimeLogs');
    if (action.kind === 'inspectRuntimeUsage') return t('productSystem.components.actionTooltip.inspectRuntimeUsage');
    return action.label;
  };
  return (
    <section
      className="component-center__inspector-card"
      data-testid="component-inspector"
      data-component-id={component.id}
      data-component-kind={component.kind}
      data-health-status={healthStatus}
      data-runtime-run-count={runtimeHealth?.recentRunCount ?? 0}
      data-runtime-failure-count={runtimeHealth?.recentFailureCount ?? 0}
      data-runtime-issue-count={runtimeHealth?.runtimeIssueCount ?? 0}
      data-runtime-warning-count={runtimeHealth?.runtimeWarningCount ?? 0}
      data-runtime-usage-count={runtimeUsages.length}
      data-diagnostic-action-count={diagnosticActions.length}
      data-recent-failure-count={recentFailures.length}
      data-recent-log-count={recentLogs.length}
      data-health-action={runtimeHealth?.healthAction ?? ''}
      data-health-action-status={runtimeHealth?.healthActionStatus ?? ''}
    >
      <p className="component-center__inspector-description">{component.description}</p>
      <div className="component-center__overview">
        <span className="component-center__icon" aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <div className="component-center__tag-row">
          <Badge variant="neutral">{t(`productSystem.componentKinds.${component.kind}`)}</Badge>
          <Badge variant={component.packageSource === 'shared' ? 'info' : 'neutral'}>
            {t(`productSystem.componentSource.${component.packageSource}`)}
          </Badge>
        </div>
      </div>
      <dl className="component-center__facts">
        <div>
          <dt>{t('productSystem.fields.id')}</dt>
          <dd>{component.id}</dd>
        </div>
        <div>
          <dt>{t('productSystem.fields.version')}</dt>
          <dd>{component.version ?? component.ownerApp?.appVersion ?? '-'}</dd>
        </div>
      </dl>
      <Tabs
        key={`${component.kind}:${component.id}`}
        className="component-center__inspector-tabs"
        type="line"
        size="small"
        defaultActiveKey="health"
      >
        <TabPane tabKey="health" label={t('productSystem.components.health')}>
        {diagnosticsLoading && !health ? (
          <p className="component-center__muted">{t('productSystem.components.healthChecking')}</p>
        ) : (
          <>
            <div className="component-center__tag-row">
              <Badge variant={healthVariant}>
                {t(`productSystem.components.healthStatus.${healthStatus}`, { defaultValue: healthStatus })}
              </Badge>
            </div>
            <p className="component-center__muted">{health?.detail ?? t('productSystem.components.healthUnavailable')}</p>
            {runtimeHealth ? (
              <div className="component-center__tag-row">
                <Tag color="gray" size="small">
                  {t('productSystem.components.runtimeRuns', { count: runtimeHealth.recentRunCount })}
                </Tag>
                <Tag color={runtimeHealth.recentFailureCount > 0 ? 'yellow' : 'gray'} size="small">
                  {t('productSystem.components.runtimeFailures', { count: runtimeHealth.recentFailureCount })}
                </Tag>
                <Tag color={runtimeHealth.runtimeIssueCount > 0 ? 'yellow' : 'gray'} size="small">
                  {t('productSystem.components.runtimeErrors', { count: runtimeHealth.runtimeIssueCount })}
                </Tag>
                <Tag color={runtimeHealth.runtimeWarningCount > 0 ? 'yellow' : 'gray'} size="small">
                  {t('productSystem.components.runtimeWarnings', { count: runtimeHealth.runtimeWarningCount })}
                </Tag>
              </div>
            ) : null}
            {healthChecks.length ? (
              <div className="component-center__health-check-list">
                {healthChecks.map((check) => (
                  <div className="component-center__health-check" key={check.name}>
                    <Badge variant={healthBadgeVariant(check.status)}>
                      {t(`productSystem.components.healthStatus.${check.status}`, { defaultValue: check.status })}
                    </Badge>
                    <div>
                      <strong>{t(`productSystem.components.healthCheck.${check.name}`, { defaultValue: check.name })}</strong>
                      <span>{check.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {diagnosticActions.length ? (
              <div className="component-center__diagnostic-action-list">
                {diagnosticActions.map((action) => (
                  <div className="component-center__diagnostic-action" key={action.id}>
                    <Badge variant={healthBadgeVariant(action.status)}>
                      {t(`productSystem.components.actionStatus.${action.status}`, { defaultValue: action.status })}
                    </Badge>
                    <div>
                      <strong>{t(`productSystem.components.diagnosticAction.${action.kind}`, { defaultValue: action.label })}</strong>
                      <span>{action.detail}</span>
                    </div>
                    <IconButton
                      className="component-center__diagnostic-action-button"
                      size="xs"
                      variant="ghost"
                      aria-label={diagnosticActionTooltip(action)}
                      tooltip={diagnosticActionTooltip(action)}
                      onClick={() => handleDiagnosticAction(action)}
                      disabled={isDiagnosticActionDisabled(action)}
                      data-testid="component-diagnostic-action"
                      data-action-kind={action.kind}
                      data-action-target={action.target ?? ''}
                    >
                      {action.kind === 'installDependency' ? (
                        <LocateFixed size={13} aria-hidden />
                      ) : (
                        <ArrowRight size={13} aria-hidden />
                      )}
                    </IconButton>
                  </div>
                ))}
              </div>
            ) : null}
            {recentFailures.length ? (
              <div className="component-center__runtime-evidence-list">
                <h4>{t('productSystem.components.recentFailures')}</h4>
                {recentFailures.map((failure) => (
                  <RuntimeEvidenceRow
                    key={`${failure.workId}:${failure.runId ?? failure.timestampMs}`}
                    evidence={failure}
                    badge={failure.severity}
                    title={failure.productAppId ?? failure.workId}
                    message={failure.message}
                    t={t}
                    onOpenWork={openWorkFromDiagnostic}
                  />
                ))}
              </div>
            ) : null}
            {recentLogs.length ? (
              <div className="component-center__runtime-evidence-list">
                <h4>{t('productSystem.components.recentLogs')}</h4>
                {recentLogs.slice(0, 5).map((log) => (
                  <RuntimeEvidenceRow
                    key={`${log.workId}:${log.category}:${log.timestampMs}`}
                    evidence={log}
                    badge={log.level}
                    badgeVariant={log.level === 'error' || log.level === 'warn' ? 'warning' : 'neutral'}
                    title={log.category}
                    message={log.message}
                    t={t}
                    onOpenWork={openWorkFromDiagnostic}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
        </TabPane>
        <TabPane tabKey="dependencies" label={t('productSystem.components.dependenciesTab')}>
      <section className="component-center__inspector-section">
        <h3>{t('productSystem.components.capabilities')}</h3>
        {(component.capabilities ?? []).length ? (
          <div className="component-center__capability-list">
            {(component.capabilities ?? []).map((capability) => (
              <div key={capability.id} className="component-center__capability">
                <strong>{capability.title || capability.id}</strong>
                <span>{capability.description}</span>
                <small>{(capability.actions ?? []).join(', ')}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="component-center__muted">{t('productSystem.components.noCapabilities')}</p>
        )}
      </section>
      <section className="component-center__inspector-section">
        <h3>{t('productSystem.components.usedBy')}</h3>
        <div className="component-center__tag-row">
          {usedByApps.length
            ? usedByApps.map((appId) => <Tag key={appId} color="gray" size="small">{appId}</Tag>)
            : <span className="component-center__muted">{t('productSystem.components.noUsage')}</span>}
        </div>
        {runtimeUsages.length ? (
          <div className="component-center__health-check-list">
            {runtimeUsages.slice(0, 5).map((usageItem) => (
              <div
                className="component-center__health-check component-center__runtime-usage-row"
                key={`${usageItem.workId}:${usageItem.runtimeInstanceId ?? 'work'}`}
                data-testid="component-runtime-usage-row"
                data-work-id={usageItem.workId}
                data-runtime-instance-id={usageItem.runtimeInstanceId ?? ''}
              >
                <Badge variant={usageItem.issueCount > 0 ? 'warning' : 'neutral'}>
                  {t('productSystem.components.runtimeUsage')}
                </Badge>
                <div>
                  <strong>{usageItem.productAppId ?? usageItem.workId}</strong>
                  <span>
                    {t('productSystem.components.runtimeUsageDetail', {
                      workId: usageItem.workId,
                      runs: usageItem.runCount,
                      issues: usageItem.issueCount,
                    })}
                  </span>
                </div>
                <IconButton
                  className="component-center__diagnostic-action-button"
                  size="xs"
                  variant="ghost"
                  aria-label={t('productSystem.components.openOwningWork')}
                  tooltip={t('productSystem.components.openOwningWork')}
                  onClick={() => openWorkFromDiagnostic(usageItem.workId)}
                  data-testid="component-runtime-usage-open-work"
                >
                  <ArrowRight size={13} aria-hidden />
                </IconButton>
              </div>
            ))}
          </div>
        ) : null}
      </section>
        </TabPane>
      </Tabs>
    </section>
  );
}

function RuntimeEvidenceRow({
  evidence,
  badge,
  badgeVariant = 'warning',
  title,
  message,
  t,
  onOpenWork,
}: {
  evidence: ComponentRuntimeFailure | ComponentRuntimeLogEntry;
  badge: string;
  badgeVariant?: 'warning' | 'neutral';
  title: string;
  message: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onOpenWork: (workId: string) => void;
}) {
  return (
    <div
      className="component-center__runtime-evidence"
      data-testid="component-runtime-evidence"
      data-work-id={evidence.workId}
      data-runtime-instance-id={evidence.runtimeInstanceId ?? ''}
    >
      <Badge variant={badgeVariant}>{badge}</Badge>
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      <IconButton
        className="component-center__diagnostic-action-button"
        size="xs"
        variant="ghost"
        aria-label={t('productSystem.components.openOwningWork')}
        tooltip={t('productSystem.components.openOwningWork')}
        onClick={() => onOpenWork(evidence.workId)}
        data-testid="component-runtime-evidence-open-work"
      >
        <ArrowRight size={13} aria-hidden />
      </IconButton>
    </div>
  );
}

export default ComponentCenter;
