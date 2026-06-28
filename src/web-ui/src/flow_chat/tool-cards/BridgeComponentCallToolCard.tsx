import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';

interface BridgeComponentCallInput {
  bridge_id?: string;
  bridgeId?: string;
  capability_id?: string;
  capabilityId?: string;
  action?: string;
  mode?: string;
}

interface BridgeComponentCallResult {
  run_id?: string;
  runId?: string;
  bridge_id?: string;
  bridgeId?: string;
  capability_id?: string;
  capabilityId?: string;
  action?: string;
  status?: string;
  output?: unknown;
  stderr?: string;
}

function parseData<T>(value: unknown): T | null {
  if (!value) return null;

  try {
    return typeof value === 'string' ? JSON.parse(value) as T : value as T;
  } catch {
    return null;
  }
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export const BridgeComponentCallToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const inputData = useMemo(
    () => parseData<BridgeComponentCallInput>(toolCall?.input) ?? {},
    [toolCall?.input],
  );
  const resultData = useMemo(
    () => parseData<BridgeComponentCallResult>(toolResult?.result) ?? {},
    [toolResult?.result],
  );

  const bridgeId = resultData.bridge_id ?? resultData.bridgeId ?? inputData.bridge_id ?? inputData.bridgeId;
  const capabilityId = resultData.capability_id ?? resultData.capabilityId ?? inputData.capability_id ?? inputData.capabilityId;
  const action = resultData.action ?? inputData.action;
  const runId = resultData.run_id ?? resultData.runId;
  const runStatus = resultData.status;
  const output = stringifyValue(resultData.output);
  const stderr = resultData.stderr;
  const capabilityLabel = capabilityId || bridgeId || t('toolCards.bridgeCall.unknownCapability');

  const renderSummary = () => {
    if (viewState.phase === 'result') {
      return t('toolCards.bridgeCall.completed', { capability: capabilityLabel, action: action || t('toolCards.bridgeCall.unknownAction') });
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return t('toolCards.bridgeCall.running', { capability: capabilityLabel, action: action || t('toolCards.bridgeCall.unknownAction') });
    }
    if (viewState.phase === 'error' || viewState.phase === 'cancelled' || viewState.phase === 'interrupted') {
      return t('toolCards.bridgeCall.failed', { capability: capabilityLabel });
    }
    return t('toolCards.bridgeCall.preparing', { capability: capabilityLabel });
  };

  const expandedContent = (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.bridgeCall.bridgeId')}:`, value: bridgeId },
        { label: `${t('toolCards.bridgeCall.capabilityId')}:`, value: capabilityId },
        { label: `${t('toolCards.bridgeCall.action')}:`, value: action },
        { label: `${t('toolCards.bridgeCall.mode')}:`, value: inputData.mode },
        { label: `${t('toolCards.bridgeCall.runId')}:`, value: runId },
        { label: `${t('toolCards.bridgeCall.status')}:`, value: runStatus },
        { label: `${t('toolCards.bridgeCall.output')}:`, value: output },
        { label: `${t('toolCards.bridgeCall.stderr')}:`, value: stderr },
      ]}
    >
      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </ToolStructuredDetails>
  );

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      action={`${t('toolCards.bridgeCall.title')}:`}
      summary={renderSummary()}
      extra={runStatus}
      expandedContent={expandedContent}
    />
  );
});
