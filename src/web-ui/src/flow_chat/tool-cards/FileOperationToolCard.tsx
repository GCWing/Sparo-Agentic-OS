/**
 * File operation tool card - compact row with optional diff preview.
 * Supports Write/Edit/Delete file operations
 *
 * Height-stability contract:
 * - Any state-driven height change must go through
 *   `useToolCardHeightContract.applyExpandedState(...)`.
 * - Any status/render-path change that removes expanded content without
 *   toggling local expand state must dispatch
 *   `flowchat:tool-card-collapse-intent` before the shrink happens.
 * - If preview/result variants stop sharing roughly the same visual height in
 *   the future, treat that as another shrink path and protect it explicitly
 *   instead of relying on `VirtualMessageList` fallback compensation.
 */

import React, { useEffect, useCallback, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
} from 'lucide-react';
import { Tooltip } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolCard } from './CompactToolCard';
import { useSnapshotState } from '../../tools/snapshot_system/hooks/useSnapshotState';
import { SnapshotEventBus, SNAPSHOT_EVENTS } from '../../tools/snapshot_system/core/SnapshotEventBus';
import { CodePreview } from '../components/CodePreview';
import { InlineDiffPreview } from '../components/InlineDiffPreview';
import { diffLines } from 'diff';
import { createLogger } from '@/shared/utils/logger';
import { useToolCardHeightContract } from './useToolCardHeightContract';
import { fileTabManager } from '../../shared/services/FileTabManager';
import { hasNonFileUriScheme } from '@/shared/utils/pathUtils';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolCompactHeaderLayout } from './ToolHeaderLayout';
import { CompactToolTemplate } from './templates';
import './FileOperationToolCard.scss';

const log = createLogger('FileOperationToolCard');
const FILE_OPERATION_PREVIEW_ROWS = 8;
const FILE_OPERATION_PREVIEW_ROW_HEIGHT = 22;
// Keep streaming and completed previews at the same height to avoid layout jumps.
const FILE_OPERATION_PREVIEW_MAX_HEIGHT =
  FILE_OPERATION_PREVIEW_ROWS * FILE_OPERATION_PREVIEW_ROW_HEIGHT;

interface FileOperationToolCardProps extends ToolCardProps {
  sessionId?: string;
}

interface RollingDiffNumberProps {
  value: number;
  tone: 'addition' | 'deletion';
}

