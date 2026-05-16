/**
 * Input component
 */

import React, { forwardRef, useId } from 'react';
import './Input.scss';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  variant?: 'default' | 'filled' | 'outlined';
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
    'bitfun-input-wrapper',
    `bitfun-input-wrapper--${variant}`,
    `bitfun-input-wrapper--${resolvedInputSize}`,
    error && 'bitfun-input-wrapper--error',
    disabled && 'bitfun-input-wrapper--disabled',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      {label && <label className="bitfun-input-label" htmlFor={inputId}>{label}</label>}
      <div className="bitfun-input-container">
        {prefix && <span className="bitfun-input-prefix">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className="bitfun-input"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error || undefined}
          {...props}
        />
        {suffix && <span className="bitfun-input-suffix">{suffix}</span>}
      </div>
      {!error && (hint ?? description) && (
        <span id={hintId} className="bitfun-input-error-message">{hint ?? description}</span>
      )}
      {error && errorMessage && (
        <span id={errorId} className="bitfun-input-error-message">{errorMessage}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export type TextFieldProps = InputProps;
export const TextField = Input;
