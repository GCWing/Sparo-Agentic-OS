/**
 * Default tool card component
 * Used for tool types without specific customization
 */

import React, { useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate, DetailToolTemplate, PreviewStreamToolTemplate } from './templates';
import { ToolActionGroup } from './ToolActionGroup';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolJsonPreview } from './ToolJsonPreview';
import { ToolPreviewFrame } from './ToolPreviewFrame';
import { getToolViewState } from '../runtime/toolViewState';
import './DefaultToolCard.scss';

const LONG_TEXT_PREVIEW_CHARS = 1600;
const FIELD_PREVIEW_CHARS = 180;
const MAX_OBJECT_FIELDS = 8;
const MAX_ARRAY_ITEMS = 8;

function sanitizeToolInput(input: any): any {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input;
  if (typeof input !== 'object') return input;

  return Object.entries(input).reduce((acc, [key, value]) => {
    if (!key.startsWith('_')) {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);
}

function hasVisibleValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function getInlinePreview(value: any): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => !key.startsWith('_'));
    if (entries.length === 0) return null;

    const [firstKey, firstValue] = entries[0];
    const nestedPreview = getInlinePreview(firstValue);
    return nestedPreview ? `${firstKey}: ${nestedPreview}` : `Object(${entries.length})`;
  }

  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getVisibleEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).filter(([key, nested]) => !key.startsWith('_') && hasVisibleValue(nested));
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function truncateText(value: string, maxChars = LONG_TEXT_PREVIEW_CHARS): { text: string; truncated: boolean } {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }

  return { text: `${normalized.slice(0, maxChars).trimEnd()}\n...`, truncated: true };
}

function getTextLikeEntry(value: Record<string, unknown>): [string, string] | null {
  const preferredKeys = ['content', 'text', 'output', 'body', 'markdown', 'raw', 'result'];
  for (const key of preferredKeys) {
    const nested = value[key];
    if (typeof nested === 'string' && nested.trim()) {
      return [key, nested];
    }
  }

  return null;
}

function formatFieldValue(value: unknown): string {
  const preview = getInlinePreview(value);
  if (!preview) return '';
  return preview.length > FIELD_PREVIEW_CHARS ? `${preview.slice(0, FIELD_PREVIEW_CHARS).trimEnd()}...` : preview;
}

function getResultPayload(toolResult: any): unknown {
  if (!toolResult || typeof toolResult !== 'object') {
    return toolResult;
  }

  return Object.prototype.hasOwnProperty.call(toolResult, 'result') ? toolResult.result : toolResult;
}

function renderScalarValue(value: unknown, truncatedLabel: string): React.ReactNode {
  if (typeof value === 'string') {
    const { text, truncated } = truncateText(value);
    return (
      <div className="default-tool-card__text-preview">
        <pre>{text}</pre>
        {truncated && <span className="default-tool-card__truncated">{truncatedLabel}</span>}
      </div>
    );
  }

  return (
    <span className="default-tool-card__scalar-value">
      {String(value)}
    </span>
  );
}

function renderFieldList(entries: Array<[string, unknown]>): React.ReactNode {
  return (
    <div className="default-tool-card__field-list">
      {entries.slice(0, MAX_OBJECT_FIELDS).map(([key, value]) => (
        <div className="default-tool-card__field" key={key}>
          <span className="default-tool-card__field-key">{key}</span>
          <span className="default-tool-card__field-value">{formatFieldValue(value)}</span>
        </div>
      ))}
      {entries.length > MAX_OBJECT_FIELDS && (
        <div className="default-tool-card__field default-tool-card__field--muted">
          <span className="default-tool-card__field-key">more</span>
          <span className="default-tool-card__field-value">+{entries.length - MAX_OBJECT_FIELDS} fields</span>
        </div>
      )}
    </div>
  );
}

function renderArrayValue(value: unknown[]): React.ReactNode {
  const simpleItems = value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));

  if (simpleItems) {
    return (
      <div className="default-tool-card__list">
        {value.slice(0, MAX_ARRAY_ITEMS).map((item, index) => (
          <div className="default-tool-card__list-item" key={`${index}-${String(item)}`}>
            {formatFieldValue(item)}
          </div>
        ))}
        {value.length > MAX_ARRAY_ITEMS && (
          <div className="default-tool-card__list-item default-tool-card__list-item--muted">
            +{value.length - MAX_ARRAY_ITEMS} more
          </div>
        )}
      </div>
    );
  }

  return <ToolJsonPreview value={value} maxChars={2400} className="default-tool-card__json-preview" />;
}

