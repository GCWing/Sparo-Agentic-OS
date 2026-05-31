import React, { useMemo } from 'react';
import type {
  AppDefinedToolCardField,
  AppDefinedToolCardSpec,
  ToolCardProps,
} from '../types/flow-chat';
import { getToolViewState } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';

function parseData(value: unknown): unknown {
  if (!value) return {};
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return {};
  }
}

function readPath(source: unknown, path?: string[]): unknown {
  if (!path?.length) return undefined;
  return path.reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function stringifyValue(value: unknown, format?: AppDefinedToolCardField['format']): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (format === 'json') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function interpolate(template: string | undefined, values: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = readPath(values, key.split('.'));
    return stringifyValue(value) ?? '';
  });
}

function resolveFieldValue(field: AppDefinedToolCardField, inputData: unknown, resultData: unknown): string | undefined {
  const value =
    readPath(resultData, field.path) ??
    readPath(resultData, field.resultPath) ??
    readPath(inputData, field.inputPath);
  return stringifyValue(value, field.format);
}

function resolveSummary(
  card: AppDefinedToolCardSpec,
  phase: ReturnType<typeof getToolViewState>['phase'],
  values: Record<string, unknown>,
): string {
  const bridgeStatus = stringifyValue(readPath(values, ['status']));
  if (bridgeStatus === 'failed' || bridgeStatus === 'cancelled') {
    return interpolate(card.summary?.failed, values) ?? 'Failed';
  }
  if (phase === 'result') {
    return interpolate(card.summary?.completed, values) ?? 'Completed';
  }
  if (phase === 'running' || phase === 'receiving_input') {
    return interpolate(card.summary?.running, values) ?? 'Running';
  }
  if (phase === 'error' || phase === 'cancelled' || phase === 'interrupted') {
    return interpolate(card.summary?.failed, values) ?? 'Failed';
  }
  return interpolate(card.summary?.preparing, values) ?? 'Preparing';
}

export const AppDefinedToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem, config }) => {
  const { toolCall, toolResult, status } = toolItem;
  const card = config.extensionCard ?? {};
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const inputData = useMemo(() => parseData(toolCall?.input), [toolCall?.input]);
  const resultData = useMemo(() => parseData(toolResult?.result), [toolResult?.result]);
  const fields = card.fields ?? [];
  const templateValues = useMemo(() => ({
    input: inputData,
    result: resultData,
    action: readPath(resultData, ['action']) ?? readPath(resultData, ['bridge', 'action']) ?? readPath(inputData, ['action']),
    status: readPath(resultData, ['status']) ?? readPath(resultData, ['bridge', 'status']),
    runId: readPath(resultData, ['run_id']) ?? readPath(resultData, ['bridge', 'run_id']) ?? readPath(inputData, ['runId']),
  }), [inputData, resultData]);
  const bridgeStatus = stringifyValue(readPath(templateValues, ['status']));

  return (
    <DefaultToolCardTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolItem.toolName}
      status={status}
      action={`${card.title ?? card.displayName ?? config.displayName}:`}
      summary={resolveSummary(card, viewState.phase, templateValues)}
      extra={bridgeStatus}
      expandedContent={(
        <ToolStructuredDetails
          rows={fields.map(field => ({
            label: `${field.label}:`,
            value: resolveFieldValue(field, inputData, resultData),
          }))}
        >
          {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
        </ToolStructuredDetails>
      )}
    />
  );
});
