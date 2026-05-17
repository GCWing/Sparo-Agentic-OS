import React from 'react';
import { Check, Play, Square, X } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import './ToolActionGroup.scss';

type ToolActionVariant = 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'ghost';

export interface ToolActionGroupProps {
  actions?: Array<{
    key: string;
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    variant?: ToolActionVariant;
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
  const getButtonVariant = (variant: ToolActionVariant = 'default') => {
    switch (variant) {
      case 'primary':
      case 'success':
        return 'success';
      case 'danger':
        return 'danger';
      case 'ghost':
        return 'ghost';
      default:
        return 'secondary';
    }
  };

  return (
    <div className={['tool-action-group', className].filter(Boolean).join(' ')} onClick={(event) => event.stopPropagation()}>
      {actions?.map((action) => (
        <Button
          key={action.key}
          type="button"
          size="small"
          variant={getButtonVariant(action.variant)}
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
        </Button>
      ))}
      {onConfirm && (
        <IconButton
          className="tool-action-group__button"
          variant="success"
          size="xs"
          onClick={onConfirm}
          disabled={confirmDisabled}
          tooltip={confirmLabel}
          aria-label={confirmLabel}
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
          aria-label={rejectLabel}
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
          aria-label={interruptLabel}
        >
          <Square size={12} fill="currentColor" />
        </IconButton>
      )}
    </div>
  );
};