function renderGenericValue(value: unknown, truncatedLabel: string): React.ReactNode {
  if (!hasVisibleValue(value)) {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return renderScalarValue(value, truncatedLabel);
  }

  if (Array.isArray(value)) {
    return renderArrayValue(value);
  }

  if (isPlainObject(value)) {
    const textEntry = getTextLikeEntry(value);
    const entries = getVisibleEntries(value);
    const metadataEntries = textEntry
      ? entries.filter(([key]) => key !== textEntry[0])
      : entries;

    if (textEntry) {
      return (
        <div className="default-tool-card__value-stack">
          {metadataEntries.length > 0 && renderFieldList(metadataEntries)}
          {renderScalarValue(textEntry[1], truncatedLabel)}
        </div>
      );
    }

    if (entries.length <= MAX_OBJECT_FIELDS) {
      return renderFieldList(entries);
    }
  }

  return <ToolJsonPreview value={value} maxChars={2400} className="default-tool-card__json-preview" />;
}

function getResultMeta(result: unknown): React.ReactNode[] {
  if (!isPlainObject(result)) {
    if (typeof result === 'string') {
      return [`${normalizeText(result).length} chars`];
    }
    if (Array.isArray(result)) {
      return [`${result.length} items`];
    }
    return [];
  }

  const chips: React.ReactNode[] = [];
  const url = result.url;
  const format = result.format;
  const contentLength = result.content_length ?? result.contentLength;

  if (typeof url === 'string' && url.trim()) {
    try {
      const parsed = new URL(url);
      chips.push(parsed.hostname);
    } catch {
      chips.push(url);
    }
  }
  if (typeof format === 'string' && format.trim()) {
    chips.push(format);
  }
  if (typeof contentLength === 'number') {
    chips.push(`${contentLength} chars`);
  }

  return chips;
}

function isLightweightFallbackValue(value: any): boolean {
  if (!hasVisibleValue(value)) return true;
  if (typeof value === 'string') return value.length <= 240;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length <= 6 && value.every((item) => typeof item !== 'object' || item === null);
  if (typeof value === 'object') return Object.keys(value).filter((key) => !key.startsWith('_')).length <= 4;
  return true;
}

