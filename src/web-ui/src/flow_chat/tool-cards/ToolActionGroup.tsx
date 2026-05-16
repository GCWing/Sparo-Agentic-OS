import React from 'react';
import { Check, Play, Square, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import './ToolActionGroup.scss';

export interface ToolActionGroupProps {
  actions?: Array<{
    key: string;
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    variant?: 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'ghost';
  }>;
  onConfirm?: () => void;
  onReject?: () => void;
  onInterrupt?: () => void;
  confirmLabel?: string;
  rejectLabel?: string;
  interruptLabel?: string;
  confirmDisabled?: boolean;
  rejectDisabled?: boolean;
  interruptDisabled?: boolean;
  confirmIcon?: 'check' | 'play';
  className?: string;
}

export const ToolActionGroup: React.FC<ToolActionGroupProps> = ({
  actions,
  onConfirm,
  onReject,
  onInterrupt,
  confirmLabel,
  rejectLabel,
  interruptLabel,
  confirmDisabled,
  rejectDisabled,
  interruptDisabled,
  confirmIcon = 'check',
  className = '',
}) => {
  return (
    <div className={['tool-action-group', className].filter(Boolean).join(' ')} onClick={(event) => event.stopPropagation()}>
      {actions?.map((action) => (
        <button
          key={action.key}
          type="button"
          className={[
            'tool-action-group__text-button',
            `tool-action-group__text-button--${action.variant ?? 'default'}`,
          ].join(' ')}
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.label}
          title={action.title ?? action.label}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
      {onConfirm && (
        <IconButton
          className="tool-action-group__button"
          variant="success"
          size="xs"
          onClick={onConfirm}
          disabled={confirmDisabled}
          tooltip={confirmLabel}
        >
          {confirmIcon === 'play' ? <Play size={12} fill="currentColor" /> : <Check size={14} />}
        </IconButton>
      )}
      {onReject && (
        <IconButton
          className="tool-action-group__button"
          variant="danger"
          size="xs"
          onClick={onReject}
          disabled={rejectDisabled}
          tooltip={rejectLabel}
        >
          <X size={14} />
        </IconButton>
      )}
      {onInterrupt && (
        <IconButton
          className="tool-action-group__button"
          variant="warning"
          size="xs"
          onClick={onInterrupt}
          disabled={interruptDisabled}
          tooltip={interruptLabel}
        >
          <Square size={12} fill="currentColor" />
        </IconButton>
      )}
    </div>
  );
};
