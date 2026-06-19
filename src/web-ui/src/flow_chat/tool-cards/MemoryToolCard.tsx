import React, { useMemo } from 'react';
import { Check, Clock3, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState, type ToolPresentationPhase } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import './MemoryToolCard.scss';

type JsonRecord = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

interface MemoryPayload {
  action?: string;
  scope?: string;
  memoryType?: string;
  content?: string;
}

function parseData(value: unknown): unknown {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(record: JsonRecord | null | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractRecord(rawValue: unknown): JsonRecord | null {
  const parsed = parseData(rawValue);
  const record = asRecord(parsed);
  if (!record) return null;

  const data = asRecord(record.data);
  const result = asRecord(record.result);

  return result ?? data ?? record;
}

function normalizePayload(rawInput: unknown, rawResult: unknown): MemoryPayload {
  const input = extractRecord(rawInput);
  const result = extractRecord(rawResult);
  const journalRecord = asRecord(result?.record);

  return {
    action: stringValue(result, 'action') ?? stringValue(input, 'action'),
    scope: stringValue(result, 'scope'),
    memoryType:
      stringValue(journalRecord, 'type') ??
      stringValue(result, 'type') ??
      stringValue(input, 'type'),
    content:
      stringValue(journalRecord, 'content') ??
      stringValue(result, 'content') ??
      stringValue(input, 'content'),
  };
}

function titleize(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function truncateInline(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function memoryTypeLabel(t: Translate, memoryType?: string): string {
  const key = memoryType?.trim().toLowerCase() || 'unknown';
  return t(`toolCards.memory.types.${key}`, {
    defaultValue: titleize(memoryType, t('toolCards.memory.types.unknown')),
  });
}

function scopeLabel(t: Translate, scope?: string): string | undefined {
  const key = scope?.trim().toLowerCase();
  if (!key) return undefined;
  return t(`toolCards.memory.scopes.${key}`, {
    defaultValue: titleize(scope, t('toolCards.memory.scopes.unknown')),
  });
}

function HeaderStatusIcon({ phase }: { phase: ToolPresentationPhase }) {
  if (phase === 'running' || phase === 'receiving_input' || phase === 'preparing' || phase === 'ready') {
    return <DotMatrixLoader size="tiny" className="memory-tool-card__loader" />;
  }

  if (phase === 'error' || phase === 'cancelled' || phase === 'interrupted') {
    return <XCircle size={13} />;
  }

  if (phase === 'result') {
    return <Check size={13} className="memory-tool-card__done-icon" />;
  }

  return <Clock3 size={13} />;
}

function renderSummary(
  t: Translate,
  phase: ToolPresentationPhase,
  payload: MemoryPayload,
  error?: string,
): React.ReactNode {
  if (phase === 'error') {
    return error || t('toolCards.memory.failed');
  }
  if (phase === 'cancelled') {
    return t('toolCards.memory.cancelled');
  }
  if (phase === 'interrupted') {
    return t('toolCards.memory.interrupted');
  }
  if (phase === 'running' || phase === 'receiving_input') {
    return t('toolCards.memory.saving');
  }
  if (phase === 'preparing' || phase === 'ready') {
    return t('toolCards.memory.preparing');
  }

  const content = payload.content ? truncateInline(payload.content) : '';
  const typeLabel = memoryTypeLabel(t, payload.memoryType);

  if (!content) {
    return t('toolCards.memory.saved');
  }

  return (
    <span className="memory-tool-card__summary">
      <span className="memory-tool-card__summary-prefix">
        {t('toolCards.memory.savedWithType', { type: typeLabel })}
      </span>
      <span className="memory-tool-card__summary-content" title={payload.content}>
        {content}
      </span>
    </span>
  );
}

export const MemoryToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const payload = useMemo(
    () => normalizePayload(toolCall?.input, toolResult?.result),
    [toolCall?.input, toolResult?.result],
  );
  const resolvedScopeLabel = scopeLabel(t, payload.scope);
  const hasExpandedContent = Boolean(payload.content || resolvedScopeLabel || toolResult?.error);

  const expandedContent = hasExpandedContent ? (
    <div className="memory-tool-card__expanded" onClick={event => event.stopPropagation()}>
      {payload.content && (
        <section className="memory-tool-card__section">
          <div className="memory-tool-card__section-label">
            {t('toolCards.memory.remembered')}
          </div>
          <p className="memory-tool-card__content">{payload.content}</p>
        </section>
      )}
      {resolvedScopeLabel && (
        <section className="memory-tool-card__section memory-tool-card__section--scope">
          <span className="memory-tool-card__section-label">
            {t('toolCards.memory.appliesTo')}
          </span>
          <span className="memory-tool-card__scope-value">{resolvedScopeLabel}</span>
        </section>
      )}
      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </div>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="memory-tool-card"
      statusIcon={<HeaderStatusIcon phase={viewState.phase} />}
      action={`${t('toolCards.memory.title')}:`}
      summary={renderSummary(t, viewState.phase, payload, toolResult?.error)}
      extra={resolvedScopeLabel ? (
        <span className="memory-tool-card__scope">{resolvedScopeLabel}</span>
      ) : undefined}
      expandedContent={expandedContent}
    />
  );
});

MemoryToolCard.displayName = 'MemoryToolCard';
