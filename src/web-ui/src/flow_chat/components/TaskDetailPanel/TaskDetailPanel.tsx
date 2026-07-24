/**
 * TaskDetailPanel - Subtask detail panel.
 * Minimal layout to match the FlowChat background.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Split,
  Clock,
  AlertCircle,
  ArrowDown
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { FlowToolItem, FlowTextItem, FlowThinkingItem, FlowItem } from '../../types/flow-chat';
import { FlowTextBlock } from '../FlowTextBlock';
import { FlowToolCard } from '../FlowToolCard';
import { ModelThinkingDisplay } from '../../tool-cards/ModelThinkingDisplay';
import { useSubagentExecution } from '../../execution';
import { getTaskExecutionVirtualItems } from '../../projections/flowChatProjectionScheduler';
import { getToolViewState } from '../../runtime/toolViewState';
import { FLOW_SCROLL_BOTTOM_THRESHOLD_PX } from '../../scroll/FlowScrollPolicy';
import { useTaskDetailPanelScrollController } from '../../scroll/adapters/useTaskDetailPanelScrollController';
import { Tooltip, DotMatrixLoader, IconButton } from '@/design-system';
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
  const persistedSubagentRun = toolItem?.executionProjection?.kind === 'subagentRun'
    && toolItem.executionProjection.edgeKind === 'delegates'
    ? toolItem.executionProjection
    : null;
  const subagentRun = liveSubagentRun ?? persistedSubagentRun;
  const subagentItems = useMemo(() => getTaskExecutionVirtualItems(subagentRun), [subagentRun]);
  
  const isRunning = toolViewState?.isLive === true;
  const isFailed = toolViewState?.phase === 'error';
  const isCompleted = toolViewState?.phase === 'result' && !isFailed;
  const lastSubagentItem = subagentItems[subagentItems.length - 1] as FlowItem | undefined;
  const tailSignature = useMemo(() => {
    if (!lastSubagentItem) {
      return `${taskToolId || 'none'}:empty:${subagentRun?.updatedAt ?? 0}`;
    }

    const contentLength =
      (lastSubagentItem.type === 'text' || lastSubagentItem.type === 'thinking')
        ? String((lastSubagentItem as FlowTextItem | FlowThinkingItem).content ?? '').length
        : 0;

    return [
      taskToolId || 'none',
      subagentItems.length,
      lastSubagentItem.id,
      lastSubagentItem.type,
      lastSubagentItem.status || '',
      contentLength,
      subagentRun?.updatedAt ?? 0,
    ].join(':');
  }, [lastSubagentItem, subagentItems.length, subagentRun?.updatedAt, taskToolId]);
  const {
    virtuosoRef,
    executionElementRef,
    isAtBottom,
    handleScrollerRef,
    handleAtBottomStateChange,
    handlePromptToggle,
    scrollToLatest,
  } = useTaskDetailPanelScrollController({
    isStreaming: isRunning,
    itemCount: subagentItems.length,
    resetKey: `${sessionId || 'none'}:${taskToolId || 'none'}`,
    tailSignature,
  });

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
          <details className="task-detail-panel__prompt-section" onToggle={handlePromptToggle}>
            <summary>{t('toolCards.taskDetailPanel.promptLabel')}</summary>
            <pre className="task-detail-panel__prompt-content">{taskInput.prompt}</pre>
          </details>
        )}

        {subagentItems.length > 0 && (
          <div
            ref={executionElementRef}
            className="task-detail-panel__execution"
            data-testid="task-detail-panel-execution"
          >
            <Virtuoso
              ref={virtuosoRef}
              className="task-detail-panel__execution-virtual-list"
              data-testid="task-detail-panel-virtual-list"
              data={subagentItems}
              followOutput={false}
              atBottomThreshold={FLOW_SCROLL_BOTTOM_THRESHOLD_PX}
              atBottomStateChange={handleAtBottomStateChange}
              increaseViewportBy={{ top: 220, bottom: 320 }}
              initialItemCount={Math.min(subagentItems.length, 12)}
              scrollerRef={handleScrollerRef}
              computeItemKey={(index, item) => `${item.id}-${index}`}
              itemContent={(_index, item) => renderSubagentItem(item)}
            />
            {!isAtBottom && (
              <div className="task-detail-panel__scroll-to-latest">
                <IconButton
                  className="task-detail-panel__scroll-to-latest-button"
                  shape="circle"
                  size="small"
                  variant="ghost"
                  onClick={() => scrollToLatest('smooth')}
                  aria-label={t('scroll.toLatest')}
                  tooltip={t('scroll.toLatest')}
                >
                  <ArrowDown size={15} />
                </IconButton>
              </div>
            )}
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
