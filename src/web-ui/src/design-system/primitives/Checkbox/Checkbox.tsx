import React, { forwardRef } from 'react';
import './Checkbox.scss';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Checkbox label */
  label?: React.ReactNode;
  /** Description text */
  description?: string;
  /** Size */
  size?: 'small' | 'medium' | 'large';
  /** Indeterminate state */
  indeterminate?: boolean;
  /** Error state */
  error?: boolean;
  /** Custom class name */
  className?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      size = 'medium',
      indeterminate = false,
      error = false,
      disabled = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const checkboxRef = React.useRef<HTMLInputElement>(null);
    
    React.useImperativeHandle(ref, () => checkboxRef.current!);

    React.useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    const containerClass = [
      'ds-checkbox',
      `ds-checkbox--${size}`,
      error && 'ds-checkbox--error',
      disabled && 'ds-checkbox--disabled',
      className
    ].filter(Boolean).join(' ');

    return (
      <label className={containerClass}>
        <div className="ds-checkbox__wrapper">
          <input
            ref={checkboxRef}
            type="checkbox"
            className="ds-checkbox__input"
            disabled={disabled}
            {...props}
          />
          <span className="ds-checkbox__box">
            <svg
              className="ds-checkbox__icon"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {indeterminate ? (
                <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              ) : (
                <path
                  d="M3 8L6.5 11.5L13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </span>
        </div>
        {(label || description || children) && (
          <div className="ds-checkbox__content">
            {label && <span className="ds-checkbox__label">{label}</span>}
            {description && <span className="ds-checkbox__description">{description}</span>}
            {children}
          </div>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
