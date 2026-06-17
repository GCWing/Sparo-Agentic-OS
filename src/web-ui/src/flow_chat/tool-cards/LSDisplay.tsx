/**
 * Display component for the LS tool.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, File, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { getToolViewState } from '../runtime/toolViewState';
import { invalidateFlowLayout } from '../scroll/FlowLayoutMutationEvents';
import './LSDisplay.scss';

const MAX_VISIBLE_ENTRIES = 50;

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
  const [showAllEntries, setShowAllEntries] = useState(false);
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

  useEffect(() => {
    setShowAllEntries(false);
  }, [entries]);

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
  const visibleEntries = showAllEntries ? entries : entries.slice(0, MAX_VISIBLE_ENTRIES);
  const hiddenEntryCount = Math.max(0, entries.length - MAX_VISIBLE_ENTRIES);
  const statsText = stats.directories > 0
    ? t('toolCards.ls.filesAndDirs', { files: stats.files, directories: stats.directories })
    : t('toolCards.ls.filesCount', { count: stats.files });

  useEffect(() => {
    if (!hasDetails) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      invalidateFlowLayout({
        source: toolItem.toolName,
        toolId: toolId ?? null,
        reason: showAllEntries ? 'ls-show-all' : 'ls-results-layout',
        priority: 'high',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasDetails, showAllEntries, toolId, toolItem.toolName, visibleEntries.length]);

  const renderContent = () => {
    if (isCompleted) {
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
    <div className="ls-display-card__table-wrap">
      <table className="ls-display-card__table">
        <tbody>
          {visibleEntries.map((entry: LSEntry, index: number) => {
            const entryName = entry.name || entry.path;
            const entryTitle = entry.path || entry.name;

            return (
              <tr key={`${entryTitle}-${index}`}>
                <td>
                  <span className="ls-display-card__entry-result">
                    {entry.is_dir ? (
                      <Folder size={13} className="ls-display-card__entry-icon" />
                    ) : (
                      <File size={13} className="ls-display-card__entry-icon" />
                    )}
                    <span className="ls-display-card__entry-name" title={entryTitle}>
                      {entryName}
                    </span>
                  </span>
                </td>
              </tr>
            );
          })}
          {!showAllEntries && hiddenEntryCount > 0 && (
            <tr>
              <td className="ls-display-card__more">
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowAllEntries(true);
                  }}
                >
                  <ChevronDown size={13} />
                  {t('toolCards.ls.moreEntries', { count: hiddenEntryCount })}
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
      className="ls-display-card"
      summary={renderContent()}
      expandedContent={hasDetails ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
