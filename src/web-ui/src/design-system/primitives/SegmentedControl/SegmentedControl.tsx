import React, { forwardRef, useEffect, useId, useMemo, useState } from 'react';
import './SegmentedControl.scss';

export interface SegmentedControlOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  size?: 'small' | 'medium';
  variant?: 'default' | 'accent';
  stretch?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  ({
    options,
    value,
    defaultValue,
    onChange,
    size = 'medium',
    variant = 'default',
    stretch = false,
    disabled = false,
    ariaLabel,
    className = '',
    ...props
  }, ref) => {
    const generatedId = useId();
    const firstEnabledValue = useMemo(
      () => options.find((option) => !option.disabled)?.value ?? options[0]?.value ?? '',
      [options]
    );
    const [internalValue, setInternalValue] = useState(defaultValue ?? firstEnabledValue);
    const selectedValue = value ?? internalValue;

    useEffect(() => {
      if (!selectedValue && firstEnabledValue && value === undefined) {
        setInternalValue(firstEnabledValue);
      }
    }, [firstEnabledValue, selectedValue, value]);

    const selectValue = (nextValue: string, optionDisabled?: boolean) => {
      if (disabled || optionDisabled) return;
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onChange?.(nextValue);
    };

    const focusOption = (nextValue: string) => {
      document.getElementById(`${generatedId}-${nextValue}`)?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      const enabledOptions = options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => !option.disabled);
      const enabledIndex = enabledOptions.findIndex(({ index }) => index === currentIndex);
      if (enabledIndex === -1) return;

      let next = undefined as { option: SegmentedControlOption; index: number } | undefined;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        next = enabledOptions[(enabledIndex + 1) % enabledOptions.length];
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        next = enabledOptions[(enabledIndex - 1 + enabledOptions.length) % enabledOptions.length];
      } else if (event.key === 'Home') {
        next = enabledOptions[0];
      } else if (event.key === 'End') {
        next = enabledOptions[enabledOptions.length - 1];
      }

      if (!next) return;
      event.preventDefault();
      selectValue(next.option.value, next.option.disabled);
      focusOption(next.option.value);
    };

    return (
      <div
        ref={ref}
        className={[
          'ds-segmented-control',
          `ds-segmented-control--${size}`,
          `ds-segmented-control--${variant}`,
          stretch && 'ds-segmented-control--stretch',
          disabled && 'ds-segmented-control--disabled',
          className,
        ].filter(Boolean).join(' ')}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        {...props}
      >
        {options.map((option, index) => {
          const checked = selectedValue === option.value;
          return (
            <button
              key={option.value}
              id={`${generatedId}-${option.value}`}
              className={[
                'ds-segmented-control__item',
                checked && 'ds-segmented-control__item--selected',
              ].filter(Boolean).join(' ')}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled || option.disabled}
              tabIndex={checked ? 0 : -1}
              onClick={() => selectValue(option.value, option.disabled)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {option.icon && <span className="ds-segmented-control__icon">{option.icon}</span>}
              <span className="ds-segmented-control__label">{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

SegmentedControl.displayName = 'SegmentedControl';
