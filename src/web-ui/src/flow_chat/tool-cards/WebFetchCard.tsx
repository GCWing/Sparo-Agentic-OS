/**
 * Compact display for WebFetch.
 */

import React, { useMemo } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design-system';
import { systemAPI } from '../../infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import './WebFetchCard.scss';

const log = createLogger('WebFetchCard');

const CONTENT_PREVIEW_CHARS = 2600;

interface WebFetchResultView {
  url: string;
  displayHost: string;
  displayPath: string;
  format: string;
  content: string;
  contentLength: number;
}

function normalizeUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getUrlParts(url: string | null): { host: string; path: string } {
  if (!url) {
    return { host: '', path: '' };
  }

  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    return {
      host: parsed.hostname,
      path: path || '/',
    };
  } catch {
    return { host: url, path: '' };
  }
}

function getResultView(result: unknown, fallbackUrl: string | null, fallbackFormat: string): WebFetchResultView | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    if (typeof result === 'string' && result.trim()) {
      const parts = getUrlParts(fallbackUrl);
      return {
        url: fallbackUrl ?? '',
        displayHost: parts.host,
        displayPath: parts.path,
        format: fallbackFormat,
        content: result,
        contentLength: result.length,
      };
    }

    return null;
  }

  const data = result as Record<string, unknown>;
  const url = normalizeUrl(data.url) ?? fallbackUrl ?? '';
  const format = typeof data.format === 'string' && data.format.trim() ? data.format.trim() : fallbackFormat;
  const content = typeof data.content === 'string'
    ? data.content
    : typeof data.result === 'string'
      ? data.result
      : '';
  const contentLength = typeof data.content_length === 'number'
    ? data.content_length
    : typeof data.contentLength === 'number'
      ? data.contentLength
      : content.length;
  const parts = getUrlParts(url);

  return {
    url,
    displayHost: parts.host,
    displayPath: parts.path,
    format,
    content,
    contentLength,
  };
}

function formatLength(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 chars';
  if (value < 1000) return `${value} chars`;
  return `${(value / 1000).toFixed(1)}k chars`;
}

function truncateContent(content: string): { text: string; truncated: boolean } {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= CONTENT_PREVIEW_CHARS) {
    return { text: normalized, truncated: false };
  }

  return {
    text: `${normalized.slice(0, CONTENT_PREVIEW_CHARS).trimEnd()}\n...`,
    truncated: true,
  };
}

export const WebFetchCard: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;
  const inputUrl = normalizeUrl(toolCall?.input?.url);
  const inputFormat = typeof toolCall?.input?.format === 'string' ? toolCall.input.format : 'text';
  const urlParts = useMemo(() => getUrlParts(inputUrl), [inputUrl]);
  const resultView = useMemo(
    () => getResultView(toolResult?.result, inputUrl, inputFormat),
    [toolResult?.result, inputUrl, inputFormat],
  );

  const displayHost = resultView?.displayHost || urlParts.host || t('toolCards.webFetch.parsingUrl');
  const displayPath = resultView?.displayPath || urlParts.path;
  const contentPreview = useMemo(
    () => resultView ? truncateContent(resultView.content) : null,
    [resultView],
  );

  const handleOpenLink = async () => {
    const url = resultView?.url || inputUrl;
    if (!url) return;

    try {
      await systemAPI.openExternal(url);
    } catch (error) {
      log.error('Failed to open fetched URL', { url, error });
    }
  };

  const handleCopyContent = async () => {
    if (!resultView?.content) return;

    try {
      await navigator.clipboard.writeText(resultView.content);
    } catch (error) {
      log.error('Failed to copy fetched content', { error });
    }
  };

  const renderSummary = () => {
    if (viewState.phase === 'result') {
      const meta = resultView
        ? ` · ${resultView.format} · ${formatLength(resultView.contentLength)}`
        : '';
      return (
        <>
          {t('toolCards.webFetch.fetched')}: <span className="web-fetch-card__target">{displayHost}</span>{meta}
        </>
      );
    }

    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return (
        <>
          {t('toolCards.webFetch.fetching')} <span className="web-fetch-card__target">{displayHost}</span>...
        </>
      );
    }

    if (viewState.phase === 'preparing' || viewState.phase === 'ready') {
      return (
        <>
          {t('toolCards.webFetch.preparing')} <span className="web-fetch-card__target">{displayHost}</span>
        </>
      );
    }

    return displayHost;
  };

  const expandedContent = resultView && contentPreview ? (
    <div className="web-fetch-card__expanded" onClick={(event) => event.stopPropagation()}>
      <div className="web-fetch-card__meta">
        <span className="web-fetch-card__meta-chip">{resultView.displayHost}</span>
        {displayPath && <span className="web-fetch-card__meta-chip web-fetch-card__meta-chip--path">{displayPath}</span>}
        <span className="web-fetch-card__meta-chip">{resultView.format}</span>
        <span className="web-fetch-card__meta-chip">{formatLength(resultView.contentLength)}</span>
      </div>

      <div className="web-fetch-card__content-preview">
        <pre>{contentPreview.text}</pre>
        {contentPreview.truncated && (
          <span className="web-fetch-card__truncated">{t('toolCards.common.truncated')}</span>
        )}
      </div>

      <div className="web-fetch-card__actions">
        {resultView.url && (
          <Button type="button" size="small" variant="secondary" onClick={handleOpenLink}>
            <ExternalLink size={12} />
            <span>{t('toolCards.webFetch.openLink')}</span>
          </Button>
        )}
        {resultView.content && (
          <Button type="button" size="small" variant="secondary" onClick={handleCopyContent}>
            <Copy size={12} />
            <span>{t('toolCards.webFetch.copyContent')}</span>
          </Button>
        )}
      </div>
    </div>
  ) : undefined;

  if (viewState.phase === 'error') {
    return null;
  }

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="web-fetch-card"
      summary={renderSummary()}
      primaryAction={(resultView?.url || inputUrl) ? {
        icon: <ExternalLink size={12} />,
        label: t('toolCards.webFetch.openLink'),
        onClick: handleOpenLink,
      } : undefined}
      expandedContent={expandedContent}
      onExpand={onExpand}
    />
  );
};
