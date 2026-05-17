import React, { forwardRef } from 'react';
import './Radio.scss';

export interface RadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label?: React.ReactNode;
  description?: string;
  size?: 'small' | 'medium' | 'large';
  error?: boolean;
  className?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      label,
      description,
      size = 'medium',
      error = false,
      disabled = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const containerClass = [
      'ds-radio',
      `ds-radio--${size}`,
      error && 'ds-radio--error',
      disabled && 'ds-radio--disabled',
      className,
    ].filter(Boolean).join(' ');

    return (
      <label className={containerClass}>
        <span className="ds-radio__wrapper">
          <input
            ref={ref}
            type="radio"
            className="ds-radio__input"
            disabled={disabled}
            {...props}
          />
          <span className="ds-radio__mark" />
        </span>
        {(label || description || children) && (
          <span className="ds-radio__content">
            {label && <span className="ds-radio__label">{label}</span>}
            {description && <span className="ds-radio__description">{description}</span>}
            {children}
          </span>
        )}
      </label>
    );
  }
);

Radio.displayName = 'Radio';
