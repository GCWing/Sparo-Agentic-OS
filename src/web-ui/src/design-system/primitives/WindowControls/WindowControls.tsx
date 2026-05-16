/**
 * WindowControls component - window control buttons
 */

import React from 'react';
import { Tooltip } from '../Tooltip';
import './WindowControls.scss';

const DEFAULT_WINDOW_CONTROL_LABELS = {
  minimize: 'Minimize',
  maximize: 'Maximize',
  restore: 'Restore',
  close: 'Close',
};

export interface WindowControlsProps extends React.HTMLAttributes<HTMLDivElement> {
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  showMinimize?: boolean;
  showMaximize?: boolean;
  showClose?: boolean;
  disabled?: boolean;
  isMaximized?: boolean;
  minimizeIcon?: React.ReactNode;
  maximizeIcon?: React.ReactNode;
  restoreIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  minimizeLabel?: string;
  maximizeLabel?: string;
  restoreLabel?: string;
  closeLabel?: string;
  'data-testid-minimize'?: string;
  'data-testid-maximize'?: string;
  'data-testid-close'?: string;
}

/**
 * Window control button component
 * Provides a unified window control UI (minimize, maximize, close)
 */
export const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onMaximize,
  onClose,
  showMinimize = true,
  showMaximize = true,
  showClose = true,
  disabled = false,
  isMaximized = false,
  minimizeIcon,
  maximizeIcon,
  restoreIcon,
  closeIcon,
  minimizeLabel = DEFAULT_WINDOW_CONTROL_LABELS.minimize,
  maximizeLabel = DEFAULT_WINDOW_CONTROL_LABELS.maximize,
  restoreLabel = DEFAULT_WINDOW_CONTROL_LABELS.restore,
  closeLabel = DEFAULT_WINDOW_CONTROL_LABELS.close,
  className = '',
  'data-testid-minimize': testIdMinimize,
  'data-testid-maximize': testIdMaximize,
  'data-testid-close': testIdClose,
  ...props
}) => {
  const defaultMinimizeIcon = (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );

  const defaultMaximizeIcon = (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const defaultRestoreIcon = (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M4 4 L4 1.5 Q4 1 4.5 1 L10.5 1 Q11 1 11 1.5 L11 7.5 Q11 8 10.5 8 L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <rect x="1" y="4" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );

  const defaultCloseIcon = (
    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
      <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );

  const resolvedMaximizeLabel = isMaximized ? restoreLabel : maximizeLabel;

  return (
    <div 
      className={`window-controls ${className}`}
      {...props}
    >
      {showMinimize && (
        <Tooltip content={minimizeLabel} placement="bottom">
          <button
            className="window-controls__btn window-controls__btn--minimize"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onMinimize && !disabled) {
                onMinimize();
              }
            }}
            disabled={disabled}
            aria-label={minimizeLabel}
            type="button"
            data-testid={testIdMinimize}
          >
            {minimizeIcon || defaultMinimizeIcon}
          </button>
        </Tooltip>
      )}

      {showMaximize && (
        <Tooltip content={resolvedMaximizeLabel} placement="bottom">
          <button
            className="window-controls__btn window-controls__btn--maximize"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onMaximize && !disabled) {
                onMaximize();
              }
            }}
            disabled={disabled}
            aria-label={resolvedMaximizeLabel}
            type="button"
            data-testid={testIdMaximize}
          >
            {isMaximized 
              ? (restoreIcon || defaultRestoreIcon)
              : (maximizeIcon || defaultMaximizeIcon)
            }
          </button>
        </Tooltip>
      )}

      {showClose && (
        <Tooltip content={closeLabel} placement="bottom">
          <button
            className="window-controls__btn window-controls__btn--close"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onClose && !disabled) {
                onClose();
              }
            }}
            disabled={disabled}
            aria-label={closeLabel}
            type="button"
            data-testid={testIdClose}
          >
            {closeIcon || defaultCloseIcon}
          </button>
        </Tooltip>
      )}
    </div>
  );
};
