import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button, IconButton, NumberField, Select, Switch } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import { configManager } from '../services/ConfigManager';
import type { AppHostScanConfig, AutoMemoryScopeConfig } from '../types';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageRow,
  ConfigPageSection,
  ConfigPageLoading,
  ConfigPageMessage,
} from './common';
import './AIFeaturesConfig.scss';

const log = createLogger('MemoryConfig');

type AutoMemoryScopeKey = 'global' | 'workspace';

type AutoMemoryScopeState = {
  enabled: boolean;
  extractEveryEligibleTurns: number;
  minExtractIntervalMinutes: number;
  forceExtractAfterPendingEligibleTurns: number;
};

type AutoMemoryState = Record<AutoMemoryScopeKey, AutoMemoryScopeState>;

const DEFAULT_AUTO_MEMORY_STATE: AutoMemoryState = {
  global: {
    enabled: true,
    extractEveryEligibleTurns: 6,
    minExtractIntervalMinutes: 60,
    forceExtractAfterPendingEligibleTurns: 20,
  },
  workspace: {
    enabled: true,
    extractEveryEligibleTurns: 1,
    minExtractIntervalMinutes: 60,
    forceExtractAfterPendingEligibleTurns: 5,
  },
};

const AUTO_MEMORY_CONFIG_PATHS = {
  global: {
    scope: 'ai.auto_memory.global',
  },
  workspace: {
    scope: 'ai.auto_memory.workspace',
  },
} as const;

const AUTO_MEMORY_SCOPES: AutoMemoryScopeKey[] = ['global', 'workspace'];

const DEFAULT_EXTRACT_EVERY_ELIGIBLE_TURNS =
  DEFAULT_AUTO_MEMORY_STATE.workspace.extractEveryEligibleTurns;
const normalizeExtractEveryEligibleTurns = (value: number) =>
  Math.max(DEFAULT_EXTRACT_EVERY_ELIGIBLE_TURNS, value);
const normalizeExtractIntervalMinutes = (value: number) => Math.max(0, Math.round(value));
const normalizeForceExtractAfterPendingEligibleTurns = (
  value: number,
  extractEveryEligibleTurns: number
) => {
  const normalizedValue = Math.max(0, Math.round(value));
  if (normalizedValue === 0) {
    return 0;
  }

  return Math.max(extractEveryEligibleTurns + 1, normalizedValue);
};
const minutesToSeconds = (value: number) =>
  normalizeExtractIntervalMinutes(value) * 60;
const secondsToMinutes = (value: number) =>
  value <= 0 ? 0 : Math.ceil(value / 60);
const normalizeScopeState = (
  scopeState: AutoMemoryScopeState
): AutoMemoryScopeState => {
  const extractEveryEligibleTurns = normalizeExtractEveryEligibleTurns(
    scopeState.extractEveryEligibleTurns
  );

  return {
    enabled: scopeState.enabled,
    extractEveryEligibleTurns,
    minExtractIntervalMinutes: normalizeExtractIntervalMinutes(
      scopeState.minExtractIntervalMinutes
    ),
    forceExtractAfterPendingEligibleTurns:
      normalizeForceExtractAfterPendingEligibleTurns(
        scopeState.forceExtractAfterPendingEligibleTurns,
        extractEveryEligibleTurns
      ),
  };
};
const deserializeScopeState = (
  loadedScopeConfig: AutoMemoryScopeConfig | null | undefined,
  defaultScopeState: AutoMemoryScopeState
): AutoMemoryScopeState => {
  const extractEveryEligibleTurns = normalizeExtractEveryEligibleTurns(
    loadedScopeConfig?.extract_every_eligible_turns ?? defaultScopeState.extractEveryEligibleTurns
  );

  return {
    enabled: loadedScopeConfig?.enabled ?? defaultScopeState.enabled,
    extractEveryEligibleTurns,
    minExtractIntervalMinutes: normalizeExtractIntervalMinutes(
      secondsToMinutes(
        loadedScopeConfig?.min_extract_interval_secs ??
          minutesToSeconds(defaultScopeState.minExtractIntervalMinutes)
      )
    ),
    forceExtractAfterPendingEligibleTurns:
      normalizeForceExtractAfterPendingEligibleTurns(
        loadedScopeConfig?.force_extract_after_pending_eligible_turns ??
          defaultScopeState.forceExtractAfterPendingEligibleTurns,
        extractEveryEligibleTurns
      ),
  };
};
const serializeScopeState = (
  scopeState: AutoMemoryScopeState
): AutoMemoryScopeConfig => {
  const normalizedState = normalizeScopeState(scopeState);

  return {
    enabled: normalizedState.enabled,
    extract_every_eligible_turns: normalizedState.extractEveryEligibleTurns,
    min_extract_interval_secs: minutesToSeconds(
      normalizedState.minExtractIntervalMinutes
    ),
    force_extract_after_pending_eligible_turns:
      normalizedState.forceExtractAfterPendingEligibleTurns > 0
        ? normalizedState.forceExtractAfterPendingEligibleTurns
        : null,
  };
};

