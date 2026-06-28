import React, { useMemo } from 'react';
import {
  ArrowLeft,
  Play,
  Square,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  EmptyState,
  StatusDot,
  Tag,
} from '@/design-system';
import type {
  AppComponentRef,
  ComponentDefinition,
  ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { productAppSupportsMultipleWorks } from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { productAppWorkRef, sameProductAppRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { appIconFor } from '../iconUtils';
import './AppDetailScene.scss';

type ProductAppComponent = {
  ref: AppComponentRef;
  component: ComponentDefinition | null;
};

interface AppDetailSceneProps {
  app: ProductAppCatalogEntry;
  components: ProductAppComponent[];
  works: WorkRecord[];
  onBack: () => void;
  onLaunch: () => void;
  onStop: () => void;
  running: boolean;
  stopping: boolean;
  onOpenWork: (work: WorkRecord) => void;
  onOpenComponent: (componentId: string) => void;
}

function workReferencesApp(work: WorkRecord, app: ProductAppCatalogEntry): boolean {
  const appRef = productAppWorkRef(app);
  return (work.subject.kind === 'app' && sameProductAppRef(work.subject.app, appRef))
    || work.appRefs.some((relation) => sameProductAppRef(relation.app, appRef));
}

function permissionEntries(app: ProductAppCatalogEntry): Array<{ key: keyof ProductAppCatalogEntry['permissions']; enabled: boolean }> {
  return (['fs', 'net', 'shell', 'gui', 'secrets', 'ai'] as const).map((key) => ({
    key,
    enabled: Boolean(app.permissions?.[key]),
  }));
}

export const AppDetailScene: React.FC<AppDetailSceneProps> = ({
  app,
  components,
  works,
  onBack,
  onLaunch,
  onStop,
  running,
  stopping,
  onOpenWork,
  onOpenComponent,
}) => {
  const { t } = useTranslation('scenes/apps');
  const supportsMultipleWorks = productAppSupportsMultipleWorks(app);
  const appWorks = useMemo(() => {
    if (!supportsMultipleWorks) return [];
    return works
      .filter((work) => workReferencesApp(work, app))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [app, supportsMultipleWorks, works]);
  const useStopAction = !supportsMultipleWorks && running;
  const Icon = appIconFor(app);
  const permissionList = permissionEntries(app);
  const componentPermissions = components.flatMap(({ component }) => component?.permissions ?? []);

  return (
    <main className="app-detail-scene">
      <div className="app-detail-scene__content">
        {/* Back navigation */}
        <button type="button" className="app-detail-scene__back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden />
          <span>{t('productSystem.actions.back')}</span>
        </button>

        {/* Hero section */}
        <section className="app-detail-scene__hero">
          <span className="app-detail-scene__hero-icon" aria-hidden>
            <Icon size={22} strokeWidth={1.8} />
          </span>
          <div className="app-detail-scene__hero-info">
            <div className="app-detail-scene__hero-name-row">
              <h1 className="app-detail-scene__hero-name">{app.name}</h1>
              <StatusDot
                tone={app.enabled ? running ? 'success' : 'neutral' : 'warning'}
                size="medium"
                pulse={running && app.enabled}
              />
            </div>
            <p className="app-detail-scene__hero-description">{app.description}</p>
            <div className="app-detail-scene__hero-meta">
              <span className="app-detail-scene__hero-version">{app.version}</span>
              <Badge variant={app.interactionModel === 'conversation' ? 'info' : 'accent'}>
                {t(`productSystem.interaction.${app.interactionModel}`)}
              </Badge>
              <Tag size="small" color="gray">{t(`productSystem.installScope.${app.installScope}`)}</Tag>
              {app.category ? <Tag size="small" color="gray">{app.category}</Tag> : null}
            </div>
          </div>
          <div className="app-detail-scene__hero-actions">
            <Button
              variant="primary"
              size="small"
              onClick={useStopAction ? onStop : onLaunch}
              disabled={useStopAction ? stopping : false}
              aria-busy={(useStopAction && stopping) || undefined}
            >
              {useStopAction ? <Square size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              <span>{useStopAction ? t('productSystem.actions.stop') : t('productSystem.actions.launch')}</span>
            </Button>
          </div>
        </section>

        {/* Goal */}
        {app.goal ? (
          <section className="app-detail-scene__section">
            <h2 className="app-detail-scene__section-title">{t('productSystem.detail.overview.goal')}</h2>
            <p className="app-detail-scene__goal-text">{app.goal}</p>
            {(app.tags ?? []).length ? (
              <div className="app-detail-scene__tags">
                {(app.tags ?? []).map((tag) => <Tag key={tag} size="small" color="gray">{tag}</Tag>)}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Metrics */}
        <section className="app-detail-scene__section">
          <h2 className="app-detail-scene__section-title">{t('productSystem.detail.sections.overview')}</h2>
          <div className="app-detail-scene__metrics">
            <div className="app-detail-scene__metric">
              <strong>{components.length}</strong>
              <span>{t('productSystem.detail.metrics.components')}</span>
            </div>
            <div className="app-detail-scene__metric">
              <strong>{(app.workObjectKinds ?? []).length}</strong>
              <span>{t('productSystem.detail.metrics.workObjects')}</span>
            </div>
            {supportsMultipleWorks ? (
              <div className="app-detail-scene__metric">
                <strong>{appWorks.length}</strong>
                <span>{t('productSystem.detail.metrics.activeWorks')}</span>
              </div>
            ) : null}
            <div className="app-detail-scene__metric">
              <strong>{permissionList.filter((item) => item.enabled).length}</strong>
              <span>{t('productSystem.detail.metrics.permissions')}</span>
            </div>
          </div>
        </section>

        {/* Continue work */}
        {supportsMultipleWorks ? (
          <section className="app-detail-scene__section">
            <h2 className="app-detail-scene__section-title">{t('productSystem.detail.start.continueTitle')}</h2>
            {appWorks.length ? (
              <div className="app-detail-scene__work-list">
                {appWorks.slice(0, 6).map((work) => (
                  <button
                    key={work.id}
                    type="button"
                    className="app-detail-scene__work-row"
                    onClick={() => onOpenWork(work)}
                  >
                    <StatusDot
                      tone={work.status === 'running' ? 'success' : work.status === 'waiting_user' ? 'warning' : 'neutral'}
                      size="small"
                      pulse={work.status === 'running'}
                    />
                    <span className="app-detail-scene__work-info">
                      <strong>{work.title}</strong>
                      <small>{work.objective}</small>
                    </span>
                    <Badge variant="neutral" className="app-detail-scene__work-status">
                      {t(`productSystem.status.${work.status}`, { defaultValue: work.status })}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                imageSize="small"
                title={t('productSystem.detail.start.noWorkTitle')}
                description={t('productSystem.detail.start.noWorkDescription')}
              />
            )}
          </section>
        ) : null}

        {/* Components */}
        <section className="app-detail-scene__section">
          <h2 className="app-detail-scene__section-title">{t('productSystem.detail.sections.components')}</h2>
          {components.length ? (
            <div className="app-detail-scene__component-list">
              {components.map(({ ref, component }) => (
                <button
                  key={`${ref.kind}:${ref.componentId}:${ref.role}`}
                  type="button"
                  className="app-detail-scene__component-row"
                  onClick={() => onOpenComponent(ref.componentId)}
                  disabled={!component}
                >
                  <div className="app-detail-scene__component-info">
                    <strong>{component?.name ?? ref.componentId}</strong>
                    <div className="app-detail-scene__component-meta">
                      <Badge variant="neutral">{t(`productSystem.componentKinds.${ref.kind}`)}</Badge>
                      <Tag size="small" color="gray">{ref.role}</Tag>
                      <Badge variant={ref.source === 'shared' ? 'info' : 'accent'}>
                        {t(`productSystem.componentRefSource.${ref.source}`)}
                      </Badge>
                    </div>
                  </div>
                  <span className="app-detail-scene__component-arrow" aria-hidden>→</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="app-detail-scene__muted">{t('productSystem.detail.components.unresolved')}</p>
          )}
        </section>

        {/* Permissions */}
        <section className="app-detail-scene__section">
          <h2 className="app-detail-scene__section-title">{t('productSystem.detail.sections.permissions')}</h2>
          <div className="app-detail-scene__permission-grid">
            {permissionList.map((permission) => (
              <div
                key={permission.key}
                className={`app-detail-scene__permission-chip${permission.enabled ? ' is-enabled' : ''}`}
              >
                <StatusDot
                  tone={permission.enabled ? 'success' : 'neutral'}
                  size="small"
                />
                <span>{t(`productSystem.permission.${permission.key}`)}</span>
              </div>
            ))}
          </div>
          {componentPermissions.length ? (
            <div className="app-detail-scene__permission-extra">
              <h3>{t('productSystem.detail.permissions.componentTitle')}</h3>
              {componentPermissions.map((perm, index) => (
                <div key={`${perm.kind}:${index}`} className="app-detail-scene__perm-detail">
                  <strong>{perm.kind}</strong>
                  <span>{perm.summary}</span>
                  <small>{(perm.scopes ?? []).join(', ')}</small>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {/* Runtime */}
        <section className="app-detail-scene__section">
          <h2 className="app-detail-scene__section-title">{t('productSystem.detail.sections.runtime')}</h2>
          <dl className="app-detail-scene__facts">
            <div>
              <dt>{t('productSystem.fields.appId')}</dt>
              <dd>{app.id}</dd>
            </div>
            <div>
              <dt>{t('productSystem.fields.lock')}</dt>
              <dd className="app-detail-scene__mono">{app.componentLockDigest}</dd>
            </div>
            <div>
              <dt>{t('productSystem.fields.surfaceMode')}</dt>
              <dd>{t(`productSystem.surfaceMode.${app.primarySurfaceMode}`)}</dd>
            </div>
            <div>
              <dt>{t('productSystem.fields.truthSource')}</dt>
              <dd>{app.truthSource ? t(`productSystem.truthSource.${app.truthSource}`) : '-'}</dd>
            </div>
          </dl>
        </section>

        {/* Package */}
        <section className="app-detail-scene__section">
          <h2 className="app-detail-scene__section-title">{t('productSystem.detail.sections.package')}</h2>
          <dl className="app-detail-scene__facts">
            <div>
              <dt>{t('productSystem.fields.installScope')}</dt>
              <dd>{t(`productSystem.installScope.${app.installScope}`)}</dd>
            </div>
            <div>
              <dt>{t('productSystem.fields.visibility')}</dt>
              <dd>{t(`productSystem.catalogVisibility.${app.catalogVisibility}`)}</dd>
            </div>
            <div>
              <dt>{t('productSystem.fields.componentLockId')}</dt>
              <dd className="app-detail-scene__mono">{app.componentLockId}</dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
};

export default AppDetailScene;
