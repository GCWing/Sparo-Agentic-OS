/**
 * Tool card for GlobSearch file matching.
 */

import React, { useMemo } from 'react';
import { File, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { CompactToolTemplate } from './templates';
import { ToolStructuredDetails } from './ToolStructuredDetails';
export const GlobSearchDisplay: React.FC<ToolCardProps> = ({
  toolItem,
  onExpand
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
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

  const stats = useMemo(() => {
    if (files.length === 0) return { files: 0, directories: 0 };
    
    let fileCount = 0;
    let dirCount = 0;
    
    files.forEach((file: any) => {
      const fileName = typeof file === 'string' ? file : (file.name || file.path || '');
      if (fileName.includes('/') && fileName.endsWith('/')) {
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
  const hasDetails = status === 'completed' && files.length > 0;
  const hasResultData = toolResult?.result !== undefined && toolResult?.result !== null;

  const renderContent = () => {
    if (status === 'completed') {
      return `${t('toolCards.globSearch.searchFile')}: ${pattern}${hasResultData ? ` (${t('toolCards.globSearch.filesCount', { count: stats.files })})` : ''}`;
    }
    if (status === 'running' || status === 'streaming') {
      return `${t('toolCards.globSearch.searchingFile')} ${pattern}...`;
    }
    if (status === 'pending') {
      return `${t('toolCards.globSearch.preparingSearch')} ${pattern}`;
    }
    return pattern;
  };

  const renderExpandedContent = () => (
    <ToolStructuredDetails
      rows={[
        { label: `${t('toolCards.globSearch.labelPattern')}:`, value: pattern },
        { label: `${t('toolCards.globSearch.labelPath')}:`, value: searchPath },
        {
          label: `${t('toolCards.globSearch.labelStats')}:`,
          value: stats.directories > 0
              ? t('toolCards.globSearch.filesAndDirs', { files: stats.files, directories: stats.directories })
              : t('toolCards.globSearch.filesCount', { count: stats.files }),
        },
      ]}
    >
      <div className="compact-detail-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {files.slice(0, 50).map((file: any, index: number) => {
          const fileName = typeof file === 'string' ? file : (file.name || file.path || '');
          const isDir = fileName.endsWith('/');
          return (
            <div key={index} className="compact-list-item" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              padding: '4px 0', 
              fontSize: '11px',
              color: 'var(--color-text-secondary)'
            }}>
              {isDir ? (
                <Folder size={12} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
              ) : (
                <File size={12} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
              )}
              <span style={{ flex: 1, fontFamily: 'var(--tool-card-font-mono)', wordBreak: 'break-all' }}>
                {fileName}
              </span>
            </div>
          );
        })}
        {files.length > 50 && (
          <div style={{ 
            textAlign: 'center', 
            padding: '8px 0', 
            color: 'var(--color-text-muted)', 
            fontSize: '11px', 
            fontStyle: 'italic' 
          }}>
            {t('toolCards.globSearch.moreFiles', { count: files.length - 50 })}
          </div>
        )}
      </div>
    </ToolStructuredDetails>
  );

  if (status === 'error') {
    return null;
  }

  return (
    <CompactToolTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      summary={renderContent()}
      expandedContent={hasDetails ? renderExpandedContent() : undefined}
      onExpand={onExpand}
    />
  );
};
