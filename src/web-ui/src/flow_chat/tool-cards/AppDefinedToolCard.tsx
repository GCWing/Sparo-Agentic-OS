import React, { useMemo } from 'react';
import {
  BarChart3,
  Check,
  Crosshair,
  Download,
  Eye,
  FilePlus,
  Film,
  FolderOpen,
  History,
  Info,
  Layers,
  Palette,
  Presentation,
  Redo2,
  RefreshCw,
  Save,
  Smartphone,
  Table2,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AppDefinedToolCardField,
  AppDefinedToolCardSpec,
  ToolCardProps,
} from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate, DetailToolTemplate } from './templates';
import { ToolActionGroup } from './ToolActionGroup';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolJsonPreview } from './ToolJsonPreview';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import './AppDefinedToolCard.scss';

const APP_DEFINED_TOOL_ICONS: Record<string, LucideIcon> = {
  BarChart: BarChart3,
  Check,
  Crosshair,
  Download,
  Eye,
  FilePlus,
  Film,
  FolderOpen,
  History,
  Info,
  Layers,
  Palette,
  Presentation,
  Redo2,
  RefreshCw,
  Save,
  Smartphone,
  Table: Table2,
  Undo2,
  X,
};

export function parseData(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return {};
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return value;
  }
}

export function readPath(source: unknown, path?: string[]): unknown {
  if (!path?.length) return undefined;
  return path.reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

export function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function hasVisibleValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function interpolate(template: string | undefined, values: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = readPath(values, key.split('.'));
    return stringifyValue(value) ?? '';
  });
}

export function resolveFieldValue(field: AppDefinedToolCardField, inputData: unknown, resultData: unknown): unknown {
  return (
    readPath(resultData, field.path) ??
    readPath(resultData, field.resultPath) ??
    readPath(inputData, field.inputPath)
  );
}

export function resolveBridgeError(resultData: unknown, toolError?: string): string | undefined {
  if (toolError) return toolError;

  const bridgeStatus = stringifyValue(readPath(resultData, ['bridge', 'status']));
  if (bridgeStatus !== 'failed' && bridgeStatus !== 'cancelled') {
    return undefined;
  }

  return (
    stringifyValue(readPath(resultData, ['bridge', 'output', 'error', 'message'])) ??
    stringifyValue(readPath(resultData, ['bridge', 'output', 'error'])) ??
    stringifyValue(readPath(resultData, ['bridge', 'output', 'message'])) ??
    stringifyValue(readPath(resultData, ['bridge', 'output', 'reason'])) ??
    stringifyValue(readPath(resultData, ['bridge', 'stderr']))
  );
}

export function resolveOutputData(resultData: unknown): unknown {
  return (
    readPath(resultData, ['bridge', 'output']) ??
    readPath(resultData, ['result']) ??
    readPath(resultData, ['output']) ??
    resultData
  );
}

export function resolveSummary(
  card: AppDefinedToolCardSpec,
  phase: ReturnType<typeof getToolViewState>['phase'],
  values: Record<string, unknown>,
  fallback: {
    preparing: string;
    running: string;
    confirming: string;
    completed: string;
    failed: string;
    cancelled: string;
  },
): string {
  const bridgeStatus = stringifyValue(readPath(values, ['status']));
  if (bridgeStatus === 'failed') {
    return interpolate(card.summary?.failed, values) ?? fallback.failed;
  }
  if (bridgeStatus === 'cancelled') {
    return interpolate(card.summary?.cancelled, values) ?? fallback.cancelled;
  }
  if (phase === 'confirming') {
    return interpolate(card.summary?.confirming, values) ?? fallback.confirming;
  }
  if (phase === 'result') {
    return (
      stringifyValue(readPath(values, ['output', 'summary'])) ??
      interpolate(card.summary?.completed, values) ??
      fallback.completed
    );
  }
  if (phase === 'running' || phase === 'receiving_input') {
    return interpolate(card.summary?.running, values) ?? fallback.running;
  }
  if (phase === 'cancelled') {
    return interpolate(card.summary?.cancelled, values) ?? fallback.cancelled;
  }
  if (phase === 'error' || phase === 'interrupted') {
    return interpolate(card.summary?.failed, values) ?? fallback.failed;
  }
  return interpolate(card.summary?.preparing, values) ?? fallback.preparing;
}

