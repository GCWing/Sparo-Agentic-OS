/**
 * Context compression display for Flow Chat.
 */

import React from 'react';
import { Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FlowToolItem } from '../types/flow-chat';
import { DetailToolTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { getToolViewState } from '../runtime/toolViewState';
import { getToolCardStatusFromViewState } from './toolStatus';
import './ContextCompressionDisplay.scss';

interface ContextCompressionDisplayProps {
  toolItem?: FlowToolItem;
  compressionData?: {
    session_id: string;
    compression_count: number;
    has_summary: boolean;
    summary_source?: 'model' | 'local_fallback' | 'none';
    tokens_before?: number;
    tokens_after?: number;
    compression_ratio?: number;
    duration?: number;
    summary_content?: string;
    trigger?: 'user_message' | 'tool_batch' | 'ai_response' | 'manual';
    compression_tiers?: {
      tier1?: { before: number; after: number; saved: number };
      tier2_3?: { before: number; after: number; saved: number };
      tier4_plus?: { before: number; after: number; saved: number };
    };
  };
}

export const ContextCompressionDisplay: React.FC<ContextCompressionDisplayProps> = ({
  toolItem,
  compressionData,
}) => {
  const { t } = useTranslation('flow-chat');
  const toolViewState = toolItem ? getToolViewState(toolItem) : null;
  const isCompleted = !toolViewState || toolViewState.phase === 'result' || toolViewState.phase === 'cancelled';
  const cardStatus = toolViewState ? getToolCardStatusFromViewState(toolViewState) : 'completed';
  const data = toolItem ? {
    compressionCount: toolItem.toolResult?.result?.compression_count || compressionData?.compression_count,
    tokensBefore: toolItem.toolResult?.result?.tokens_before || toolItem.toolCall?.input?.tokens_before || compressionData?.tokens_before,
    tokensAfter: toolItem.toolResult?.result?.tokens_after || compressionData?.tokens_after,
    compressionRatio: toolItem.toolResult?.result?.compression_ratio || compressionData?.compression_ratio,
    duration: toolItem.toolResult?.duration_ms || compressionData?.duration,
    hasSummary: toolItem.toolResult?.result?.has_summary ?? compressionData?.has_summary,
    summarySource: toolItem.toolResult?.result?.summary_source || compressionData?.summary_source,
    trigger: toolItem.toolCall?.input?.trigger || compressionData?.trigger,
    status: isCompleted ? 'completed' as const : cardStatus,
    error: toolItem.toolResult?.error,
  } : {
    compressionCount: compressionData?.compression_count,
    tokensBefore: compressionData?.tokens_before,
    tokensAfter: compressionData?.tokens_after,
    compressionRatio: compressionData?.compression_ratio,
    duration: compressionData?.duration,
    hasSummary: compressionData?.has_summary,
    summarySource: compressionData?.summary_source,
    trigger: compressionData?.trigger,
    status: 'completed' as const,
    error: undefined,
  };

  const getTriggerText = (triggerType?: string) => {
    switch (triggerType) {
      case 'user_message':
        return t('toolCards.contextCompression.beforeUserMessage');
      case 'tool_batch':
        return t('toolCards.contextCompression.toolBatchComplete');
      case 'ai_response':
        return 'After AI response';
      case 'manual':
        return t('toolCards.contextCompression.manualTrigger');
      default:
        return t('toolCards.contextCompression.autoTrigger');
    }
  };

  const savedTokens = data.tokensBefore && data.tokensAfter
    ? data.tokensBefore - data.tokensAfter
    : undefined;
  const isFailed = toolViewState?.phase === 'error' || Boolean(data.error);
  const usedLocalFallback = data.summarySource === 'local_fallback';
  const usedNoSummary = data.summarySource === 'none';

  const headerAction = isFailed
    ? t('toolCards.contextCompression.contextCompressionFailed')
    : usedLocalFallback && isCompleted
      ? t('toolCards.contextCompression.localFallbackHeader')
      : t('toolCards.contextCompression.contextCompression');

  const subject = (
    <span className="compression-info">
      {data.tokensBefore !== undefined && data.tokensAfter !== undefined ? (
        <>
          <span className="token-stat">
            {data.tokensBefore.toLocaleString()} éˆ«?{data.tokensAfter.toLocaleString()} tokens
          </span>
          {savedTokens !== undefined && data.compressionRatio !== undefined && (
            <span className="savings-tag">
              Saved {savedTokens.toLocaleString()} è·¯ Ratio {(data.compressionRatio * 100).toFixed(0)}%
            </span>
          )}
        </>
      ) : (
        <span className="processing-text">Compressing context...</span>
      )}
    </span>
  );

  const extra = isCompleted && data.compressionCount ? (
    <span className="compression-meta">
      {getTriggerText(data.trigger)} è·¯ Compression #{data.compressionCount}
    </span>
  ) : undefined;

  const expandedContent = usedNoSummary ? (
    <div className="compression-detail-note">
      {t('toolCards.contextCompression.noSummaryNotice', {
        defaultValue: 'No additional summary was generated for this compaction pass.',
      })}
    </div>
  ) : undefined;

  return (
    <DetailToolTemplate
      toolId={toolItem?.id ?? toolItem?.toolCall?.id}
      toolName={toolItem?.toolName ?? 'ContextCompression'}
      status={data.status}
      icon={<Archive size={16} />}
      iconClassName="compression-icon"
      action={headerAction}
      subject={subject}
      extra={extra}
      expandedContent={expandedContent}
      errorContent={isFailed ? <ToolErrorBlock message={data.error || t('toolCards.contextCompression.contextCompressionFailed')} /> : undefined}
      isFailed={isFailed}
      className="context-compression-display"
    />
  );
};

