 

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberField, Select, Button, ConfirmDialog, Switch } from '@/design-system';
import { configManager } from '../services/ConfigManager';
import {
  getEditorSettingId,
  mergeEditorSettingsProjection,
  parseEditorSettingsProjection,
  type EditorSettingsDraftPath,
  type EditorSettingsProjection,
} from '../services/EditorSettingsProjection';
import type { CustomSettingsProjectionProps } from '../customSettingsProjection';
import { globalEventBus } from '@/infrastructure/event-bus';
import {
  ConfigPageLayout,
  ConfigPageHeader,
  ConfigPageContent,
  ConfigPageSection,
  ConfigPageRow,
  ConfigPageLoading,
  ConfigPageMessage,
} from './common';
import { createLogger } from '@/shared/utils/logger';
import './EditorConfig.scss';

const log = createLogger('EditorConfig');


const AUTO_SAVE_DELAY = 500;

export type EditorConfigProps = CustomSettingsProjectionProps;


const fontFamilyOptions = [
  { label: 'Fira Code', value: 'Fira Code' },
  { label: 'Noto Sans SC', value: 'Noto Sans SC' },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Courier New', value: 'Courier New' },
];




const wordWrapOptions = [
  { label: 'off', value: 'off', labelKey: 'behavior.wordWrapOptions.off' },
  { label: 'on', value: 'on', labelKey: 'behavior.wordWrapOptions.on' },
  { label: 'wordWrapColumn', value: 'wordWrapColumn', labelKey: 'behavior.wordWrapOptions.wordWrapColumn' },
  { label: 'bounded', value: 'bounded', labelKey: 'behavior.wordWrapOptions.bounded' },
];


const lineNumbersOptions = [
  { label: 'on', value: 'on', labelKey: 'behavior.lineNumberOptions.on' },
  { label: 'off', value: 'off', labelKey: 'behavior.lineNumberOptions.off' },
  { label: 'relative', value: 'relative', labelKey: 'behavior.lineNumberOptions.relative' },
  { label: 'interval', value: 'interval', labelKey: 'behavior.lineNumberOptions.interval' },
];


const minimapSideOptions = [
  { label: 'left', value: 'left', labelKey: 'display.minimapPositionLeft' },
  { label: 'right', value: 'right', labelKey: 'display.minimapPositionRight' },
];


const minimapSizeOptions = [
  { label: 'proportional', value: 'proportional', labelKey: 'display.minimapSizeAuto' },
  { label: 'fill', value: 'fill', labelKey: 'display.minimapSizeFill' },
  { label: 'fit', value: 'fit', labelKey: 'display.minimapSizeFit' },
];


function getPrimaryFont(fontFamily: string): string {
  
  const fonts = fontFamily.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, ''));
  
  return fonts[0] ?? '';
}

 
function buildFontFamily(primaryFont: string): string {
  
  const fallbackFonts = ['Consolas', 'Monaco', 'Menlo', "'Courier New'", 'monospace'];
  const fonts = [primaryFont, ...fallbackFonts.filter(f => f !== primaryFont && f !== `'${primaryFont}'`)];
  return fonts.map(f => f.includes(' ') && !f.startsWith("'") ? `'${f}'` : f).join(', ');
}

