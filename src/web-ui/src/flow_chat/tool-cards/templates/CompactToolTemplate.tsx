import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CompactToolCard } from '../CompactToolCard';
import { ToolStatusIndicator } from '../ToolStatusIndicator';
import type { ToolCardStatus } from '../toolStatus';
import { ToolCompactHeaderLayout } from '../ToolHeaderLayout';
import { useToolDisclosureController } from '../ToolDisclosureController';

export interface CompactToolTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  action?: React.ReactNode;
  summary: React.ReactNode;
  extra?: React.ReactNode;
  statusIcon?: React.ReactNode;
  expandedContent?: React.ReactNode;
  className?: string;
  onExpand?: () => void;
  onClick?: () => void;
}

export const CompactToolTemplate: React.FC<CompactToolTemplateProps> = ({
  toolId,
  toolName,
  status,
  action,
  summary,
  extra,
  statusIcon,
  expandedContent,
  className = '',
  onExpand,
  onClick,
}) => {
  const hasExpandedContent = Boolean(expandedContent);
  const clickable = hasExpandedContent || Boolean(onClick);
  const { cardRootRef, isExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName,
    status,
    initialExpanded: false,
    onExpand,
  });

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId ?? ''}>
      <CompactToolCard
        status={status}
        isExpanded={isExpanded}
        className={className}
        clickable={clickable}
        onClick={clickable ? () => {
          if (hasExpandedContent) {
            toggleExpanded('manual');
            return;
          }
          onClick?.();
        } : undefined}
        header={(
          <ToolCompactHeaderLayout
            statusIcon={statusIcon ?? <ToolStatusIndicator status={status} size={12} />}
            action={action}
            content={summary}
            extra={extra}
            rightIcon={hasExpandedContent ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : undefined}
          />
        )}
        expandedContent={isExpanded ? expandedContent : undefined}
      />
    </div>
  );
};
