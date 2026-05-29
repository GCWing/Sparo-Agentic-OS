/**
 * Display component for the GetFileDiff tool.
 */

import React, { useMemo } from 'react';
import { GitCompare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { InlineDiffPreview } from '../components/InlineDiffPreview';
import { createLogger } from '@/shared/utils/logger';
import { DetailToolTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import { getToolViewState } from '../runtime/toolViewState';
import './GetFileDiffDisplay.scss';

const log = createLogger('GetFileDiffDisplay');

interface GetFileDiffResult {
  file_path?: string;
  diff_type?: 'baseline' | 'full';
  diff_format?: string;
  diff_content?: string;
  original_content?: string;
  modified_content?: string;
  stats?: {
    additions?: number;
    deletions?: number;
    total_lines?: number;
  };
  message?: string;
}

export const GetFileDiffDisplay: React.FC<ToolCardProps> = React.memo(({
  toolItem,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';
  const toolId = toolItem.id ?? toolCall?.id;

  const resultData = useMemo((): GetFileDiffResult | null => {
    if (!toolResult?.result) return null;

    try {
      if (typeof toolResult.result === 'string') {
        return JSON.parse(toolResult.result);
      }
      return toolResult.result as GetFileDiffResult;
    } catch (error) {
      log.error('Failed to parse GetFileDiff result', { error });
      return null;
    }
  }, [toolResult]);

  const filePath = useMemo(() => {
    if (resultData?.file_path) {
      return resultData.file_path;
    }
    const path = toolCall?.input?.file_path;
    return path || t('toolCards.readFile.parsingParams');
  }, [resultData?.file_path, t, toolCall?.input?.file_path]);

  const fileName = useMemo(() => {
    if (!filePath || filePath === t('toolCards.readFile.parsingParams')) {
      return filePath || '';
    }
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  }, [filePath, t]);

  const diffTypeLabel = useMemo(() => {
    if (!resultData?.diff_type) return null;
    const typeMap: Record<string, string> = {
      baseline: 'Baseline',
      full: 'Full',
    };
    return typeMap[resultData.diff_type] || resultData.diff_type;
  }, [resultData?.diff_type]);

  const stats = resultData?.stats || null;
  const hasDiffContent = Boolean(
    resultData && (resultData.original_content || resultData.modified_content || resultData.diff_content)
  );
  const isFailed = viewState.phase === 'error';

  const getActionText = () => {
    if (isFailed) {
      return t('toolCards.getFileDiff.failed', { defaultValue: 'Diff failed' });
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return t('toolCards.getFileDiff.gettingDiff', { defaultValue: 'Getting diff' });
    }
    if (viewState.phase === 'preparing' || viewState.phase === 'ready') {
      return t('toolCards.getFileDiff.preparing', { defaultValue: 'Preparing diff' });
    }
    return t('toolCards.getFileDiff.diffFile', { defaultValue: 'Diff' });
  };

  const subject = (
    <span className="diff-tool-info">
      <span className="diff-file-name">{fileName}</span>
      {diffTypeLabel && isCompleted && (
        <span className="diff-type-tag">{diffTypeLabel}</span>
      )}
    </span>
  );

  const extra = !isFailed && isCompleted && stats && (
    stats.additions !== undefined || stats.deletions !== undefined
  ) ? (
    <span className="diff-stats">
      {stats.additions !== undefined && stats.additions > 0 && (
        <span className="additions">+{stats.additions}</span>
      )}
      {stats.deletions !== undefined && stats.deletions > 0 && (
        <span className="deletions">-{stats.deletions}</span>
      )}
    </span>
  ) : undefined;

  const renderExpandedContent = () => {
    if (!resultData) return null;

    const { original_content, modified_content, diff_content, diff_type } = resultData;

    if (diff_type === 'full' && modified_content) {
      return (
        <div className="diff-expanded-content">
          <div className="diff-message">{resultData.message}</div>
          <pre className="diff-content-preview">{modified_content}</pre>
        </div>
      );
    }

    if (original_content !== undefined && modified_content !== undefined) {
      return (
        <div className="diff-expanded-content">
          {resultData.message && (
            <div className="diff-message">{resultData.message}</div>
          )}
          <InlineDiffPreview
            originalContent={original_content}
            modifiedContent={modified_content}
            filePath={filePath}
            maxHeight={400}
            showLineNumbers={true}
            lineNumberMode="dual"
            showPrefix={true}
            contextLines={-1}
          />
        </div>
      );
    }

    if (diff_content) {
      return (
        <div className="diff-expanded-content">
          {resultData.message && (
            <div className="diff-message">{resultData.message}</div>
          )}
          <pre className="diff-content-preview">{diff_content}</pre>
        </div>
      );
    }

    return null;
  };

  return (
    <DetailToolTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      icon={<GitCompare size={16} />}
      iconClassName="diff-icon"
      action={`${getActionText()}:`}
      subject={subject}
      extra={extra}
      expandedContent={hasDiffContent && isCompleted ? renderExpandedContent() : undefined}
      errorContent={isFailed ? <ToolErrorBlock message={t('toolCards.getFileDiff.failed', { defaultValue: 'Failed to get file diff' })} /> : undefined}
      isFailed={isFailed}
      className="get-file-diff-card"
    />
  );
});