const EditorConfig: React.FC<EditorConfigProps> = ({
  snapshotRevision,
  onDirtySettingIdsChange,
}) => {
  const { t } = useTranslation('settings/editor');
  const { t: tCommon } = useTranslation('common');
  
  
  const wordWrapOptionsTranslated = wordWrapOptions.map(o => ({ ...o, label: t(o.labelKey) }));
  const lineNumbersOptionsTranslated = lineNumbersOptions.map(o => ({ ...o, label: t(o.labelKey) }));
  const minimapSideOptionsTranslated = minimapSideOptions.map(o => ({ ...o, label: t(o.labelKey) }));
  const minimapSizeOptionsTranslated = minimapSizeOptions.map(o => ({ ...o, label: t(o.labelKey) }));
  
  
  const [config, setConfig] = useState<EditorSettingsProjection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  
  
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveConfigRef = useRef<EditorSettingsProjection | null>(null);
  const saveGenerationRef = useRef(0);
  const dirtySettingIdsRef = useRef<ReadonlySet<string>>(new Set());
  const onDirtySettingIdsChangeRef = useRef(onDirtySettingIdsChange);
  const lastSnapshotRevisionRef = useRef(snapshotRevision);
  const isMountedRef = useRef(true);

  useEffect(() => {
    onDirtySettingIdsChangeRef.current = onDirtySettingIdsChange;
  }, [onDirtySettingIdsChange]);

  const replaceDirtySettingIds = useCallback((next: ReadonlySet<string>) => {
    dirtySettingIdsRef.current = next;
    onDirtySettingIdsChangeRef.current([...next]);
  }, []);

  const markSettingDirty = useCallback((settingId: string) => {
    if (dirtySettingIdsRef.current.has(settingId)) {
      return;
    }
    replaceDirtySettingIds(new Set([...dirtySettingIdsRef.current, settingId]));
  }, [replaceDirtySettingIds]);

  const clearAllDirtySettings = useCallback(() => {
    if (dirtySettingIdsRef.current.size > 0) {
      replaceDirtySettingIds(new Set());
    }
  }, [replaceDirtySettingIds]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      onDirtySettingIdsChangeRef.current([]);
    };
  }, []);

  
  const loadConfig = useCallback(async (): Promise<EditorSettingsProjection | null> => {
    try {
      setIsLoading(true);
      setLoadError(null);
      setStatusMessage(null);
      const nextConfig = parseEditorSettingsProjection(
        await configManager.getSetting<unknown>('core.editor'),
      );
      if (!isMountedRef.current) return null;
      pendingSaveConfigRef.current = null;
      saveGenerationRef.current += 1;
      setConfig(nextConfig);
      clearAllDirtySettings();
      return nextConfig;
    } catch (error) {
      log.error('Failed to load editor config', { error });
      if (!isMountedRef.current) return null;
      setConfig(null);
      setLoadError(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [clearAllDirtySettings]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  
  const doSave = useCallback(async (
    configToSave: EditorSettingsProjection,
    generation: number,
  ) => {
    try {
      setIsSaving(true);
      setStatusMessage(null);

      await configManager.setSetting('core.editor', configToSave);

      globalEventBus.emit('editor:config:changed', configToSave);
      if (generation === saveGenerationRef.current) {
        pendingSaveConfigRef.current = null;
        clearAllDirtySettings();
      }

      setStatusMessage({ 
        type: 'success', 
        text: t('messages.saveSuccess') 
      });

      
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      log.error('Failed to save config', error);
      setStatusMessage({ 
        type: 'error', 
        text: `${t('messages.saveFailed')}: ` + (error instanceof Error ? error.message : String(error))
      });
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [clearAllDirtySettings, t]);

  const scheduleSave = useCallback((nextConfig: EditorSettingsProjection) => {
    const generation = ++saveGenerationRef.current;
    pendingSaveConfigRef.current = nextConfig;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      const pendingConfig = pendingSaveConfigRef.current;
      if (pendingConfig) {
        void doSave(pendingConfig, generation);
      }
    }, AUTO_SAVE_DELAY);
  }, [doSave]);

  useEffect(() => {
    if (snapshotRevision === null || snapshotRevision === lastSnapshotRevisionRef.current) {
      return;
    }
    lastSnapshotRevisionRef.current = snapshotRevision;
    let cancelled = false;
    void configManager.getSetting<unknown>('core.editor').then((value) => {
      if (cancelled || !isMountedRef.current) {
        return;
      }
      const committed = parseEditorSettingsProjection(value);
      setConfig((current) => {
        if (!current) {
          return committed;
        }
        const merged = mergeEditorSettingsProjection(
          current,
          committed,
          dirtySettingIdsRef.current,
        );
        if (dirtySettingIdsRef.current.size > 0) {
          pendingSaveConfigRef.current = merged;
        }
        return merged;
      });
    }).catch((error) => {
      log.error('Failed to reconcile committed editor config', { error });
    });
    return () => {
      cancelled = true;
    };
  }, [snapshotRevision]);

  const resetConfig = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    saveGenerationRef.current += 1;
    pendingSaveConfigRef.current = null;
    setResetConfirmOpen(false);
    setIsSaving(true);
    setIsLoading(true);
    setLoadError(null);
    setStatusMessage(null);
    let resetApplied = false;
    try {
      await configManager.resetSetting('core.editor');
      resetApplied = true;
      const nextConfig = parseEditorSettingsProjection(
        await configManager.getSetting<unknown>('core.editor'),
      );
      if (!isMountedRef.current) return;
      setConfig(nextConfig);
      globalEventBus.emit('editor:config:changed', nextConfig);
      clearAllDirtySettings();
      setStatusMessage({
        type: 'warning',
        text: t('messages.resetDone'),
      });
    } catch (error) {
      log.error('Failed to reset editor config', { error });
      if (!isMountedRef.current) return;
      if (resetApplied) {
        setConfig(null);
        setLoadError(error instanceof Error ? error : new Error(String(error)));
      } else {
        setStatusMessage({ type: 'error', text: t('messages.resetFailed') });
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
        setIsLoading(false);
      }
    }
  }, [clearAllDirtySettings, t]);

  const updateConfig = useCallback(<K extends Exclude<keyof EditorSettingsProjection, 'minimap'>>(
    key: K,
    value: EditorSettingsProjection[K]
  ) => {
    if (!config) {
      return;
    }
    const nextConfig = { ...config, [key]: value };
    setConfig(nextConfig);
    markSettingDirty(getEditorSettingId(key as EditorSettingsDraftPath));
    scheduleSave(nextConfig);
    if (statusMessage?.type === 'success') {
      setStatusMessage(null);
    }
  }, [config, markSettingDirty, scheduleSave, statusMessage]);

  const updateMinimapConfig = useCallback(<K extends keyof EditorSettingsProjection['minimap']>(
    key: K,
    value: EditorSettingsProjection['minimap'][K],
  ) => {
    if (!config) {
      return;
    }
    const nextConfig = {
      ...config,
      minimap: { ...config.minimap, [key]: value },
    };
    setConfig(nextConfig);
    markSettingDirty(getEditorSettingId(`minimap.${key}` as EditorSettingsDraftPath));
    scheduleSave(nextConfig);
  }, [config, markSettingDirty, scheduleSave]);

  if (isLoading) {
    return (
      <ConfigPageLayout className="sparo-editor-config">
        <ConfigPageHeader
          title={t('title')}
          description={t('subtitle')}
        />
        <ConfigPageContent>
          <ConfigPageLoading text={t('messages.loading')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  if (loadError || !config) {
    return (
      <ConfigPageLayout className="sparo-editor-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent className="sparo-editor-config__content">
          <ConfigPageMessage message={{ type: 'error', text: t('messages.loadFailed') }} />
          <Button variant="secondary" size="small" onClick={() => void loadConfig()}>
            {tCommon('actions.retry')}
          </Button>
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="sparo-editor-config">
      <ConfigPageHeader
        title={t('title')}
        description={t('subtitle')}
      />

      <ConfigPageContent className="sparo-editor-config__content">
        <ConfigPageSection
          title={t('sections.appearance.title')}
        >
          <ConfigPageRow label={t('appearance.font')} align="center">
            <Select
              options={fontFamilyOptions}
              value={getPrimaryFont(config.font_family)}
              onChange={(v) => updateConfig('font_family', buildFontFamily(v as string))}
              placeholder={t('appearance.font')}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('appearance.fontSize')} align="center">
            <NumberField
              value={config.font_size}
              onChange={(v) => updateConfig('font_size', v)}
              min={10}
              max={32}
              step={1}
              unit="px"
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('appearance.lineHeight')} align="center">
            <NumberField
              value={config.line_height}
              onChange={(v) => updateConfig('line_height', v)}
              min={1.0}
              max={3.0}
              step={0.1}
              precision={1}
              size="small"
            />
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.behavior.title')}
        >
          <ConfigPageRow label={t('behavior.tabSize')} align="center">
            <NumberField
              value={config.tab_size}
              onChange={(v) => updateConfig('tab_size', v)}
              min={1}
              max={8}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('behavior.insertSpaces')} description={t('behavior.insertSpacesDesc')} align="center">
            <Switch
              checked={config.insert_spaces}
              onChange={(e) => updateConfig('insert_spaces', e.target.checked)}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('behavior.wordWrap')} align="center">
            <Select
              options={wordWrapOptionsTranslated}
              value={config.word_wrap}
              onChange={(v) => updateConfig('word_wrap', v as string)}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('behavior.lineNumbers')} align="center">
            <Select
              options={lineNumbersOptionsTranslated}
              value={config.line_numbers}
              onChange={(v) => updateConfig('line_numbers', v as string)}
              size="small"
            />
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.display.title')}
        >
          <ConfigPageRow label={t('display.minimap')} description={t('display.minimapDesc')} align="center">
            <Switch
              checked={config.minimap.enabled}
              onChange={(e) => updateMinimapConfig('enabled', e.target.checked)}
              size="small"
            />
          </ConfigPageRow>
          {config.minimap.enabled && (
            <>
              <ConfigPageRow label={t('display.minimapPosition')} align="center">
                <Select
                  options={minimapSideOptionsTranslated}
                  value={config.minimap.side}
                  onChange={(v) => updateMinimapConfig('side', v as string)}
                  size="small"
                />
              </ConfigPageRow>
              <ConfigPageRow label={t('display.minimapSize')} align="center">
                <Select
                  options={minimapSizeOptionsTranslated}
                  value={config.minimap.size}
                  onChange={(v) => updateMinimapConfig('size', v as string)}
                  size="small"
                />
              </ConfigPageRow>
            </>
          )}
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.advanced.title')}
        >
          <ConfigPageRow label={t('advanced.formatOnSave')} description={t('advanced.formatOnSaveDesc')} align="center">
            <Switch
              checked={config.format_on_save}
              onChange={(e) => updateConfig('format_on_save', e.target.checked)}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('advanced.formatOnPaste')} description={t('advanced.formatOnPasteDesc')} align="center">
            <Switch
              checked={config.format_on_paste}
              onChange={(e) => updateConfig('format_on_paste', e.target.checked)}
              size="small"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('advanced.trimAutoWhitespace')} description={t('advanced.trimAutoWhitespaceDesc')} align="center">
            <Switch
              checked={config.trim_auto_whitespace}
              onChange={(e) => updateConfig('trim_auto_whitespace', e.target.checked)}
              size="small"
            />
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.reset.title')}
        >
          <ConfigPageRow label={t('actions.reset')} description={t('messages.confirmReset')} align="center">
            <div className="sparo-editor-config__actions">
              <Button
                variant="secondary"
                size="small"
                onClick={() => setResetConfirmOpen(true)}
                disabled={isSaving}
              >
                {t('actions.reset')}
              </Button>
              {isSaving && (
                <span className="sparo-editor-config__saving">{t('messages.saving')}</span>
              )}
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageMessage message={statusMessage} />
      </ConfigPageContent>
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        onConfirm={() => void resetConfig()}
        title={t('resetDialog.title')}
        message={t('resetDialog.message')}
        type="warning"
        confirmDanger
        confirmText={t('resetDialog.confirm')}
        cancelText={t('resetDialog.cancel')}
      />
    </ConfigPageLayout>
  );
};

export default EditorConfig;
