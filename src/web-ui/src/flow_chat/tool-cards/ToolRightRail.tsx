import React from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Tooltip } from '@/component-library';
import './ToolRightRail.scss';

export interface ToolRightRailProps {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  icon?: React.ReactNode;
  className?: string;
}

export const ToolRightRail: React.FC<ToolRightRailProps> = ({
  label,
  onClick,
  icon,
  className = '',
}) => {
  return (
    <Tooltip content={label} placement="top">
      <div className={['tool-right-rail', className].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="tool-right-rail__hit"
          onClick={(event) => {
            event.stopPropagation();
            onClick(event);
          }}
          aria-label={label}
          title={label}
        />
        <div className="tool-right-rail__visual" aria-hidden>
          {icon ?? <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />}
        </div>
      </div>
    </Tooltip>
  );
};

export const ToolExternalRailIcon = ExternalLink;

