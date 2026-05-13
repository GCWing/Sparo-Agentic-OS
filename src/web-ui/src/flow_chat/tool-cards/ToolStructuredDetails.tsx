import React from 'react';
import './ToolStructuredDetails.scss';

export interface ToolDetailRow {
  label: React.ReactNode;
  value: React.ReactNode;
  hidden?: boolean;
}

export interface ToolStructuredDetailsProps {
  rows?: ToolDetailRow[];
  chips?: React.ReactNode[];
  children?: React.ReactNode;
  emptyText?: React.ReactNode;
  className?: string;
}

export const ToolStructuredDetails: React.FC<ToolStructuredDetailsProps> = ({
  rows = [],
  chips = [],
  children,
  emptyText,
  className = '',
}) => {
  const visibleRows = rows.filter(row => !row.hidden && row.value !== undefined && row.value !== null && row.value !== '');
  const hasContent = visibleRows.length > 0 || chips.length > 0 || children;

  if (!hasContent) {
    return emptyText ? <div className="tool-structured-details__empty">{emptyText}</div> : null;
  }

  return (
    <div className={['tool-structured-details', className].filter(Boolean).join(' ')}>
      {chips.length > 0 && (
        <div className="tool-structured-details__chips">
          {chips.map((chip, index) => (
            <span key={index} className="tool-structured-details__chip">{chip}</span>
          ))}
        </div>
      )}
      {visibleRows.length > 0 && (
        <div className="tool-structured-details__rows">
          {visibleRows.map((row, index) => (
            <div key={index} className="tool-structured-details__row">
              <span className="tool-structured-details__label">{row.label}</span>
              <span className="tool-structured-details__value">{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
};

