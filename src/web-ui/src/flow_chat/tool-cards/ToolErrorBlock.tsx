import React from 'react';
import { AlertTriangle } from 'lucide-react';
import './ToolErrorBlock.scss';

export interface ToolErrorBlockProps {
  title?: React.ReactNode;
  message?: React.ReactNode;
  details?: React.ReactNode;
  className?: string;
}

export const ToolErrorBlock: React.FC<ToolErrorBlockProps> = ({
  title,
  message,
  details,
  className = '',
}) => {
  if (!title && !message && !details) {
    return null;
  }

  return (
    <div className={['tool-error-block', className].filter(Boolean).join(' ')}>
      {title && (
        <div className="tool-error-block__title">
          <AlertTriangle size={14} />
          <span>{title}</span>
        </div>
      )}
      {message && <div className="tool-error-block__message">{message}</div>}
      {details && <div className="tool-error-block__details">{details}</div>}
    </div>
  );
};
