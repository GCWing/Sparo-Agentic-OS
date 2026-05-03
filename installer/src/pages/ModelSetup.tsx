import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  createModelConfigFromTemplate,
  getOrderedProviders,
  PROVIDER_TEMPLATES,
  resolveProviderFormat,
  type ApiFormat,
  type ProviderTemplate,
} from '../data/modelProviders';
import type { RequestFormatValue } from '../data/modelRequestFormats';
import type { ConnectionTestResult, InstallOptions, ModelConfig, RemoteModelInfo } from '../types/installer';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
const CUSTOM_MODEL_OPTION = '__custom_model__';

interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface ModelSetupProps {
  options: InstallOptions;
  setOptions: React.Dispatch<React.SetStateAction<InstallOptions>>;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => Promise<void>;
  onTestConnection: (modelConfig: ModelConfig) => Promise<ConnectionTestResult>;
}

interface SimpleSelectProps {
  value: string;
  options: SelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Larger list panel (e.g. model list) */
  menuVariant?: 'default' | 'tall';
  /** When value equals this key, show an inline text input instead of the label */
  customOptionValue?: string;
  customInputValue?: string;
  customInputPlaceholder?: string;
  onCustomInputChange?: (v: string) => void;
  /** Extra CSS class added to the portal menu div (e.g. for advanced/small styling) */
  menuClassName?: string;
}

