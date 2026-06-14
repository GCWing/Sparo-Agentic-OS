import React from 'react';
import { ChevronDown } from 'lucide-react';
import { CubeLoading } from '@/design-system';
import { BaseToolCard } from '../BaseToolCard';
import type { ToolRightRailProps } from '../ToolRightRail';
import type { ToolCardStatus } from '../toolStatus';
import { useToolDisclosureController } from '../ToolDisclosureController';
import { ToolInlineInterruptionNote, useToolInterruptionNote } from '../ToolInterruptionNoteContext';
import './HeavyToolCardTemplate.scss';

export interface HeavyToolCardTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  isExpanded?: boolean;
  title: React.ReactNode;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  headerSubline?: React.ReactNode;
  isRunning?: boolean;
  isFailed?: boolean;
  className?: string;
  showHeaderExpandHint?: boolean;
  headerRail?: ToolRightRailProps;
  expandedContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  requiresConfirmation?: boolean;
  allowExpandedContentWhenFailed?: boolean;
  onExpand?: () => void;
  onToggle?: (nextExpanded: boolean, event: React.MouseEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
}

export const HeavyToolCardTemplate: React.FC<HeavyToolCardTemplateProps> = ({
  toolId,
  toolName,
  status,
  isExpanded: controlledExpanded,
  title,
  icon,
  meta,
  headerSubline,
  isRunning = false,
  isFailed = false,
  className = '',
  showHeaderExpandHint = false,
  headerRail,
  expandedContent,
  errorContent,
  requiresConfirmation = false,
  allowExpandedContentWhenFailed = false,
  onExpand,
  onToggle,
  onClick,
}) => {
  const interruptionNote = useToolInterruptionNote();
  const hasDetails = Boolean(expandedContent || errorContent);
  const { cardRootRef, isExpanded: uncontrolledExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: false,
    onExpand,
  });
  const isExpanded = controlledExpanded ?? uncontrolledExpanded;
  const canToggleInline = showHeaderExpandHint || hasDetails;

  const handleClick = (event: React.MouseEvent) => {
    if (onClick) {
      onClick(event);
      return;
    }
    if (!canToggleInline) {
      return;
    }
    if (onToggle) {
      onToggle(!isExpanded, event);
      return;
    }
    toggleExpanded('manual');
  };

  const header = (
    <div className="task-header-wrapper">
      <div
        className={`task-icon-container ${isRunning ? 'is-running' : ''}${
          showHeaderExpandHint ? ' task-icon-container--expandable' : ''
        }`}
      >
        <div className="task-task-icon-marks">
          <div className="task-task-icon-main">{icon}</div>
          {showHeaderExpandHint && (
            <span
              className={`task-task-icon-hint${isExpanded ? ' task-task-icon-hint--open' : ''}`}
              aria-hidden
            >
              <ChevronDown size={16} strokeWidth={2} absoluteStrokeWidth />
            </span>
          )}
        </div>
      </div>

      <div className="task-content-wrapper">
        <div className="task-body-columns">
          <div className="task-body-main">
            <div className={`task-header-main ${isFailed ? 'task-header-main--failed' : ''}`}>
              <span className="task-action">
                {interruptionNote ? <ToolInlineInterruptionNote note={interruptionNote} subject={title} /> : title}
              </span>
              {meta && <div className="task-header-meta">{meta}</div>}
            </div>
            {headerSubline && (
              <div className="task-header-subline">
                {headerSubline}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  const resolvedHeaderRail = headerRail ? {
    ...headerRail,
    className: ['task-header-rail', headerRail.className].filter(Boolean).join(' '),
  } : undefined;

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <BaseToolCard
        status={status}
        isExpanded={isExpanded}
        onClick={canToggleInline || onClick ? handleClick : undefined}
        className={['heavy-tool-card-template', 'task-tool-display', className].filter(Boolean).join(' ')}
        header={header}
        headerRail={resolvedHeaderRail}
        expandedContent={isExpanded ? expandedContent : undefined}
        errorContent={errorContent}
        headerExpandAffordance={canToggleInline}
        isFailed={isFailed}
        allowExpandedContentWhenFailed={allowExpandedContentWhenFailed}
        requiresConfirmation={requiresConfirmation}
      />
    </div>
  );
};

export function renderHeavyToolRunningStatus(isRunning: boolean): React.ReactNode {
  if (!isRunning) {
    return null;
  }
  return <CubeLoading size="small" />;
}
