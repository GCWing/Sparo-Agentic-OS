/**
 * Compact display for the read_file tool.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { getToolViewState } from '../runtime/toolViewState';

export const ReadFileDisplay: React.FC<ToolCardProps> = React.memo(({
  toolItem,
  onOpenInEditor
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';

  const filePath = useMemo(() => {
    const path = toolCall?.input?.file_path || toolCall?.input?.target_file || toolCall?.input?.path;

    if (!path) {
      const isEarlyDetection = toolCall?.input?._early_detection === true;
      const isPartialParams = toolCall?.input?._partial_params === true;

      if (isEarlyDetection || isPartialParams) {
        return t('toolCards.readFile.parsingParams');
      }

      return t('toolCards.readFile.parsingParams');
    }

    return path;
  }, [t, toolCall?.input]);

  const handleOpenInEditor = () => {
    if (filePath !== t('toolCards.readFile.noFileSpecified') && filePath !== t('toolCards.readFile.parsingParams')) {
      onOpenInEditor?.(filePath);
    }
  };

  const fileName = useMemo(() => {
    if (!filePath || filePath === t('toolCards.readFile.noFileSpecified') || filePath === t('toolCards.readFile.parsingParams')) {
      return filePath || t('toolCards.readFile.noFileSpecified');
    }
    return filePath.split(/[\\/]/).pop() || filePath;
  }, [filePath, t]);

  const lineRange = useMemo(() => {
    const start_line = toolCall?.input?.start_line;
    const limit = toolCall?.input?.limit;

    if (start_line !== undefined || limit !== undefined) {
      const startLine = start_line || 1;
      const endLine = limit ? startLine + limit - 1 : undefined;

      if (endLine) {
        return `L${startLine}~L${endLine}`;
      } else if (startLine > 1) {
        return `L${startLine}~EOF`;
      }
    }

    return null;
  }, [toolCall?.input?.start_line, toolCall?.input?.limit]);

  const fileSize = useMemo(() => {
    if (!toolResult?.result) return null;

    const content = toolResult.result.content || toolResult.result;
    if (typeof content === 'string') {
      const bytes = new TextEncoder().encode(content).length;
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
    return null;
  }, [toolResult?.result]);

  const canOpenFile = isCompleted && filePath !== t('toolCards.readFile.noFileSpecified') && filePath !== t('toolCards.readFile.parsingParams');

  if (viewState.phase === 'error') {
    return null;
  }

  const renderFileName = () => {
    if (!canOpenFile) {
      return <span className="read-file-name">{fileName}</span>;
    }

    return (
      <button
        type="button"
        className="read-file-name read-file-name--openable"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleOpenInEditor();
        }}
        title={filePath}
      >
        {fileName}
      </button>
    );
  };

  const renderContent = () => {
    if (isCompleted) {
      return (
        <>
          {t('toolCards.readFile.readFile')}: {renderFileName()}
          {lineRange && <span className="read-file-meta"> {lineRange}</span>}
          {fileSize && <span className="read-file-meta"> ({fileSize})</span>}
        </>
      );
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return (
        <>
          {t('toolCards.readFile.readingFile')} {renderFileName()}
          {lineRange && <span className="read-file-meta"> {lineRange}</span>}
          ...
        </>
      );
    }
    if (viewState.phase === 'preparing' || viewState.phase === 'ready') {
      return (
        <>
          {t('toolCards.readFile.preparingRead')} {renderFileName()}
          {lineRange && <span className="read-file-meta"> {lineRange}</span>}
        </>
      );
    }
    if (viewState.phase === 'cancelled' || viewState.phase === 'interrupted') {
      return (
        <>
          {t('toolCards.readFile.readFile')}: {renderFileName()}
          {lineRange && <span className="read-file-meta"> {lineRange}</span>}
        </>
      );
    }
    return null;
  };

  return (
    <DefaultToolCardTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolItem.toolName}
      status={status}
      className="read-file-card"
      summary={renderContent()}
    />
  );
});
