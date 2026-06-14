import React from 'react';
import { BaseToolCard } from '../BaseToolCard';
import type { ToolCardStatus } from '../toolStatus';
import { isToolStatusFailed, isToolStatusLoading } from '../toolStatus';
import { ToolHeaderLayout } from '../ToolHeaderLayout';
import { useToolDisclosureController } from '../ToolDisclosureController';
import { ToolInlineInterruptionNote, useToolInterruptionNote } from '../ToolInterruptionNoteContext';

export interface PreviewStreamToolTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  icon?: React.ReactNode;
  iconClassName?: string;
  action?: string;
  subject?: React.ReactNode;
  extra?: React.ReactNode;
  previewContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  isFailed?: boolean;
  requiresConfirmation?: boolean;
  autoCollapseStatuses?: ToolCardStatus[];
  className?: string;
  onExpand?: () => void;
}

export const PreviewStreamToolTemplate: React.FC<PreviewStreamToolTemplateProps> = ({
  toolId,
  toolName,
  status,
  icon,
  iconClassName,
  action,
  subject,
  extra,
  previewContent,
  errorContent,
  isFailed,
  requiresConfirmation = false,
  autoCollapseStatuses = ['completed', 'cancelled'],
  className = '',
  onExpand,
}) => {
  const interruptionNote = useToolInterruptionNote();
  const hasPreview = Boolean(previewContent);
  const resolvedIsFailed = isFailed ?? isToolStatusFailed(status);
  const { cardRootRef, isExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: isToolStatusLoading(status),
    autoExpandStatuses: ['preparing', 'streaming', 'running', 'receiving'],
    autoCollapseStatuses,
    onExpand,
  });

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <BaseToolCard
        status={status}
        isExpanded={isExpanded}
        onClick={hasPreview || errorContent ? () => toggleExpanded('manual') : undefined}
        className={className}
        headerExpandAffordance={hasPreview || Boolean(errorContent)}
        header={(
          <ToolHeaderLayout
            icon={icon}
            iconClassName={iconClassName}
            action={action}
            content={interruptionNote ? <ToolInlineInterruptionNote note={interruptionNote} subject={subject} /> : subject}
            extra={extra}
            status={status}
          />
        )}
        expandedContent={isExpanded ? previewContent : undefined}
        errorContent={isExpanded ? errorContent : undefined}
        isFailed={resolvedIsFailed}
        requiresConfirmation={requiresConfirmation}
      />
    </div>
  );
};
