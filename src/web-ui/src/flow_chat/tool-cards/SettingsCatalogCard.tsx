import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates/DefaultToolCardTemplate';
import { getToolCardStatusFromViewState } from './toolStatus';
import './SettingsCatalogCard.scss';

type JsonRecord = Record<string, unknown>;
type CatalogAction = 'query' | 'get' | 'unknown';

interface CatalogResultItem {
  id: string;
  descriptor: JsonRecord;
  current: unknown;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resultPayload(value: unknown): unknown {
  const parsed = parseJsonValue(value);
  const record = asRecord(parsed);
  if (record && Object.prototype.hasOwnProperty.call(record, 'result')) {
    return parseJsonValue(record.result);
  }
  return parsed;
}

function normalizeAction(input: unknown): CatalogAction {
  const action = asRecord(parseJsonValue(input))?.action;
  return action === 'query' || action === 'get' ? action : 'unknown';
}

function humanizeIdentifier(value: unknown): string {
  if (typeof value !== 'string') return '';
  const segment = value.split('.').filter(Boolean).at(-1) ?? value;
  return segment.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function catalogResultItems(value: unknown): CatalogResultItem[] {
  const record = asRecord(resultPayload(value));
  if (!record) return [];

  const candidates = Array.isArray(record.settings)
    ? record.settings
    : record.descriptor
      ? [{ descriptor: record.descriptor, current: record.current }]
      : [];

  return candidates.flatMap((candidate, index) => {
    const item = asRecord(candidate);
    const descriptor = asRecord(item?.descriptor);
    if (!item || !descriptor) return [];
    const id = typeof descriptor.id === 'string' ? descriptor.id : `setting-${index}`;
    return [{ id, descriptor, current: item.current }];
  });
}

function optionLabel(descriptor: JsonRecord, value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!Array.isArray(descriptor.resolvedOptions)) return null;
  for (const candidate of descriptor.resolvedOptions) {
    const option = asRecord(candidate);
    if (option?.value === String(value) && typeof option.label === 'string') {
      return option.label;
    }
  }
  return null;
}

export const SettingsCatalogCard: React.FC<ToolCardProps> = ({ toolItem }) => {
  const { t, i18n } = useTranslation('flow-chat');
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const action = useMemo(() => normalizeAction(toolItem.toolCall?.input), [toolItem.toolCall?.input]);
  const items = useMemo(() => catalogResultItems(toolItem.toolResult?.result), [toolItem.toolResult?.result]);
  const input = asRecord(parseJsonValue(toolItem.toolCall?.input));

  const settingTitle = (item: CatalogResultItem): string => {
    const fallback = humanizeIdentifier(item.descriptor.id)
      || t('toolCards.settingsCatalog.results.unnamed');
    const presentation = asRecord(item.descriptor.presentation);
    return typeof presentation?.titleKey === 'string'
      ? String(i18n.t(presentation.titleKey, { defaultValue: fallback }))
      : fallback;
  };

  const settingLocation = (item: CatalogResultItem): string => {
    const presentation = asRecord(item.descriptor.presentation);
    const tabId = typeof presentation?.tabId === 'string' ? presentation.tabId : '';
    if (!tabId) return t('toolCards.settingsCatalog.results.otherLocation');
    return String(i18n.t(`settings/config-center:tabs.${tabId}`, {
      defaultValue: humanizeIdentifier(tabId),
    }));
  };

  const settingValue = (item: CatalogResultItem): string => {
    const stored = asRecord(item.current);
    if (!stored) return t('toolCards.settingsCatalog.results.notSet');
    if (stored.kind === 'secret') {
      return stored.configured === true
        ? t('toolCards.settingsCatalog.results.configured')
        : t('toolCards.settingsCatalog.results.notConfigured');
    }
    if (stored.kind !== 'value') return t('toolCards.settingsCatalog.results.defaultValue');

    const value = stored.value;
    const resolvedLabel = optionLabel(item.descriptor, value);
    if (resolvedLabel) return resolvedLabel;
    if (value === null || value === undefined || value === '') {
      return t('toolCards.settingsCatalog.results.notSet');
    }
    if (typeof value === 'boolean') {
      return t(value
        ? 'toolCards.settingsCatalog.results.enabled'
        : 'toolCards.settingsCatalog.results.disabled');
    }
    if (Array.isArray(value)) {
      return t('toolCards.settingsCatalog.results.itemCount', { count: value.length });
    }
    if (typeof value === 'object') {
      return t('toolCards.settingsCatalog.results.itemCount', {
        count: Object.keys(value as JsonRecord).length,
      });
    }
    return String(value);
  };

  const requestedSettingName = humanizeIdentifier(input?.settingId);
  const resolvedSettingName = items[0] ? settingTitle(items[0]) : requestedSettingName;
  const summary = (() => {
    if (viewState.phase === 'error') return t('toolCards.settingsCatalog.status.failed');
    if (viewState.phase === 'cancelled' || viewState.phase === 'interrupted') {
      return t('toolCards.settingsCatalog.status.cancelled');
    }
    if (viewState.phase !== 'result') {
      return action === 'get'
        ? t('toolCards.settingsCatalog.status.reading')
        : t('toolCards.settingsCatalog.status.searching');
    }
    if (action === 'get') {
      return resolvedSettingName
        ? t('toolCards.settingsCatalog.status.readOneNamed', { name: resolvedSettingName })
        : t('toolCards.settingsCatalog.status.readOne');
    }
    return t('toolCards.settingsCatalog.status.matched', { count: items.length });
  })();

  const actionLabel = t(`toolCards.settingsCatalog.actions.${action}`);
  const compactSummary = t('toolCards.settingsCatalog.summaryLine', {
    action: actionLabel,
    summary,
  });
  const expandedContent = viewState.phase === 'result' && items.length > 0 ? (
    <ul
      className="settings-catalog-card__results"
      aria-label={t('toolCards.settingsCatalog.results.listLabel')}
    >
      {items.map((item) => (
        <li className="settings-catalog-card__result" key={item.id}>
          <span className="settings-catalog-card__result-copy">
            <strong className="settings-catalog-card__result-title">{settingTitle(item)}</strong>
            <span className="settings-catalog-card__result-location">{settingLocation(item)}</span>
          </span>
          <span className="settings-catalog-card__result-value">
            <span className="settings-catalog-card__result-value-label">
              {t('toolCards.settingsCatalog.results.currentValue')}
            </span>
            <strong>{settingValue(item)}</strong>
          </span>
        </li>
      ))}
    </ul>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolItem.id}
      toolName={toolItem.toolName}
      status={getToolCardStatusFromViewState(viewState)}
      summary={compactSummary}
      expandedContent={expandedContent}
    />
  );
};

SettingsCatalogCard.displayName = 'SettingsCatalogCard';
