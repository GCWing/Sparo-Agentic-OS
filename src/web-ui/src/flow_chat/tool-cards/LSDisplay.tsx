/**
 * Display component for the LS tool.
 */

import React, { useMemo } from 'react';
import { File, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import { getToolViewState } from '../runtime/toolViewState';
import './LSDisplay.scss';
interface LSEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_time: string;
}

export const LSDisplay: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';
  const toolId = toolItem.id ?? toolCall?.id;

  const getDirectoryPath = (): string => {
    const path = toolCall?.input?.path;
    
    if (!path) {
      const isEarlyDetection = toolCall?.input?._early_detection === true;
      const isPartialParams = toolCall?.input?._partial_params === true;
      
      if (isEarlyDetection || isPartialParams) {
        return t('toolCards.ls.parsingPath');
      }
      
      return t('toolCards.ls.parsingPath');
    }
    
    return path;
  };

  const entries = useMemo((): LSEntry[] => {
    if (!toolResult?.result) return [];
    
    const parsedResult = toolResult.result;
    
    if (parsedResult.entries && Array.isArray(parsedResult.entries)) {
      return parsedResult.entries;
    }
    
    return [];
  }, [toolResult]);

  const stats = useMemo(() => {
    if (entries.length === 0) return { files: 0, directories: 0, total: 0 };
    
    let fileCount = 0;
    let dirCount = 0;
    
    entries.forEach((entry: LSEntry) => {
      if (entry.is_dir) {
        dirCount++;
      } else {
        fileCount++;
      }
    });
    
    return {
      files: fileCount,
      directories: dirCount,
      total: entries.length
    };
  }, [entries]);

  const directoryPath = getDirectoryPath();
  const hasDetails = isCompleted && entries.length > 0;
  const hasResultData = toolResult?.result !== undefined && toolResult?.result !== null;

  const renderContent = () => {
    if (isCompleted) {
      const statsText = stats.directories > 0 
        ? t('toolCards.ls.filesAndDirs', { files: stats.files, directories: stats.directories })
        : t('toolCards.ls.filesCount', { count: stats.files });
      return `${t('toolCards.ls.listDirectory')}: ${directoryPath}${hasResultData ? ` (${statsText})` : ''}`;
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input') {
      return `${t('toolCards.ls.listingDirectory')} ${directoryPath}...`;
    }
    if (viewState.phase === 'preparing' || viewState.phase === 'ready') {
      return `${t('toolCards.ls.preparingList')} ${directoryPath}`;
    }
    return directoryPath;
  };

  const renderExpandedContent = () => (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.ls.labelPath')}:`, value: directoryPath },
        {
          label: `${t('toolCards.ls.labelStats')}:`,
          value: stats.directories > 0
              ? t('toolCards.ls.filesAndDirs', { files: stats.files, directories: stats.directories })
              : t('toolCards.ls.filesCount', { count: stats.files }),
        },
        { label: `${t('toolCards.ls.labelSort')}:`, value: t('toolCards.ls.sortByModifiedTime') },
      ]}
    >
      <div className="compact-detail-list ls-display-card__entry-list">
        {entries.slice(0, 50).map((entry: LSEntry, index: number) => (
          <div key={index} className="compact-list-item ls-display-card__entry">
            {entry.is_dir ? (
              <Folder size={12} className="ls-display-card__entry-icon" />
            ) : (
              <File size={12} className="ls-display-card__entry-icon" />
            )}
            <span className="ls-display-card__entry-name" title={entry.path || entry.name}>
              {entry.name}
            </span>
            <span className="ls-display-card__entry-time" title={entry.modified_time}>
              {entry.modified_time}
            </span>
          </div>
        ))}
        {entries.length > 50 && (
          <div className="ls-display-card__entry-more">
            {t('toolCards.ls.moreEntries', { count: entries.length - 50 })}
          </div>
        )}
      </div>
    </ToolStructuredDetails>
  );

  if (viewState.phase === 'error') {
    return null;
  }

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="ls-display-card"
      summary={renderContent()}
      expandedContent={hasDetails ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