const RollingDiffNumber: React.FC<RollingDiffNumberProps> = ({ value, tone }) => {
  const [digitState, setDigitState] = useState(() => ({
    previous: String(value),
    current: String(value),
    animationIndex: 0,
  }));
  const digits = digitState.current;
  const previousDigits = digitState.previous.padStart(digits.length, ' ');

  useEffect(() => {
    const nextDigits = String(value);
    setDigitState((current) => {
      if (current.current === nextDigits) {
        return current;
      }

      return {
        previous: current.current,
        current: nextDigits,
        animationIndex: current.animationIndex + 1,
      };
    });
  }, [value]);

  return (
    <span className={`diff-preview-number diff-preview-number--${tone}`} aria-live="polite">
      <span className="diff-preview-number__sign">
        {tone === 'addition' ? '+' : '-'}
      </span>
      <span className="diff-preview-number__digits">
        {digits.split('').map((digit, index) => {
          const changed = previousDigits[index] !== digit;
          return (
            <span className="diff-preview-number__digit-clip" key={`${tone}-${digits.length}-${index}`}>
              <span
                key={changed ? `${tone}-${digitState.animationIndex}-${index}-${digit}` : `${tone}-${index}-${digit}`}
                className={changed ? 'diff-preview-number__value diff-preview-number__value--changed' : 'diff-preview-number__value'}
              >
                {digit}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
};

const extractPartialJsonStringField = (buffer: string | undefined, fieldName: string): string => {
  if (!buffer) {
    return '';
  }

  const fieldPattern = `"${fieldName}"`;
  const fieldIndex = buffer.indexOf(fieldPattern);
  if (fieldIndex < 0) {
    return '';
  }

  const colonIndex = buffer.indexOf(':', fieldIndex + fieldPattern.length);
  if (colonIndex < 0) {
    return '';
  }

  let openingQuoteIndex = colonIndex + 1;
  while (openingQuoteIndex < buffer.length && /\s/.test(buffer[openingQuoteIndex])) {
    openingQuoteIndex += 1;
  }

  if (buffer[openingQuoteIndex] !== '"') {
    return '';
  }

  let value = '';
  let escaping = false;

  for (let index = openingQuoteIndex + 1; index < buffer.length; index += 1) {
    const char = buffer[index];

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
};

export const FileOperationToolCard: React.FC<FileOperationToolCardProps> = ({
  toolItem,
  config,
  sessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status, isParamsStreaming, partialParams } = toolItem;
  const toolId = toolItem.id ?? toolCall?.id;
  
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [operationDiffStats, setOperationDiffStats] = useState<{ additions: number; deletions: number } | null>(null);
  
  const hasInitializedCompletionEffectRef = useRef(false);
  const previousCompletionEndTimeRef = useRef<number | null>(toolItem.endTime ?? null);
  const previousStatusRef = useRef(status);
  const lastStableExpandedHeightRef = useRef<number>(0);
  const hasManuallyExpandedContentRef = useRef(false);
  const {
    cardRootRef,
    applyExpandedState: applyHeightContractExpandedState,
  } = useToolCardHeightContract({
    toolId,
    toolName: toolItem.toolName,
  });
  
  const { error, clearError } = useSnapshotState(sessionId);
  const eventBus = SnapshotEventBus.getInstance();

  const paramsSource = useMemo(() => {
    const baseParams =
      toolCall?.input && typeof toolCall.input === 'object'
        ? toolCall.input
        : {};
    const streamedParams =
      partialParams && typeof partialParams === 'object'
        ? partialParams
        : {};
    const mergedParams = {
      ...baseParams,
      ...streamedParams,
    };

    return {
      ...mergedParams,
    };
  }, [partialParams, toolCall?.input]);

  const getParamString = useCallback((fieldNames: string[]): string => {
    for (const fieldName of fieldNames) {
      const value = paramsSource[fieldName];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    for (const fieldName of fieldNames) {
      const value = extractPartialJsonStringField(toolItem._paramsBuffer, fieldName);
      if (value.length > 0) {
        return value;
      }
    }

    return '';
  }, [paramsSource, toolItem._paramsBuffer]);

  const getFilePath = useCallback((): string => {
    return getParamString(['file_path', 'target_file', 'path', 'filename']) || toolItem._streamingFileStats?.filePath || '';
  }, [getParamString, toolItem._streamingFileStats?.filePath]);

  const currentFilePath = getFilePath();

  const getOldString = useCallback((): string => {
    return getParamString(['old_string']);
  }, [getParamString]);

  const getNewString = useCallback((): string => {
    return getParamString(['new_string']);
  }, [getParamString]);

  const getContent = useCallback((): string => {
    return getParamString(['content', 'contents']);
  }, [getParamString]);

  const oldStringContent = getOldString();
  const newStringContent = getNewString();
  const contentPreview = getContent();
  
  const isFailed = status === 'error' || (toolResult && 'success' in toolResult && !toolResult.success);
  
  const fileName = currentFilePath ? 
    (currentFilePath.split(/[/\\]/).pop() || t('context.file')) : 
    (isFailed ? t('toolCards.file.unknownFile') : t('toolCards.file.parsingPath'));
  
  useEffect(() => {
    const completionEndTime = toolItem.endTime ?? null;
    const isCompletedSuccess = status === 'completed' && Boolean(toolResult?.success);

    if (!hasInitializedCompletionEffectRef.current) {
      hasInitializedCompletionEffectRef.current = true;
      previousCompletionEndTimeRef.current = completionEndTime;
      return;
    }

    const shouldEmitCompletionEvent =
      isCompletedSuccess &&
      completionEndTime !== null &&
      previousCompletionEndTimeRef.current !== completionEndTime &&
      Boolean(sessionId) &&
      Boolean(currentFilePath);

    previousCompletionEndTimeRef.current = completionEndTime;

    if (!shouldEmitCompletionEvent || !sessionId || !currentFilePath) {
      return;
    }

    eventBus.emit(SNAPSHOT_EVENTS.FILE_OPERATION_COMPLETED, {
      toolName: toolItem.toolName,
      toolResult
    }, sessionId, currentFilePath);
  }, [status, toolResult, sessionId, currentFilePath, toolItem.toolName, toolItem.endTime, eventBus]);

  const getToolDisplayInfo = () => {
    const toolMap: Record<string, { icon: string; name: string }> = {
      'Write': { icon: '', name: t('toolCards.file.write') },
      'Edit': { icon: '', name: t('toolCards.file.edit') },
      'Delete': { icon: '', name: t('toolCards.file.delete') }
    };
    
    return toolMap[toolItem.toolName] || { icon: config.icon, name: config.displayName };
  };

  const toolDisplayInfo = getToolDisplayInfo();

  const applyContentExpandedState = useCallback((
    nextExpanded: boolean,
    reason: 'manual' | 'auto',
  ) => {
    if (reason === 'manual' && nextExpanded) {
      hasManuallyExpandedContentRef.current = true;
    }

    applyHeightContractExpandedState(
      isContentExpanded,
      nextExpanded,
      setIsContentExpanded,
      { reason },
    );
  }, [applyHeightContractExpandedState, isContentExpanded]);

  const applyErrorExpandedState = useCallback((
    nextExpanded: boolean,
    reason: 'manual' | 'auto',
  ) => {
    applyHeightContractExpandedState(
      isErrorExpanded,
      nextExpanded,
      setIsErrorExpanded,
      { reason },
    );
  }, [applyHeightContractExpandedState, isErrorExpanded]);

  useEffect(() => {
    if (error) {
      log.error('File operation error', { filePath: currentFilePath, error });
      setTimeout(clearError, 3000);
    }
  }, [error, clearError, currentFilePath]);

  useEffect(() => {
    if (previousStatusRef.current !== status) {
      if (status === 'completed' && !isFailed && !hasManuallyExpandedContentRef.current) {
        applyContentExpandedState(false, 'auto');
      }
      previousStatusRef.current = status;
    }
  }, [
    applyContentExpandedState,
    cardRootRef,
    contentPreview,
    currentFilePath,
    isContentExpanded,
    isFailed,
    oldStringContent,
    status,
    toolId,
    toolItem.toolName,
  ]);

  const localDiffStats = useMemo(() => {
    if (isFailed) return null;
    if (isParamsStreaming && toolItem._streamingFileStats) return null;
    if (toolItem.toolName === 'Write' && contentPreview) {
      const lines = contentPreview.split('\n');
      const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      return { additions: count, deletions: 0 };
    }
    if (toolItem.toolName === 'Edit' && (oldStringContent || newStringContent)) {
      const changes = diffLines(oldStringContent, newStringContent);
      let additions = 0;
      let deletions = 0;
      for (const change of changes) {
        const lineCount = change.count ?? 0;
        if (change.added) additions += lineCount;
        else if (change.removed) deletions += lineCount;
      }
      return { additions, deletions };
    }
    return null;
  }, [toolItem.toolName, toolItem._streamingFileStats, contentPreview, oldStringContent, newStringContent, isFailed, isParamsStreaming]);

  const streamingDiffStats = useMemo(() => {
    if (isFailed || !toolItem._streamingFileStats) return null;
    return {
      additions: toolItem._streamingFileStats.additions,
      deletions: toolItem._streamingFileStats.deletions,
    };
  }, [isFailed, toolItem._streamingFileStats]);

  const currentFileDiffStats = useMemo(() => {
    return operationDiffStats ?? streamingDiffStats ?? localDiffStats ?? { additions: 0, deletions: 0 };
  }, [operationDiffStats, localDiffStats, streamingDiffStats]);

  useEffect(() => {
    if (!sessionId || !toolCall?.id || status !== 'completed' || isFailed) return;
    let cancelled = false;

    (async () => {
      try {
        // TODO: Persist diff stats with the tool result so historical cards can
        // read a static value instead of recomputing on every remount.
        const { snapshotAPI } = await import('../../infrastructure/api');
        const summary = await snapshotAPI.getOperationSummary(sessionId, toolCall.id);
        if (cancelled) return;
        setOperationDiffStats({
          additions: summary.linesAdded ? Number(summary.linesAdded) : 0,
          deletions: summary.linesRemoved ? Number(summary.linesRemoved) : 0
        });
      } catch (error) {
        log.warn('Failed to load operation summary', { sessionId, toolCallId: toolCall.id, error });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, toolCall?.id, status, isFailed]);

  const previewVariant = useMemo(() => {
    if (toolItem.toolName === 'Edit') {
      if (status !== 'completed' && newStringContent) {
        return 'streaming-code';
      }
      if (status === 'completed' && !isParamsStreaming && (oldStringContent || newStringContent)) {
        return 'completed-diff';
      }
    }

    if (toolItem.toolName === 'Write') {
      if (status !== 'completed' && contentPreview) {
        return 'streaming-code';
      }
      if (status === 'completed' && !isParamsStreaming && contentPreview) {
        return 'completed-diff';
      }
    }

    return 'none';
  }, [
    contentPreview,
    isParamsStreaming,
    newStringContent,
    oldStringContent,
    status,
    toolItem.toolName,
  ]);

  useLayoutEffect(() => {
    const measuredHeight = cardRootRef.current?.getBoundingClientRect().height ?? 0;
    if (!isFailed && isContentExpanded && measuredHeight > 0) {
      lastStableExpandedHeightRef.current = measuredHeight;
    }
  }, [cardRootRef, isContentExpanded, isFailed, previewVariant, status]);

  useLayoutEffect(() => {
    const previousStatus = previousStatusRef.current;
    const isNewFailure = previousStatus !== status && status === 'error';
    if (!isNewFailure || !isContentExpanded) {
      return;
    }

    const currentMeasuredHeight = cardRootRef.current?.getBoundingClientRect().height ?? 0;
    const lastStableExpandedHeight = lastStableExpandedHeightRef.current;
    const estimatedShrinkHeight = Math.max(lastStableExpandedHeight, currentMeasuredHeight);

    if (estimatedShrinkHeight <= currentMeasuredHeight + 0.5) {
      return;
    }

    window.dispatchEvent(new CustomEvent('flowchat:tool-card-collapse-intent', {
      detail: {
        toolId: toolId ?? null,
        toolName: toolItem.toolName,
        cardHeight: estimatedShrinkHeight,
        filePath: currentFilePath || null,
        reason: 'auto',
      },
    }));
    window.dispatchEvent(new CustomEvent('tool-card-toggle'));
  }, [
    cardRootRef,
    currentFilePath,
    isContentExpanded,
    previewVariant,
    status,
    toolId,
    toolItem.toolName,
  ]);

  const getErrorMessage = () => {
    if (toolResult && 'error' in toolResult) {
      return toolResult.error;
    }
    if (error) {
      return error;
    }
    return t('error.unknown');
  };

  const handleCodeLineClick = useCallback(async (lineNumber: number, filePath?: string) => {
    if (!filePath) return;

    try {
      const { editorJumpService } = await import('../../shared/services/EditorJumpService');
      await editorJumpService.jumpToFile(filePath, lineNumber, 1);
    } catch (error) {
      log.error('Failed to jump to line', { filePath, lineNumber, error });
    }
  }, []);

  const handleOpenInCodeEditor = useCallback(async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (!currentFilePath) {
      return;
    }

    if (!sessionId || hasNonFileUriScheme(currentFilePath)) {
      fileTabManager.openFile({
        filePath: currentFilePath,
        fileName,
        mode: 'agent',
      });
      return;
    }

    try {
      const { snapshotAPI } = await import('../../infrastructure/api');
      const diffData = await snapshotAPI.getOperationDiff(sessionId, currentFilePath, toolCall?.id);
      const jumpToLine = diffData.anchorLine ? Number(diffData.anchorLine) : undefined;

      fileTabManager.openFile({
        filePath: currentFilePath,
        fileName,
        jumpToLine,
        mode: 'agent',
      });
    } catch (error) {
      log.error('Failed to open in CodeEditor', { sessionId, filePath: currentFilePath, error });
      fileTabManager.openFile({
        filePath: currentFilePath,
        fileName,
        mode: 'agent',
      });
    }
  }, [currentFilePath, fileName, sessionId, toolCall?.id]);

  const renderExpandedContent = () => {
    if (isFailed) return null;

    if (toolItem.toolName === 'Edit') {
      if (status !== 'completed' && newStringContent) {
        return (
          <div className="streaming-content-preview">
            <div className="preview-text">
              <CodePreview
                content={newStringContent}
                filePath={currentFilePath}
                isStreaming={isParamsStreaming}
                showLineNumbers={false}
                maxHeight={FILE_OPERATION_PREVIEW_MAX_HEIGHT}
                autoScrollToBottom={isParamsStreaming}
                onLineClick={handleCodeLineClick}
              />
            </div>
          </div>
        );
      }
      
      if (status === 'completed' && !isParamsStreaming && (oldStringContent || newStringContent)) {
        return (
          <div className="streaming-content-preview">
            <div className="preview-text">
              <InlineDiffPreview
                originalContent={oldStringContent}
                modifiedContent={newStringContent}
                filePath={currentFilePath}
                maxHeight={FILE_OPERATION_PREVIEW_MAX_HEIGHT}
                showLineNumbers={false}
                lineNumberMode="dual"
                showPrefix={false}
                contextLines={-1}
              />
            </div>
          </div>
        );
      }
    }

    if (toolItem.toolName === 'Write') {
      if (status !== 'completed' && contentPreview) {
        return (
          <div className="streaming-content-preview">
            <div className="preview-text">
              <CodePreview
                content={contentPreview}
                filePath={currentFilePath}
                isStreaming={isParamsStreaming}
                showLineNumbers={false}
                maxHeight={FILE_OPERATION_PREVIEW_MAX_HEIGHT}
                autoScrollToBottom={isParamsStreaming}
                onLineClick={handleCodeLineClick}
              />
            </div>
          </div>
        );
      }
      
      if (status === 'completed' && !isParamsStreaming && contentPreview) {
        return (
          <div className="streaming-content-preview">
            <div className="preview-text">
              <InlineDiffPreview
                originalContent=""
                modifiedContent={contentPreview}
                filePath={currentFilePath}
                maxHeight={FILE_OPERATION_PREVIEW_MAX_HEIGHT}
                showLineNumbers={false}
                lineNumberMode="single"
                showPrefix={true}
                contextLines={-1}
              />
            </div>
          </div>
        );
      }
    }

    if (status !== 'completed') {
      return (
        <div className="streaming-content-preview">
          <div className="preview-text diff-loading">
            {t('toolCards.file.receivingParams')}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderErrorContent = () => (
    <ToolErrorBlock
      title={`${toolDisplayInfo.name}${t('toolCards.file.failed')}`}
      message={getErrorMessage()}
    />
  );

  const isDeleteTool = toolItem.toolName === 'Delete';

  const renderDeleteContent = () => {
    if (status === 'error') {
      return `${t('toolCards.file.delete')}${t('toolCards.file.failed')}: ${fileName}`;
    }
    return <>{t('toolCards.file.delete')}: <span className="delete-file-name">{fileName}</span></>;
  };

  const hasPreviewContent =
    (toolItem.toolName === 'Edit' && Boolean(oldStringContent || newStringContent)) ||
    (toolItem.toolName === 'Write' && Boolean(contentPreview));
  const isStreamingFileOperation =
    !isDeleteTool &&
    !isFailed &&
    (toolItem.toolName === 'Edit' || toolItem.toolName === 'Write') &&
    status !== 'completed';
  const hasExpandableContent =
    !isFailed &&
    !isDeleteTool &&
    (hasPreviewContent || isStreamingFileOperation);

  const isCardContentExpanded =
    !isDeleteTool &&
    !isFailed &&
    (hasExpandableContent ? isContentExpanded : false);

  const hasDiffStats =
    currentFileDiffStats.additions > 0 || currentFileDiffStats.deletions > 0;
  const diffCapsuleBaseReady =
    !isDeleteTool &&
    !isFailed;
  const showInlineDiffStats = diffCapsuleBaseReady && hasDiffStats;
  const expandedContent = isCardContentExpanded ? renderExpandedContent() : null;

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest('.compact-inline-action-button')) {
      return;
    }

    if (isFailed) {
      applyErrorExpandedState(!isErrorExpanded, 'manual');
      return;
    }

    if (toolItem.toolName === 'Delete') {
      return;
    }

    if (hasExpandableContent) {
      applyContentExpandedState(!isContentExpanded, 'manual');
    }
  }, [
    applyContentExpandedState,
    applyErrorExpandedState,
    hasExpandableContent,
    isContentExpanded,
    isErrorExpanded,
    isFailed,
    toolItem.toolName,
  ]);

  const renderHeader = () => {
    const actionText = isDeleteTool
      ? ''
      : (isFailed ? `${toolDisplayInfo.name}${t('toolCards.file.failed')}` : `${toolDisplayInfo.name}:`);
    const canOpenFileAction = !isDeleteTool && Boolean(currentFilePath);

    const diffStatsInner = (
      <span className="diff-preview-group">
        {currentFileDiffStats.additions > 0 && (
          <RollingDiffNumber value={currentFileDiffStats.additions} tone="addition" />
        )}
        {currentFileDiffStats.deletions > 0 && (
          <RollingDiffNumber value={currentFileDiffStats.deletions} tone="deletion" />
        )}
      </span>
    );

    return (
      <ToolCompactHeaderLayout
        status={status}
        content={
          <>
            {actionText ? `${actionText} ` : null}
            <Tooltip content={currentFilePath || fileName} placement="top">
              <span className={`file-name ${isDeleteTool ? 'file-name--muted' : ''}`}>
                {fileName}
              </span>
            </Tooltip>
            {showInlineDiffStats && diffStatsInner}
            {canOpenFileAction && (
              <Tooltip content={t('toolCards.file.openInEditor')} placement="top">
                <button
                  type="button"
                  className="compact-inline-action-button file-op-hover-affordance"
                  onClick={handleOpenInCodeEditor}
                  aria-label={t('toolCards.file.openInEditor')}
                >
                  <ExternalLink size={12} />
                </button>
              </Tooltip>
            )}
          </>
        }
      />
    );
  };

  if (isDeleteTool) {
    return (
      <CompactToolTemplate
        toolId={toolId}
        toolName={toolItem.toolName}
        status={status}
        className="read-file-card delete-file-card"
        summary={renderDeleteContent()}
      />
    );
  }

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <CompactToolCard
        status={status}
        isExpanded={isFailed ? isErrorExpanded : isCardContentExpanded}
        onClick={handleCardClick}
        className={`file-operation-card ${isDeleteTool ? 'non-clickable' : ''}`}
        clickable={!isDeleteTool && (hasExpandableContent || isFailed)}
        header={renderHeader()}
        expandedContent={
          isFailed
            ? (isErrorExpanded ? renderErrorContent() : null)
            : (isCardContentExpanded ? expandedContent : null)
        }
      />
    </div>
  );
};
