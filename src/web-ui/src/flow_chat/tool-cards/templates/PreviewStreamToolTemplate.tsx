import React from 'react';
import { BaseToolCard } from '../BaseToolCard';
import { type ToolCardStatus } from '../ToolStatusIndicator';
import { ToolHeaderLayout } from '../ToolHeaderLayout';
import { useToolDisclosureController } from '../ToolDisclosureController';

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
  isFailed = status === 'error',
  requiresConfirmation = false,
  autoCollapseStatuses = ['completed', 'cancelled'],
  className = '',
  onExpand,
}) => {
  const hasPreview = Boolean(previewContent);
  const { cardRootRef, isExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: status === 'preparing' || status === 'streaming' || status === 'running' || status === 'receiving',
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
            content={subject}
            extra={extra}
            status={status}
          />
        )}
        expandedContent={isExpanded ? previewContent : undefined}
        errorContent={isExpanded ? errorContent : undefined}
        isFailed={isFailed}
        requiresConfirmation={requiresConfirmation}
      />
    </div>
  );
};
