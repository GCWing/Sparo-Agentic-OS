import React, { forwardRef, useState, useCallback, useRef, useEffect, useId } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import './NumberField.scss';

const DEFAULT_NUMBER_FIELD_ARIA_LABELS = {
  increase: 'Increase value',
  decrease: 'Decrease value',
};

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'default' | 'compact' | 'stepper';
  showButtons?: boolean;
  precision?: number;
  className?: string;
  label?: string;
  id?: string;
  error?: boolean;
  errorMessage?: string;
  hint?: string;
  draggable?: boolean;
  disableWheel?: boolean;
  increaseAriaLabel?: string;
  decreaseAriaLabel?: string;
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(
  (
    {
      value,
      onChange,
      min = -Infinity,
      max = Infinity,
      step = 1,
      unit,
      disabled = false,
      size = 'medium',
      variant = 'default',
      showButtons = true,
      precision = 0,
      className = '',
      label,
      id,
      error = false,
      errorMessage,
      hint,
      draggable = false,
      disableWheel = false,
      increaseAriaLabel = DEFAULT_NUMBER_FIELD_ARIA_LABELS.increase,
      decreaseAriaLabel = DEFAULT_NUMBER_FIELD_ARIA_LABELS.decrease,
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? `number-field-${generatedId}`;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const describedBy = [
      error && errorMessage ? errorId : undefined,
      !error && hint ? hintId : undefined,
    ].filter(Boolean).join(' ') || undefined;
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(String(value));
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const dragStartRef = useRef<{ y: number; value: number } | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const formatValue = useCallback(
      (val: number) => (precision > 0 ? val.toFixed(precision) : String(Math.round(val))),
      [precision]
    );

    useEffect(() => {
      if (!isEditing) {
        setInputValue(formatValue(value));
      }
    }, [formatValue, isEditing, value]);

    const clampValue = useCallback(
      (val: number) => Math.min(max, Math.max(min, val)),
      [max, min]
    );

    const increment = useCallback(() => {
      if (!disabled) {
        onChange(clampValue(value + step));
      }
    }, [clampValue, disabled, onChange, step, value]);

    const decrement = useCallback(() => {
      if (!disabled) {
        onChange(clampValue(value - step));
      }
    }, [clampValue, disabled, onChange, step, value]);

    const handleInputBlur = useCallback(() => {
      setIsEditing(false);
      const parsed = Number.parseFloat(inputValue);
      if (Number.isNaN(parsed)) {
        setInputValue(formatValue(value));
        return;
      }

      const clamped = clampValue(parsed);
      onChange(clamped);
      setInputValue(formatValue(clamped));
    }, [clampValue, formatValue, inputValue, onChange, value]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          handleInputBlur();
          inputRef.current?.blur();
        } else if (event.key === 'Escape') {
          setIsEditing(false);
          setInputValue(formatValue(value));
          inputRef.current?.blur();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          increment();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          decrement();
        }
      },
      [decrement, formatValue, handleInputBlur, increment, value]
    );

    const handleDragStart = useCallback(
      (event: React.MouseEvent) => {
        if (!draggable || disabled) return;
        event.preventDefault();
        setIsDragging(true);
        dragStartRef.current = { y: event.clientY, value };
        document.body.style.cursor = 'ns-resize';
      },
      [disabled, draggable, value]
    );

    useEffect(() => {
      if (!isDragging) return;

      const handleMouseMove = (event: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = dragStartRef.current.y - event.clientY;
        const steps = Math.round(delta / 5);
        onChange(clampValue(dragStartRef.current.value + steps * step));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        dragStartRef.current = null;
        document.body.style.cursor = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
      };
    }, [clampValue, isDragging, onChange, step]);

    const handleWheel = useCallback(
      (event: React.WheelEvent) => {
        if (disabled || disableWheel || !isHovered) return;
        event.preventDefault();
        if (event.deltaY < 0) {
          increment();
        } else {
          decrement();
        }
      },
      [decrement, disabled, disableWheel, increment, isHovered]
    );

    const containerClassName = [
      'ds-number-field',
      `ds-number-field--${size}`,
      `ds-number-field--${variant}`,
      disabled && 'ds-number-field--disabled',
      error && 'ds-number-field--error',
      isDragging && 'ds-number-field--dragging',
      isEditing && 'ds-number-field--editing',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={containerClassName}>
        {label && <label className="ds-number-field__label" htmlFor={inputId}>{label}</label>}
        <div
          className="ds-number-field__container"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onWheel={handleWheel}
        >
          <div
            className="ds-number-field__value-area"
            onMouseDown={draggable ? handleDragStart : undefined}
            style={{ cursor: draggable && !disabled ? 'ns-resize' : 'text' }}
          >
            <input
              ref={(node) => {
                if (typeof ref === 'function') {
                  ref(node);
                } else if (ref) {
                  (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
                }
                inputRef.current = node;
              }}
              type="text"
              id={inputId}
              inputMode="decimal"
              className="ds-number-field__input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onFocus={() => setIsEditing(true)}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              aria-invalid={error || undefined}
              aria-describedby={describedBy}
            />
            {unit && <span className="ds-number-field__unit">{unit}</span>}
          </div>

          {showButtons && variant !== 'compact' && (
            <div className="ds-number-field__buttons">
              {variant === 'stepper' ? (
                <>
                  <button
                    type="button"
                    className="ds-number-field__btn ds-number-field__btn--minus"
                    onClick={decrement}
                    disabled={disabled || value <= min}
                    tabIndex={-1}
                    aria-label={decreaseAriaLabel}
                  >
                    <Minus size={12} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    className="ds-number-field__btn ds-number-field__btn--plus"
                    onClick={increment}
                    disabled={disabled || value >= max}
                    tabIndex={-1}
                    aria-label={increaseAriaLabel}
                  >
                    <Plus size={12} strokeWidth={2.5} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ds-number-field__btn ds-number-field__btn--up"
                    onClick={increment}
                    disabled={disabled || value >= max}
                    tabIndex={-1}
                    aria-label={increaseAriaLabel}
                  >
                    <ChevronUp size={14} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    className="ds-number-field__btn ds-number-field__btn--down"
                    onClick={decrement}
                    disabled={disabled || value <= min}
                    tabIndex={-1}
                    aria-label={decreaseAriaLabel}
                  >
                    <ChevronDown size={14} strokeWidth={2.5} />
                  </button>
                </>
              )}
            </div>
          )}

          {min !== -Infinity && max !== Infinity && (
            <div className="ds-number-field__progress">
              <div
                className="ds-number-field__progress-bar"
                style={{ width: `${((value - min) / (max - min)) * 100}%` }}
              />
            </div>
          )}
        </div>
        {(hint || errorMessage) && (
          <div className="ds-number-field__message">
            {error && errorMessage ? (
              <span id={errorId} className="ds-number-field__error-message">{errorMessage}</span>
            ) : hint ? (
              <span id={hintId} className="ds-number-field__hint">{hint}</span>
            ) : null}
          </div>
        )}
      </div>
    );
  }
);

NumberField.displayName = 'NumberField';
