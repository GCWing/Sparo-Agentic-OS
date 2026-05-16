import React from 'react';
import { Check, Clock, Loader2, XCircle } from 'lucide-react';
import { CubeLoading } from '@/design-system';
import { isToolStatusLoading } from './toolStatus';
import type { ToolCardStatus } from './toolStatus';

export interface ToolStatusIndicatorProps {
  status: ToolCardStatus;
  loadingStyle?: 'spinner' | 'cube';
  size?: number;
  className?: string;
}

export const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
  loadingStyle = 'spinner',
  size = 12,
  className = '',
}) => {
  const classes = ['tool-status-indicator', `tool-status-indicator--${status}`, className]
    .filter(Boolean)
    .join(' ');

  if (isToolStatusLoading(status)) {
    return (
      <span className={classes}>
        {loadingStyle === 'cube' ? <CubeLoading size="small" /> : <Loader2 className="animate-spin" size={size} />}
      </span>
    );
  }

  if (status === 'completed' || status === 'confirmed') {
    return (
      <span className={classes}>
        <Check size={size} className="icon-check-done" />
      </span>
    );
  }

  if (status === 'error' || status === 'cancelled') {
    return (
      <span className={classes}>
        <XCircle size={size} />
      </span>
    );
  }

  return (
    <span className={classes}>
      <Clock size={size} />
    </span>
  );
};

