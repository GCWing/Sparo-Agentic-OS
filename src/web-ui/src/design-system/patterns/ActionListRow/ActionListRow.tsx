import React, { forwardRef } from 'react';
import { Check } from 'lucide-react';
import './ActionListRow.scss';

export interface SelectableRowProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  selected?: boolean;
  selectedIndicator?: 'none' | 'check';
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  error?: React.ReactNode;
}

export const SelectableRow = forwardRef<HTMLButtonElement, SelectableRowProps>(
  ({
    selected = false,
    selectedIndicator = 'none',
    leading,
    title,
    description,
    meta,
    error,
    className = '',
    type = 'button',
    disabled,
    ...props
  }, ref) => (
    <button
      ref={ref}
      type={type}
      className={[
        'ds-action-list-row',
        !description && !error && 'ds-action-list-row--single-line',
        'ds-action-list-row--selectable',
        selected && 'ds-action-list-row--selected',
        error && 'ds-action-list-row--error',
        className,
      ].filter(Boolean).join(' ')}
      aria-pressed={selected}
      disabled={disabled}
      {...props}
    >
      {leading && <span className="ds-action-list-row__leading">{leading}</span>}
      <span className="ds-action-list-row__content">
        <span className="ds-action-list-row__title">{title}</span>
        {description && <span className="ds-action-list-row__description">{description}</span>}
        {error && <span className="ds-action-list-row__error">{error}</span>}
      </span>
      {meta && <span className="ds-action-list-row__meta">{meta}</span>}
      {selected && selectedIndicator === 'check' && (
        <span className="ds-action-list-row__selected-icon" aria-hidden="true">
          <Check size={14} />
        </span>
      )}
    </button>
  )
);

SelectableRow.displayName = 'SelectableRow';

export interface ActionListRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  disabled?: boolean;
  error?: React.ReactNode;
  loading?: boolean;
}

export const ActionListRow = forwardRef<HTMLDivElement, ActionListRowProps>(
  ({
    leading,
    title,
    description,
    meta,
    actions,
    disabled = false,
    error,
    loading = false,
    className = '',
    ...props
  }, ref) => (
    <div
      ref={ref}
      className={[
        'ds-action-list-row',
        !description && !error && 'ds-action-list-row--single-line',
        disabled && 'ds-action-list-row--disabled',
        error && 'ds-action-list-row--error',
        loading && 'ds-action-list-row--loading',
        className,
      ].filter(Boolean).join(' ')}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {leading && <span className="ds-action-list-row__leading">{leading}</span>}
      <span className="ds-action-list-row__content">
        <span className="ds-action-list-row__title">{title}</span>
        {description && <span className="ds-action-list-row__description">{description}</span>}
        {error && <span className="ds-action-list-row__error">{error}</span>}
      </span>
      {meta && <span className="ds-action-list-row__meta">{meta}</span>}
      {actions && <span className="ds-action-list-row__actions">{actions}</span>}
    </div>
  )
);

ActionListRow.displayName = 'ActionListRow';
