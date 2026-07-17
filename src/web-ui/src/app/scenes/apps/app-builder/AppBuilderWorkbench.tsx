import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Rocket,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DotMatrixLoader,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
} from '@/design-system';
import {
  intelligentAppAPI,
  type AppDraftPreview,
  type AppReleaseCapabilityReview,
  type AppReleaseRecord,
  type IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { notificationService } from '@/shared/notification-system';
import { normalizeAppScope, systemAppScope, type AppScope } from '@/shared/types/app-scope';
import ProductAppRuntimeIframeHost from '../product-app-runtime/ProductAppRuntimeIframeHost';
import { CapabilityReviewDialog } from '../components/CapabilityReviewDialog';
import { openAppBuilderSession } from './openAppBuilderSession';
import './AppBuilderWorkbench.scss';

interface AppBuilderWorkbenchProps {
  sessionId: string | null;
  appId?: string;
  draftId?: string;
  slotId?: string;
  baseReleaseId?: string | null;
  scope?: AppScope | null;
}

type WorkbenchTabId =
  | 'blueprint'
  | 'preview'
  | 'issues'
  | 'components'
  | 'agent'
  | 'data'
  | 'eval'
  | 'validation'
  | 'versions'
  | 'permissions'
  | 'share';

const TABS: WorkbenchTabId[] = [
  'blueprint',
  'preview',
  'issues',
  'components',
  'agent',
  'data',
  'eval',
  'validation',
  'versions',
  'permissions',
  'share',
];

function compactId(value?: string | null): string {
  if (!value) return '-';
  return value.length > 32 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
}

function nextPatchVersion(current?: string | null): string {
  const match = current?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return '1.0.0';
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export const AppBuilderWorkbench: React.FC<AppBuilderWorkbenchProps> = ({
  sessionId,
  appId,
  draftId,
  slotId,
  baseReleaseId,
  scope,
}) => {
  const { t } = useTranslation('scenes/app-builder');
  const effectiveScope = useMemo(() => normalizeAppScope(scope ?? systemAppScope()), [scope]);
  const [activeTab, setActiveTab] = useState<WorkbenchTabId>('preview');
  const [preview, setPreview] = useState<AppDraftPreview | null>(null);
  const previewRef = useRef<AppDraftPreview | null>(null);
  const [app, setApp] = useState<IntelligentAppRecord | null>(null);
  const [publishedRelease, setPublishedRelease] = useState<AppReleaseRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [version, setVersion] = useState('1.0.0');
  const [publishing, setPublishing] = useState(false);
  const [review, setReview] = useState<AppReleaseCapabilityReview | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    intelligentAppAPI.listCatalog().then((catalog) => {
      if (cancelled) return;
      const variant = catalog.slots
        .flatMap((candidate) => candidate.variants)
        .find(({ app: candidate }) => candidate.appId === appId);
      setApp(variant?.app ?? null);
      setVersion(nextPatchVersion(variant?.latestRelease?.version));
    }).catch(() => setApp(null));
    return () => { cancelled = true; };
  }, [appId]);

  const closePreview = useCallback(async (current: AppDraftPreview | null) => {
    if (!current) return;
    await intelligentAppAPI.closeDraftPreview(current.previewSessionId).catch(() => undefined);
  }, []);

  const refreshPreview = useCallback(async () => {
    if (!draftId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    const previous = previewRef.current;
    try {
      const next = await intelligentAppAPI.resolveDraftPreview({ draftId });
      setPreview(next);
      previewRef.current = next;
      if (previous?.previewSessionId !== next.previewSessionId) {
        await closePreview(previous);
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  }, [closePreview, draftId]);

  useEffect(() => {
    void refreshPreview();
    return () => {
      void closePreview(previewRef.current);
      previewRef.current = null;
    };
    // The preview session is replaced explicitly by refreshPreview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePreview, draftId, refreshPreview]);

  const requestValidation = useCallback(async () => {
    if (!sessionId || !draftId) return;
    const instruction = `Validate Draft ${draftId} against every Release gate. Fix failures in the Draft only; do not mutate any Release or Activation.`;
    await flowChatManager.sendMessage(
      instruction,
      sessionId,
      t('draftWorkbench.actions.validate'),
      'AppBuilder',
      'AppBuilder',
    );
    notificationService.success(t('draftWorkbench.messages.validationStarted'));
    setActiveTab('validation');
  }, [draftId, sessionId, t]);

  const publish = useCallback(async () => {
    if (!draftId || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version.trim())) {
      notificationService.error(t('draftWorkbench.publish.invalidVersion'));
      return;
    }
    setPublishing(true);
    try {
      const result = await intelligentAppAPI.publishDraft({
        draftId,
        version: version.trim(),
      });
      setApp(result.app);
      setPublishedRelease(result.release);
      setPublishOpen(false);
      setActiveTab('versions');
      notificationService.success(t('draftWorkbench.messages.releaseCreated', { version: result.release.version }));
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPublishing(false);
    }
  }, [draftId, t, version]);

  const beginActivation = useCallback(async () => {
    if (!publishedRelease || !app) return;
    const next = await intelligentAppAPI.getReleaseCapabilityReview(
      app.appId,
      publishedRelease.releaseId,
    );
    if (next.requiresApproval && !next.approved) {
      setReview(next);
      return;
    }
    await intelligentAppAPI.activateRelease({
      slotId: app.slotId,
      appId: app.appId,
      releaseId: publishedRelease.releaseId,
    });
    notificationService.success(t('draftWorkbench.messages.activated'));
  }, [app, publishedRelease, t]);

  const approveAndActivate = useCallback(async () => {
    if (!review || !publishedRelease || !app) return;
    setActivating(true);
    try {
      await intelligentAppAPI.approveCapabilities({
        appId: app.appId,
        releaseId: publishedRelease.releaseId,
      });
      await intelligentAppAPI.activateRelease({
        slotId: app.slotId,
        appId: app.appId,
        releaseId: publishedRelease.releaseId,
      });
      setReview(null);
      notificationService.success(t('draftWorkbench.messages.activated'));
    } finally {
      setActivating(false);
    }
  }, [app, publishedRelease, review, t]);

  const continueEditing = useCallback(async () => {
    if (!publishedRelease || !app) return;
    const draft = await intelligentAppAPI.createDraft(app.appId, publishedRelease.releaseId);
    await openAppBuilderSession({ app, draft, scope: effectiveScope });
  }, [app, effectiveScope, publishedRelease]);

  if (!draftId) {
    return (
      <div className="app-builder-panel is-dock-collapsed">
        <EmptyState
          title={t('draftWorkbench.empty.title')}
          description={t('draftWorkbench.empty.description')}
        />
      </div>
    );
  }

  const renderFacts = () => {
    if (activeTab === 'versions') {
      return (
        <div className="builder-workbench-facts">
          <section className="builder-fact-section">
            <div className="builder-fact-section__header">
              <h3>{publishedRelease
                ? t('draftWorkbench.release.ready', { version: publishedRelease.version })
                : t('draftWorkbench.release.emptyTitle')}</h3>
              <p>{publishedRelease
                ? t('draftWorkbench.release.description')
                : t('draftWorkbench.release.emptyDescription')}</p>
            </div>
            <div className="builder-fact-grid">
              <div className="builder-fact-row">
                <span className="builder-fact-row__label">Draft ID</span>
                <code>{compactId(draftId)}</code>
              </div>
              <div className="builder-fact-row">
                <span className="builder-fact-row__label">{t('draftWorkbench.release.releaseId')}</span>
                <code>{compactId(publishedRelease?.releaseId)}</code>
              </div>
              <div className="builder-fact-row">
                <span className="builder-fact-row__label">{t('draftWorkbench.release.artifact')}</span>
                <code>{compactId(publishedRelease?.artifactDigest)}</code>
              </div>
            </div>
          </section>
          {publishedRelease ? (
            <div className="builder-workbench-facts__actions">
              <Button variant="secondary" size="small" onClick={() => void continueEditing()}>
                {t('draftWorkbench.actions.continueEditing')}
              </Button>
              <Button variant="primary" size="small" onClick={() => void beginActivation()}>
                <Rocket size={14} aria-hidden />
                {t('draftWorkbench.actions.activate')}
              </Button>
            </div>
          ) : null}
        </div>
      );
    }

    if (activeTab === 'validation' || activeTab === 'issues' || activeTab === 'eval') {
      return (
        <div className="builder-workbench-facts">
          <section className="builder-fact-section">
            <div className="builder-fact-section__header">
              <h3>{t('draftWorkbench.quality.validation')}</h3>
              <p>{t('draftWorkbench.quality.validationDescription')}</p>
            </div>
            <div className="builder-fact-section__empty">
              {t('draftWorkbench.quality.notRun')}
            </div>
          </section>
          <div className="builder-workbench-facts__actions">
            <Button variant="primary" size="small" onClick={() => void requestValidation()}>
              <CheckCircle2 size={14} aria-hidden />
              {t('draftWorkbench.actions.validate')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="builder-workbench-facts">
        <section className="builder-fact-section">
          <div className="builder-fact-section__header">
            <h3>{t(`workbench.tabs.${activeTab}`)}</h3>
            <p>{baseReleaseId
              ? t('draftWorkbench.derivedFrom', { releaseId: compactId(baseReleaseId) })
              : t('draftWorkbench.newDraft')}</p>
          </div>
          <div className="builder-fact-grid">
            <div className="builder-fact-row">
              <span className="builder-fact-row__label">App ID</span>
              <code>{appId ?? '-'}</code>
            </div>
            <div className="builder-fact-row">
              <span className="builder-fact-row__label">Slot ID</span>
              <code>{slotId ?? app?.slotId ?? '-'}</code>
            </div>
            <div className="builder-fact-row">
              <span className="builder-fact-row__label">Draft ID</span>
              <code>{draftId}</code>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className={`app-builder-panel ${dockCollapsed ? 'is-dock-collapsed' : ''}`}>
      <div className="builder-statusbar">
        <div className="builder-statusbar__identity">
          <span className={`builder-statusbar__dot ${previewError ? 'is-error' : preview ? 'is-running' : 'is-idle'}`} />
          <span className="builder-statusbar__name">{app?.displayName ?? t('draftWorkbench.title')}</span>
          <Badge variant="accent">{t('draftWorkbench.draftBadge')}</Badge>
          <span className="builder-statusbar__runtime-label">{compactId(draftId)}</span>
        </div>
        <div className="builder-statusbar__ctas">
          <Button variant="secondary" size="small" onClick={() => void requestValidation()}>
            {t('draftWorkbench.actions.validate')}
          </Button>
          <Button variant="primary" size="small" onClick={() => setPublishOpen(true)}>
            {t('draftWorkbench.actions.createRelease')}
          </Button>
        </div>
        <span className="builder-statusbar__sep" />
        <div className="builder-statusbar__actions">
          <IconButton
            size="small"
            variant="ghost"
            aria-label={t('draftWorkbench.actions.refreshPreview')}
            tooltip={t('draftWorkbench.actions.refreshPreview')}
            onClick={() => void refreshPreview()}
          >
            <RefreshCw size={14} aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="builder-workbench-tabs">
        <SegmentedControl
          className="builder-workbench-tabs__control"
          value={activeTab}
          onChange={(value) => setActiveTab(value as WorkbenchTabId)}
          aria-label={t('workbench.tabsLabel')}
          options={TABS.map((tab) => ({ value: tab, label: t(`workbench.tabs.${tab}`) }))}
          size="small"
        />
      </div>

      {activeTab === 'preview' ? (
        <div className="builder-preview">
          {previewLoading ? (
            <div className="builder-preview__empty">
              <DotMatrixLoader size="small" />
              <div>{t('draftWorkbench.preview.loading')}</div>
            </div>
          ) : previewError ? (
            <div className="builder-preview__empty is-error">
              <AlertTriangle size={28} aria-hidden />
              <div>{t('draftWorkbench.preview.failed')}</div>
              <p>{previewError}</p>
              <Button variant="secondary" size="small" onClick={() => void refreshPreview()}>
                {t('draftWorkbench.actions.retry')}
              </Button>
            </div>
          ) : preview ? (
            <ProductAppRuntimeIframeHost
              app={preview.hostSurface}
              runtimeContext={preview.runtimeContext}
              scope={effectiveScope}
            />
          ) : (
            <div className="builder-preview__empty">
              <div>{t('draftWorkbench.preview.starting')}</div>
              <p>{t('draftWorkbench.preview.isolated')}</p>
            </div>
          )}
        </div>
      ) : renderFacts()}

      <div className="builder-dock">
        <Button
          className="builder-dock__header"
          variant="ghost"
          size="small"
          onClick={() => setDockCollapsed((current) => !current)}
        >
          {dockCollapsed ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          {t('diagnostics.title')}
          <Badge variant={previewError ? 'warning' : 'success'}>
            {previewError ? t('workbench.values.needsAttention') : t('diagnostics.ok')}
          </Badge>
        </Button>
        {!dockCollapsed ? (
          <div className="builder-fact-section__empty">
            {previewError ?? t('draftWorkbench.preview.isolated')}
          </div>
        ) : null}
      </div>

      <Dialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={t('draftWorkbench.publish.title')}
        size="small"
      >
        <DialogBody>
          <p>{t('draftWorkbench.publish.description')}</p>
          <Input label="Version" value={version} onChange={(event) => setVersion(event.target.value)} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setPublishOpen(false)} disabled={publishing}>
            {t('draftWorkbench.actions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void publish()} disabled={publishing}>
            {publishing ? <DotMatrixLoader size="tiny" /> : <Rocket size={14} aria-hidden />}
            {t('draftWorkbench.actions.createRelease')}
          </Button>
        </DialogFooter>
      </Dialog>

      <CapabilityReviewDialog
        open={Boolean(review)}
        title={t('draftWorkbench.capabilities.title')}
        description={t('draftWorkbench.capabilities.description')}
        scopeNote={t('draftWorkbench.capabilities.scopeNote')}
        capabilities={review?.capabilities ?? []}
        approveText={t('draftWorkbench.capabilities.approveAndActivate')}
        cancelText={t('draftWorkbench.actions.cancel')}
        closeText={t('draftWorkbench.actions.close')}
        translationPrefix="draftWorkbench.capabilities"
        t={t}
        approving={activating}
        onClose={() => setReview(null)}
        onApprove={() => void approveAndActivate()}
      />
    </div>
  );
};

export default AppBuilderWorkbench;
