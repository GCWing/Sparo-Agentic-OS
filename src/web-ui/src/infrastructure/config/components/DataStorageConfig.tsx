import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, SegmentedControl, Switch } from '@/design-system';
import { storageAPI, type ResetMode, type StorageStats } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageLoading,
  ConfigPageRow,
  ConfigPageSection,
} from './common';
import './AIUsageConfig.scss';
import './DataStorageConfig.scss';

const log = createLogger('DataStorageConfig');
const CONFIRMATION_TEXT = 'RESET SPARO OS';

type ResetOptionKey = 'logs' | 'secrets' | 'browser';

/** Which extra-data options are meaningful per reset mode, and which are forced on. */
const MODE_OPTION_MATRIX: Record<ResetMode, { visible: ResetOptionKey[]; forced: ResetOptionKey[] }> = {
  soft: { visible: [], forced: [] },
  app_data: { visible: ['logs', 'secrets', 'browser'], forced: [] },
  factory: { visible: ['logs', 'secrets', 'browser'], forced: ['secrets', 'browser'] },
};

const MODE_DETAIL_KEY: Record<ResetMode, string> = {
  soft: 'soft',
  app_data: 'appData',
  factory: 'factory',
};

function formatMb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  if (value >= 1024) {
    return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} MB`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1) return '<1';
  return `${Math.round(value)}`;
}

const DataStorageConfig: React.FC = () => {
  const { t } = useTranslation('settings/data-storage');
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [mode, setMode] = useState<ResetMode>('app_data');
  const [createBackup, setCreateBackup] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [includeBrowserProfiles, setIncludeBrowserProfiles] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await storageAPI.getStorageStatistics());
    } catch (loadError) {
      log.error('Failed to load storage statistics', { error: loadError });
      setError(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const categories = useMemo(() => {
    const list = (stats?.categories ?? []).filter(category => category.sizeMb > 0.01);
    list.sort((a, b) => b.sizeMb - a.sizeMb);
    return list;
  }, [stats]);

  const trackedTotal = useMemo(
    () => categories.reduce((sum, category) => sum + category.sizeMb, 0),
    [categories]
  );
  const maxCategorySize = Math.max(1, ...categories.map(category => category.sizeMb));

  const optionMatrix = MODE_OPTION_MATRIX[mode];
  const showLogs = optionMatrix.visible.includes('logs');
  const showSecrets = optionMatrix.visible.includes('secrets');
  const showBrowser = optionMatrix.visible.includes('browser');
  const forcedSecrets = optionMatrix.forced.includes('secrets');
  const forcedBrowser = optionMatrix.forced.includes('browser');

  const handleReset = useCallback(async () => {
    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const resetResult = await storageAPI.resetApplicationData({
        mode,
        confirmation: CONFIRMATION_TEXT,
        createBackup,
        includeLogs: showLogs ? includeLogs : false,
        includeSecrets: forcedSecrets || (showSecrets && includeSecrets),
        includeBrowserProfiles: forcedBrowser || (showBrowser && includeBrowserProfiles),
        includeProjectLocalSparoDirs: [],
      });
      setResult(t('messages.resetComplete', {
        resetId: resetResult.resetId,
        size: formatMb(resetResult.bytesFreed / 1_048_576),
      }));
    } catch (resetError) {
      log.error('Failed to reset application data', { error: resetError });
      setError(t('messages.resetFailed'));
    } finally {
      setResetting(false);
    }
  }, [
    createBackup,
    forcedBrowser,
    forcedSecrets,
    includeBrowserProfiles,
    includeLogs,
    includeSecrets,
    mode,
    showBrowser,
    showLogs,
    showSecrets,
    t,
  ]);

  return (
    <ConfigPageLayout className="sparo-ai-usage-config sparo-data-storage-config">
      <ConfigPageHeader
        title={t('title')}
        extra={(
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => void loadStats()}
            disabled={loading || resetting}
          >
            {t('actions.refresh')}
          </Button>
        )}
      />

      <ConfigPageContent className="sparo-ai-usage-config__content">
        {loading ? (
          <ConfigPageLoading text={t('loading')} />
        ) : error && !stats ? (
          <div className="sparo-ai-usage-config__status" role="alert">{error}</div>
        ) : (
          <>
            {error ? (
              <div className="sparo-ai-usage-config__status" role="alert">{error}</div>
            ) : null}
            {result ? (
              <div className="sparo-ai-usage-config__status" role="status">{result}</div>
            ) : null}

            <ConfigPageSection title={t('sections.usage')}>
              <div className="sparo-ai-usage-config__metrics">
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.total')}</span>
                  <strong>{formatMb(stats?.totalSizeMb ?? 0)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.workspaces')}</span>
                  <strong>{formatMb(stats?.workspacesSizeMb ?? 0)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.agenticOs')}</span>
                  <strong>{formatMb(stats?.agenticOsSizeMb ?? 0)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.cache')}</span>
                  <strong>{formatMb(stats?.cacheSizeMb ?? 0)}</strong>
                </div>
              </div>
            </ConfigPageSection>

            <ConfigPageSection title={t('sections.categories')}>
              {categories.length === 0 ? (
                <div className="sparo-ai-usage-config__empty">{t('empty')}</div>
              ) : (
                <div className="sparo-ai-usage-config__bars">
                  {categories.map(category => {
                    const share = trackedTotal > 0 ? (category.sizeMb / trackedTotal) * 100 : 0;
                    return (
                      <div className="sparo-ai-usage-config__bar-row" key={category.id}>
                        <div className="sparo-ai-usage-config__bar-meta">
                          <span className="sparo-ai-usage-config__bar-label">
                            {t(`categoryLabels.${category.id}`, { defaultValue: category.label })}
                          </span>
                          <span
                            className="sparo-ai-usage-config__bar-count sparo-data-storage-config__path"
                            title={category.path}
                          >
                            {category.path}
                          </span>
                        </div>
                        <div className="sparo-ai-usage-config__bar-track" aria-hidden="true">
                          <div
                            className="sparo-ai-usage-config__bar-fill"
                            style={{ width: `${Math.max(4, Math.round((category.sizeMb / maxCategorySize) * 100))}%` }}
                          />
                        </div>
                        <div className="sparo-ai-usage-config__bar-values">
                          <span>{formatMb(category.sizeMb)}</span>
                          <span>{t('labels.share', { percent: formatPercent(share) })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ConfigPageSection>

            <ConfigPageSection title={t('sections.reset')}>
              <ConfigPageRow
                label={t('reset.mode.label')}
                description={t(`reset.details.${MODE_DETAIL_KEY[mode]}`)}
                multiline
              >
                <SegmentedControl
                  value={mode}
                  onChange={(value) => setMode(value as ResetMode)}
                  options={[
                    { value: 'soft', label: t('reset.mode.soft') },
                    { value: 'app_data', label: t('reset.mode.appData') },
                    { value: 'factory', label: t('reset.mode.factory') },
                  ]}
                  ariaLabel={t('reset.mode.label')}
                  stretch
                />
              </ConfigPageRow>

              <ConfigPageRow
                label={t('reset.options.backup.label')}
                description={t('reset.options.backup.description')}
                align="center"
              >
                <Switch
                  checked={createBackup}
                  onChange={(event) => setCreateBackup(event.currentTarget.checked)}
                  size="small"
                />
              </ConfigPageRow>

              {showLogs ? (
                <ConfigPageRow
                  label={t('reset.options.logs.label')}
                  description={t('reset.options.logs.description')}
                  align="center"
                >
                  <Switch
                    checked={includeLogs}
                    onChange={(event) => setIncludeLogs(event.currentTarget.checked)}
                    size="small"
                  />
                </ConfigPageRow>
              ) : null}

              {showSecrets ? (
                <ConfigPageRow
                  label={t('reset.options.secrets.label')}
                  description={forcedSecrets ? t('reset.options.forced') : t('reset.options.secrets.description')}
                  align="center"
                >
                  <Switch
                    checked={forcedSecrets || includeSecrets}
                    disabled={forcedSecrets}
                    onChange={(event) => setIncludeSecrets(event.currentTarget.checked)}
                    size="small"
                  />
                </ConfigPageRow>
              ) : null}

              {showBrowser ? (
                <ConfigPageRow
                  label={t('reset.options.browser.label')}
                  description={forcedBrowser ? t('reset.options.forced') : t('reset.options.browser.description')}
                  align="center"
                >
                  <Switch
                    checked={forcedBrowser || includeBrowserProfiles}
                    disabled={forcedBrowser}
                    onChange={(event) => setIncludeBrowserProfiles(event.currentTarget.checked)}
                    size="small"
                  />
                </ConfigPageRow>
              ) : null}

              <ConfigPageRow label={t('actions.reset')} align="center">
                <Button
                  type="button"
                  variant="danger"
                  size="small"
                  onClick={() => setConfirmResetOpen(true)}
                  disabled={resetting}
                >
                  {resetting ? t('actions.resetting') : t('actions.reset')}
                </Button>
              </ConfigPageRow>
            </ConfigPageSection>
          </>
        )}
      </ConfigPageContent>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        onConfirm={() => void handleReset()}
        title={t('resetDialog.title')}
        message={t('resetDialog.message')}
        type="error"
        confirmDanger
        confirmText={t('resetDialog.confirm')}
        cancelText={t('resetDialog.cancel')}
      />
    </ConfigPageLayout>
  );
};

export default DataStorageConfig;
