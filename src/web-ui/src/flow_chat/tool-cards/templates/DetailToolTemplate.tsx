import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BaseToolCard } from '../BaseToolCard';
import type { ToolCardStatus } from '../toolStatus';
import { isToolStatusFailed } from '../toolStatus';
import { ToolHeaderLayout } from '../ToolHeaderLayout';
import type { ToolRightRailProps } from '../ToolRightRail';
import { useToolDisclosureController } from '../ToolDisclosureController';
import { ToolInlineInterruptionNote, useToolInterruptionNote } from '../ToolInterruptionNoteContext';

export interface DetailToolTemplateProps {
  toolId?: string;
  toolName: string;
  status: ToolCardStatus;
  icon?: React.ReactNode;
  iconClassName?: string;
  action?: string;
  subject?: React.ReactNode;
  extra?: React.ReactNode;
  headerRail?: ToolRightRailProps;
  expandedContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  isFailed?: boolean;
  requiresConfirmation?: boolean;
  className?: string;
  onExpand?: () => void;
  /**
   * Inline disclosure renders expanded/error content below the header.
   * Use `none` for cards whose details live in a right-side panel opened
   * from `extra`.
   */
  disclosureMode?: 'inline' | 'none';
  /** Some panel-only cards keep status styling but do not need a right status glyph. */
  showStatusIcon?: boolean;
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
  headerRail,
  expandedContent,
  errorContent,
  isFailed,
  requiresConfirmation = false,
  className = '',
  onExpand,
  disclosureMode = 'inline',
  showStatusIcon = true,
}) => {
  const interruptionNote = useToolInterruptionNote();
  const resolvedIsFailed = isFailed ?? isToolStatusFailed(status);
  const hasExpandedContent = Boolean(expandedContent);
  const canInlineDisclose =
    disclosureMode === 'inline' &&
    (hasExpandedContent || Boolean(errorContent));
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
        onClick={canInlineDisclose ? () => toggleExpanded('manual') : undefined}
        className={className}
        headerExpandAffordance={canInlineDisclose}
        headerRail={headerRail}
        header={(
          <ToolHeaderLayout
            icon={icon}
            iconClassName={iconClassName}
            action={action}
            content={interruptionNote ? <ToolInlineInterruptionNote note={interruptionNote} subject={subject} /> : subject}
            extra={(
              <>
                {extra}
                {canInlineDisclose && (
                  <span className="detail-tool-template__chevron" aria-hidden>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                )}
              </>
            )}
            status={showStatusIcon ? status : undefined}
          />
        )}
        expandedContent={canInlineDisclose && isExpanded ? expandedContent : undefined}
        errorContent={canInlineDisclose && isExpanded ? errorContent : undefined}
        isFailed={resolvedIsFailed}
        requiresConfirmation={requiresConfirmation}
      />
    </div>
  );
};