export const DefaultToolCard: React.FC<ToolCardProps> = ({
  toolItem,
  config,
  onConfirm,
  onReject,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolViewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const filteredInput = useMemo(() => sanitizeToolInput(toolCall?.input), [toolCall?.input]);
  const hasInput = useMemo(() => hasVisibleValue(filteredInput), [filteredInput]);
  const hasResult = toolResult !== undefined && toolResult !== null && config.resultDisplayType !== 'hidden';
  const errorMessage = toolResult?.success === false ? toolResult.error || t('toolCards.default.failed') : null;
  const hasError = Boolean(errorMessage);
  const progressMessage = (toolItem as any)._progressMessage;
  const progressLogs = (toolItem as any)._progressLogs;
  const hasProgressOutput = typeof progressMessage === 'string' && progressMessage.length > 0
    || (Array.isArray(progressLogs) && progressLogs.length > 0);
  const shouldUsePreviewFallback =
    hasProgressOutput ||
    toolViewState.phase === 'receiving_input' ||
    (toolViewState.phase === 'running' && config.resultDisplayType === 'detailed');
  const shouldUseCompactFallback =
    !shouldUsePreviewFallback &&
    toolViewState.phase !== 'confirming' &&
    !hasError &&
    isLightweightFallbackValue(filteredInput) &&
    isLightweightFallbackValue(toolResult?.result);
  const showConfirmationActions = toolViewState.phase === 'confirming';
  const canExpand = hasInput || hasResult || hasError || showConfirmationActions;

  const handleConfirm = () => {
    onConfirm?.(toolCall?.input);
  };

  const handleReject = () => {
    onReject?.();
  };

  const getStatusText = () => {
    if (toolViewState.phase === 'confirming') {
      return t('toolCards.default.waitingConfirm');
    }

    const progressMessage = (toolItem as any)._progressMessage;
    if (progressMessage && toolViewState.isLive) {
      return progressMessage;
    }

    switch (toolViewState.phase) {
      case 'receiving_input':
      case 'running':
        return t('toolCards.default.executing');
      case 'result':
        return t('toolCards.default.completed');
      case 'cancelled':
        return t('toolCards.default.cancelled');
      case 'error':
        return t('toolCards.default.failed');
      default:
        return t('toolCards.default.preparing');
    }
  };

  const getSummaryText = () => {
    if (toolViewState.phase === 'confirming') {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.waitingConfirm')} - ${preview}`
        : t('toolCards.default.waitingConfirm');
    }

    const progressMessage = (toolItem as any)._progressMessage;
    if (progressMessage && toolViewState.isLive) {
      return progressMessage;
    }

    if (toolViewState.phase === 'result') {
      const preview = getInlinePreview(toolResult?.result) || getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.completed')} - ${preview}`
        : t('toolCards.default.completed');
    }

    if (toolViewState.phase === 'error') {
      return errorMessage || t('toolCards.default.failed');
    }

    if (toolViewState.phase === 'running' || toolViewState.phase === 'receiving_input') {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.executing')} - ${preview}`
        : t('toolCards.default.executing');
    }

    if (toolViewState.phase === 'preparing' || toolViewState.phase === 'ready') {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.preparing')} - ${preview}`
        : t('toolCards.default.preparing');
    }

    return getStatusText();
  };

  const showConfirmationHighlight = toolViewState.phase === 'confirming';
  const resultPayload = getResultPayload(toolResult);
  const resultMeta = getResultMeta(resultPayload);
  const truncatedLabel = t('toolCards.common.truncated');

  const expandedContent = canExpand ? (
    <div
      className="default-tool-card__expanded"
      onClick={(event) => event.stopPropagation()}
    >
      {resultMeta.length > 0 && (
        <div className="default-tool-card__meta">
          {resultMeta.map((item, index) => (
            <span key={index} className="default-tool-card__meta-label">{item}</span>
          ))}
        </div>
      )}
      {hasInput && (
        <section className="default-tool-card__section">
          <div className="default-tool-card__section-label">{t('toolCards.common.inputParams')}</div>
          {renderGenericValue(filteredInput, truncatedLabel)}
        </section>
      )}
      {hasResult && toolResult?.success !== false && (
        <section className="default-tool-card__section default-tool-card__section--result">
          <div className="default-tool-card__section-label">{t('toolCards.common.executionResult')}</div>
          {renderGenericValue(resultPayload, truncatedLabel)}
        </section>
      )}
      {showConfirmationActions && (
        <ToolActionGroup
          onConfirm={handleConfirm}
          onReject={handleReject}
          confirmLabel={t('toolCards.mcp.confirmExecute')}
          rejectLabel={t('toolCards.mcp.cancel')}
          confirmDisabled={!toolViewState.canConfirm}
          rejectDisabled={!toolViewState.canReject}
        />
      )}
    </div>
  ) : undefined;

  const fallbackSubject = (
    <span className="default-tool-card__summary">
      {getSummaryText()}
    </span>
  );

  if (shouldUseCompactFallback) {
    return (
      <DefaultToolCardTemplate
        toolId={toolId}
        toolName={config.toolName}
        status={status}
        action={config.displayName}
        summary={fallbackSubject}
        extra={config.icon ? <span className="default-tool-card__icon-badge">{config.icon}</span> : undefined}
        expandedContent={expandedContent}
        className="default-tool-card default-tool-card--compact-fallback"
      />
    );
  }

  if (shouldUsePreviewFallback) {
    const previewContent = (
      <ToolPreviewFrame>
        {hasProgressOutput ? (
          <ToolJsonPreview value={Array.isArray(progressLogs) && progressLogs.length > 0 ? progressLogs : progressMessage} />
        ) : expandedContent}
      </ToolPreviewFrame>
    );

    return (
      <PreviewStreamToolTemplate
        toolId={toolId}
        toolName={config.toolName}
        status={status}
        icon={<Wrench size={16} />}
        action={config.displayName}
        subject={fallbackSubject}
        extra={config.icon ? <span className="default-tool-card__icon-badge">{config.icon}</span> : undefined}
        previewContent={previewContent}
        errorContent={hasError ? <ToolErrorBlock message={errorMessage} /> : undefined}
        isFailed={toolViewState.phase === 'error' || toolResult?.success === false}
        className="default-tool-card default-tool-card--preview-fallback"
      />
    );
  }

  return (
    <DetailToolTemplate
      toolId={toolId}
      toolName={config.toolName}
      status={status}
      icon={<Wrench size={16} />}
      action={config.displayName}
      subject={getSummaryText()}
      extra={config.icon ? <span className="default-tool-card__icon-badge">{config.icon}</span> : undefined}
      expandedContent={expandedContent}
      errorContent={hasError ? <ToolErrorBlock message={errorMessage} /> : undefined}
      isFailed={toolViewState.phase === 'error' || toolResult?.success === false}
      requiresConfirmation={showConfirmationHighlight}
      className={`default-tool-card ${showConfirmationHighlight ? 'requires-confirmation' : ''}`}
      />
  );
};


