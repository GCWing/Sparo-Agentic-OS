import React, { forwardRef, useRef, useImperativeHandle, useCallback, useId } from 'react';
import './Textarea.scss';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: boolean;
  errorMessage?: string;
  hint?: string;
  autoResize?: boolean;
  showCount?: boolean;
  maxLength?: number;
  variant?: 'default' | 'filled' | 'outlined';
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error = false,
      errorMessage,
      hint,
      autoResize = false,
      showCount = false,
      maxLength,
      variant = 'default',
      className = '',
      value,
      onChange,
      style,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const textareaId = props.id ?? `textarea-${generatedId}`;
    const hintId = `${textareaId}-hint`;
    const errorId = `${textareaId}-error`;
    const countId = `${textareaId}-count`;
    const describedBy = [
      props['aria-describedby'],
      error && errorMessage ? errorId : undefined,
      !error && hint ? hintId : undefined,
      showCount ? countId : undefined,
    ].filter(Boolean).join(' ') || undefined;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [charCount, setCharCount] = React.useState(0);

    useImperativeHandle(ref, () => textareaRef.current!);

    const adjustHeight = useCallback(() => {
      if (autoResize && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, [autoResize]);

    React.useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    React.useEffect(() => {
      const count = typeof value === 'string' ? value.length : 0;
      setCharCount(count);
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setCharCount(newValue.length);
      adjustHeight();
      onChange?.(e);
    };

    const containerClass = [
      'bitfun-textarea',
      `bitfun-textarea--${variant}`,
      error && 'bitfun-textarea--error',
      props.disabled && 'bitfun-textarea--disabled',
      className
    ].filter(Boolean).join(' ');

    return (
      <div className={containerClass}>
        {label && (
          <label className="bitfun-textarea__label" htmlFor={textareaId}>
            {label}
            {props.required && <span className="bitfun-textarea__required">*</span>}
          </label>
        )}
        <div className="bitfun-textarea__wrapper">
          <textarea
            ref={textareaRef}
            id={textareaId}
            className="bitfun-textarea__field"
            value={value}
            onChange={handleChange}
            maxLength={maxLength}
            style={style}
            aria-describedby={describedBy}
            aria-invalid={error || undefined}
            {...props}
          />
        </div>
        {(hint || errorMessage || showCount) && (
          <div className="bitfun-textarea__footer">
            <div className="bitfun-textarea__hint-wrapper">
              {error && errorMessage && (
                <span id={errorId} className="bitfun-textarea__error-message">{errorMessage}</span>
              )}
              {!error && hint && (
                <span id={hintId} className="bitfun-textarea__hint">{hint}</span>
              )}
            </div>
            {showCount && (
              <span id={countId} className="bitfun-textarea__count">
                {charCount}{maxLength && ` / ${maxLength}`}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