function resolveToolIcon(iconName?: string): React.ReactNode {
  const Icon = (iconName && APP_DEFINED_TOOL_ICONS[iconName]) || Wrench;
  return <Icon size={16} strokeWidth={1.8} />;
}

function familyClassName(family?: string): string | undefined {
  if (!family) return undefined;
  const normalized = family.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized ? `app-defined-tool-card--${normalized}` : undefined;
}

function resolvePrimaryColor(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  // Older component manifests used this pre-token name. Keep their intent
  // while resolving onto the public runtime token that actually exists.
  if (normalized === 'var(--ds-tool-family-agent-component-fg)') {
    return 'var(--ds-tool-family-agent-fg)';
  }

  return /^var\(--ds-[a-z0-9-]+\)$/i.test(normalized) ? normalized : undefined;
}

function localeCandidates(locale?: string): string[] {
  const normalized = locale?.trim().replace(/_/g, '-');
  if (!normalized) return [];
  const language = normalized.split('-')[0].toLowerCase();
  const languageFallback = language === 'zh'
    ? 'zh-CN'
    : language === 'en'
      ? 'en-US'
      : undefined;
  return Array.from(new Set([normalized, languageFallback, language].filter(Boolean) as string[]));
}

export function resolveLocalizedCard(
  card: AppDefinedToolCardSpec,
  locale?: string,
): AppDefinedToolCardSpec {
  const localeEntries = Object.entries(card.locales ?? {});
  const localized = localeCandidates(locale)
    .map(candidate => localeEntries.find(([key]) => key.toLowerCase() === candidate.toLowerCase())?.[1])
    .find(Boolean);
  if (!localized) return card;

  return {
    ...card,
    ...localized,
    summary: localized.summary ? { ...card.summary, ...localized.summary } : card.summary,
    fields: card.fields?.map((field, index) => ({
      ...field,
      label: localized.fields?.[index]?.label?.trim() || field.label,
    })),
    locales: card.locales,
  };
}

