import React from 'react';
import { AlertCircle, CheckCircle, Info, TriangleAlert, X } from 'lucide-react';
import { IconButton } from '@/design-system';

export interface ConfigStatusProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  icon?: React.ReactNode;
  closable?: boolean;
  onClose?: () => void;
  style?: React.CSSProperties;
  className?: string;
  multiline?: boolean;
}

const defaultIcons = {
  success: <CheckCircle size={14} />,
  error: <AlertCircle size={14} />,
  warning: <TriangleAlert size={14} />,
  info: <Info size={14} />,
};

export const ConfigStatus: React.FC<ConfigStatusProps> = ({
  type,
  message,
  icon,
  closable = false,
  onClose,
  style,
  className = '',
  multiline = false
}) => {
  const statusClass = `config-form-status ${type} ${className}`.trim();
  const displayIcon = icon !== undefined ? icon : defaultIcons[type];

  return (
    <div className={statusClass} style={style}>
      {displayIcon && <span>{displayIcon}</span>}
      <div
        style={{
          flex: 1,
          whiteSpace: multiline ? 'pre-line' : 'nowrap',
          overflow: multiline ? 'visible' : 'hidden',
          textOverflow: multiline ? 'unset' : 'ellipsis'
        }}
      >
        {message}
      </div>
      {closable && onClose && (
        <IconButton
          onClick={onClose}
          aria-label="Close status"
          tooltip="Close status"
          size="xs"
          variant="ghost"
          style={{ marginLeft: 8 }}
        >
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
};

ConfigStatus.displayName = 'ConfigStatus';
