/**
 * Terminal tool card component
 * Displays command execution lifecycle:
 * - receive tool parameters
 * - wait for terminal output after launch
 * - stream real output and final result
 *
 * Design notes:
 * - Final lifecycle always comes from the centralized tool runtime state
 * - The only local interaction guard is `interruptRequested`, used to prevent
 *   duplicate cancel clicks before the backend status catches up
 * - Live terminal output is rendered from store-managed progress logs
 * - Clicking "Open Terminal in right panel" opens the full Terminal tab
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { ExternalLink } from 'lucide-react';
import { createTerminalTab } from '@/shared/utils/tabUtils';
import { Tooltip } from '@/design-system';
import { TerminalOutputRenderer } from '@/tools/terminal/components';
import { createLogger } from '@/shared/utils/logger';
import { useFlowLayoutMutationContract, type FlowLayoutCollapseReason } from '../scroll/useFlowLayoutMutationContract';
import { getTerminalViewState, type TerminalViewState } from './terminalToolCardState';
import { ToolActionGroup } from './ToolActionGroup';
import { ToolErrorBlock } from './ToolErrorBlock';
import { DefaultToolCardTemplate } from './templates';
import { normalizePartialJsonBuffer } from '@/shared/utils/partialJsonParser';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { getToolCardStatusFromViewState } from './toolStatus';
import './TerminalToolCard.scss';

const log = createLogger('TerminalToolCard');
const TERMINAL_OUTPUT_PREVIEW_ROWS = 4;
const TERMINAL_OUTPUT_ESTIMATED_LINE_HEIGHT = 18;
const TERMINAL_OUTPUT_VERTICAL_PADDING = 16;
const TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT =
  TERMINAL_OUTPUT_PREVIEW_ROWS * TERMINAL_OUTPUT_ESTIMATED_LINE_HEIGHT + TERMINAL_OUTPUT_VERTICAL_PADDING;

interface TerminalToolCardProps extends ToolCardProps {
  terminalSessionId?: string;
}

interface ParsedTerminalResult {
  command?: string;
  output: string;
  exitCode: number;
  workingDir: string;
  executionTimeMs?: number;
  wasInterrupted: boolean;
  terminalSessionId?: string;
}

function normalizeTerminalSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.startsWith('FlowChat-')) {
    return undefined;
  }

  return value;
}

function isTerminalCollapsedPhase(phase: string): boolean {
  return phase === 'result' || phase === 'cancelled' || phase === 'interrupted' || phase === 'error';
}

function getInitialTerminalExpandedState(phase: string, inputPhase: string): boolean {
  if (inputPhase === 'streaming') {
    return false;
  }

  return !(isTerminalCollapsedPhase(phase) || phase === 'confirming');
}

function getAutoExpandedStateForTerminalState(phase: string, inputPhase: string): boolean | null {
  if (inputPhase === 'streaming') {
    return false;
  }

  if (isTerminalCollapsedPhase(phase) || phase === 'confirming') {
    return false;
  }

  if (phase === 'preparing' || phase === 'ready' || phase === 'running') {
    return true;
  }

  return null;
}

function extractPartialJsonStringField(buffer: string | undefined, fieldName: string): string {
  if (!buffer) {
    return '';
  }

  const normalizedBuffer = normalizePartialJsonBuffer(buffer);
  const looseMatch = normalizedBuffer.match(new RegExp(`${fieldName}\\\\?"?\\s*[:{]\\s*\\\\?"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, 'i'));
  if (looseMatch?.[1]) {
    return looseMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  const fieldPattern = `"${fieldName}"`;
  const fieldIndex = normalizedBuffer.indexOf(fieldPattern);
  if (fieldIndex < 0) {
    return '';
  }

  const colonIndex = normalizedBuffer.indexOf(':', fieldIndex + fieldPattern.length);
  if (colonIndex < 0) {
    return '';
  }

  let openingQuoteIndex = colonIndex + 1;
  while (openingQuoteIndex < normalizedBuffer.length && /\s/.test(normalizedBuffer[openingQuoteIndex])) {
    openingQuoteIndex += 1;
  }

  if (normalizedBuffer[openingQuoteIndex] !== '"') {
    return '';
  }

  let value = '';
  let escaping = false;

  for (let index = openingQuoteIndex + 1; index < normalizedBuffer.length; index += 1) {
    const char = normalizedBuffer[index];

    if (escaping) {
      if (char === 'n') value += '\n';
      else if (char === 'r') value += '\r';
      else if (char === 't') value += '\t';
      else value += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      break;
    }

    value += char;
  }

  return value;
}

function renderTerminalExpandedContent(params: {
  viewState: TerminalViewState;
  liveOutput: string;
  parsedResult: ParsedTerminalResult;
  waitingMessage: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): React.ReactNode {
  const { viewState, liveOutput, parsedResult, waitingMessage, t } = params;

  return (
    <>
      {viewState.displayPhase === 'live_output' && (
        <div className="terminal-execution-output">
          <TerminalOutputRenderer
            content={liveOutput}
            className="terminal-xterm-output"
            maxHeight={TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT}
          />
        </div>
      )}

      {(viewState.displayPhase === 'receiving_params' || viewState.displayPhase === 'executing') && waitingMessage && (
        <div className="terminal-execution-output terminal-waiting">
          <span className="waiting-text">{waitingMessage}</span>
        </div>
      )}

      {viewState.showCompletedResult && (
        <div className="terminal-result-container">
          {parsedResult.output && (
            <div className="terminal-result-output">
              <TerminalOutputRenderer
                content={parsedResult.output}
                className="terminal-xterm-output"
                maxHeight={TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT}
              />
            </div>
          )}
          <div className="terminal-result-footer">
            {parsedResult.workingDir && (
              <>
                <span className="terminal-result-label">{t('toolCards.terminal.workingDirectory')}</span>
                <span className="terminal-result-value">{parsedResult.workingDir}</span>
              </>
            )}
            <span className={`terminal-exit-code ${parsedResult.exitCode === 0 ? 'success' : 'error'}`}>
              {t('toolCards.terminal.exitCode', { code: parsedResult.exitCode })}
            </span>
            {parsedResult.executionTimeMs && (
              <span className="terminal-execution-time">
                {parsedResult.executionTimeMs}ms
              </span>
            )}
          </div>
        </div>
      )}

      {viewState.showCancelledResult && (
        <div className="terminal-result-container cancelled">
          <div className="terminal-result-output">
            <TerminalOutputRenderer
              content={liveOutput}
              className="terminal-xterm-output"
              maxHeight={TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT}
            />
          </div>
          <div className="terminal-result-footer">
            <span className="terminal-cancelled-text">{t('toolCards.terminal.commandInterrupted')}</span>
          </div>
        </div>
      )}
    </>
  );
}

function renderTerminalErrorContent(errorMessage: string): React.ReactNode {
  return <ToolErrorBlock message={errorMessage} />;
}

function parseTerminalResult(raw: unknown, durationMs?: number): ParsedTerminalResult {
  let record: Record<string, unknown> | null = null;

  if (raw != null && typeof raw === 'string') {
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      record = null;
    }
  } else if (raw != null && typeof raw === 'object') {
    record = raw as Record<string, unknown>;
  }

  if (!record) {
    return {
      command: undefined,
      output: '',
      exitCode: 0,
      workingDir: '',
      executionTimeMs: undefined,
      wasInterrupted: false,
      terminalSessionId: undefined,
    };
  }

  const stdout = typeof record.stdout === 'string' ? record.stdout : '';
  const stderr = typeof record.stderr === 'string' ? record.stderr : '';
  const combinedOutput = [stdout, stderr].filter((value) => value.length > 0).join('\n');
  const outputField = typeof record.output === 'string' ? record.output : '';
  const output = outputField || combinedOutput;

  return {
    command: typeof record.command === 'string' ? record.command : undefined,
    output,
    exitCode: typeof record.exit_code === 'number' ? record.exit_code : 0,
    workingDir: typeof record.working_directory === 'string' ? record.working_directory : '',
    executionTimeMs:
      typeof record.execution_time_ms === 'number'
        ? record.execution_time_ms
        : typeof record.duration_ms === 'number'
          ? record.duration_ms
          : durationMs,
    wasInterrupted: Boolean(record.interrupted),
    terminalSessionId: normalizeTerminalSessionId(record.terminal_session_id),
  };
}

export const TerminalToolCard: React.FC<TerminalToolCardProps> = ({
  toolItem,
  onConfirm,
  onReject,
  onExpand,
  terminalSessionId: propTerminalSessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const toolCall = toolItem.toolCall;
  const toolResult = toolItem.toolResult;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const toolViewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const status = useMemo(() => getToolCardStatusFromViewState(toolViewState), [toolViewState]);
  const command = useMemo(() => {
    const baseParams: Record<string, unknown> =
      runtimeState.input && typeof runtimeState.input === 'object'
        ? runtimeState.input as Record<string, unknown>
        : {};
    const streamedParams: Record<string, unknown> =
      runtimeState.partialInput && typeof runtimeState.partialInput === 'object'
        ? runtimeState.partialInput as Record<string, unknown>
        : {};
    const mergedParams = {
      ...baseParams,
      ...streamedParams,
    };
    const commandValue = mergedParams.command;

    if (typeof commandValue === 'string' && commandValue.length > 0) {
      return commandValue;
    }

    return extractPartialJsonStringField(toolItem._paramsBuffer, 'command');
  }, [runtimeState.input, runtimeState.partialInput, toolItem._paramsBuffer]);
  const progressMessage = typeof (toolItem as any)._progressMessage === 'string'
    ? (toolItem as any)._progressMessage
    : '';

  const parsedResult = useMemo(
    () => parseTerminalResult(toolResult?.result, toolResult?.duration_ms),
    [toolResult?.duration_ms, toolResult?.result],
  );

  const terminalSessionId = useMemo(
    () => normalizeTerminalSessionId(toolItem.terminalSessionId)
      ?? parsedResult.terminalSessionId
      ?? normalizeTerminalSessionId(propTerminalSessionId),
    [parsedResult.terminalSessionId, propTerminalSessionId, toolItem.terminalSessionId],
  );

  const progressLogs = useMemo(() => {
    const logs = (toolItem as any)._progressLogs;
    if (!Array.isArray(logs)) {
      return [];
    }

    return logs.filter((entry): entry is string => typeof entry === 'string');
  }, [toolItem]);

  const liveOutput = useMemo(() => {
    if (progressLogs.length > 0) {
      return progressLogs.join('');
    }

    return progressMessage;
  }, [progressLogs, progressMessage]);

  const toolId = toolItem.id ?? toolCall?.id;
  const [isExpanded, setIsExpandedState] = useState(() => getInitialTerminalExpandedState(toolViewState.phase, runtimeState.inputPhase));
  const previousAutoStateRef = useRef({ phase: toolViewState.phase, inputPhase: runtimeState.inputPhase });
  const {
    cardRootRef,
    applyExpandedState,
    invalidateLayout,
  } = useFlowLayoutMutationContract({
    toolId,
    toolName: toolItem.toolName,
  });
  const applyTerminalExpandedState = useCallback((
    nextExpanded: boolean,
    options?: { reason?: FlowLayoutCollapseReason },
  ) => {
    if (nextExpanded === isExpanded) {
      return;
    }

    applyExpandedState(isExpanded, nextExpanded, setIsExpandedState, {
      reason: options?.reason ?? 'manual',
      onExpand,
    });
  }, [applyExpandedState, isExpanded, onExpand]);

  const toggleExpanded = useCallback(() => {
    applyTerminalExpandedState(!isExpanded, { reason: 'manual' });
  }, [applyTerminalExpandedState, isExpanded]);

  const displayCommand = command || parsedResult.command || '';
  const [interruptRequested, setInterruptRequested] = useState(false);
  const [isCommandTruncated, setIsCommandTruncated] = useState(false);
  const commandRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (toolViewState.phase !== 'running') {
      setInterruptRequested(false);
    }
  }, [toolViewState.phase]);

  useEffect(() => {
    if (!isExpanded || !liveOutput) {
      return;
    }

    invalidateLayout({
      reason: 'terminal-output',
      priority: 'normal',
    });
  }, [invalidateLayout, isExpanded, liveOutput]);

  useEffect(() => {
    const prevAutoState = previousAutoStateRef.current;
    previousAutoStateRef.current = { phase: toolViewState.phase, inputPhase: runtimeState.inputPhase };

    if (prevAutoState.phase === toolViewState.phase && prevAutoState.inputPhase === runtimeState.inputPhase) {
      return;
    }

    const nextExpanded = getAutoExpandedStateForTerminalState(toolViewState.phase, runtimeState.inputPhase);
    if (nextExpanded !== null) {
      applyTerminalExpandedState(nextExpanded, { reason: 'auto' });
    }
  }, [applyTerminalExpandedState, runtimeState.inputPhase, toolViewState.phase]);

  const updateCommandTruncation = useCallback(() => {
    const element = commandRef.current;
    if (!element) {
      setIsCommandTruncated(false);
      return;
    }

    const nextValue = element.scrollWidth - element.clientWidth > 1;
    setIsCommandTruncated((prev) => (prev === nextValue ? prev : nextValue));
  }, []);

  useEffect(() => {
    const element = commandRef.current;
    if (!element) {
      setIsCommandTruncated(false);
      return;
    }

    const frameId = window.requestAnimationFrame(updateCommandTruncation);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          updateCommandTruncation();
        })
      : null;

    resizeObserver?.observe(element);
    if (element.parentElement) {
      resizeObserver?.observe(element.parentElement);
    }

    window.addEventListener('resize', updateCommandTruncation);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateCommandTruncation);
    };
  }, [displayCommand, updateCommandTruncation]);

  const showConfirmButtons = toolViewState.canConfirm;

  const viewState = useMemo(() => {
    return getTerminalViewState({
      lifecycle: runtimeState.lifecycle,
      inputPhase: runtimeState.inputPhase,
      presentationPhase: toolViewState.phase,
      liveOutput,
      interruptRequested,
      showConfirmButtons,
      wasInterrupted: parsedResult.wasInterrupted,
    });
  }, [
    interruptRequested,
    liveOutput,
    parsedResult.wasInterrupted,
    runtimeState.inputPhase,
    runtimeState.lifecycle,
    showConfirmButtons,
    toolViewState.phase,
  ]);
  const waitingMessage = viewState.waitingMessageKey ? t(viewState.waitingMessageKey) : null;
  const confirmInput = useMemo(() => {
    const baseInput =
      runtimeState.input && typeof runtimeState.input === 'object'
        ? runtimeState.input
        : {};

    return displayCommand
      ? { ...baseInput, command: displayCommand }
      : baseInput;
  }, [displayCommand, runtimeState.input]);
  const isWaitingForCommand =
    !displayCommand &&
    (viewState.isLoading || showConfirmButtons || runtimeState.lifecycle === 'pending');
  const canExecuteCommand = Boolean(displayCommand.trim());
  const handleExecute = useCallback(() => {
    if (!canExecuteCommand) {
      return;
    }

    applyTerminalExpandedState(true, { reason: 'manual' });
    onConfirm?.(confirmInput);
  }, [applyTerminalExpandedState, canExecuteCommand, confirmInput, onConfirm]);

  const handleReject = useCallback(() => {
    onReject?.();
  }, [onReject]);

  const handleInterrupt = useCallback(async () => {
    const toolUseId = toolCall?.id;
    if (!toolUseId || interruptRequested) {
      return;
    }

    setInterruptRequested(true);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_tool', {
        request: {
          toolUseId,
          reason: 'User cancelled',
        },
      });
    } catch (error) {
      setInterruptRequested(false);
      log.error('Failed to send cancel signal', { toolUseId, error });
    }
  }, [interruptRequested, toolCall?.id]);

  const handleOpenInPanel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!terminalSessionId) {
      return;
    }

    const terminalName = `Chat-${terminalSessionId.slice(0, 8)}`;
    createTerminalTab(terminalSessionId, terminalName);
  }, [terminalSessionId]);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.terminal-action-control, .terminal-confirm-actions')) {
      return;
    }

    toggleExpanded();
  }, [toggleExpanded]);

  const renderCommandContent = () => {
    const commandContent = displayCommand
      || (
        <span className="command-empty terminal-command-placeholder">
          {t(isWaitingForCommand ? 'toolCards.terminal.receivingCommand' : 'toolCards.terminal.commandUnavailable')}
        </span>
      );
    const commandNode = (
      <span ref={commandRef} className="terminal-command">{commandContent}</span>
    );

    if (displayCommand && isCommandTruncated) {
      return (
        <Tooltip
          content={<div className="terminal-command-tooltip-content">{displayCommand}</div>}
          placement="bottom"
          className="terminal-command-tooltip"
          interactive
        >
          {commandNode}
        </Tooltip>
      );
    }

    return commandNode;
  };

  const renderStatusText = () => {
    if (!viewState.statusLabel || !viewState.statusClassName) {
      return null;
    }

    return (
      <span className={`terminal-status-text ${viewState.statusClassName}`}>
        {t(`toolCards.terminal.${viewState.statusLabel}`)}
      </span>
    );
  };

  const renderSummary = () => (
    <>
      {t('toolCards.terminal.executeCommand')} {renderCommandContent()}
    </>
  );

  const renderExtra = () => (
    viewState.hasHeaderExtra ? (
        <>
          {renderStatusText()}

          {showConfirmButtons && (
            <ToolActionGroup
              className="terminal-confirm-actions"
              onConfirm={handleExecute}
              onReject={handleReject}
              confirmIcon="play"
              confirmDisabled={!canExecuteCommand}
              confirmLabel={
                canExecuteCommand
                  ? t('toolCards.terminal.executeCommandTitle')
                  : t('toolCards.terminal.commandStillReceivingWarning')
              }
              rejectLabel={t('toolCards.terminal.cancel')}
            />
          )}

          {viewState.showInterruptButton && (
            <ToolActionGroup
              className="terminal-interrupt-actions"
              onInterrupt={handleInterrupt}
              interruptLabel={t('toolCards.terminal.interrupt')}
            />
          )}
        </>
      ) : undefined
  );
  const expandedContent = renderTerminalExpandedContent({ viewState, liveOutput, parsedResult, waitingMessage, t });
  const errorContent = viewState.isFailed
    ? renderTerminalErrorContent(toolResult?.error || t('toolCards.terminal.executionFailed'))
    : null;
  const hasExpandableContent = viewState.isFailed || !showConfirmButtons;

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <DefaultToolCardTemplate
        toolId={toolId}
        toolName={toolItem.toolName}
        status={status}
        isExpanded={isExpanded}
        onToggle={(_, event) => handleCardClick(event)}
        expandable={hasExpandableContent}
        className={[
          'terminal-tool-card',
          showConfirmButtons ? 'requires-confirmation' : '',
        ].filter(Boolean).join(' ')}
        summary={renderSummary()}
        extra={renderExtra()}
        primaryAction={terminalSessionId ? {
          icon: <ExternalLink size={12} />,
          label: t('toolCards.terminal.openInPanel'),
          onClick: handleOpenInPanel,
          className: 'terminal-action-control terminal-inline-open-control',
        } : undefined}
        expandedContent={viewState.isFailed ? errorContent : expandedContent}
      />
    </div>
  );
};

export default TerminalToolCard;
