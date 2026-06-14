import React from 'react';
import { Tooltip } from '@/design-system';
import { CompactToolCard } from '../CompactToolCard';
import { ToolStatusIndicator } from '../ToolStatusIndicator';
import type { ToolCardStatus } from '../toolStatus';
import { ToolCompactHeaderLayout } from '../ToolHeaderLayout';
import { useToolDisclosureController } from '../ToolDisclosureController';
import { ToolInlineInterruptionNote, useToolInterruptionNote } from '../ToolInterruptionNoteContext';
import './DefaultToolCardTemplate.scss';

export interface DefaultToolCardPrimaryAction {
  icon: React.ReactNode;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  disabled?: boolean;
  visibility?: 'hover' | 'always';
}

export interface DefaultToolCardTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  action?: React.ReactNode;
  summary: React.ReactNode;
  extra?: React.ReactNode;
  statusIcon?: React.ReactNode;
  primaryAction?: DefaultToolCardPrimaryAction;
  expandedContent?: React.ReactNode;
  interruptionNote?: string | null;
  className?: string;
  isExpanded?: boolean;
  expandable?: boolean;
  onToggle?: (nextExpanded: boolean, event: React.MouseEvent) => void;
  onExpand?: () => void;
  onClick?: () => void;
}

export const DefaultToolCardTemplate: React.FC<DefaultToolCardTemplateProps> = ({
  toolId,
  toolName,
  status,
  action,
  summary,
  extra,
  statusIcon,
  primaryAction,
  expandedContent,
  interruptionNote,
  className = '',
  isExpanded: controlledExpanded,
  expandable,
  onToggle,
  onExpand,
  onClick,
}) => {
  const contextInterruptionNote = useToolInterruptionNote();
  const resolvedInterruptionNote = interruptionNote ?? contextInterruptionNote;
  const hasExpandedContent = Boolean(expandedContent);
  const templateExpandable = expandable ?? hasExpandedContent;
  const clickable = templateExpandable || Boolean(onClick);
  const { cardRootRef, isExpanded: uncontrolledExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: false,
    onExpand,
  });
  const isExpanded = controlledExpanded ?? uncontrolledExpanded;

  const handleCardClick = (event: React.MouseEvent) => {
    if (!clickable) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('.default-tool-card-template__action')) {
      return;
    }

    if (templateExpandable) {
      if (onToggle) {
        onToggle(!isExpanded, event);
      } else {
        toggleExpanded('manual');
      }
      return;
    }

    onClick?.();
  };

  const primaryActionNode = primaryAction ? (
    <Tooltip content={primaryAction.label} placement="top">
      <button
        type="button"
        className={[
          'default-tool-card-template__action',
          primaryAction.visibility === 'always' ? 'default-tool-card-template__action--always-visible' : '',
          primaryAction.className ?? '',
        ].filter(Boolean).join(' ')}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          primaryAction.onClick(event);
        }}
        aria-label={primaryAction.label}
        disabled={primaryAction.disabled}
      >
        {primaryAction.icon}
      </button>
    </Tooltip>
  ) : null;
  const summaryNode = (
    <>
      {resolvedInterruptionNote
        ? <ToolInlineInterruptionNote note={resolvedInterruptionNote} subject={summary} />
        : summary}
      {primaryActionNode}
    </>
  );
  const extraNode = extra ? (
    <>
      {extra}
    </>
  ) : undefined;

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <CompactToolCard
        status={status}
        isExpanded={isExpanded}
        className={className}
        clickable={clickable}
        onClick={clickable ? handleCardClick : undefined}
        header={(
          <ToolCompactHeaderLayout
            statusIcon={statusIcon ?? <ToolStatusIndicator status={status} size={12} />}
            expandable={templateExpandable}
            isExpanded={isExpanded}
            action={action}
            content={summaryNode}
            extra={extraNode}
          />
        )}
        expandedContent={isExpanded ? expandedContent : undefined}
      />
    </div>
  );
};
