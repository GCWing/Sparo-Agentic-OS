/**
 * TaskDetailPanel - Subtask detail panel.
 * Minimal layout to match the FlowChat background.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Split,
  Clock,
  AlertCircle
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { FlowToolItem, FlowTextItem, FlowThinkingItem, FlowItem } from '../../types/flow-chat';
import { FlowTextBlock } from '../FlowTextBlock';
import { FlowToolCard } from '../FlowToolCard';
import { ModelThinkingDisplay } from '../../tool-cards/ModelThinkingDisplay';
import { useSubagentExecution } from '../../execution';
import { getTaskExecutionVirtualItems } from '../../projections/flowChatProjectionScheduler';
import { getToolViewState } from '../../runtime/toolViewState';
import { Tooltip, DotMatrixLoader } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import './TaskDetailPanel.scss';

const log = createLogger('TaskDetailPanel');

export interface TaskDetailData {
  toolItem: FlowToolItem;
  taskInput: {
    description: string;
    prompt: string;
    agentType: string;
  } | null;
  sessionId?: string;
}

export interface TaskDetailPanelProps {
  data: TaskDetailData;
}

export const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({ data }) => {
  const { t } = useTranslation('flow-chat');
  const { toolItem, taskInput, sessionId } = data || {};
  const toolResult = toolItem?.toolResult;
  const toolViewState = toolItem ? getToolViewState(toolItem) : null;
  const taskToolId = toolItem?.id;
  const liveSubagentRun = useSubagentExecution(sessionId, taskToolId);
  const subagentRun = liveSubagentRun ?? toolItem?.executionProjection ?? null;
  const subagentItems = useMemo(() => getTaskExecutionVirtualItems(subagentRun), [subagentRun]);
  
  const isRunning = toolViewState?.isLive === true;
  const isFailed = toolViewState?.phase === 'error';
  const isCompleted = toolViewState?.phase === 'result' && !isFailed;

  const getErrorMessage = () => {
    if (toolResult && 'error' in toolResult) {
      return toolResult.error as string;
    }
    return t('toolCards.taskTool.subAgentFailed');
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  };

  // Open files in a split editor layout.
  const handleOpenInEditor = useCallback(async (filePath: string) => {
    if (!filePath) return;
    
    try {
      const { useAgentCanvasStore } = await import('@/app/components/panels/content-canvas/stores/canvasStore');
      const store = useAgentCanvasStore.getState();
      
      if (store.layout.splitMode === 'none') {
        store.setSplitMode('horizontal');
      }
      
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      
      store.addTab({
        type: 'code-editor',
        title: fileName,
        data: { filePath },
        metadata: { filePath }
      }, 'pinned', 'secondary');
      
    } catch (error) {
      log.error('Failed to open file', { filePath, error });
    }
  }, []);

  const renderSubagentItem = useCallback((item: FlowItem) => {
    switch (item.type) {
      case 'text':
        return (
          <FlowTextBlock
            key={item.id}
            textItem={item as FlowTextItem}
          />
        );
      
      case 'thinking':
        return (
          <ModelThinkingDisplay 
            key={item.id}
            thinkingItem={item as FlowThinkingItem} 
          />
        );
      
      case 'tool':
        return (
          <FlowToolCard
            key={item.id}
            toolItem={item as FlowToolItem}
            sessionId={sessionId}
            onOpenInEditor={handleOpenInEditor}
          />
        );
      
      default:
        return null;
    }
  }, [sessionId, handleOpenInEditor]);

  if (!toolItem) {
    return (
      <div className="task-detail-panel task-detail-panel--empty">
        <div className="task-detail-panel__header">
          <span className="task-detail-panel__header-title">
            {t('toolCards.taskDetailPanel.untitled')}
          </span>
        </div>
        <div className="task-detail-panel__empty-content">
          {t('toolCards.taskDetailPanel.noData', 'Unable to load task data')}
        </div>
      </div>
    );
  }

  return (
    <div className="task-detail-panel">
      <div className="task-detail-panel__header">
        <Split size={14} className="task-detail-panel__header-icon" />
        <span className="task-detail-panel__header-title">
          {taskInput?.description || t('toolCards.taskDetailPanel.untitled')}
        </span>
        {taskInput?.agentType && (
          <span className="task-detail-panel__header-badge">
            {taskInput.agentType}
          </span>
        )}
        {isCompleted && toolResult?.result?.duration && (
          <span className="task-detail-panel__header-duration">
            <Clock size={11} />
            {formatDuration(toolResult.result.duration)}
          </span>
        )}
        {isRunning && (
          <span className="task-detail-panel__header-loading">
            <DotMatrixLoader size="small" />
          </span>
        )}
        {isFailed && (
          <Tooltip content={getErrorMessage()} placement="bottom">
            <AlertCircle size={14} className="task-detail-panel__header-failed" />
          </Tooltip>
        )}
      </div>

      <div className="task-detail-panel__content">
        {taskInput?.prompt && taskInput.prompt !== 'Not provided' && (
          <details className="task-detail-panel__prompt-section">
            <summary>{t('toolCards.taskDetailPanel.promptLabel')}</summary>
            <pre className="task-detail-panel__prompt-content">{taskInput.prompt}</pre>
          </details>
        )}

        {subagentItems.length > 0 && (
          <div className="task-detail-panel__execution">
            <Virtuoso
              className="task-detail-panel__execution-virtual-list"
              data={subagentItems}
              followOutput={isRunning ? 'smooth' : false}
              increaseViewportBy={{ top: 220, bottom: 320 }}
              initialItemCount={Math.min(subagentItems.length, 12)}
              computeItemKey={(index, item) => `${item.id}-${index}`}
              itemContent={(_index, item) => renderSubagentItem(item)}
            />
          </div>
        )}

        {isRunning && subagentItems.length === 0 && (
          <div className="task-detail-panel__loading">
            <DotMatrixLoader size="medium" />
            <span>{subagentRun?.summary.latestLabel || t('toolCards.taskDetailPanel.status.running')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskDetailPanel;
