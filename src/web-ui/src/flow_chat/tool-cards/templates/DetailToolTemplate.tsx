import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BaseToolCard } from '../BaseToolCard';
import { type ToolCardStatus } from '../ToolStatusIndicator';
import { ToolHeaderLayout } from '../ToolHeaderLayout';
import { useToolDisclosureController } from '../ToolDisclosureController';

export interface DetailToolTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  icon?: React.ReactNode;
  iconClassName?: string;
  action?: string;
  subject?: React.ReactNode;
  extra?: React.ReactNode;
  expandedContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  isFailed?: boolean;
  requiresConfirmation?: boolean;
  className?: string;
  onExpand?: () => void;
}

export const DetailToolTemplate: React.FC<DetailToolTemplateProps> = ({
  toolId,
  toolName,
  status,
  icon,
  iconClassName,
  action,
  subject,
  extra,
  expandedContent,
  errorContent,
  isFailed = status === 'error',
  requiresConfirmation = false,
  className = '',
  onExpand,
}) => {
  const hasExpandedContent = Boolean(expandedContent);
  const { cardRootRef, isExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: false,
    onExpand,
  });

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <BaseToolCard
        status={status}
        isExpanded={isExpanded}
        onClick={hasExpandedContent || errorContent ? () => toggleExpanded('manual') : undefined}
        className={className}
        headerExpandAffordance={hasExpandedContent || Boolean(errorContent)}
        header={(
          <ToolHeaderLayout
            icon={icon}
            iconClassName={iconClassName}
            action={action}
            content={subject}
            extra={(
              <>
                {extra}
                {(hasExpandedContent || errorContent) && (
                  <span className="detail-tool-template__chevron" aria-hidden>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                )}
              </>
            )}
            status={status}
          />
        )}
        expandedContent={isExpanded ? expandedContent : undefined}
        errorContent={isExpanded ? errorContent : undefined}
        isFailed={isFailed}
        requiresConfirmation={requiresConfirmation}
      />
    </div>
  );
};
