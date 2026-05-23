import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Select, SegmentedControl, Switch, type SelectOption } from '@/design-system';
import { tokenUsageAPI, type TokenUsageRecord, type TokenUsageTimeRange } from '@/infrastructure/api';
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

const log = createLogger('AIUsageConfig');

type UsageGroupBy = 'agent' | 'model' | 'time';

interface UsageGroup {
  id: string;
  label: string;
  input: number;
  output: number;
  cached: number;
  total: number;
  requests: number;
}

const RECENT_RECORD_LIMIT = 12;
const USAGE_RECORD_SAMPLE_LIMIT = 500;
const COMPACT_UNITS = ['', 'K', 'M', 'B', 'T', 'P'];

function compactId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  let scaled = Math.abs(value);
  let unitIndex = 0;
  while (scaled >= 1000 && unitIndex < COMPACT_UNITS.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }
  const fractionDigits = unitIndex === 0 || scaled >= 10 || Number.isInteger(scaled) ? 0 : 1;
  return `${sign}${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(scaled)}${COMPACT_UNITS[unitIndex]}`;
}

function formatTokens(value: number): string {
  return formatCompactNumber(value);
}

function formatCount(value: number): string {
  return formatCompactNumber(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createGroup(id: string, label: string): UsageGroup {
  return { id, label, input: 0, output: 0, cached: 0, total: 0, requests: 0 };
}

function addRecordToGroup(group: UsageGroup, record: TokenUsageRecord): void {
  group.input += record.inputTokens;
  group.output += record.outputTokens;
  group.cached += record.cachedTokens;
  group.total += record.totalTokens;
  group.requests += 1;
}

function groupRecords(records: TokenUsageRecord[], groupBy: UsageGroupBy, unknownLabel: string): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();

  for (const record of records) {
    const key =
      groupBy === 'agent'
        ? record.agentType || unknownLabel
        : groupBy === 'model'
          ? record.modelId || unknownLabel
          : formatDay(record.timestamp);

    const label = groupBy === 'time' ? key : key || unknownLabel;
    const group = groups.get(key) ?? createGroup(key, label);
    addRecordToGroup(group, record);
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}

function buildDailyTrend(records: TokenUsageRecord[]): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();

  for (const record of records) {
    const key = formatDay(record.timestamp);
    const group = groups.get(key) ?? createGroup(key, key);
    addRecordToGroup(group, record);
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((a, b) => a.id.localeCompare(b.id)).slice(-14);
}

const AIUsageConfig: React.FC = () => {
  const { t } = useTranslation('settings/ai-usage');
  const [timeRange, setTimeRange] = useState<TokenUsageTimeRange>('thisMonth');
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('agent');
  const [includeSubagent, setIncludeSubagent] = useState(true);
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [summary, setSummary] = useState({
    totalInput: 0,
    totalOutput: 0,
    totalCached: 0,
    totalTokens: 0,
    recordCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await tokenUsageAPI.getTokenUsage({
        timeRange,
        includeSubagent,
        limit: USAGE_RECORD_SAMPLE_LIMIT,
      });
      setRecords(response.records);
      setSummary({
        totalInput: response.summary.totalInput,
        totalOutput: response.summary.totalOutput,
        totalCached: response.summary.totalCached,
        totalTokens: response.summary.totalTokens,
        recordCount: response.summary.recordCount,
      });
    } catch (loadError) {
      log.error('Failed to load AI usage history', { error: loadError });
      setError(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [includeSubagent, t, timeRange]);

  const resetUsage = useCallback(async () => {
    setResetting(true);
    setError(null);
    try {
      await tokenUsageAPI.clearTokenUsage();
      setRecords([]);
      setSummary({
        totalInput: 0,
        totalOutput: 0,
        totalCached: 0,
        totalTokens: 0,
        recordCount: 0,
      });
    } catch (resetError) {
      log.error('Failed to reset AI usage history', { error: resetError });
      setError(t('messages.resetFailed'));
    } finally {
      setResetting(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const timeRangeOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'today', label: t('filters.timeRange.today') },
      { value: 'thisWeek', label: t('filters.timeRange.thisWeek') },
      { value: 'thisMonth', label: t('filters.timeRange.thisMonth') },
      { value: 'all', label: t('filters.timeRange.all') },
    ],
    [t]
  );

  const groupedUsage = useMemo(
    () => groupRecords(records, groupBy, t('labels.unknown')),
    [groupBy, records, t]
  );
  const maxGroupTotal = Math.max(1, ...groupedUsage.map(group => group.total));
  const dailyTrend = useMemo(() => buildDailyTrend(records), [records]);
  const maxTrendTotal = Math.max(1, ...dailyTrend.map(day => day.total));
  const recentRecords = useMemo(
    () => [...records]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, RECENT_RECORD_LIMIT),
    [records]
  );

  return (
    <ConfigPageLayout className="sparo-ai-usage-config">
      <ConfigPageHeader
        title={t('title')}
        extra={(
          <div className="sparo-ai-usage-config__header-actions">
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => void loadUsage()}
              disabled={loading || resetting}
            >
              <span className="sparo-ai-usage-config__button-label">
                <span>{t('actions.refresh')}</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="danger"
              size="small"
              onClick={() => setConfirmResetOpen(true)}
              disabled={loading || resetting || summary.recordCount === 0}
            >
              <span className="sparo-ai-usage-config__button-label">
                <span>{t('actions.reset')}</span>
              </span>
            </Button>
          </div>
        )}
      />

      <ConfigPageContent className="sparo-ai-usage-config__content">
        <ConfigPageSection title={t('sections.filters')}>
          <ConfigPageRow label={t('filters.timeRange.label')} align="center">
            <Select
              size="small"
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as TokenUsageTimeRange)}
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('filters.groupBy.label')} align="center">
            <SegmentedControl
              className="sparo-ai-usage-config__group-control"
              size="small"
              value={groupBy}
              onChange={(value) => setGroupBy(value as UsageGroupBy)}
              options={[
                { value: 'agent', label: t('filters.groupBy.agent') },
                { value: 'model', label: t('filters.groupBy.model') },
                { value: 'time', label: t('filters.groupBy.time') },
              ]}
              ariaLabel={t('filters.groupBy.label')}
              stretch
            />
          </ConfigPageRow>
          <ConfigPageRow
            label={t('filters.includeSubagent.label')}
            description={t('filters.includeSubagent.description')}
            align="center"
          >
            <Switch
              checked={includeSubagent}
              onChange={(event) => setIncludeSubagent(event.currentTarget.checked)}
            />
          </ConfigPageRow>
        </ConfigPageSection>

        {loading ? (
          <ConfigPageLoading text={t('loading')} />
        ) : error ? (
          <div className="sparo-ai-usage-config__status" role="alert">{error}</div>
        ) : (
          <>
            <ConfigPageSection title={t('sections.overview')}>
              <div className="sparo-ai-usage-config__metrics">
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.total')}</span>
                  <strong>{formatTokens(summary.totalTokens)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.input')}</span>
                  <strong>{formatTokens(summary.totalInput)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.output')}</span>
                  <strong>{formatTokens(summary.totalOutput)}</strong>
                </div>
                <div className="sparo-ai-usage-config__metric">
                  <span>{t('metrics.requests')}</span>
                  <strong>{formatCount(summary.recordCount)}</strong>
                </div>
              </div>
            </ConfigPageSection>

            <ConfigPageSection title={t('sections.trend')}>
              {dailyTrend.length === 0 ? (
                <div className="sparo-ai-usage-config__empty">{t('empty')}</div>
              ) : (
                <div className="sparo-ai-usage-config__trend">
                  {dailyTrend.map(day => (
                    <div className="sparo-ai-usage-config__trend-item" key={day.id}>
                      <div className="sparo-ai-usage-config__trend-value">
                        {formatTokens(day.total)}
                      </div>
                      <div className="sparo-ai-usage-config__trend-track" aria-hidden="true">
                        <div
                          className="sparo-ai-usage-config__trend-fill"
                          style={{ height: `${Math.max(6, Math.round((day.total / maxTrendTotal) * 100))}%` }}
                        />
                      </div>
                      <div className="sparo-ai-usage-config__trend-label">
                        {day.id.slice(5)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ConfigPageSection>

            <ConfigPageSection title={t(`sections.by.${groupBy}`)}>
              {groupedUsage.length === 0 ? (
                <div className="sparo-ai-usage-config__empty">{t('empty')}</div>
              ) : (
                <div className="sparo-ai-usage-config__bars">
                  {groupedUsage.slice(0, 8).map(group => (
                    <div className="sparo-ai-usage-config__bar-row" key={group.id}>
                      <div className="sparo-ai-usage-config__bar-meta">
                        <span className="sparo-ai-usage-config__bar-label">{group.label}</span>
                        <span className="sparo-ai-usage-config__bar-count">
                          {t('labels.requests', { count: group.requests })}
                        </span>
                      </div>
                      <div className="sparo-ai-usage-config__bar-track" aria-hidden="true">
                        <div
                          className="sparo-ai-usage-config__bar-fill"
                          style={{ width: `${Math.max(4, Math.round((group.total / maxGroupTotal) * 100))}%` }}
                        />
                      </div>
                      <div className="sparo-ai-usage-config__bar-values">
                        <span>{formatTokens(group.total)}</span>
                        <span>{t('labels.inOut', {
                          input: formatTokens(group.input),
                          output: formatTokens(group.output),
                        })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ConfigPageSection>

            <ConfigPageSection title={t('sections.recent')}>
              {recentRecords.length === 0 ? (
                <div className="sparo-ai-usage-config__empty">{t('empty')}</div>
              ) : (
                <div className="sparo-ai-usage-config__table">
                  <div className="sparo-ai-usage-config__table-head">
                    <span>{t('table.time')}</span>
                    <span>{t('table.agent')}</span>
                    <span>{t('table.model')}</span>
                    <span>{t('table.tokens')}</span>
                  </div>
                  {recentRecords.map(record => (
                    <div
                      className="sparo-ai-usage-config__table-row"
                      key={`${record.sessionId}-${record.turnId}-${record.timestamp}`}
                    >
                      <span>{formatDateTime(record.timestamp)}</span>
                      <span>{record.agentType || t('labels.unknown')}</span>
                      <span title={record.modelId}>{compactId(record.modelId)}</span>
                      <span>{formatTokens(record.totalTokens)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ConfigPageSection>
          </>
        )}
      </ConfigPageContent>
      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        onConfirm={() => void resetUsage()}
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

export default AIUsageConfig;
