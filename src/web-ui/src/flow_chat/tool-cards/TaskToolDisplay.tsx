/**
 * TaskTool card display component.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Split,
  Timer,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@/design-system';
import { Markdown } from '@/shared/markdown/Markdown';
import type { FlowItem, FlowTextItem, FlowThinkingItem, FlowToolItem, ToolCardProps } from '../types/flow-chat';
import { taskCollapseStateManager } from '../store/TaskCollapseStateManager';
import { useFlowLayoutMutationContract } from '../scroll/useFlowLayoutMutationContract';
import { useSubagentExecution } from '../execution';
import { getToolViewState } from '../runtime/toolViewState';
import { FlowTextBlock } from '../components/FlowTextBlock';
import { FlowToolCard } from '../components/FlowToolCard';
import { ModelThinkingDisplay } from './ModelThinkingDisplay';
import {
  HeavyToolCardTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
import './TaskToolDisplay.scss';
import './ModelThinkingDisplay.scss';

export const TaskToolDisplay: React.FC<ToolCardProps> = ({
  toolItem,
  onConfirm,
  onReject,
  onOpenInPanel,
  sessionId,
  interruptionNote,
}) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const toolViewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;
  const liveSubagentRun = useSubagentExecution(sessionId, toolItem.id);
  const subagentRun = liveSubagentRun ?? toolItem.executionProjection ?? null;
  const hasSubagentRun = Boolean(subagentRun);
  const userDisclosureTouchedRef = useRef(false);
  
  // Restore collapse state; default to collapsed until running.
  const [isExpanded, setIsExpanded] = useState(() => {
    const savedState = taskCollapseStateManager.getCollapsedOrUndefined(toolItem.id);
    if (savedState !== undefined) {
      return !savedState;
    }
    return false;
  });
  
  const isRunning = toolViewState.isLive && (
    toolViewState.phase === 'preparing' ||
    toolViewState.phase === 'receiving_input' ||
    toolViewState.phase === 'ready' ||
    toolViewState.phase === 'running'
  );
  const isCompleted = toolViewState.phase === 'result';
  
  const { cardRootRef, applyExpandedState } = useFlowLayoutMutationContract({
    toolId,
    toolName: toolItem.toolName,
  });
  
  const prevPhaseRef = useRef(toolViewState.phase);

  const updateCardExpandedState = useCallback((
    nextExpanded: boolean,
    reason: 'manual' | 'auto' = 'manual',
  ) => {
    applyExpandedState(isExpanded, nextExpanded, setIsExpanded, { reason });
  }, [applyExpandedState, isExpanded]);

  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    
    if (prevPhase !== toolViewState.phase) {
      prevPhaseRef.current = toolViewState.phase;
      
      if (isCompleted) {
        updateCardExpandedState(false, 'auto');
      }
    }
  }, [isCompleted, toolViewState.phase, updateCardExpandedState]);
  
  useEffect(() => {
    taskCollapseStateManager.setCollapsed(toolItem.id, !isExpanded);
  }, [isExpanded, toolItem.id]);

  // Detect full-width characters for visual width estimation.
  const isFullWidth = (char: string) => {
    const code = char.charCodeAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0x3040 && code <= 0x309F) ||
      (code >= 0x30A0 && code <= 0x30FF) ||
      (code >= 0xFF00 && code <= 0xFFEF)
    );
  };

  // Truncate by visual width (full-width counts as 2).
  const truncateByVisualWidth = (str: string, maxWidth: number) => {
    let width = 0;
    let result = '';
    
    for (const char of str) {
      const charWidth = isFullWidth(char) ? 2 : 1;
      
      if (width + charWidth > maxWidth) {
        return result + '...';
      }
      
      width += charWidth;
      result += char;
    }
    
    return result;
  };

  const getTaskInput = () => {
    if (!toolCall?.input) return null;
    
    const isEarlyDetection = toolCall.input._early_detection === true;
    const isPartialParams = toolCall.input._partial_params === true;
    
    if (isEarlyDetection || isPartialParams) {
      return null;
    }
    
    const inputKeys = Object.keys(toolCall.input).filter(key => !key.startsWith('_'));
    if (inputKeys.length === 0) return null;
    
    const { description, prompt, subagent_type } = toolCall.input;
    return {
      description: description || (prompt ? truncateByVisualWidth(prompt, 70) : 'Not provided'),
      prompt: prompt || 'Not provided',
      agentType: subagent_type || 'Not provided'
    };
  };

  const taskInput = getTaskInput();
  const hasRealPrompt = Boolean(
    taskInput && taskInput.prompt && taskInput.prompt !== 'Not provided',
  );
  const needsConfirmation = toolViewState.phase === 'confirming';

  /* Prompt body: same scroll + Markdown shell as ModelThinkingDisplay. */
  const promptContentRef = useRef<HTMLDivElement>(null);
  const [promptScrollState, setPromptScrollState] = useState({
    hasScroll: false,
    atTop: true,
    atBottom: true,
  });

  const checkPromptScrollState = useCallback(() => {
    const el = promptContentRef.current;
    if (!el) return;
    setPromptScrollState({
      hasScroll: el.scrollHeight > el.clientHeight,
      atTop: el.scrollTop <= 5,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 5,
    });
  }, []);

  useEffect(() => {
    if (!isExpanded || !hasRealPrompt) return;
    const timer = setTimeout(checkPromptScrollState, 50);
    return () => clearTimeout(timer);
  }, [isExpanded, hasRealPrompt, taskInput?.prompt, checkPromptScrollState]);

  const isFailed =
    toolViewState.phase === 'error' ||
    (toolResult != null &&
      'success' in toolResult &&
      toolResult.success === false);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('.tool-actions') ||
      target.closest('.result-expand-toggle') ||
      target.closest('.tool-right-rail')
    ) {
      return;
    }

    if (
      isFailed &&
      !hasRealPrompt &&
      !interruptionNote
    ) {
      return;
    }

    userDisclosureTouchedRef.current = true;
    // Pause auto-scroll while the user toggles the card.
    updateCardExpandedState(!isExpanded);
  }, [
    isFailed,
    hasRealPrompt,
    interruptionNote,
    isExpanded,
    updateCardExpandedState,
  ]);

  const showHeaderExpandHint =
    hasRealPrompt ||
    needsConfirmation ||
    Boolean(interruptionNote) ||
    hasSubagentRun;

  const taskHeaderLine = useMemo(() => {
    const desc =
      (taskInput?.description || '').trim() || t('toolCards.taskDetailPanel.untitled');
    const raw = taskInput?.agentType;
    const agentTypeLabel =
      raw && raw !== 'Not provided'
        ? raw
        : t('toolCards.taskTool.defaultAgentKind');
    return t('toolCards.taskTool.headerLine', {
      agentType: agentTypeLabel,
      description: desc,
    });
  }, [taskInput, t]);

  const openTaskDetailPanel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!userDisclosureTouchedRef.current) {
        updateCardExpandedState(false, 'auto');
      }
      const panelData = { toolItem, taskInput, sessionId };
      const tabInfo = {
        type: 'task-detail',
        title: taskHeaderLine,
        data: panelData,
        metadata: { taskId: toolItem.id },
      };
      if (onOpenInPanel) {
        onOpenInPanel(tabInfo.type, tabInfo);
      } else {
        window.dispatchEvent(new CustomEvent('agent-create-tab', { detail: tabInfo }));
      }
    },
    [onOpenInPanel, sessionId, taskInput, toolItem, taskHeaderLine, updateCardExpandedState],
  );

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  };

  const headerMeta = (
    <>
      {isCompleted && toolResult?.result?.duration && (
        <span className="duration-text">
          <Timer size={13} strokeWidth={2} />
          {formatDuration(toolResult.result.duration)}
        </span>
      )}
      {isFailed && (
        <span className="task-failed-badge">{t('toolCards.taskTool.failed')}</span>
      )}
      {interruptionNote && !isExpanded && (
        <Tooltip content={interruptionNote} placement="top">
          <span
            className="task-interruption-indicator"
            aria-label={interruptionNote}
          >
            <AlertTriangle size={13} strokeWidth={2} aria-hidden />
          </span>
        </Tooltip>
      )}
    </>
  );

  const renderExecutionItem = (item: FlowItem) => {
    switch (item.type) {
      case 'text':
        return <FlowTextBlock key={item.id} textItem={item as FlowTextItem} />;
      case 'thinking':
        return <ModelThinkingDisplay key={item.id} thinkingItem={item as FlowThinkingItem} />;
      case 'tool': {
        const tool = item as FlowToolItem;
        return (
          <FlowToolCard
            key={tool.id}
            toolItem={tool}
            sessionId={sessionId}
            onOpenInPanel={onOpenInPanel}
            className="task-subagent-nested-tool-card"
          />
        );
      }
      default:
        return null;
    }
  };

  const renderSubagentSummary = () => {
    if (!subagentRun) return null;
    const { summary } = subagentRun;
    return (
      <div className="task-subagent-summary" data-execution-node-id={subagentRun.id}>
        <span className="task-subagent-summary__status">{summary.status}</span>
        <span className="task-subagent-summary__label">{summary.latestLabel}</span>
        {summary.latestDetail && (
          <span className="task-subagent-summary__detail">{summary.latestDetail}</span>
        )}
      </div>
    );
  };

  const renderSubagentLiveLine = () => {
    if (!subagentRun) return null;
    const { summary } = subagentRun;
    return (
      <div className="task-subagent-live-line" data-execution-node-id={subagentRun.id}>
        <span className="task-subagent-live-line__status">{summary.status}</span>
        <span className="task-subagent-live-line__label">{summary.latestLabel}</span>
        {summary.latestDetail && (
          <span className="task-subagent-live-line__detail">{summary.latestDetail}</span>
        )}
      </div>
    );
  };

  const renderExpandedContent = () => {
    if (!hasRealPrompt && !needsConfirmation && !interruptionNote && !subagentRun) {
      return null;
    }

    if (isFailed) {
      if (!hasRealPrompt && !interruptionNote) {
        return null;
      }
      const hasBodyBelowInterruption = Boolean(hasRealPrompt);
      return (
        <div className="task-expanded-content">
          {interruptionNote && (
            <div
              className={
                'task-tool-card-interruption' +
                (hasBodyBelowInterruption ? ' task-tool-card-interruption--has-below' : '')
              }
            >
              <div className="flow-tool-card-note" role="note">
                <AlertTriangle size={13} strokeWidth={2} aria-hidden />
                {interruptionNote}
              </div>
            </div>
          )}
          {hasRealPrompt && (
            <div
              className={`thinking-content-wrapper${promptScrollState.hasScroll ? ' has-scroll' : ''}${
                promptScrollState.atTop ? ' at-top' : ''
              }${promptScrollState.atBottom ? ' at-bottom' : ''}`}
            >
              <div
                ref={promptContentRef}
                className="thinking-content expanded"
                onScroll={checkPromptScrollState}
              >
                <Markdown
                  content={taskInput!.prompt}
                  isStreaming={false}
                  className="thinking-markdown"
                />
              </div>
            </div>
          )}
        </div>
      );
    }

    const hasBodyBelowInterruption = Boolean(hasRealPrompt || needsConfirmation);

    return (
      <div className="task-expanded-content">
        {interruptionNote && (
          <div
            className={
              'task-tool-card-interruption' +
              (hasBodyBelowInterruption ? ' task-tool-card-interruption--has-below' : '')
            }
          >
            <div className="flow-tool-card-note" role="note">
              <AlertTriangle size={13} strokeWidth={2} aria-hidden />
              {interruptionNote}
            </div>
          </div>
        )}
        {hasRealPrompt && (
          <div
            className={`thinking-content-wrapper${promptScrollState.hasScroll ? ' has-scroll' : ''}${
              promptScrollState.atTop ? ' at-top' : ''
            }${promptScrollState.atBottom ? ' at-bottom' : ''}`}
          >
            <div
              ref={promptContentRef}
              className="thinking-content expanded"
              onScroll={checkPromptScrollState}
            >
              <Markdown
                content={taskInput!.prompt}
                isStreaming={false}
                className="thinking-markdown"
              />
            </div>
          </div>
        )}
        {needsConfirmation && (
          <div className="tool-actions">
            <Button
              variant="primary"
              size="small"
              onClick={() => onConfirm?.(toolCall?.input)}
              disabled={!toolViewState.canConfirm}
            >
              {t('toolCards.taskTool.confirmDelegate')}
            </Button>
            <Button
              variant="danger"
              size="small"
              onClick={() => onReject?.()}
              disabled={!toolViewState.canReject}
            >
              {t('toolCards.taskTool.cancel')}
            </Button>
          </div>
        )}
        {subagentRun && (
          <div className="task-subagent-inline-timeline">
            {subagentRun.items.length > 0
              ? subagentRun.items.map(item => renderExecutionItem(item))
              : renderSubagentSummary()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <HeavyToolCardTemplate
        toolId={toolId}
        toolName={toolItem.toolName}
        status={status}
        isExpanded={isExpanded}
        onClick={handleCardClick}
        icon={<Split size={16} />}
        title={taskHeaderLine}
        meta={headerMeta}
        headerSubline={renderSubagentLiveLine()}
        isRunning={isRunning}
        showHeaderExpandHint={showHeaderExpandHint}
        className="task-tool-display"
        headerRail={{
          className: 'task-header-rail',
          label: t('toolCards.taskTool.openInPanel'),
          onClick: openTaskDetailPanel,
          icon: (
            <>
              <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
              <div className="task-status-icon task-status-icon--rail">
                {renderHeavyToolRunningStatus(isRunning)}
              </div>
            </>
          ),
        }}
        expandedContent={renderExpandedContent()}
        isFailed={isFailed}
        allowExpandedContentWhenFailed
        requiresConfirmation={needsConfirmation}
      />
    </div>
  );
};
