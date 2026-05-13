import React from 'react';
import './ToolPreviewFrame.scss';

export interface ToolPreviewFrameProps {
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxHeight?: number;
  className?: string;
}

export const ToolPreviewFrame: React.FC<ToolPreviewFrameProps> = ({
  children,
  footer,
  maxHeight,
  className = '',
}) => {
  return (
    <div className={['tool-preview-frame', className].filter(Boolean).join(' ')}>
      <div className="tool-preview-frame__body" style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
      {footer && <div className="tool-preview-frame__footer">{footer}</div>}
    </div>
  );
};

