import { useState, useEffect, useCallback, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { aiExperienceConfigService, type AIExperienceSettings } from '../services/AIExperienceConfigService';
import { useAIExperienceSettings } from '../hooks';
import { configManager } from '../services/ConfigManager';
import { getCompactModelDisplayName } from '../services/modelConfigs';
import {
  getDebugSettingId,
  mergeDebugSettingsProjection,
} from '../services/DebugSettingsProjection';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { notificationService } from '@/shared/notification-system';
import type { AIModelConfig, DebugModeConfig, DefaultModels, LanguageDebugTemplate } from '../types';
import { ALL_LANGUAGES } from '../types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('SessionSettingsConfig');

export const IS_TAURI_DESKTOP = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
export const AGENT_SESSION_TITLE = 'session-title-func-agent';
export const AGENT_DAILY_LETTER = 'DailyLetterWriter';
const BITFUN_CODER_DEBUG_SETTING_NAMESPACE = 'core.product_apps.bitfun_coder.debug';
const DEFAULT_GOAL_MAX_CONTINUATION_TURNS = 100;
const MIN_GOAL_MAX_CONTINUATION_TURNS = 1;
const MAX_GOAL_MAX_CONTINUATION_TURNS = 1000;

type ComputerUseStatusPayload = {
  computerUseEnabled: boolean;
  accessibilityGranted: boolean;
  screenCaptureGranted: boolean;
  platformNote: string | null;
};

type BrowserControlLaunchResponse = {
  success: boolean;
  status: string;
  message: string | null;
  browserKind: string;
};

type UseSessionSettingsConfigOptions = {
  loadDesktopStatus?: boolean;
  snapshotRevision?: number | null;
  onDebugDirtySettingIdsChange?: (settingIds: readonly string[]) => void;
};

async function loadBitFunCoderDebugConfig(): Promise<DebugModeConfig> {
  const config = await configManager.getSetting<DebugModeConfig | undefined>(
    BITFUN_CODER_DEBUG_SETTING_NAMESPACE,
  );
  if (
    !config
    || typeof config.log_path !== 'string'
    || typeof config.ingest_port !== 'number'
    || !Array.isArray(config.enabled_languages)
    || config.language_templates === null
    || typeof config.language_templates !== 'object'
    || Array.isArray(config.language_templates)
  ) {
    throw new Error('BitFun Coder debug settings are missing from the Catalog projection');
  }
  return config;
}

export function useSessionSettingsConfig(options: UseSessionSettingsConfigOptions = {}) {
  const {
    loadDesktopStatus = true,
    snapshotRevision,
    onDebugDirtySettingIdsChange,
  } = options;
  const { t } = useTranslation('settings/personalization');
  const { t: tTools } = useTranslation('settings/agentic-tools');
  const { t: tDebug } = useTranslation('settings/debug');
  const { t: tPermissions } = useTranslation('settings/permissions');
  const isMountedRef = useRef(true);
  const onDebugDirtySettingIdsChangeRef = useRef(onDebugDirtySettingIdsChange);
  const lastDebugSnapshotRevisionRef = useRef(snapshotRevision);
  const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useAIExperienceSettings();

  const [isLoading, setIsLoading] = useState(true);
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [defaultModels, setDefaultModels] = useState<DefaultModels>({ primary: null, fast: null });
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});
  const [funcAgentModels, setFuncAgentModels] = useState<Record<string, string>>({});
  const [skipToolConfirmation, setSkipToolConfirmation] = useState(false);
  const [executionTimeout, setExecutionTimeout] = useState('');
  const [confirmationTimeout, setConfirmationTimeout] = useState('');
  const [goalMaxContinuationTurns, setGoalMaxContinuationTurns] = useState(DEFAULT_GOAL_MAX_CONTINUATION_TURNS);
  const [toolExecConfigLoading, setToolExecConfigLoading] = useState(false);

  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [computerUseAccess, setComputerUseAccess] = useState(false);
  const [computerUseScreen, setComputerUseScreen] = useState(false);
  const [computerUseBusy, setComputerUseBusy] = useState(false);

  const [browserCdpAvailable, setBrowserCdpAvailable] = useState(false);
  const [browserKind, setBrowserKind] = useState('');
  const [browserVersion, setBrowserVersion] = useState<string | null>(null);
  const [browserPageCount, setBrowserPageCount] = useState(0);
  const [browserControlBusy, setBrowserControlBusy] = useState(false);
  const [browserRestartPrompt, setBrowserRestartPrompt] = useState<BrowserControlLaunchResponse | null>(null);
  const [platform, setPlatform] = useState<string>('');

  const [debugConfig, setDebugConfig] = useState<DebugModeConfig | null>(null);
  const [debugConfigLoading, setDebugConfigLoading] = useState(true);
  const [debugConfigError, setDebugConfigError] = useState<Error | null>(null);
  const [debugDirtySettingIds, setDebugDirtySettingIds] = useState<ReadonlySet<string>>(new Set());
  const debugDirtySettingIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [debugSaving, setDebugSaving] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

  useEffect(() => {
    onDebugDirtySettingIdsChangeRef.current = onDebugDirtySettingIdsChange;
  }, [onDebugDirtySettingIdsChange]);

  useEffect(() => {
    onDebugDirtySettingIdsChangeRef.current?.([...debugDirtySettingIds]);
  }, [debugDirtySettingIds]);

  useEffect(() => () => onDebugDirtySettingIdsChangeRef.current?.([]), []);

  const replaceDebugDirtySettingIds = useCallback((next: ReadonlySet<string>) => {
    debugDirtySettingIdsRef.current = next;
    setDebugDirtySettingIds(next);
  }, []);

  const markDebugFieldsDirty = useCallback((fields: readonly (keyof DebugModeConfig)[]) => {
    const next = new Set(debugDirtySettingIdsRef.current);
    for (const field of fields) {
      next.add(getDebugSettingId(field));
    }
    replaceDebugDirtySettingIds(next);
  }, [replaceDebugDirtySettingIds]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshComputerUseStatus = useCallback(async (): Promise<boolean> => {
    if (!IS_TAURI_DESKTOP) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<ComputerUseStatusPayload>('computer_use_get_status');
      if (!isMountedRef.current) return true;
      setComputerUseEnabled(s.computerUseEnabled);
      setComputerUseAccess(s.accessibilityGranted);
      setComputerUseScreen(s.screenCaptureGranted);
      return true;
    } catch (error) {
      log.error('computer_use_get_status failed', error);
      return false;
    }
  }, []);

  const refreshBrowserControlStatus = useCallback(async () => {
    if (!IS_TAURI_DESKTOP) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<{
        cdpAvailable: boolean;
        browserKind: string;
        browserVersion: string | null;
        port: number;
        pageCount: number;
      }>('browser_control_get_status', { request: { port: 9222 } });
      if (!isMountedRef.current) return;
      setBrowserCdpAvailable(s.cdpAvailable);
      setBrowserKind(s.browserKind);
      setBrowserVersion(s.browserVersion);
      setBrowserPageCount(s.pageCount);
    } catch (error) {
      log.error('browser_control_get_status failed', error);
    }
  }, []);

  const loadDebugConfig = useCallback(async (): Promise<DebugModeConfig | null> => {
    setDebugConfigLoading(true);
    setDebugConfigError(null);
    try {
      const nextConfig = await loadBitFunCoderDebugConfig();
      if (!isMountedRef.current) return null;
      setDebugConfig(nextConfig);
      replaceDebugDirtySettingIds(new Set());
      return nextConfig;
    } catch (error) {
      log.error('Failed to load BitFun Coder debug config', { error });
      if (!isMountedRef.current) return null;
      setDebugConfig(null);
      setDebugConfigError(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      if (isMountedRef.current) setDebugConfigLoading(false);
    }
  }, [replaceDebugDirtySettingIds]);

  useEffect(() => {
    if (
      snapshotRevision === null
      || snapshotRevision === undefined
      || snapshotRevision === lastDebugSnapshotRevisionRef.current
    ) {
      return;
    }
    lastDebugSnapshotRevisionRef.current = snapshotRevision;
    let cancelled = false;
    void loadBitFunCoderDebugConfig().then((committed) => {
      if (cancelled || !isMountedRef.current) {
        return;
      }
      setDebugConfig((current) => current
        ? mergeDebugSettingsProjection(current, committed, debugDirtySettingIdsRef.current)
        : committed);
    }).catch((error) => {
      log.error('Failed to reconcile committed BitFun Coder debug config', { error });
    });
    return () => {
      cancelled = true;
    };
  }, [snapshotRevision]);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [
        allModels,
        defaultModelsData,
        agentModelsData,
        funcAgentModelsData,
        skipConfirm,
        execTimeout,
        confirmTimeout,
        goalMaxContinuationTurnsConfig,
        computerUseCfg,
      ] = await Promise.all([
        configManager.getSetting<AIModelConfig[]>('core.ai.models') || [],
        configManager.getSetting<Partial<DefaultModels>>('core.ai.default_models') || {},
        configManager.getSetting<Record<string, string>>('core.ai.agent_models') || {},
        configManager.getSetting<Record<string, string>>('core.ai.func_agent_models') || {},
        configManager.getSetting<boolean>('core.ai.skip_tool_confirmation'),
        configManager.getSetting<number | null>('core.ai.tool_execution_timeout_secs'),
        configManager.getSetting<number | null>('core.ai.tool_confirmation_timeout_secs'),
        configManager.getSetting<number | null>('core.ai.goal_mode.max_continuation_turns'),
        configManager.getSetting<boolean>('core.ai.computer_use_enabled'),
      ]);

      if (!isMountedRef.current) return;
      setModels(allModels as AIModelConfig[]);
      setDefaultModels({
        primary: defaultModelsData?.primary || null,
        fast: defaultModelsData?.fast || null,
      });
      setAgentModels(agentModelsData as Record<string, string>);
      setFuncAgentModels(funcAgentModelsData as Record<string, string>);
      setSkipToolConfirmation(skipConfirm || false);
      setExecutionTimeout(execTimeout != null ? String(execTimeout) : '');
      setConfirmationTimeout(confirmTimeout != null ? String(confirmTimeout) : '');
      setGoalMaxContinuationTurns(goalMaxContinuationTurnsConfig ?? DEFAULT_GOAL_MAX_CONTINUATION_TURNS);

      if (IS_TAURI_DESKTOP && loadDesktopStatus) {
        void (async () => {
          const ok = await refreshComputerUseStatus();
          if (!isMountedRef.current) return;
          if (!ok) setComputerUseEnabled(computerUseCfg ?? false);
          await refreshBrowserControlStatus();
          if (!isMountedRef.current) return;
          try {
            const info = await systemAPI.getSystemInfo();
            if (isMountedRef.current) setPlatform(info.platform || '');
          } catch (error) {
            log.warn('getSystemInfo failed', error);
          }
        })();
      } else {
        setComputerUseEnabled(computerUseCfg ?? false);
      }
    } catch (error) {
      log.error('Failed to load session settings data', error);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [loadDesktopStatus, refreshBrowserControlStatus, refreshComputerUseStatus]);

  useEffect(() => {
    void loadAllData();
    void loadDebugConfig();
  }, [loadAllData, loadDebugConfig]);

  const updateSetting = async <K extends keyof AIExperienceSettings>(
    key: K,
    value: AIExperienceSettings[K]
  ) => {
    if (!settings) {
      throw settingsError ?? new Error('AI experience settings are unavailable');
    }
    const newSettings = { ...settings, [key]: value };
    try {
      await aiExperienceConfigService.saveSettings(newSettings);
      notificationService.success(t('messages.saveSuccess'), { duration: 2000 });
    } catch (error) {
      log.error('Failed to save personalization settings', error);
      notificationService.error(t('messages.saveFailed'));
    }
  };

  const getModelName = useCallback((modelId: string | null | undefined): string | undefined => {
    if (!modelId) return undefined;
    const model = models.find(m => m.id === modelId);
    return model ? getCompactModelDisplayName(model) || model.id : undefined;
  }, [models]);

  const handleAgentModelChange = async (agentKey: string, featureTitleKey: string, modelId: string) => {
    try {
      const current = await configManager.getSetting<Record<string, string>>('core.ai.func_agent_models') || {};
      const updated = { ...current, [agentKey]: modelId };
      await configManager.setSetting('core.ai.func_agent_models', updated);
      setFuncAgentModels(updated);

      let modelDesc = '';
      if (modelId === 'primary') {
        modelDesc = t('model.primary');
      } else if (modelId === 'fast') {
        modelDesc = t('model.fast');
      } else {
        modelDesc = getModelName(modelId) || modelId || '';
      }

      notificationService.success(
        t('models.updateSuccess', { agentName: t(featureTitleKey), modelName: modelDesc }),
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to update agent model', { agentKey, modelId, error });
      notificationService.error(t('messages.updateFailed'), { duration: 3000 });
    }
  };

  const handleBuiltinAgentModelChange = async (agentKey: string, featureTitleKey: string, modelId: string) => {
    try {
      const current = await configManager.getSetting<Record<string, string>>('core.ai.agent_models') || {};
      const updated = { ...current, [agentKey]: modelId };
      await configManager.setSetting('core.ai.agent_models', updated);
      setAgentModels(updated);

      let modelDesc = '';
      if (modelId === 'primary') {
        modelDesc = t('model.primary');
      } else if (modelId === 'fast') {
        modelDesc = t('model.fast');
      } else {
        modelDesc = getModelName(modelId) || modelId || '';
      }

      notificationService.success(
        t('models.updateSuccess', { agentName: t(featureTitleKey), modelName: modelDesc }),
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to update built-in agent model', { agentKey, modelId, error });
      notificationService.error(t('messages.updateFailed'), { duration: 3000 });
    }
  };

  const handleSkipToolConfirmationChange = async (checked: boolean) => {
    setSkipToolConfirmation(checked);
    setToolExecConfigLoading(true);
    try {
      await configManager.setSetting('core.ai.skip_tool_confirmation', checked);
      notificationService.success(
        checked ? tTools('messages.autoExecuteEnabled') : tTools('messages.autoExecuteDisabled'),
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to save skip_tool_confirmation', error);
      notificationService.error(
        `${tTools('messages.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
      setSkipToolConfirmation(!checked);
    } finally {
      setToolExecConfigLoading(false);
    }
  };

  const handleComputerUseEnabledChange = async (checked: boolean) => {
    setComputerUseBusy(true);
    setComputerUseEnabled(checked);
    try {
      await configManager.setSetting('core.ai.computer_use_enabled', checked);
      notificationService.success(t('messages.saveSuccess'), { duration: 2000 });
      await refreshComputerUseStatus();
    } catch (error) {
      log.error('Failed to save computer_use_enabled', error);
      notificationService.error(t('messages.saveFailed'));
      setComputerUseEnabled(!checked);
    } finally {
      setComputerUseBusy(false);
    }
  };

  const handleComputerUseOpenSettings = async (pane: 'accessibility' | 'screen_capture') => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('computer_use_open_system_settings', { request: { pane } });
    } catch (error) {
      log.error('computer_use_open_system_settings failed', error);
      notificationService.error(t('messages.saveFailed'));
    }
  };

  const handleBrowserControlLaunch = async () => {
    setBrowserControlBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<BrowserControlLaunchResponse>('browser_control_launch', { request: { port: 9222 } });
      if (result.success) {
        notificationService.success(
          tPermissions('browserControl.connectSuccess', { browser: result.browserKind }),
          { duration: 3000 }
        );
      } else if (result.status === 'needs_restart') {
        setBrowserRestartPrompt(result);
      } else if (result.message) {
        notificationService.info(result.message, { duration: 8000 });
      }
      await refreshBrowserControlStatus();
    } catch (error) {
      log.error('browser_control_launch failed', error);
      notificationService.error(tPermissions('browserControl.connectFailed'));
    } finally {
      setBrowserControlBusy(false);
    }
  };

  const handleBrowserControlRestart = async () => {
    if (!browserRestartPrompt) return;
    setBrowserControlBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<BrowserControlLaunchResponse>('browser_control_restart_with_cdp', {
        request: { port: 9222 },
      });
      if (result.success) {
        notificationService.success(
          tPermissions('browserControl.restartSuccess', { browser: result.browserKind }),
          { duration: 3000 }
        );
        setBrowserRestartPrompt(null);
      } else if (result.message) {
        notificationService.info(result.message, { duration: 8000 });
      }
      await refreshBrowserControlStatus();
    } catch (error) {
      log.error('browser_control_restart_with_cdp failed', error);
      notificationService.error(tPermissions('browserControl.restartFailed'));
    } finally {
      setBrowserControlBusy(false);
    }
  };

  const handleBrowserControlCreateLauncher = async () => {
    setBrowserControlBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('browser_control_create_launcher');
      notificationService.success(
        tPermissions('browserControl.createLauncherSuccess', { path }),
        { duration: 5000 }
      );
    } catch (error) {
      log.error('browser_control_create_launcher failed', error);
      notificationService.error(tPermissions('browserControl.createLauncherFailed'));
    } finally {
      setBrowserControlBusy(false);
    }
  };

  const handleToolTimeoutChange = async (type: 'execution' | 'confirmation', value: string) => {
    const settingId =
      type === 'execution' ? 'core.ai.tool_execution_timeout_secs' : 'core.ai.tool_confirmation_timeout_secs';
    const trimmedValue = value.trim();
    if (trimmedValue !== '') {
      const numValue = parseInt(trimmedValue, 10);
      if (Number.isNaN(numValue) || numValue < 0) return;
    }
    if (type === 'execution') setExecutionTimeout(trimmedValue);
    else setConfirmationTimeout(trimmedValue);
    const numValue = trimmedValue === '' ? null : parseInt(trimmedValue, 10);
    try {
      await configManager.setSetting(settingId, numValue);
    } catch (error) {
      log.error('Failed to save tool timeout config', { type, error });
      notificationService.error(tTools('messages.saveFailed'));
    }
  };

  const handleGoalMaxContinuationTurnsChange = async (value: number) => {
    const nextValue = Math.max(
      MIN_GOAL_MAX_CONTINUATION_TURNS,
      Math.min(MAX_GOAL_MAX_CONTINUATION_TURNS, Math.round(value)),
    );
    setGoalMaxContinuationTurns(nextValue);
    setToolExecConfigLoading(true);
    try {
      await configManager.setSetting('core.ai.goal_mode.max_continuation_turns', nextValue);
    } catch (error) {
      log.error('Failed to save goal continuation budget config', error);
      notificationService.error(tTools('messages.saveFailed'));
    } finally {
      setToolExecConfigLoading(false);
    }
  };

  const updateDebugConfig = useCallback((updates: Partial<DebugModeConfig>) => {
    setDebugConfig(prev => prev ? { ...prev, ...updates } : prev);
    markDebugFieldsDirty(Object.keys(updates) as (keyof DebugModeConfig)[]);
  }, [markDebugFieldsDirty]);

  const saveDebugConfig = async (): Promise<boolean> => {
    if (!debugConfig) {
      notificationService.error(tDebug('messages.loadFailed'));
      return false;
    }
    try {
      setDebugSaving(true);
      await configManager.setSetting(BITFUN_CODER_DEBUG_SETTING_NAMESPACE, debugConfig);
      replaceDebugDirtySettingIds(new Set());
      notificationService.success(tDebug('messages.saveSuccess'), { duration: 2000 });
      return true;
    } catch (error) {
      log.error('Failed to save debug config', error);
      notificationService.error(tDebug('messages.saveFailed'));
      return false;
    } finally {
      setDebugSaving(false);
    }
  };

  const cancelDebugChanges = async (): Promise<boolean> => {
    return (await loadDebugConfig()) !== null;
  };

  const handleModalSave = async () => {
    if (await saveDebugConfig()) setIsTemplatesModalOpen(false);
  };

  const handleModalCancel = async () => {
    if (await cancelDebugChanges()) setIsTemplatesModalOpen(false);
  };

  const resetDebugTemplates = async () => {
    try {
      await configManager.resetSetting(BITFUN_CODER_DEBUG_SETTING_NAMESPACE);
      const nextConfig = await loadDebugConfig();
      if (!nextConfig) {
        throw new Error('Failed to reload the reset BitFun Coder debug config');
      }
      notificationService.success(tDebug('messages.resetSuccess'), { duration: 2000 });
    } catch (error) {
      log.error('Failed to reset debug config', error);
      notificationService.error(tDebug('messages.resetFailed'));
    }
  };

  const updateTemplate = useCallback((language: string, updates: Partial<LanguageDebugTemplate>) => {
    setDebugConfig(prev => prev ? ({
      ...prev,
      language_templates: {
        ...prev.language_templates,
        [language]: { ...prev.language_templates[language], ...updates },
      },
    }) : prev);
    markDebugFieldsDirty(['language_templates']);
  }, [markDebugFieldsDirty]);

  const toggleTemplateEnabled = useCallback(async (language: string, currentEnabled: boolean) => {
    if (!debugConfig) return;
    const newEnabled = !currentEnabled;
    const newConfig = {
      ...debugConfig,
      language_templates: {
        ...debugConfig.language_templates,
        [language]: { ...debugConfig.language_templates[language], enabled: newEnabled },
      },
    };
    setDebugConfig(newConfig);
    try {
      await configManager.setSetting(BITFUN_CODER_DEBUG_SETTING_NAMESPACE, newConfig);
      replaceDebugDirtySettingIds(new Set());
      const templateName = debugConfig.language_templates[language]?.display_name || language;
      notificationService.success(
        newEnabled
          ? tDebug('messages.templateEnabled', { name: templateName })
          : tDebug('messages.templateDisabled', { name: templateName }),
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to save template toggle', { language, error });
      setDebugConfig(debugConfig);
      notificationService.error(tDebug('messages.saveFailed'));
    }
  }, [debugConfig, replaceDebugDirtySettingIds, tDebug]);

  const toggleTemplateExpand = useCallback((language: string) => {
    setExpandedTemplates(prev => {
      const next = new Set(prev);
      if (next.has(language)) next.delete(language);
      else next.add(language);
      return next;
    });
  }, []);

  const handleSelectLogPath = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: tDebug('fileDialog.logFile'), extensions: ['log', 'txt', 'ndjson'] }],
      });
      if (selected) {
        updateDebugConfig({ log_path: selected });
        notificationService.success(tDebug('messages.logPathUpdated'), { duration: 2000 });
      }
    } catch (error) {
      notificationService.error(
        `${tDebug('messages.selectFileFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const getTemplateEntries = useCallback((): [string, LanguageDebugTemplate][] => {
    if (!debugConfig) return [];
    const languageOrder = new Map<string, number>(
      ALL_LANGUAGES.map((language, index) => [language, index]),
    );
    return Object.entries(debugConfig.language_templates).sort(([left], [right]) => {
      const leftOrder = languageOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = languageOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right);
    });
  }, [debugConfig]);

  return {
    isLoading,
    settings,
    settingsLoading,
    settingsError,
    enabledModels: models.filter((m: AIModelConfig) => m.enabled),
    primaryModelName: getModelName(defaultModels.primary) || t('model.notConfigured'),
    fastModelName: getModelName(defaultModels.fast) || t('model.fastUsesPrimary'),
    sessionTitleModelId: funcAgentModels[AGENT_SESSION_TITLE] || 'fast',
    dailyLetterModelId: agentModels[AGENT_DAILY_LETTER] || 'primary',
    skipToolConfirmation,
    executionTimeout,
    confirmationTimeout,
    goalMaxContinuationTurns,
    toolExecConfigLoading,
    computerUseEnabled,
    computerUseAccess,
    computerUseScreen,
    computerUseBusy,
    browserCdpAvailable,
    browserKind,
    browserVersion,
    browserPageCount,
    browserControlBusy,
    browserRestartPrompt,
    platform,
    debugConfig,
    debugConfigLoading,
    debugConfigError,
    debugHasChanges: debugDirtySettingIds.size > 0,
    debugSaving,
    expandedTemplates,
    isTemplatesModalOpen,
    templateEntries: getTemplateEntries(),
    updateSetting,
    handleAgentModelChange,
    handleBuiltinAgentModelChange,
    handleSkipToolConfirmationChange,
    handleComputerUseEnabledChange,
    handleComputerUseOpenSettings,
    refreshComputerUseStatus,
    refreshBrowserControlStatus,
    handleBrowserControlLaunch,
    handleBrowserControlRestart,
    handleBrowserControlCreateLauncher,
    setBrowserRestartPrompt,
    loadDebugConfig,
    handleToolTimeoutChange,
    handleGoalMaxContinuationTurnsChange,
    updateDebugConfig,
    saveDebugConfig,
    cancelDebugChanges,
    handleModalSave,
    handleModalCancel,
    resetDebugTemplates,
    updateTemplate,
    toggleTemplateEnabled,
    toggleTemplateExpand,
    handleSelectLogPath,
    setIsTemplatesModalOpen,
    tDebug,
    tTools,
  };
}
