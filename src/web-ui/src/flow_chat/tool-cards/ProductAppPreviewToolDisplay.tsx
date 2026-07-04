import React, { useMemo } from 'react';
import { PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import { HeavyToolCardTemplate } from './templates';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function statusLabel(status: unknown): string {
  return typeof status === 'string' && status.trim() ? status : 'notVerified';
}

export const ProductAppPreviewToolDisplay: React.FC<ToolCardProps> = ({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, toolCall } = toolItem;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const result = asRecord(toolResult?.result);
  const input = asRecord(runtimeState.inputPhase === 'streaming' ? runtimeState.partialInput : runtimeState.input);
  const isCompleted = viewState.phase === 'result';
  const isLoading = viewState.phase === 'running' || viewState.phase === 'receiving_input' || viewState.phase === 'preparing';
  const isFailed = viewState.phase === 'error' || (isCompleted && toolResult != null && toolResult.success === false);
  const previewStatus = statusLabel(result.status);
  const harnessMode =
    (result.harnessMode as string | undefined) ??
    (result.harness_mode as string | undefined) ??
    (input.mode as string | undefined) ??
    'auto';
  const target = (result.target as string | undefined) ??
    (result.app_id as string | undefined) ??
    (result.component_id as string | undefined) ??
    t('toolCards.productAppPreview.target');
  const failed = Number(asRecord(result.summary).failed ?? 0);
  const warnings = Number(asRecord(result.summary).warnings ?? 0);
  const checks = Array.isArray(result.checks) ? result.checks.map(asRecord) : [];
  const toolId = toolItem.id ?? toolCall?.id;
  const errorMessage = toolResult && 'error' in toolResult && toolResult.error
    ? String(toolResult.error)
    : t('toolCards.productAppPreview.failedMessage');

  const title = (
    <span className="create-product-app-tool-info">
      <span className="operation-tag">
        {isLoading ? t('toolCards.productAppPreview.running') : t('toolCards.productAppPreview.title')}
      </span>
      <span className="command-text">
        {harnessMode}
      </span>
    </span>
  );

  const meta = isCompleted && !isFailed ? (
    <span className="output-summary">
      {previewStatus}
    </span>
  ) : null;

  const rows = [
    { label: t('toolCards.productAppPreview.status'), value: previewStatus },
    { label: t('toolCards.productAppPreview.mode'), value: harnessMode },
    { label: t('toolCards.productAppPreview.target'), value: target },
    { label: t('toolCards.productAppPreview.failed'), value: failed },
    { label: t('toolCards.productAppPreview.warnings'), value: warnings },
    ...checks.map((check) => ({
      label: String(check.id ?? t('toolCards.productAppPreview.check')),
      value: [statusLabel(check.status), check.detail].filter(Boolean).join(': '),
    })),
  ];

  return (
    <HeavyToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      icon={<PlayCircle size={16} />}
      title={title}
      meta={meta}
      isRunning={isLoading}
      showHeaderExpandHint={isCompleted || isFailed}
      expandedContent={!isFailed ? <ToolStructuredDetails rows={rows} /> : undefined}
      errorContent={isFailed ? (
        <ToolErrorBlock
          message={errorMessage}
        />
      ) : undefined}
      isFailed={isFailed}
    />
  );
};
