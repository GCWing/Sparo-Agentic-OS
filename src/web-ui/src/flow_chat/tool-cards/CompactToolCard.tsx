/**
 * Compact tool card component
 * Used for ReadFile, GrepSearch, WebSearch, etc. with transparent gray background
 *
 * Features:
 * - Collapsed: transparent background, no border, single-line display
 * - Expanded: keeps header and details in one lightweight card surface
 * - Simple gray style, text brightens on hover
 */

import React, { ReactNode } from 'react';
import { ToolCardIconSlot } from './ToolCardIconSlot';
import { ToolRightRail, type ToolRightRailProps } from './ToolRightRail';
import './CompactToolCard.scss';

export interface CompactToolCardProps {
  /** Tool status */
  status:
    | 'pending'
    | 'preparing'
    | 'streaming'
    | 'receiving'
    | 'running'
    | 'completed'
    | 'error'
    | 'cancelled'
    | 'analyzing'
    | 'pending_confirmation'
    | 'confirmed';
  /** Whether expanded */
  isExpanded?: boolean;
  /** Card click callback */
  onClick?: (e: React.MouseEvent) => void;
  /** Custom class name */
  className?: string;
  /** Whether clickable */
  clickable?: boolean;
  /** Header content */
  header: ReactNode;
  /** Optional right-side rail action rendered by the card shell. */
  headerRail?: ToolRightRailProps;
  /** Expanded content (optional) */
  expandedContent?: ReactNode;
}

export const CompactToolCard: React.FC<CompactToolCardProps> = ({
  status,
  isExpanded = false,
  onClick,
  className = '',
  clickable = false,
  header,
  headerRail,
  expandedContent,
}) => {
  const handleWrapperClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
  };

  const loadingShimmer =
    status === 'preparing' ||
    status === 'streaming' ||
    status === 'receiving' ||
    status === 'running' ||
    status === 'analyzing';
  const hasExpandedContent = Boolean(expandedContent);

  return (
    <div
      className={[
        'compact-tool-card-wrapper',
        loadingShimmer ? 'compact-tool-card-wrapper--loading-shimmer' : '',
        hasExpandedContent ? 'compact-tool-card-wrapper--has-expanded-content' : '',
        isExpanded && hasExpandedContent ? 'compact-tool-card-wrapper--expanded' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <div
        className={`compact-tool-card status-${status} ${clickable ? 'clickable' : ''} ${isExpanded ? 'expanded' : ''}`}
        onClick={handleWrapperClick}
        style={{ cursor: clickable ? 'pointer' : 'default' }}
      >
        {header}
        {headerRail && <ToolRightRail {...headerRail} />}
      </div>

      {isExpanded && expandedContent && (
        <div className="compact-tool-card-expanded">
          {expandedContent}
        </div>
      )}
    </div>
  );
};

export interface CompactToolCardHeaderProps {
  /** Left status icon; prefer icon for expandable affordance. */
  statusIcon?: ReactNode;
  /** Left icon slot (replaces statusIcon; supports expandable affordance via ToolCardIconSlot) */
  icon?: ReactNode;
  /** Show hover chevron when expandable */
  expandable?: boolean;
  /** Expanded state for chevron rotation */
  isExpanded?: boolean;
  /** Click handler for the left icon rail affordance */
  onAffordanceClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Show right border divider on the icon slot (default true) */
  showDivider?: boolean;
  /** Action text or markup */
  action?: ReactNode;
  /** Main content */
  content?: ReactNode;
  /** Right extra content (e.g., statistics) */
  extra?: ReactNode;
  /** Right status icon */
  rightIcon?: ReactNode;
}

export const CompactToolCardHeader: React.FC<CompactToolCardHeaderProps> = ({
  statusIcon,
  icon,
  expandable = false,
  isExpanded = false,
  onAffordanceClick,
  showDivider = true,
  action,
  content,
  extra,
  rightIcon,
}) => {
  return (
    <>
      {icon ? (
        <ToolCardIconSlot
          icon={icon}
          expandable={expandable}
          isExpanded={isExpanded}
          onAffordanceClick={onAffordanceClick}
          showDivider={showDivider}
        />
      ) : statusIcon ? (
        <span className="compact-card-status-icon">
          {statusIcon}
        </span>
      ) : null}
      {action && <span className="compact-card-action">{action}</span>}
      {content && <span className="compact-card-content">{content}</span>}
      {extra && <span className="compact-card-extra">{extra}</span>}
      {rightIcon && (
        <span className="compact-card-right-icon">
          {rightIcon}
        </span>
      )}
    </>
  );
};
