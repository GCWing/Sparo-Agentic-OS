/**
 * Tool card for GlobSearch file matching.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, File, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { getToolViewState } from '../runtime/toolViewState';
import { invalidateFlowLayout } from '../scroll/FlowLayoutMutationEvents';
import './GlobSearchDisplay.scss';

const MAX_VISIBLE_FILES = 50;

function getFileEntryPath(file: unknown): string {
  if (typeof file === 'string') {
    return file;
  }

  if (file && typeof file === 'object') {
    const candidate = file as { name?: unknown; path?: unknown };
    const path = typeof candidate.path === 'string' ? candidate.path : '';
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    return path || name;
  }

  return '';
}

export const GlobSearchDisplay: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const [showAllFiles, setShowAllFiles] = useState(false);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';
  const toolId = toolItem.id ?? toolCall?.id;

  const getSearchPattern = (): string => {
    const pattern = toolCall?.input?.pattern ||
                   toolCall?.input?.glob_pattern ||
                   toolCall?.input?.file_pattern;

    if (!pattern) {
      const isEarlyDetection = toolCall?.input?._early_detection === true;
      const isPartialParams = toolCall?.input?._partial_params === true;

      if (isEarlyDetection || isPartialParams) {
        return t('toolCards.globSearch.parsingPattern');
      }

      return t('toolCards.globSearch.parsingPattern');
    }

    return pattern;
  };

  const getSearchPath = (): string => {
    return toolCall?.input?.path || toolCall?.input?.target_directory || t('toolCards.globSearch.currentDirectory');
  };

  const files = useMemo(() => {
    if (!toolResult?.result) return [];

    const parsedResult = toolResult.result;

    if (Array.isArray(parsedResult)) {
      return parsedResult;
    }
    if (parsedResult.files && Array.isArray(parsedResult.files)) {
      return parsedResult.files;
    }
    if (parsedResult.matches && Array.isArray(parsedResult.matches)) {
      return parsedResult.matches;
    }

    return [];
  }, [toolResult]);

  useEffect(() => {
    setShowAllFiles(false);
  }, [files]);

  const stats = useMemo(() => {
    if (files.length === 0) return { files: 0, directories: 0 };

    let fileCount = 0;
    let dirCount = 0;

    files.forEach((file: any) => {
      const fileName = getFileEntryPath(file);
      if (/[/\\]$/.test(fileName)) {
        dirCount++;
      } else {
        fileCount++;
      }
    });

    return {
      files: fileCount,
      directories: dirCount
    };
  }, [files]);

  const pattern = getSearchPattern();
  const searchPath = getSearchPath();
  const hasDetails = isCompleted && files.length > 0;
  const hasResultData = toolResult?.result !== undefined && toolResult?.result !== null;
  const visibleFiles = showAllFiles ? files : files.slice(0, MAX_VISIBLE_FILES);
  const hiddenFileCount = Math.max(0, files.length - MAX_VISIBLE_FILES);
  const statsText = stats.directories > 0
    ? t('toolCards.globSearch.filesAndDirs', { files: stats.files, directories: stats.directories })
    : t('toolCards.globSearch.filesCount', { count: stats.files });

  useEffect(() => {
    if (!hasDetails) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      invalidateFlowLayout({
        source: toolItem.toolName,
        toolId: toolId ?? null,
        reason: showAllFiles ? 'glob-search-show-all' : 'glob-search-results-layout',
        priority: 'high',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasDetails, showAllFiles, toolId, toolItem.toolName, visibleFiles.length]);

  const renderSummary = (actionLabel: string, showCount = false) => (
    <span className="glob-search-card__summary">
      <span className="glob-search-card__summary-column glob-search-card__summary-main" title={pattern}>
        {actionLabel}: {pattern}
        {showCount && hasResultData && (
          <span className="glob-search-card__summary-count-inline"> ({statsText})</span>
        )}
      </span>
      <span className="glob-search-card__summary-column glob-search-card__summary-path" title={searchPath}>
        {t('toolCards.globSearch.labelPath')}: {searchPath}
      </span>
      {showCount && hasResultData && (
        <span className="glob-search-card__summary-column glob-search-card__summary-count">{statsText}</span>
      )}
    </span>
  );

  const renderContent = () => {
    if (isCompleted) {
      return renderSummary(t('toolCards.globSearch.searchFile'), true);
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return renderSummary(t('toolCards.globSearch.searchingFile'));
    }
    if (viewState.phase === 'preparing' || viewState.phase === 'ready') {
      return renderSummary(t('toolCards.globSearch.preparingSearch'));
    }
    return pattern;
  };

  const renderExpandedContent = () => (
    <div className="glob-search-card__table-wrap">
      <table className="glob-search-card__table">
        <tbody>
          {visibleFiles.map((file: any, index: number) => {
            const fileName = getFileEntryPath(file);
            const isDirectory = /[/\\]$/.test(fileName);
            return (
              <tr key={`${fileName}-${index}`}>
                <td>
                  <span className="glob-search-card__file-result">
                    {isDirectory ? (
                      <Folder size={13} className="glob-search-card__file-icon" />
                    ) : (
                      <File size={13} className="glob-search-card__file-icon" />
                    )}
                    <span className="glob-search-card__file-name" title={fileName}>
                      {fileName}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
          {!showAllFiles && hiddenFileCount > 0 && (
            <tr>
              <td className="glob-search-card__more">
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowAllFiles(true);
                  }}
                >
                  <ChevronDown size={13} />
                  {t('toolCards.globSearch.moreFiles', { count: hiddenFileCount })}
                </Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  if (viewState.phase === 'error') {
    return null;
  }

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="glob-search-card"
      summary={renderContent()}
      expandedContent={hasDetails ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
