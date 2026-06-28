import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from '@/design-system';
import {
  appCatalogAPI,
  type AppSurfaceMode,
  type ComponentKind,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('StudioPlaceholder');

const COMPONENT_FILTERS: Array<'all' | ComponentKind> = ['all', 'surface', 'agent', 'bridge', 'runtime', 'tool', 'skill'];

interface StudioPlaceholderProps {
  kind: 'create-app' | 'create-component';
  onBack: () => void;
  onAppCreated: (appId: string) => Promise<void>;
  onComponentCreated: (componentId: string) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const StudioPlaceholder: React.FC<StudioPlaceholderProps> = ({
  kind,
  onBack,
  onAppCreated,
  onComponentCreated,
  t,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [appDraft, setAppDraft] = useState({
    appId: '',
    name: '',
    description: '',
    goal: '',
    version: '1.0.0',
    agentType: 'agentic',
    category: '',
    tags: '',
    primarySurfaceMode: 'chatPrimary' as AppSurfaceMode,
  });
  const [componentDraft, setComponentDraft] = useState({
    componentId: '',
    kind: 'surface' as ComponentKind,
    name: '',
    description: '',
    version: '1.0.0',
    implementationRef: '',
  });

  const isCreateApp = kind === 'create-app';

  const surfaceModeOptions = useMemo<SelectOption[]>(() => ([
    'chatPrimary', 'sidecarLinked', 'immersivePrimary', 'embeddedObject',
  ] as AppSurfaceMode[]).map((value) => ({
    value,
    label: t(`productSystem.surfaceMode.${value}`),
  })), [t]);

  const componentKindOptions = useMemo<SelectOption[]>(() => COMPONENT_FILTERS
    .filter((value): value is ComponentKind => value !== 'all')
    .map((value) => ({ value, label: t(`productSystem.componentKinds.${value}`) })),
  [t]);

  const updateAppDraft = useCallback((field: keyof typeof appDraft, value: string) => {
    setAppDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const updateComponentDraft = useCallback((field: keyof typeof componentDraft, value: string) => {
    setComponentDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const handleCreateApp = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!appDraft.appId.trim() || !appDraft.name.trim() || !appDraft.goal.trim()) {
      notificationService.error(t('productSystem.studio.requiredFields'));
      return;
    }
    setSubmitting(true);
    try {
      const written = await appCatalogAPI.createProductAppPackage({
        appId: appDraft.appId.trim(),
        name: appDraft.name.trim(),
        description: appDraft.description.trim(),
        goal: appDraft.goal.trim(),
        version: appDraft.version.trim() || '1.0.0',
        agentType: appDraft.agentType.trim() || 'agentic',
        category: appDraft.category.trim(),
        tags: appDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        primarySurfaceMode: appDraft.primarySurfaceMode,
      });
      notificationService.success(t('productSystem.studio.createAppSuccess', { name: appDraft.name.trim() }));
      await onAppCreated(written.appId);
    } catch (error) {
      log.error('Create Product App package failed', { error });
      notificationService.error(error instanceof Error ? error.message : t('productSystem.studio.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [appDraft, onAppCreated, t]);

  const handleCreateComponent = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!componentDraft.componentId.trim() || !componentDraft.name.trim() || !componentDraft.description.trim()) {
      notificationService.error(t('productSystem.studio.requiredFields'));
      return;
    }
    setSubmitting(true);
    try {
      const written = await appCatalogAPI.createComponentPackage({
        componentId: componentDraft.componentId.trim(),
        kind: componentDraft.kind,
        name: componentDraft.name.trim(),
        description: componentDraft.description.trim(),
        version: componentDraft.version.trim() || '1.0.0',
        implementationRef: componentDraft.implementationRef.trim() || null,
      });
      notificationService.success(t('productSystem.studio.createComponentSuccess', { name: componentDraft.name.trim() }));
      await onComponentCreated(written.componentId);
    } catch (error) {
      log.error('Create Component package failed', { error });
      notificationService.error(error instanceof Error ? error.message : t('productSystem.studio.createFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [componentDraft, onComponentCreated, t]);

  return (
    <main className="create-form-scene">
      <div className="create-form-scene__content">
        {/* Back */}
        <button type="button" className="create-form-scene__back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden />
          <span>{t('productSystem.actions.back')}</span>
        </button>

        {/* Header */}
        <header className="create-form-scene__header">
          <h1 className="create-form-scene__title">
            {t(isCreateApp ? 'productSystem.studio.createAppTitle' : 'productSystem.studio.createComponentTitle')}
          </h1>
          <p className="create-form-scene__subtitle">
            {t(isCreateApp ? 'productSystem.studio.createAppSubtitle' : 'productSystem.studio.createComponentSubtitle')}
          </p>
        </header>

        {/* Form */}
        {isCreateApp ? (
          <form className="create-form-scene__form" onSubmit={handleCreateApp}>
            {/* Required fields */}
            <fieldset className="create-form-scene__fieldset">
              <legend className="create-form-scene__legend">
                {t('productSystem.studio.sections.required')}
              </legend>
              <div className="create-form-scene__fields">
                <Input
                  label={`${t('productSystem.studio.fields.appId')} *`}
                  value={appDraft.appId}
                  onChange={(event) => updateAppDraft('appId', event.target.value)}
                  placeholder={t('productSystem.studio.placeholders.appId')}
                  required
                />
                <Input
                  label={`${t('productSystem.studio.fields.name')} *`}
                  value={appDraft.name}
                  onChange={(event) => updateAppDraft('name', event.target.value)}
                  required
                />
                <Textarea
                  label={`${t('productSystem.studio.fields.goal')} *`}
                  value={appDraft.goal}
                  onChange={(event) => updateAppDraft('goal', event.target.value)}
                  rows={3}
                  autoResize
                  required
                />
              </div>
            </fieldset>

            {/* Optional fields */}
            <button
              type="button"
              className="create-form-scene__toggle"
              onClick={() => setShowOptional((v) => !v)}
              aria-expanded={showOptional}
            >
              {showOptional ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span>{t('productSystem.studio.sections.optional')}</span>
            </button>
            {showOptional ? (
              <fieldset className="create-form-scene__fieldset">
                <div className="create-form-scene__fields">
                  <Input
                    label={t('productSystem.studio.fields.version')}
                    value={appDraft.version}
                    onChange={(event) => updateAppDraft('version', event.target.value)}
                  />
                  <Input
                    label={t('productSystem.studio.fields.agentType')}
                    value={appDraft.agentType}
                    onChange={(event) => updateAppDraft('agentType', event.target.value)}
                  />
                  <Textarea
                    label={t('productSystem.studio.fields.description')}
                    value={appDraft.description}
                    onChange={(event) => updateAppDraft('description', event.target.value)}
                    rows={2}
                    autoResize
                  />
                  <Select
                    label={t('productSystem.studio.fields.surfaceMode')}
                    options={surfaceModeOptions}
                    value={appDraft.primarySurfaceMode}
                    onChange={(value) => updateAppDraft('primarySurfaceMode', String(value))}
                  />
                  <Input
                    label={t('productSystem.studio.fields.category')}
                    value={appDraft.category}
                    onChange={(event) => updateAppDraft('category', event.target.value)}
                  />
                  <Input
                    label={t('productSystem.studio.fields.tags')}
                    value={appDraft.tags}
                    onChange={(event) => updateAppDraft('tags', event.target.value)}
                    placeholder={t('productSystem.studio.placeholders.tags')}
                  />
                </div>
              </fieldset>
            ) : null}

            <div className="create-form-scene__actions">
              <Button type="submit" variant="primary" isLoading={submitting}>
                <Plus size={14} aria-hidden />
                <span>{t('productSystem.actions.createApp')}</span>
              </Button>
            </div>
          </form>
        ) : (
          <form className="create-form-scene__form" onSubmit={handleCreateComponent}>
            {/* Required fields */}
            <fieldset className="create-form-scene__fieldset">
              <legend className="create-form-scene__legend">
                {t('productSystem.studio.sections.required')}
              </legend>
              <div className="create-form-scene__fields">
                <Input
                  label={`${t('productSystem.studio.fields.componentId')} *`}
                  value={componentDraft.componentId}
                  onChange={(event) => updateComponentDraft('componentId', event.target.value)}
                  placeholder={t('productSystem.studio.placeholders.componentId')}
                  required
                />
                <Input
                  label={`${t('productSystem.studio.fields.name')} *`}
                  value={componentDraft.name}
                  onChange={(event) => updateComponentDraft('name', event.target.value)}
                  required
                />
                <Select
                  label={`${t('productSystem.studio.fields.componentKind')} *`}
                  options={componentKindOptions}
                  value={componentDraft.kind}
                  onChange={(value) => updateComponentDraft('kind', String(value))}
                />
                <Textarea
                  label={`${t('productSystem.studio.fields.description')} *`}
                  value={componentDraft.description}
                  onChange={(event) => updateComponentDraft('description', event.target.value)}
                  rows={3}
                  autoResize
                  required
                />
              </div>
            </fieldset>

            {/* Optional fields */}
            <button
              type="button"
              className="create-form-scene__toggle"
              onClick={() => setShowOptional((v) => !v)}
              aria-expanded={showOptional}
            >
              {showOptional ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span>{t('productSystem.studio.sections.optional')}</span>
            </button>
            {showOptional ? (
              <fieldset className="create-form-scene__fieldset">
                <div className="create-form-scene__fields">
                  <Input
                    label={t('productSystem.studio.fields.version')}
                    value={componentDraft.version}
                    onChange={(event) => updateComponentDraft('version', event.target.value)}
                  />
                  <Input
                    label={t('productSystem.studio.fields.implementationRef')}
                    value={componentDraft.implementationRef}
                    onChange={(event) => updateComponentDraft('implementationRef', event.target.value)}
                    placeholder={t('productSystem.studio.placeholders.implementationRef')}
                  />
                </div>
              </fieldset>
            ) : null}

            <div className="create-form-scene__actions">
              <Button type="submit" variant="primary" isLoading={submitting}>
                <Plus size={14} aria-hidden />
                <span>{t('productSystem.actions.createComponent')}</span>
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
};

export default StudioPlaceholder;
