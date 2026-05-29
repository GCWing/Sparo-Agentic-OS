/**
 * Compact tool card for web_search.
 */

import React, { useMemo } from 'react';
import { Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { systemAPI } from '../../infrastructure/api';
import { DefaultToolCardTemplate } from './templates';
import { Tooltip } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import { getToolViewState } from '../runtime/toolViewState';

const log = createLogger('WebSearchCard');

export const WebSearchCard: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';
  const toolId = toolItem.id ?? toolCall?.id;

  const getSearchTerm = () => {
    const searchTerm = toolCall?.input?.search_term || toolCall?.input?.query;
    
    if (!searchTerm) {
      return t('toolCards.webSearch.parsingSearchTerm');
    }
    
    return searchTerm;
  };

  const searchResults = useMemo(() => {
    if (!toolResult?.result) return null;
    
    const result = toolResult.result;
    
    if (result.results && Array.isArray(result.results)) {
      return {
        results: result.results,
        summary: result.summary || result.content,
        total: result.results.length
      };
    }
    
    if (result.content) {
      return {
        results: [],
        summary: result.content,
        total: 0
      };
    }
    
    return null;
  }, [toolResult]);

  const handleOpenLink = async (url: string) => {
    if (url && url !== '#') {
      try {
        await systemAPI.openExternal(url);
      } catch (error) {
        log.error('Failed to open external URL', { url, error });
      }
    }
  };

  const searchTerm = getSearchTerm();
  const hasResultData = toolResult?.result !== undefined && toolResult?.result !== null;
  const hasResults = searchResults && searchResults.results.length > 0;

  const renderContent = () => {
    if (isCompleted) {
      const resultsText = hasResultData && searchResults 
        ? ` (${t('toolCards.webSearch.resultsCount', { count: searchResults.total || 0 })})` 
        : '';
      return `${t('toolCards.webSearch.searchTitle', { term: searchTerm })}${resultsText}`;
    }
    if (viewState.phase === 'running' || viewState.phase === 'receiving_input' || viewState.phase === 'preparing') {
      return t('toolCards.webSearch.searching', { term: searchTerm });
    }
    if (viewState.phase === 'ready') {
      return t('toolCards.webSearch.preparingSearch', { term: searchTerm });
    }
    return t('toolCards.webSearch.searchTitle', { term: searchTerm });
  };

  const renderExpandedContent = () => (
    <div className="compact-expanded-results-list">
      {searchResults?.results.map((result: any, index: number) => (
        <div key={index} className="compact-expanded-result-item">
          <Tooltip content={t('toolCards.webSearch.clickToOpenLink')}>
            <div 
              className="compact-expanded-result-title"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenLink(result.url);
              }}
            >
              <Link size={12} className="inline-icon" />
              {result.title || t('toolCards.webSearch.noTitle')}
            </div>
          </Tooltip>
          {result.snippet && (
            <div className="compact-expanded-result-snippet">{result.snippet}</div>
          )}
          <div className="compact-expanded-result-url">{result.url}</div>
        </div>
      ))}
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
      summary={renderContent()}
      expandedContent={hasResults ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
