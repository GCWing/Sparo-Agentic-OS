/**
 * Input component
 */

import React, { forwardRef, useId } from 'react';
import './Input.scss';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  variant?: 'default' | 'filled' | 'outlined';
  shape?: 'default' | 'pill';
  focusTone?: 'default' | 'danger';
  inputSize?: 'small' | 'medium' | 'large';
  size?: 'small' | 'medium' | 'large';
  error?: boolean;
  errorMessage?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  label?: string;
  hint?: React.ReactNode;
  description?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  variant = 'default',
  shape = 'default',
  focusTone = 'default',
  inputSize = 'medium',
  size,
  error = false,
  errorMessage,
  prefix,
  suffix,
  label,
  hint,
  description,
  className = '',
  disabled,
  ...props
}, ref) => {
  const generatedId = useId();
  const inputId = props.id ?? `input-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [
    props['aria-describedby'],
    !error && (hint ?? description) ? hintId : undefined,
    error && errorMessage ? errorId : undefined,
  ].filter(Boolean).join(' ') || undefined;
  const resolvedInputSize = size ?? inputSize;
  const classNames = [
    'ds-input-wrapper',
    `ds-input-wrapper--${variant}`,
    shape === 'pill' && 'ds-input-wrapper--pill',
    focusTone === 'danger' && 'ds-input-wrapper--focus-danger',
    `ds-input-wrapper--${resolvedInputSize}`,
    error && 'ds-input-wrapper--error',
    disabled && 'ds-input-wrapper--disabled',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      {label && <label className="ds-input-label" htmlFor={inputId}>{label}</label>}
      <div className="ds-input-container">
        {prefix && <span className="ds-input-prefix">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className="ds-input"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error || undefined}
          {...props}
        />
        {suffix && <span className="ds-input-suffix">{suffix}</span>}
      </div>
      {!error && (hint ?? description) && (
        <span id={hintId} className="ds-input-error-message">{hint ?? description}</span>
      )}
      {error && errorMessage && (
        <span id={errorId} className="ds-input-error-message">{errorMessage}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export type TextFieldProps = InputProps;
export const TextField = Input;
