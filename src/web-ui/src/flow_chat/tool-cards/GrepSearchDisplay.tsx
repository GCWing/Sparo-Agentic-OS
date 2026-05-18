/**
 * Tool card for GrepSearch text queries.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { DefaultToolCardTemplate } from './templates';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import { ToolJsonPreview } from './ToolJsonPreview';
export const GrepSearchDisplay: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolId = toolItem.id ?? toolCall?.id;

  const getSearchPattern = (): string => {
    const pattern = toolCall?.input?.pattern || 
                   toolCall?.input?.search_pattern || 
                   toolCall?.input?.query ||
                   toolCall?.input?.text;
    
    if (!pattern) {
      const isEarlyDetection = toolCall?.input?._early_detection === true;
      const isPartialParams = toolCall?.input?._partial_params === true;
      
      if (isEarlyDetection || isPartialParams) {
        return t('toolCards.grepSearch.parsingPattern');
      }
      
      return t('toolCards.grepSearch.parsingPattern');
    }
    
    return pattern;
  };

  const getSearchPath = (): string => {
    return toolCall?.input?.path || t('toolCards.grepSearch.currentDirectory');
  };

  const stats = useMemo(() => {
    if (!toolResult?.result || typeof toolResult.result !== 'object') {
      return { matches: 0, files: 0 };
    }
    
    const fileCount = toolResult.result.file_count || 0;
    const totalMatches = toolResult.result.total_matches || 0;
    
    return {
      matches: totalMatches,
      files: fileCount
    };
  }, [toolResult]);

  const pattern = getSearchPattern();
  const searchPath = getSearchPath();
  const hasDetails = status === 'completed' && stats.matches > 0;
  const hasResultData = toolResult?.result !== undefined && toolResult?.result !== null;

  const renderContent = () => {
    if (status === 'completed') {
      return `${t('toolCards.grepSearch.searchText')}: ${pattern}${hasResultData ? ` (${t('toolCards.grepSearch.matchesCount', { count: stats.matches })})` : ''}`;
    }
    if (status === 'running' || status === 'streaming') {
      const progressMessage = (toolItem as any)._progressMessage;
      if (progressMessage) {
        return progressMessage;
      }
      return `${t('toolCards.grepSearch.searchingText')} ${pattern}...`;
    }
    if (status === 'pending') {
      return `${t('toolCards.grepSearch.preparingSearch')} ${pattern}`;
    }
    return pattern;
  };

  const renderExpandedContent = () => (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.grepSearch.labelPattern')}:`, value: pattern },
        { label: `${t('toolCards.grepSearch.labelPath')}:`, value: searchPath },
        { label: `${t('toolCards.grepSearch.labelStats')}:`, value: t('toolCards.grepSearch.matchesAndFiles', { matches: stats.matches, files: stats.files }) },
      ]}
    >
      {toolResult?.result?.result && (
        <div className="compact-result-content">
          <ToolJsonPreview value={toolResult.result.result} />
        </div>
      )}
    </ToolStructuredDetails>
  );

  if (status === 'error') {
    return null;
  }

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="grep-search-card"
      summary={renderContent()}
      expandedContent={hasDetails ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
