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
import { ToolStructuredDetails } from './ToolStructuredDetails';
import './DefaultToolCard.scss';

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
  const { toolCall, toolResult, status, requiresConfirmation, userConfirmed } = toolItem;
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
    status === 'streaming' ||
    (status === 'running' && config.resultDisplayType === 'detailed');
  const shouldUseCompactFallback =
    !shouldUsePreviewFallback &&
    !requiresConfirmation &&
    !hasError &&
    isLightweightFallbackValue(filteredInput) &&
    isLightweightFallbackValue(toolResult?.result);
  const showConfirmationActions = requiresConfirmation && !userConfirmed &&
    status !== 'completed' &&
    status !== 'cancelled' &&
    status !== 'error';
  const canExpand = hasInput || hasResult || hasError || showConfirmationActions;

  const handleConfirm = () => {
    onConfirm?.(toolCall?.input);
  };

  const handleReject = () => {
    onReject?.();
  };

  const getStatusText = () => {
    if (requiresConfirmation && !userConfirmed) {
      return t('toolCards.default.waitingConfirm');
    }

    const progressMessage = (toolItem as any)._progressMessage;
    if (progressMessage && (status === 'running' || status === 'streaming')) {
      return progressMessage;
    }

    switch (status) {
      case 'streaming':
      case 'running':
        return t('toolCards.default.executing');
      case 'completed':
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
    if (requiresConfirmation && !userConfirmed) {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.waitingConfirm')} - ${preview}`
        : t('toolCards.default.waitingConfirm');
    }

    const progressMessage = (toolItem as any)._progressMessage;
    if (progressMessage && (status === 'running' || status === 'streaming')) {
      return progressMessage;
    }

    if (status === 'completed') {
      const preview = getInlinePreview(toolResult?.result) || getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.completed')} - ${preview}`
        : t('toolCards.default.completed');
    }

    if (status === 'error') {
      return errorMessage || t('toolCards.default.failed');
    }

    if (status === 'running' || status === 'streaming') {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.executing')} - ${preview}`
        : t('toolCards.default.executing');
    }

    if (status === 'pending' || status === 'preparing') {
      const preview = getInlinePreview(filteredInput);
      return preview
        ? `${t('toolCards.default.preparing')} - ${preview}`
        : t('toolCards.default.preparing');
    }

    return getStatusText();
  };

  const showConfirmationHighlight = requiresConfirmation && !userConfirmed &&
    status !== 'completed' &&
    status !== 'cancelled' &&
    status !== 'error';

  const expandedContent = canExpand ? (
    <ToolStructuredDetails
      rows={[
        {
          label: t('toolCards.common.inputParams'),
          value: hasInput ? <ToolJsonPreview value={filteredInput} /> : null,
          hidden: !hasInput,
        },
        {
          label: t('toolCards.common.executionResult'),
          value: hasResult && toolResult?.success !== false ? <ToolJsonPreview value={toolResult?.result} /> : null,
          hidden: !hasResult || toolResult?.success === false,
        },
      ]}
    >
      {showConfirmationActions && (
        <ToolActionGroup
          onConfirm={handleConfirm}
          onReject={handleReject}
          confirmLabel={t('toolCards.mcp.confirmExecute')}
          rejectLabel={t('toolCards.mcp.cancel')}
          confirmDisabled={status === 'streaming'}
          rejectDisabled={status === 'streaming'}
        />
      )}
    </ToolStructuredDetails>
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
        isFailed={status === 'error' || toolResult?.success === false}
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
      isFailed={status === 'error' || toolResult?.success === false}
      requiresConfirmation={showConfirmationHighlight}
      className={`default-tool-card ${showConfirmationHighlight ? 'requires-confirmation' : ''}`}
      />
  );
};


