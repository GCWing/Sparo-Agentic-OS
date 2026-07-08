import React, { forwardRef } from 'react';
import './SqueezeSegmentedControl.scss';

export interface SqueezeSegmentedControlOption {
  value: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  title?: string;
  disabled?: boolean;
  trailing?: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaHasPopup?: React.AriaAttributes['aria-haspopup'];
  ariaExpanded?: boolean;
}

export interface SqueezeSegmentedControlProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: SqueezeSegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  onOptionClick?: (value: string) => void;
  size?: 'small' | 'medium';
  disabled?: boolean;
  ariaLabel?: string;
}

export const SqueezeSegmentedControl = forwardRef<HTMLDivElement, SqueezeSegmentedControlProps>(
  ({
    options,
    value,
    onChange,
    onOptionClick,
    size = 'small',
    disabled = false,
    ariaLabel,
    className = '',
    ...props
  }, ref) => {
    const handleSelect = (option: SqueezeSegmentedControlOption) => {
      if (disabled || option.disabled) return;
      if (option.value !== value) {
        onChange?.(option.value);
      }
      onOptionClick?.(option.value);
    };

    return (
      <div
        ref={ref}
        className={[
          'ds-squeeze-segmented-control',
          `ds-squeeze-segmented-control--${size}`,
          disabled && 'ds-squeeze-segmented-control--disabled',
          className,
        ].filter(Boolean).join(' ')}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        {...props}
      >
        {options.map(option => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={option.buttonRef}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-haspopup={selected ? option.ariaHasPopup : undefined}
              aria-expanded={selected ? option.ariaExpanded : undefined}
              className={[
                'ds-squeeze-segmented-control__option',
                selected && 'ds-squeeze-segmented-control__option--selected',
                option.trailing && selected && 'ds-squeeze-segmented-control__option--with-trailing',
              ].filter(Boolean).join(' ')}
              disabled={disabled || option.disabled}
              onClick={() => handleSelect(option)}
            >
              <span className="ds-squeeze-segmented-control__content">
                <span className="ds-squeeze-segmented-control__label">
                  {option.label}
                </span>
                {selected && option.detail && (
                  <span
                    className="ds-squeeze-segmented-control__detail"
                    title={option.title}
                  >
                    {option.detail}
                  </span>
                )}
              </span>
              {selected && option.trailing && (
                <span className="ds-squeeze-segmented-control__trailing" aria-hidden="true">
                  {option.trailing}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
);

SqueezeSegmentedControl.displayName = 'SqueezeSegmentedControl';