export const AppDefinedToolCard: React.FC<ToolCardProps> = React.memo(({
  toolItem,
  config,
  onConfirm,
  onReject,
}) => {
  const { t, i18n } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const card = useMemo(
    () => resolveLocalizedCard(config.extensionCard ?? {}, i18n.language),
    [config.extensionCard, i18n.language],
  );
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const inputData = useMemo(() => parseData(toolCall?.input), [toolCall?.input]);
  const resultData = useMemo(() => parseData(toolResult?.result), [toolResult?.result]);
  const outputData = resolveOutputData(resultData);
  const templateValues = useMemo(() => ({
    input: inputData,
    result: resultData,
    output: resolveOutputData(resultData),
    action: readPath(resultData, ['action']) ?? readPath(resultData, ['bridge', 'action']) ?? readPath(inputData, ['action']),
    status: readPath(resultData, ['status']) ?? readPath(resultData, ['bridge', 'status']),
    runId: readPath(resultData, ['run_id']) ?? readPath(resultData, ['bridge', 'run_id']) ?? readPath(inputData, ['runId']),
  }), [inputData, resultData]);
  const bridgeStatus = stringifyValue(readPath(templateValues, ['status']));
  const isConfirming = viewState.phase === 'confirming';
  const isCancelled = viewState.phase === 'cancelled'
    || bridgeStatus === 'cancelled'
    || status === 'cancelled';
  const isFailed = !isCancelled && (
    viewState.phase === 'error'
    || bridgeStatus === 'failed'
    || toolResult?.success === false
    || status === 'error'
  );
  const errorMessage = resolveBridgeError(resultData, toolResult?.error)
    ?? (isFailed ? t('toolCards.default.failed') : undefined);
  const presentationPhase = isCancelled
    ? 'cancelled'
    : isFailed
      ? 'error'
      : viewState.phase;
  const displayStatus = isCancelled
    ? 'cancelled'
    : isFailed
      ? 'error'
      : status;

  const resolvedFields = (card.fields ?? [])
    .map(field => ({ field, value: resolveFieldValue(field, inputData, resultData) }))
    .filter(({ value }) => hasVisibleValue(value));
  const textFields = resolvedFields.filter(({ field }) => field.format !== 'json');
  const jsonFields = resolvedFields.filter(({ field }) => field.format === 'json');
  const fallbackOutput = resolvedFields.length === 0 && hasVisibleValue(outputData) ? outputData : undefined;
  const hasExpandedContent = resolvedFields.length > 0 || fallbackOutput !== undefined || Boolean(errorMessage);

  const summary = resolveSummary(card, presentationPhase, templateValues, {
    preparing: t('toolCards.default.preparing'),
    running: t('toolCards.default.executing'),
    confirming: t('toolCards.default.waitingConfirm'),
    completed: t('toolCards.default.completed'),
    failed: t('toolCards.default.failed'),
    cancelled: t('toolCards.default.cancelled'),
  });

  const confirmationActions = isConfirming && (onConfirm || onReject) ? (
    <ToolActionGroup
      className="app-defined-tool-card__actions"
      onConfirm={onConfirm ? () => onConfirm(toolCall?.input) : undefined}
      onReject={onReject ? () => onReject() : undefined}
      confirmLabel={t('toolCards.mcp.confirmExecute')}
      rejectLabel={t('toolCards.mcp.cancel')}
      confirmDisabled={!viewState.canConfirm}
      rejectDisabled={!viewState.canReject}
    />
  ) : null;

  const expandedContent = hasExpandedContent ? (
    <ToolStructuredDetails
      rows={textFields.map(({ field, value }) => ({
        label: `${field.label}:`,
        value: stringifyValue(value),
      }))}
      className="app-defined-tool-card__details"
    >
      {jsonFields.map(({ field, value }) => (
        <div key={`${field.label}-${field.resultPath?.join('.') ?? field.inputPath?.join('.') ?? ''}`} className="app-defined-tool-card__json-field">
          <div className="app-defined-tool-card__json-label">{field.label}</div>
          <ToolJsonPreview value={value} maxChars={3200} />
        </div>
      ))}
      {fallbackOutput !== undefined && (
        <ToolJsonPreview value={fallbackOutput} maxChars={3200} />
      )}
      {errorMessage && <ToolErrorBlock message={errorMessage} />}
    </ToolStructuredDetails>
  ) : undefined;
  const errorContent = errorMessage ? <ToolErrorBlock message={errorMessage} /> : undefined;

  const visibleBridgeStatus = bridgeStatus && !['completed', 'failed', 'cancelled'].includes(bridgeStatus)
    ? bridgeStatus
    : undefined;
  const headerExtra = visibleBridgeStatus || confirmationActions ? (
    <>
      {visibleBridgeStatus && <span className="app-defined-tool-card__bridge-status">{visibleBridgeStatus}</span>}
      {confirmationActions}
    </>
  ) : undefined;
  const rootClassName = [
    'app-defined-tool-card',
    familyClassName(card.family),
    isConfirming ? 'requires-confirmation' : '',
  ].filter(Boolean).join(' ');
  const primaryColor = resolvePrimaryColor(config.primaryColor);
  const rootStyle = primaryColor
    ? ({ '--app-defined-tool-accent': primaryColor } as React.CSSProperties)
    : undefined;
  const title = card.title ?? card.displayName ?? config.displayName;
  const icon = resolveToolIcon(card.icon ?? config.icon);
  // Excel Live keeps the same compact, single-row rhythm as file writes;
  // structured workbook/range payloads remain available through disclosure.
  const useDetailTemplate = card.family !== 'excel-live'
    && (card.template === 'detail' || config.displayMode === 'detailed');

  return (
    <div className={rootClassName} style={rootStyle}>
      {useDetailTemplate ? (
        <DetailToolTemplate
          toolId={toolItem.id ?? toolCall?.id}
          toolName={toolItem.toolName}
          status={displayStatus}
          icon={icon}
          action={title}
          subject={summary}
          extra={headerExtra}
          expandedContent={expandedContent}
          errorContent={errorContent}
          isFailed={displayStatus === 'error'}
          requiresConfirmation={isConfirming}
          className="app-defined-tool-card__template"
        />
      ) : (
        <DefaultToolCardTemplate
          toolId={toolItem.id ?? toolCall?.id}
          toolName={toolItem.toolName}
          status={displayStatus}
          action={`${title}:`}
          summary={summary}
          extra={headerExtra}
          expandedContent={expandedContent}
          className="app-defined-tool-card__template"
        />
      )}
    </div>
  );
});