function SimpleSelect({
  value,
  options,
  placeholder,
  onChange,
  onOpenChange,
  disabled = false,
  menuVariant = 'default',
  menuClassName,
  customOptionValue,
  customInputValue = '',
  customInputPlaceholder = '',
  onCustomInputChange,
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const isCustomMode = customOptionValue !== undefined && value === customOptionValue;
  const selected = useMemo(() => options.find((item) => item.value === value) || null, [options, value]);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  // Notify parent after open state is committed (avoids setState-in-updater issues).
  useEffect(() => {
    onOpenChangeRef.current?.(open);
  }, [open]);

  // Compute portal menu position from trigger's bounding rect.
  const updateMenuStyle = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl) return;
    const tri = triggerEl.getBoundingClientRect();
    const gap = 4;
    // tall: scrollable list capped by viewport; default: show all options (no scroll)
    const maxCap = menuVariant === 'tall' ? 630 : 600;
    // Use viewport bottom as boundary (menu z-index 9999 sits above the footer anyway)
    const spaceBelow = window.innerHeight - tri.bottom - gap - 8;
    const maxH = Math.min(maxCap, Math.max(80, spaceBelow));
    setMenuStyle({
      position: 'fixed',
      left: tri.left,
      right: 'auto',
      width: tri.width,
      top: tri.bottom + gap,
      bottom: 'auto',
      maxHeight: maxH,
      zIndex: 9999,
    });
  }, [menuVariant]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuStyle();
    window.addEventListener('resize', updateMenuStyle);
    document.addEventListener('scroll', updateMenuStyle, true);
    return () => {
      window.removeEventListener('resize', updateMenuStyle);
      document.removeEventListener('scroll', updateMenuStyle, true);
    };
  }, [open, updateMenuStyle]);

  // Close on outside click; check both root anchor and the portal menu node.
  const menuNodeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const inRoot = rootRef.current?.contains(target) ?? false;
      const inMenu = menuNodeRef.current?.contains(target) ?? false;
      if (!inRoot && !inMenu) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const rootClass = 'bf-select' + (open ? ' bf-select--open' : '');

  const menu = open
    ? createPortal(
        <div
          ref={menuNodeRef}
          className={`bf-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
          role="listbox"
          style={menuStyle}
          onWheel={(e) => {
            const m = e.currentTarget;
            if (m.scrollHeight <= m.clientHeight + 2) return;
            const { scrollTop, scrollHeight, clientHeight } = m;
            const atTop = scrollTop <= 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
            if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) e.preventDefault();
          }}
        >
          {options.length > 0
            ? options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`bf-select-option ${option.value === value ? 'bf-select-option--active' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="bf-select-option-label">{option.label}</span>
                  {option.description && <span className="bf-select-option-desc">{option.description}</span>}
                </button>
              ))
            : <div className="bf-select-empty">—</div>}
        </div>,
        document.body,
      )
    : null;

  // Auto-focus the inline input when entering custom mode.
  useEffect(() => {
    if (isCustomMode) customInputRef.current?.focus();
  }, [isCustomMode]);

  return (
    <div className={rootClass} ref={rootRef}>
      {isCustomMode ? (
        /* Custom-input mode: editable field + caret to re-open menu */
        <div
          ref={triggerRef as unknown as React.RefObject<HTMLDivElement>}
          className={`bf-select-trigger bf-select-trigger--custom ${open ? 'bf-select-trigger--open' : ''}`}
        >
          <input
            ref={customInputRef}
            className="bf-select-custom-input"
            value={customInputValue}
            placeholder={customInputPlaceholder}
            onChange={(e) => onCustomInputChange?.(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className={`bf-select-caret bf-select-caret-btn ${open ? 'bf-select-caret--open' : ''}`}
            aria-label="open list"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setOpen((prev) => !prev);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={`bf-select-trigger ${open ? 'bf-select-trigger--open' : ''}`}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
        >
          <span className={`bf-select-value ${selected ? '' : 'bf-select-value--placeholder'}`}>
            {selected?.label || placeholder}
          </span>
          <span className={`bf-select-caret ${open ? 'bf-select-caret--open' : ''}`} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
      )}
      {menu}
    </div>
  );
}

/** API URL: one bordered control — editable field + optional preset list (no separate select + input). */
interface BaseUrlComboProps {
  value: string;
  placeholder: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  onPresetSelect: (url: string) => void;
  menuClassName?: string;
}

function BaseUrlCombo({ value, placeholder, options, onChange, onPresetSelect, menuClassName }: BaseUrlComboProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuNodeRef = useRef<HTMLDivElement | null>(null);

  const updateMenuStyle = useCallback(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const maxH = Math.min(200, Math.max(80, spaceBelow));
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      right: 'auto',
      width: rect.width,
      top: rect.bottom + gap,
      bottom: 'auto',
      maxHeight: maxH,
      zIndex: 9999,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuStyle();
    window.addEventListener('resize', updateMenuStyle);
    document.addEventListener('scroll', updateMenuStyle, true);
    return () => {
      window.removeEventListener('resize', updateMenuStyle);
      document.removeEventListener('scroll', updateMenuStyle, true);
    };
  }, [open, updateMenuStyle]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node;
      if (!rootRef.current?.contains(t) && !menuNodeRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const menu = open ? createPortal(
    <div
      ref={menuNodeRef}
      className={`model-setup-baseurl-combo__menu${menuClassName ? ` ${menuClassName}` : ''}`}
      role="listbox"
      style={menuStyle}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={value.trim() === opt.value.trim()}
          className={'model-setup-baseurl-combo__option' + (value.trim() === opt.value.trim() ? ' model-setup-baseurl-combo__option--active' : '')}
          onClick={() => { onPresetSelect(opt.value); setOpen(false); }}
        >
          <span className="model-setup-baseurl-combo__option-label">{opt.label}</span>
          {opt.description ? <span className="model-setup-baseurl-combo__option-desc">{opt.description}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={rootRef} className="model-setup-baseurl-combo">
      <div className="model-setup-baseurl-combo__row">
        <input
          className="model-setup-baseurl-combo__input"
          type="url"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          ref={triggerBtnRef}
          type="button"
          className="model-setup-baseurl-combo__trigger"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={t('model.presetEndpoints')}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`model-setup-baseurl-combo__caret ${open ? 'model-setup-baseurl-combo__caret--open' : ''}`} aria-hidden>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
      </div>
      {menu}
    </div>
  );
}


export function ModelSetup({ options, setOptions, onSkip, onBack, onNext, onTestConnection }: ModelSetupProps) {
  const { t } = useTranslation();
  const providers = useMemo(() => getOrderedProviders(), []);
  const current = options.modelConfig;

  const [selectedProviderId, setSelectedProviderId] = useState(current?.provider || '');
  const [apiKey, setApiKey] = useState(current?.apiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl || '');
  const [modelName, setModelName] = useState(current?.modelName || '');
  const [apiFormat, setApiFormat] = useState<ApiFormat>((current?.format as ApiFormat) || 'openai');
  const [customFormat, setCustomFormat] = useState<ApiFormat>((current?.format as ApiFormat) || 'openai');
  const [forceCustomModelInput, setForceCustomModelInput] = useState(false);

  const [remoteModels, setRemoteModels] = useState<RemoteModelInfo[]>([]);
  const [isFetchingRemoteModels, setIsFetchingRemoteModels] = useState(false);
  const [remoteModelsError, setRemoteModelsError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isCustomProvider = selectedProviderId === 'custom';
  const template = useMemo<ProviderTemplate | null>(() => {
    if (!selectedProviderId || selectedProviderId === 'custom') return null;
    return PROVIDER_TEMPLATES[selectedProviderId] || null;
  }, [selectedProviderId]);

  const defaultProviderLabel = useMemo(() => {
    if (!template) return t('model.customProvider');
    return t(template.nameKey, { defaultValue: template.id });
  }, [template, t]);

  const effectiveBaseUrl = useMemo(() => {
    if (isCustomProvider) return baseUrl.trim();
    if (baseUrl.trim()) return baseUrl.trim();
    return template?.baseUrl || '';
  }, [isCustomProvider, baseUrl, template]);

  const effectiveModelName = useMemo(() => {
    if (modelName.trim()) return modelName.trim();
    return template?.models[0] || '';
  }, [modelName, template]);

  const resolvedApiFormat = useMemo<ApiFormat>(() => {
    if (isCustomProvider || !template) return customFormat;
    return apiFormat;
  }, [isCustomProvider, template, customFormat, apiFormat]);

  const draftModelConfig = useMemo<ModelConfig | null>(() => {
    if (!selectedProviderId) return null;
    return {
      provider: selectedProviderId,
      apiKey,
      baseUrl: effectiveBaseUrl,
      modelName: effectiveModelName,
      format: resolvedApiFormat,
      configName: defaultProviderLabel,
    };
  }, [selectedProviderId, apiKey, effectiveBaseUrl, effectiveModelName, resolvedApiFormat, defaultProviderLabel]);

  const canContinue = Boolean(
    selectedProviderId && apiKey.trim() && effectiveBaseUrl && effectiveModelName && draftModelConfig,
  );

  const canTestConnection = canContinue && testStatus !== 'testing';

  useEffect(() => {
    setOptions((prev) => ({
      ...prev,
      modelConfig: draftModelConfig,
    }));
  }, [draftModelConfig, setOptions]);

  const resetTestState = useCallback(() => {
    setTestStatus('idle');
    setTestMessage('');
  }, []);

  const resetRemoteDiscovery = useCallback(() => {
    setRemoteModels([]);
    setRemoteModelsError(null);
  }, []);

  const fetchRemoteModels = useCallback(async () => {
    if (!draftModelConfig || !apiKey.trim()) {
      setRemoteModelsError(t('model.fillApiKeyBeforeFetch'));
      return;
    }
    setIsFetchingRemoteModels(true);
    setRemoteModelsError(null);
    try {
      const list = await invoke<RemoteModelInfo[]>('list_model_config_models', {
        modelConfig: draftModelConfig,
      });
      setRemoteModels(list);
      if (list.length === 0) {
        setRemoteModelsError(t('model.fetchEmptyFallback'));
      }
    } catch {
      setRemoteModels([]);
      setRemoteModelsError(t('model.fetchFailedFallback'));
    } finally {
      setIsFetchingRemoteModels(false);
    }
  }, [draftModelConfig, apiKey, t]);

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      resetTestState();
      resetRemoteDiscovery();
      setSelectedProviderId(providerId);
      setForceCustomModelInput(false);
      if (providerId === 'custom') {
        setBaseUrl('');
        setModelName('');
        setCustomFormat('openai');
        setApiFormat('openai');
        return;
      }
      const nextTemplate = PROVIDER_TEMPLATES[providerId];
      if (!nextTemplate) return;
      const next = createModelConfigFromTemplate(nextTemplate, null);
      setBaseUrl(next.baseUrl);
      setModelName(next.modelName);
      setApiFormat(resolveProviderFormat(nextTemplate, next.baseUrl));
      setCustomFormat(next.format);
    },
    [resetTestState, resetRemoteDiscovery],
  );

  const handleBaseUrlOptionSelect = useCallback(
    (url: string) => {
      setBaseUrl(url);
      resetTestState();
      resetRemoteDiscovery();
      if (template?.baseUrlOptions) {
        const opt = template.baseUrlOptions.find((o) => o.url === url.trim());
        if (opt) setApiFormat(opt.format);
      }
    },
    [template, resetTestState, resetRemoteDiscovery],
  );

  const handleBaseUrlChange = useCallback(
    (next: string) => {
      setBaseUrl(next);
      resetTestState();
      resetRemoteDiscovery();
      if (template && !isCustomProvider) {
        setApiFormat(resolveProviderFormat(template, next));
      }
    },
    [template, isCustomProvider, resetTestState, resetRemoteDiscovery],
  );

  const handleTestConnection = useCallback(async () => {
    if (!draftModelConfig || !canTestConnection) return;
    setTestStatus('testing');
    setTestMessage(t('model.testing'));
    try {
      const result = await onTestConnection(draftModelConfig);
      if (result.success) {
        setTestStatus('success');
        setTestMessage(t('model.testSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(result.errorDetails || t('model.testFailed'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestStatus('error');
      setTestMessage(message || t('model.testFailed'));
    }
  }, [draftModelConfig, canTestConnection, onTestConnection, t]);

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    setIsSubmitting(true);
    try {
      await onNext();
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [canContinue, onNext]);

  const providerOptions = useMemo<SelectOption[]>(() => {
    return [
      { value: 'custom', label: t('model.customProvider') },
      ...providers.map((provider) => ({
        value: provider.id,
        label: t(provider.nameKey, { defaultValue: provider.id }),
      })),
    ];
  }, [providers, t]);

  const baseUrlOptions = useMemo<SelectOption[]>(() => {
    if (!template?.baseUrlOptions?.length) return [];
    return template.baseUrlOptions.map((opt) => ({
      value: opt.url,
      label: opt.url,
      description: `${opt.format.toUpperCase()} · ${opt.noteKey ? t(opt.noteKey) : ''}`,
    }));
  }, [template, t]);

  const formatSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'openai', label: t('model.formats.openaiCompatible') },
      { value: 'responses', label: t('model.formats.responsesApi') },
      { value: 'anthropic', label: t('model.formats.claudeApi') },
      { value: 'gemini', label: t('model.formats.geminiApi') },
    ],
    [t],
  );

  const mergedModelIds = useMemo(() => {
    const preset = template?.models ?? [];
    const remoteIds = remoteModels.map((m) => m.id);
    return [...new Set([...preset, ...remoteIds])];
  }, [template, remoteModels]);

  const modelOptions = useMemo<SelectOption[]>(() => {
    if (!template && !isCustomProvider) return [];
    if (isCustomProvider) {
      return [];
    }
    return [
      {
        value: CUSTOM_MODEL_OPTION,
        label: t('model.addCustomModel'),
      },
      ...mergedModelIds.map((id) => {
        const dn = remoteModels.find((m) => m.id === id)?.displayName;
        return {
          value: id,
          label: dn ? `${id} (${dn})` : id,
        };
      }),
    ];
  }, [template, isCustomProvider, mergedModelIds, remoteModels, t]);

  const modelSelectionValue = useMemo(() => {
    if (!template) return '';
    if (forceCustomModelInput) return CUSTOM_MODEL_OPTION;
    const trimmed = modelName.trim();
    if (!trimmed) return mergedModelIds[0] || CUSTOM_MODEL_OPTION;
    if (mergedModelIds.includes(trimmed)) return trimmed;
    return CUSTOM_MODEL_OPTION;
  }, [template, modelName, forceCustomModelInput, mergedModelIds]);

  const modelFetchHint = useMemo(() => {
    if (isFetchingRemoteModels) return t('model.fetchingModels');
    if (remoteModelsError) return remoteModelsError;
    if (remoteModels.length > 0) return null;
    if (template?.models?.length) return t('model.usingPresetModels');
    return null;
  }, [isFetchingRemoteModels, remoteModelsError, remoteModels.length, template, t]);

  // Advanced section is always open for custom provider; otherwise user-toggled
  const advancedOpen = isCustomProvider || showAdvanced;

  return (
    <div className="model-setup-page">
      <div className="model-setup-scroll">
        <div className="model-setup-container" style={{ animation: 'fadeIn 0.4s ease-out' }}>

          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--print)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--slate)' }}>
                {t('model.title')}
              </span>
            </div>
            <div style={{ fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: 6 }}>
              {t('model.subtitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate)', lineHeight: 1.5 }}>
              {t('model.simpleHint', 'Choose a provider, paste your API key, pick a model — done.')}
            </div>
          </div>

          {/* ── Step 1: Provider ── */}
          <div className="model-setup-step-block">
            <div className="model-setup-step-num">1</div>
            <div className="model-setup-step-body">
              <div className="model-setup-row__label">{t('model.providerLabel')}</div>
              <SimpleSelect
                value={selectedProviderId}
                options={providerOptions}
                placeholder={t('model.selectProvider')}
                onChange={handleProviderSelect}
              />
            </div>
          </div>

          {!!selectedProviderId && (
            <>
              {/* ── Step 2: API Key ── */}
              <div className="model-setup-step-block">
                <div className="model-setup-step-num">2</div>
                <div className="model-setup-step-body">
                  <div className="model-setup-row__label">{t('model.form.apiKey')}</div>
                  <div className="model-setup-inline">
                    <input
                      className="input"
                      type={showApiKey ? 'text' : 'password'}
                      placeholder={t('model.form.apiKeyPlaceholder')}
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); resetTestState(); resetRemoteDiscovery(); }}
                    />
                    <button type="button" className="btn btn-ghost model-setup-secret-btn" onClick={() => setShowApiKey((s) => !s)}>
                      {showApiKey ? t('model.hideSecret') : t('model.showSecret')}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Step 3: Model + Test ── */}
              <div className="model-setup-step-block">
                <div className="model-setup-step-num">3</div>
                <div className="model-setup-step-body">
                  <div className="model-setup-row__label">{t('model.form.modelSelection')}</div>
                  <div className="model-setup-inline">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {template ? (
                        <SimpleSelect
                          value={modelSelectionValue}
                          options={modelOptions}
                          placeholder={t('model.modelNameSelectPlaceholder')}
                          disabled={isFetchingRemoteModels}
                          menuVariant="tall"
                          customOptionValue={CUSTOM_MODEL_OPTION}
                          customInputValue={modelName}
                          customInputPlaceholder={t('model.modelNamePlaceholder')}
                          onCustomInputChange={(v) => { setModelName(v); resetTestState(); }}
                          onOpenChange={(o) => { if (o) void fetchRemoteModels(); }}
                          onChange={(next) => {
                            if (next === CUSTOM_MODEL_OPTION) {
                              setForceCustomModelInput(true);
                              if (mergedModelIds.includes(modelName.trim())) setModelName('');
                              resetTestState();
                              return;
                            }
                            setForceCustomModelInput(false);
                            setModelName(next);
                            resetTestState();
                          }}
                        />
                      ) : (
                        <input
                          className="input"
                          placeholder={t('model.modelNamePlaceholder')}
                          value={modelName}
                          onChange={(e) => { setModelName(e.target.value); resetTestState(); }}
                        />
                      )}
                    </div>
                    <div className="model-setup-test-inline">
                      <button className="btn" disabled={!canTestConnection} onClick={handleTestConnection}>
                        {testStatus === 'testing' ? t('model.testing') : t('model.testConnection')}
                      </button>
                      {testStatus === 'success' && (
                        <span className="model-setup-test-msg model-setup-test-msg--ok">
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--print)', display: 'inline-block', animation: 'orbitPulse 2.4s ease-in-out infinite' }} />
                          {t('model.testLive', 'Live')}
                        </span>
                      )}
                      {testStatus === 'error' && (
                        <span className="model-setup-test-msg model-setup-test-msg--err" title={testMessage}>!</span>
                      )}
                    </div>
                  </div>
                  {modelFetchHint && <div className="model-setup-fetch-hint">{modelFetchHint}</div>}
                </div>
              </div>

              {/* ── Advanced toggle (hidden for custom provider) ── */}
              {!isCustomProvider && (
                <button
                  type="button"
                  className="model-setup-advanced-toggle"
                  onClick={() => setShowAdvanced((s) => !s)}
                >
                  <svg
                    width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transition: 'transform 0.2s', transform: advancedOpen ? 'rotate(180deg)' : 'none' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {advancedOpen ? t('model.advancedHide') : t('model.advancedShow')}
                </button>
              )}

              {/* ── Advanced: Base URL + Format on one row ── */}
              {advancedOpen && (
                <div className={`model-setup-advanced-body${isCustomProvider ? '' : ' model-setup-advanced-body--muted'}`}>
                  <div className="model-setup-combo-row">
                    <div className="model-setup-combo-col">
                      <div className="model-setup-row__label">{t('model.form.baseUrl')}</div>
                      {baseUrlOptions.length > 0 ? (
                        <BaseUrlCombo
                          value={baseUrl}
                          placeholder={template?.baseUrl || t('model.baseUrlPlaceholder')}
                          options={baseUrlOptions}
                          onChange={handleBaseUrlChange}
                          onPresetSelect={handleBaseUrlOptionSelect}
                          menuClassName={isCustomProvider ? undefined : 'model-setup-baseurl-combo__menu--advanced'}
                        />
                      ) : (
                        <input
                          className="input"
                          type="url"
                          placeholder={template?.baseUrl || t('model.baseUrlPlaceholder')}
                          value={baseUrl}
                          onChange={(e) => handleBaseUrlChange(e.target.value)}
                        />
                      )}
                    </div>
                    <div className="model-setup-combo-col" style={{ flex: '0 0 148px' }}>
                      <div className="model-setup-row__label">{t('model.form.provider')}</div>
                      <SimpleSelect
                        value={isCustomProvider ? customFormat : apiFormat}
                        options={formatSelectOptions}
                        placeholder={t('model.form.providerPlaceholder')}
                        menuClassName={isCustomProvider ? undefined : 'bf-select-menu--advanced'}
                        onChange={(next) => {
                          const v = next as RequestFormatValue;
                          if (isCustomProvider) setCustomFormat(v);
                          else setApiFormat(v);
                          resetTestState();
                          resetRemoteDiscovery();
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </div>

      <div className="model-setup-footer" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('model.back')}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={onSkip}>
            {t('model.tuneLater', t('model.skip'))}
          </button>
          <button className="btn btn--ignite" onClick={handleContinue} disabled={!canContinue || isSubmitting}>
            {t('model.nextTheme')}
          </button>
        </div>
      </div>
    </div>
  );
}