const DEFAULT_HOST_SCAN_CONFIG: AppHostScanConfig = {
  auto_scan_enabled: false,
  auto_scan_interval_days: 7,
};

const MemoryConfig: React.FC = () => {
  const { t } = useTranslation('settings/memory');
  const [isLoading, setIsLoading] = useState(true);
  const [autoMemoryState, setAutoMemoryState] = useState<AutoMemoryState>(
    DEFAULT_AUTO_MEMORY_STATE
  );
  const [hostScanConfig, setHostScanConfig] = useState<AppHostScanConfig>(DEFAULT_HOST_SCAN_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const messageTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  const hostScanIntervalOptions = useMemo(
    () => [
      { value: '1', label: t('hostScan.intervals.daily') },
      { value: '3', label: t('hostScan.intervals.every3Days') },
      { value: '7', label: t('hostScan.intervals.weekly') },
      { value: '14', label: t('hostScan.intervals.every2Weeks') },
      { value: '30', label: t('hostScan.intervals.monthly') },
    ],
    [t]
  );

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    if (messageTimeoutRef.current !== null) {
      window.clearTimeout(messageTimeoutRef.current);
    }
    messageTimeoutRef.current = window.setTimeout(() => {
      setMessage(null);
      messageTimeoutRef.current = null;
    }, 3000);
  }, []);

  const loadConfig = useCallback(
    async () => {
      setIsLoading(true);
      try {
        const [
          loadedGlobalScopeConfig,
          loadedWorkspaceScopeConfig,
          loadedHostScanConfig,
        ] = await Promise.all([
          configManager.getConfig<AutoMemoryScopeConfig>(AUTO_MEMORY_CONFIG_PATHS.global.scope),
          configManager.getConfig<AutoMemoryScopeConfig>(AUTO_MEMORY_CONFIG_PATHS.workspace.scope),
          configManager.getConfig<AppHostScanConfig>('app.host_scan'),
        ]);

        if (!isMountedRef.current) {
          return;
        }

        setAutoMemoryState({
          global: deserializeScopeState(
            loadedGlobalScopeConfig,
            DEFAULT_AUTO_MEMORY_STATE.global
          ),
          workspace: deserializeScopeState(
            loadedWorkspaceScopeConfig,
            DEFAULT_AUTO_MEMORY_STATE.workspace
          ),
        });
        setHostScanConfig({
          auto_scan_enabled:
            loadedHostScanConfig?.auto_scan_enabled ?? DEFAULT_HOST_SCAN_CONFIG.auto_scan_enabled,
          auto_scan_interval_days:
            loadedHostScanConfig?.auto_scan_interval_days ??
            DEFAULT_HOST_SCAN_CONFIG.auto_scan_interval_days,
        });
      } catch (error) {
        log.error('Failed to load auto memory settings', error);
        if (isMountedRef.current) {
          showMessage('error', t('messages.loadFailed'));
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [showMessage, t]
  );

  useEffect(() => {
    void loadConfig();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadConfig]);

  useEffect(() => () => {
    if (messageTimeoutRef.current !== null) {
      window.clearTimeout(messageTimeoutRef.current);
    }
  }, []);

  const updateScopeState = (
    scope: AutoMemoryScopeKey,
    nextState: Partial<AutoMemoryScopeState>
  ) => {
    setAutoMemoryState((previousState) => ({
      ...previousState,
      [scope]: {
        ...previousState[scope],
        ...nextState,
      },
    }));
  };

  const areAllBackgroundFeaturesDisabled =
    AUTO_MEMORY_SCOPES.every((scope) => !autoMemoryState[scope].enabled) &&
    !hostScanConfig.auto_scan_enabled;

  const saveEnabled = async (scope: AutoMemoryScopeKey, nextValue: boolean) => {
    const previousState = autoMemoryState[scope];
    const nextState = normalizeScopeState({
      ...previousState,
      enabled: nextValue,
    });

    updateScopeState(scope, nextState);
    setIsSaving(true);
    try {
      await configManager.setConfig(
        AUTO_MEMORY_CONFIG_PATHS[scope].scope,
        serializeScopeState(nextState)
      );
      configManager.clearCache();
      showMessage('success', t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save auto memory enabled setting', {
        scope,
        error,
      });
      updateScopeState(scope, previousState);
      showMessage('error', t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveThreshold = async (scope: AutoMemoryScopeKey, nextValue: number) => {
    const normalizedValue = normalizeExtractEveryEligibleTurns(nextValue);
    const previousState = autoMemoryState[scope];

    if (normalizedValue === previousState.extractEveryEligibleTurns) {
      return;
    }

    const nextState = normalizeScopeState({
      ...previousState,
      extractEveryEligibleTurns: normalizedValue,
    });

    updateScopeState(scope, nextState);
    setIsSaving(true);
    try {
      await configManager.setConfig(
        AUTO_MEMORY_CONFIG_PATHS[scope].scope,
        serializeScopeState(nextState)
      );
      configManager.clearCache();
      showMessage('success', t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save auto memory threshold setting', {
        scope,
        error,
      });
      updateScopeState(scope, previousState);
      showMessage('error', t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveMinExtractIntervalMinutes = async (scope: AutoMemoryScopeKey, nextValue: number) => {
    const normalizedMinutes = normalizeExtractIntervalMinutes(nextValue);
    const previousState = autoMemoryState[scope];

    if (normalizedMinutes === previousState.minExtractIntervalMinutes) {
      return;
    }

    const nextState = normalizeScopeState({
      ...previousState,
      minExtractIntervalMinutes: normalizedMinutes,
    });

    updateScopeState(scope, nextState);
    setIsSaving(true);
    try {
      await configManager.setConfig(
        AUTO_MEMORY_CONFIG_PATHS[scope].scope,
        serializeScopeState(nextState)
      );
      configManager.clearCache();
      showMessage('success', t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save auto memory interval setting', {
        scope,
        error,
      });
      updateScopeState(scope, previousState);
      showMessage('error', t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveForceExtractAfterPendingEligibleTurns = async (
    scope: AutoMemoryScopeKey,
    nextValue: number
  ) => {
    const previousState = autoMemoryState[scope];
    const normalizedValue = normalizeForceExtractAfterPendingEligibleTurns(
      nextValue,
      previousState.extractEveryEligibleTurns
    );

    if (
      normalizedValue === previousState.forceExtractAfterPendingEligibleTurns
    ) {
      return;
    }

    const nextState = normalizeScopeState({
      ...previousState,
      forceExtractAfterPendingEligibleTurns: normalizedValue,
    });

    updateScopeState(scope, nextState);
    setIsSaving(true);
    try {
      await configManager.setConfig(
        AUTO_MEMORY_CONFIG_PATHS[scope].scope,
        serializeScopeState(nextState)
      );
      configManager.clearCache();
      showMessage('success', t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save auto memory force extract threshold setting', {
        scope,
        error,
      });
      updateScopeState(scope, previousState);
      showMessage('error', t('messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const persistHostScanConfig = useCallback(
    async (nextConfig: AppHostScanConfig, successMessage: string) => {
      setIsSaving(true);
      try {
        await configManager.setConfig('app.host_scan', nextConfig);
        configManager.clearCache();
        setHostScanConfig(nextConfig);
        showMessage('success', successMessage);
      } catch (error) {
        log.error('Failed to save host scan config', { nextConfig, error });
        showMessage('error', t('hostScan.messages.saveFailed'));
      } finally {
        setIsSaving(false);
      }
    },
    [showMessage, t]
  );

  const handleHostScanEnabledChange = useCallback(
    async (checked: boolean) => {
      await persistHostScanConfig(
        { ...hostScanConfig, auto_scan_enabled: checked },
        t('hostScan.messages.enabledUpdated')
      );
    },
    [hostScanConfig, persistHostScanConfig, t]
  );

  const handleHostScanIntervalChange = useCallback(
    async (value: string) => {
      const nextInterval = Number.parseInt(value, 10);
      if (!Number.isFinite(nextInterval) || nextInterval <= 0) {
        return;
      }

      await persistHostScanConfig(
        { ...hostScanConfig, auto_scan_interval_days: nextInterval },
        t('hostScan.messages.intervalUpdated')
      );
    },
    [hostScanConfig, persistHostScanConfig, t]
  );

  const handleToggleAllEnabled = useCallback(async () => {
    const previousAutoMemoryState = autoMemoryState;
    const previousHostScanConfig = hostScanConfig;
    const shouldEnableAll = areAllBackgroundFeaturesDisabled;
    const nextAutoMemoryState: AutoMemoryState = {
      global: {
        ...previousAutoMemoryState.global,
        enabled: shouldEnableAll,
      },
      workspace: {
        ...previousAutoMemoryState.workspace,
        enabled: shouldEnableAll,
      },
    };
    const nextHostScanConfig: AppHostScanConfig = {
      ...previousHostScanConfig,
      auto_scan_enabled: shouldEnableAll,
    };

    setAutoMemoryState(nextAutoMemoryState);
    setHostScanConfig(nextHostScanConfig);
    setIsSaving(true);

    try {
      await Promise.all([
        configManager.setConfig(
          AUTO_MEMORY_CONFIG_PATHS.global.scope,
          serializeScopeState(nextAutoMemoryState.global)
        ),
        configManager.setConfig(
          AUTO_MEMORY_CONFIG_PATHS.workspace.scope,
          serializeScopeState(nextAutoMemoryState.workspace)
        ),
        configManager.setConfig('app.host_scan', nextHostScanConfig),
      ]);
      configManager.clearCache();
      showMessage(
        'success',
        shouldEnableAll ? t('messages.enableAllSuccess') : t('messages.disableAllSuccess')
      );
    } catch (error) {
      log.error('Failed to toggle memory page background features', {
        shouldEnableAll,
        error,
      });
      setAutoMemoryState(previousAutoMemoryState);
      setHostScanConfig(previousHostScanConfig);
      showMessage(
        'error',
        shouldEnableAll ? t('messages.enableAllFailed') : t('messages.disableAllFailed')
      );
    } finally {
      setIsSaving(false);
    }
  }, [areAllBackgroundFeaturesDisabled, autoMemoryState, hostScanConfig, showMessage, t]);

  const handleResetAll = useCallback(async () => {
    setIsSaving(true);

    try {
      await Promise.all([
        configManager.resetConfig(AUTO_MEMORY_CONFIG_PATHS.global.scope),
        configManager.resetConfig(AUTO_MEMORY_CONFIG_PATHS.workspace.scope),
        configManager.resetConfig('app.host_scan'),
      ]);
      configManager.clearCache();
      await loadConfig();
      showMessage('success', t('messages.resetAllSuccess'));
    } catch (error) {
      log.error('Failed to reset memory page configuration', { error });
      showMessage('error', t('messages.resetAllFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [loadConfig, showMessage, t]);

  if (isLoading) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader title={t('title')} subtitle={t('subtitle')} />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageLoading text={t('loading.text')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  const renderLabelWithInfo = (label: string, description?: string) => {
    if (!description) {
      return label;
    }

    return (
      <span className="sparo-func-agent-config__label-with-info">
        <span>{label}</span>
        <IconButton
          type="button"
          className="sparo-func-agent-config__info-button"
          aria-label={`${label} info`}
          tooltip={description}
          size="xs"
          variant="ghost"
        >
          <Info size={14} />
        </IconButton>
      </span>
    );
  };

  const renderScopeSection = (scope: AutoMemoryScopeKey) => (
    <ConfigPageSection
      key={scope}
      title={t(`autoMemory.${scope}.sectionTitle`)}
      description={t(`autoMemory.${scope}.sectionDescription`)}
    >
      <ConfigPageRow
        label={renderLabelWithInfo(
          t(`autoMemory.${scope}.enabled`),
          t(`autoMemory.${scope}.enabledDesc`)
        )}
        align="center"
      >
        <div className="sparo-func-agent-config__row-control">
          <Switch
            checked={autoMemoryState[scope].enabled}
            onChange={(event) => void saveEnabled(scope, event.target.checked)}
            disabled={isSaving}
            size="small"
          />
        </div>
      </ConfigPageRow>
      <ConfigPageRow
        label={renderLabelWithInfo(
          t(`autoMemory.${scope}.extractEveryEligibleTurns`),
          t(`autoMemory.${scope}.extractEveryEligibleTurnsDesc`)
        )}
        align="center"
      >
        <div className="sparo-func-agent-config__row-control">
          <NumberField
            value={autoMemoryState[scope].extractEveryEligibleTurns}
            onChange={(value) => void saveThreshold(scope, value)}
            min={1}
            max={100}
            step={1}
            unit={t('autoMemory.units.turns')}
            disableWheel
            disabled={isSaving}
            size="small"
            variant="compact"
          />
        </div>
      </ConfigPageRow>
      <ConfigPageRow
        label={renderLabelWithInfo(
          t(`autoMemory.${scope}.minExtractIntervalMinutes`),
          t(`autoMemory.${scope}.minExtractIntervalMinutesDesc`)
        )}
        align="center"
      >
        <div className="sparo-func-agent-config__row-control">
          <NumberField
            value={autoMemoryState[scope].minExtractIntervalMinutes}
            onChange={(value) => void saveMinExtractIntervalMinutes(scope, value)}
            min={0}
            max={24 * 60}
            step={1}
            unit={t('autoMemory.units.minutes')}
            disableWheel
            disabled={isSaving}
            size="small"
            variant="compact"
          />
        </div>
      </ConfigPageRow>
      <ConfigPageRow
        label={renderLabelWithInfo(
          t(`autoMemory.${scope}.forceExtractAfterPendingEligibleTurns`),
          t(`autoMemory.${scope}.forceExtractAfterPendingEligibleTurnsDesc`)
        )}
        align="center"
      >
        <div className="sparo-func-agent-config__row-control">
          <NumberField
            value={autoMemoryState[scope].forceExtractAfterPendingEligibleTurns}
            onChange={(value) =>
              void saveForceExtractAfterPendingEligibleTurns(scope, value)
            }
            min={0}
            max={1000}
            step={1}
            unit={t('autoMemory.units.turns')}
            disableWheel
            disabled={isSaving}
            size="small"
            variant="compact"
          />
        </div>
      </ConfigPageRow>
    </ConfigPageSection>
  );

  return (
    <ConfigPageLayout className="sparo-func-agent-config">
      <ConfigPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        extra={(
          <div className="sparo-func-agent-config__page-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={() => void handleToggleAllEnabled()}
              disabled={isSaving}
            >
              {areAllBackgroundFeaturesDisabled
                ? t('actions.enableAll')
                : t('actions.disableAll')}
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => void handleResetAll()}
              disabled={isSaving}
            >
              {t('actions.resetAll')}
            </Button>
          </div>
        )}
      />
      <ConfigPageContent className="sparo-func-agent-config__content">
        <ConfigPageMessage message={message} />
        {AUTO_MEMORY_SCOPES.map(renderScopeSection)}
        <ConfigPageSection
          title={t('hostScan.title')}
          description={t('hostScan.hint')}
        >
          <ConfigPageRow
            label={renderLabelWithInfo(
              t('hostScan.enable.label'),
              t('hostScan.enable.description')
            )}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <Switch
                checked={hostScanConfig.auto_scan_enabled}
                onChange={(event) => void handleHostScanEnabledChange(event.target.checked)}
                disabled={isSaving}
                size="small"
              />
            </div>
          </ConfigPageRow>
          <ConfigPageRow
            label={renderLabelWithInfo(
              t('hostScan.interval.label'),
              t('hostScan.interval.description')
            )}
            align="center"
          >
            <div className="sparo-func-agent-config__row-control">
              <Select
                value={String(hostScanConfig.auto_scan_interval_days)}
                onChange={(value) => void handleHostScanIntervalChange(value as string)}
                options={hostScanIntervalOptions}
                disabled={isSaving || !hostScanConfig.auto_scan_enabled}
              />
            </div>
          </ConfigPageRow>
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default MemoryConfig;
