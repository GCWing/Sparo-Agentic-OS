/**
 * Button component
 */

import React, { forwardRef } from 'react';
import { DotMatrixLoader } from '../Spinner';
import './Button.scss';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger' | 'success' | 'accent' | 'ai';
  size?: 'small' | 'medium' | 'large';
  shape?: 'default' | 'pill';
  isLoading?: boolean;
  iconOnly?: boolean;
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  size = 'medium',
  shape = 'default',
  isLoading = false,
  iconOnly = false,
  loadingLabel = 'Loading',
  className = '',
  disabled,
  type = 'button',
  ...props
}, ref) => {
  const sizeClassMap = {
    small: 'sm',
    medium: 'base',
    large: 'lg'
  };

  const getVariantClass = (variant: string) => {
    switch (variant) {
      case 'primary':
      case 'accent':
        return 'btn-primary';
      case 'secondary':
        return 'btn-secondary';
      case 'ai':
        return 'btn-action btn-action-ai';
      case 'danger':
        return 'btn-action btn-action-danger';
      case 'success':
        return 'btn-action btn-action-success';
      case 'ghost':
        return 'btn-ghost';
      case 'dashed':
        return 'btn-dashed';
      default:
        return 'btn-secondary';
    }
  };

  const classNames = [
    'btn',
    getVariantClass(variant),
    `btn-${sizeClassMap[size] || 'base'}`,
    shape === 'pill' && 'btn-pill',
    iconOnly && 'btn-icon-only',
    isLoading && 'btn-loading',
    disabled && 'btn-disabled',
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      ref={ref}
      className={classNames}
      disabled={disabled || isLoading}
      type={type}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <>
          <DotMatrixLoader size="tiny" className="btn-loading-icon" />
          <span className="btn-loading-text">{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

Button.displayName = 'Button';
