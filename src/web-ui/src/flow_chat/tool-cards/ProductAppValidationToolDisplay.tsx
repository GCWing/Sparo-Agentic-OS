import React, { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import {
  HeavyToolCardTemplate,
} from './templates';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function statusLabel(status: unknown): string {
  return typeof status === 'string' && status.trim() ? status : 'notVerified';
}

export const ProductAppValidationToolDisplay: React.FC<ToolCardProps> = ({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, toolCall } = toolItem;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const result = asRecord(toolResult?.result);
  const input = asRecord(runtimeState.inputPhase === 'streaming' ? runtimeState.partialInput : runtimeState.input);
  const isCompleted = viewState.phase === 'result';
  const isLoading = viewState.phase === 'running' || viewState.phase === 'receiving_input' || viewState.phase === 'preparing';
  const isFailed = viewState.phase === 'error' || (isCompleted && toolResult != null && toolResult.success === false);
  const isComponentValidation = toolItem.toolName === 'ValidateComponentPackage';

  const appId = (result.app_id as string | undefined) ?? (result.appId as string | undefined) ?? (input.app_id as string | undefined);
  const componentId =
    (result.component_id as string | undefined) ??
    (result.componentId as string | undefined) ??
    (input.component_id as string | undefined) ??
    (input.componentId as string | undefined);
  const componentKind =
    (result.component_kind as string | undefined) ??
    (result.componentKind as string | undefined) ??
    (input.kind as string | undefined);
  const version = (result.version as string | undefined) ?? (input.version as string | undefined);
  const packagePath = (result.path as string | undefined) ?? (input.path as string | undefined);
  const validationStatus = statusLabel(result.status);
  const summary = asRecord(result.summary);
  const failed = Number(summary.failed ?? 0);
  const warnings = Number(summary.warnings ?? 0);
  const checks = Array.isArray(result.checks) ? result.checks.map(asRecord) : [];
  const toolId = toolItem.id ?? toolCall?.id;
  const errorMessage = toolResult && 'error' in toolResult && toolResult.error
    ? String(toolResult.error)
    : t('toolCards.productAppValidation.failedMessage');

  const title = (
    <span className="create-product-app-tool-info">
      <span className="operation-tag">
        {isLoading
          ? t('toolCards.productAppValidation.validating')
          : isComponentValidation
            ? t('toolCards.productAppValidation.componentTitle')
            : t('toolCards.productAppValidation.title')}
      </span>
      <span className="command-text">
        {componentId || appId || packagePath || t(isComponentValidation
          ? 'toolCards.productAppValidation.componentPackage'
          : 'toolCards.productAppValidation.package')}
      </span>
    </span>
  );

  const meta = isCompleted && !isFailed ? (
    <span className="output-summary">
      {validationStatus}
    </span>
  ) : null;

  const rows = [
    { label: t('toolCards.productAppValidation.status'), value: validationStatus },
    { label: t('toolCards.productAppValidation.failed'), value: failed },
    { label: t('toolCards.productAppValidation.warnings'), value: warnings },
    ...(isComponentValidation
      ? [
          { label: t('toolCards.productAppValidation.componentId'), value: componentId },
          { label: t('toolCards.productAppValidation.componentKind'), value: componentKind },
        ]
      : [
          { label: t('toolCards.productAppValidation.appId'), value: appId },
        ]),
    { label: t('toolCards.productAppValidation.version'), value: version },
    { label: t('toolCards.productAppValidation.path'), value: packagePath },
    ...checks.map((check) => ({
      label: String(check.id ?? t('toolCards.productAppValidation.check')),
      value: [statusLabel(check.status), check.detail].filter(Boolean).join(': '),
    })),
  ];

  return (
    <HeavyToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      icon={<ShieldCheck size={16} />}
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
