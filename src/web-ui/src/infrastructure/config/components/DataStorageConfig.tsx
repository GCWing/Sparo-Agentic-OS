import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/design-system';
import { storageAPI, systemFsAPI, type StorageStats } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageLoading,
  ConfigPageSection,
} from './common';
import StorageOverviewChart from './StorageOverviewChart';
import StorageResetSection from './StorageResetSection';
import './DataStorageConfig.scss';

const log = createLogger('DataStorageConfig');

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

  const loadStats = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      setStats(await storageAPI.getStorageStatistics());
    } catch (loadError) {
      log.error('Failed to load storage statistics', { error: loadError });
      setError(t('messages.loadFailed'));
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
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

  const overviewSegments = useMemo(
    () => categories.map(category => ({
      id: category.id,
      label: t(`categoryLabels.${category.id}`, { defaultValue: category.label }),
      path: category.path,
      sizeMb: category.sizeMb,
    })),
    [categories, t]
  );

  const handleOpenCategoryPath = useCallback(async (path: string) => {
    try {
      await systemFsAPI.revealInOs(path);
    } catch (openError) {
      log.error('Failed to open storage folder', { path, error: openError });
      setError(t('messages.openFolderFailed'));
    }
  }, [t]);

  return (
    <ConfigPageLayout className="sparo-data-storage-config">
      <ConfigPageHeader title={t('title')} description={t('subtitle')} />

      <ConfigPageContent>
        {loading ? (
          <ConfigPageLoading text={t('loading')} />
        ) : error && !stats ? (
          <div className="sparo-data-storage-config__status" role="alert">
            <Alert type="error" message={error} />
          </div>
        ) : (
          <>
            {error ? (
              <div className="sparo-data-storage-config__status" role="alert">
                <Alert type="error" message={error} />
              </div>
            ) : null}
            {result ? (
              <div className="sparo-data-storage-config__status" role="status">
                <Alert type="success" message={result} />
              </div>
            ) : null}

            <ConfigPageSection title={t('sections.usage')}>
              <StorageOverviewChart
                totalMb={stats?.totalSizeMb ?? 0}
                totalLabel={t('metrics.total')}
                segments={overviewSegments}
                formatSize={formatMb}
                formatShare={formatPercent}
                emptyLabel={t('empty')}
                openFolderLabel={t('actions.openFolderTooltip')}
                onOpenPath={handleOpenCategoryPath}
              />
            </ConfigPageSection>

            <StorageResetSection
              resetting={resetting}
              onResettingChange={setResetting}
              onResetSuccess={(message) => {
                setError(null);
                setResult(message);
                void loadStats({ silent: true });
              }}
              onResetError={(message) => {
                setResult(null);
                setError(message);
              }}
            />
          </>
        )}
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default DataStorageConfig;
