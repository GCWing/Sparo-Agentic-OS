/**
 * Search input component
 */

import React, { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import './Search.scss';

const DEFAULT_SEARCH_TEXT = {
  placeholder: 'Search',
  button: 'Search',
  clearAriaLabel: 'Clear search',
};

function SearchGlyph() {
  return (
    <svg
      className="search__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 20L16.5 16.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoadingGlyph() {
  return (
    <svg
      className="search__loading-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="search__loading-track"
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="search__loading-arc"
        d="M12 3A9 9 0 0 1 21 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface SearchProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  /** Fired before built-in key handling; call `preventDefault` to skip Enter/Escape behavior. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  size?: 'small' | 'medium' | 'large';
  clearable?: boolean;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  autoFocus?: boolean;
  maxLength?: number;
  className?: string;
  expandOnFocus?: boolean;
  enterToSearch?: boolean;
  prefixIcon?: React.ReactNode;
  searchButtonText?: string;
  showSearchButton?: boolean;
  suffixContent?: React.ReactNode;
  showPrefixIcon?: boolean;
  shape?: 'default' | 'pill';
  /** Overrides default aria-label on the input. */
  inputAriaLabel?: string;
  clearAriaLabel?: string;
  searchButtonAriaLabel?: string;
  ariaControls?: string;
  ariaExpanded?: boolean;
}

export const Search = forwardRef<HTMLInputElement, SearchProps>(({
  value,
  defaultValue = '',
  placeholder,
  disabled = false,
  onChange,
  onSearch,
  onClear,
  onKeyDown: onKeyDownProp,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  size = 'medium',
  clearable = true,
  loading = false,
  error = false,
  errorMessage,
  autoFocus = false,
  maxLength,
  className = '',
  expandOnFocus = false,
  enterToSearch = true,
  prefixIcon,
  searchButtonText,
  showSearchButton = false,
  suffixContent,
  showPrefixIcon = true,
  shape = 'default',
  inputAriaLabel,
  clearAriaLabel = DEFAULT_SEARCH_TEXT.clearAriaLabel,
  searchButtonAriaLabel,
  ariaControls,
  ariaExpanded,
}, ref) => {
  const resolvedPlaceholder = placeholder ?? DEFAULT_SEARCH_TEXT.placeholder;
  const resolvedSearchButtonText = searchButtonText ?? DEFAULT_SEARCH_TEXT.button;
  const resolvedInputAriaLabel = inputAriaLabel ?? resolvedPlaceholder;
  const resolvedSearchButtonAriaLabel = searchButtonAriaLabel ?? resolvedSearchButtonText;
  const [inputValue, setInputValue] = useState<string>(
    value !== undefined ? value : defaultValue
  );
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setForwardedRef = useCallback((node: HTMLInputElement | null) => {
    if (typeof ref === 'function') {
      ref(node);
      return;
    }
    if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  }, [ref]);

  useEffect(() => {
    if (value !== undefined) {
      setInputValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange?.(newValue);
  }, [onChange]);

  const handleSearch = useCallback(() => {
    if (!disabled && !loading) {
      onSearch?.(inputValue);
    }
  }, [inputValue, onSearch, disabled, loading]);

  const handleClear = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setInputValue('');
    onChange?.('');
    onClear?.();
    inputRef.current?.focus();
  }, [onChange, onClear]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) {
      return;
    }
    if (e.key === 'Enter' && enterToSearch) {
      e.preventDefault();
      handleSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputValue) {
        handleClear(e);
      } else {
        inputRef.current?.blur();
      }
    }
  }, [inputValue, enterToSearch, handleSearch, handleClear, onKeyDownProp]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocusProp?.();
  }, [onFocusProp]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onBlurProp?.();
  }, [onBlurProp]);

  const classNames = [
    'search',
    `search--${size}`,
    isFocused && 'search--focused',
    isHovered && 'search--hovered',
    disabled && 'search--disabled',
    error && 'search--error',
    loading && 'search--loading',
    expandOnFocus && 'search--expandable',
    showSearchButton && 'search--with-button',
    shape === 'pill' && 'search--pill',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      <div 
        className="search__wrapper"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {(showPrefixIcon || loading) && (
          <div className="search__prefix">
            {loading ? <LoadingGlyph /> : (prefixIcon || <SearchGlyph />)}
          </div>
        )}

        <input
          ref={(node) => {
            inputRef.current = node;
            setForwardedRef(node);
          }}
          type="text"
          className="search__input"
          value={inputValue}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          maxLength={maxLength}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-label={resolvedInputAriaLabel}
          aria-controls={ariaControls}
          aria-expanded={ariaExpanded}
        />

        {clearable && inputValue && !loading && !disabled && (
          <button
            type="button"
            className="search__clear"
            onClick={handleClear}
            aria-label={clearAriaLabel}
            tabIndex={-1}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {suffixContent && (
          <div className="search__suffix-content">
            {suffixContent}
          </div>
        )}

        {showSearchButton && (
          <button
            type="button"
            className="search__button"
            onClick={handleSearch}
            disabled={disabled || loading}
            aria-label={resolvedSearchButtonAriaLabel}
          >
            {resolvedSearchButtonText}
          </button>
        )}
      </div>

      {error && errorMessage && (
        <div className="search__error-message">{errorMessage}</div>
      )}
    </div>
  );
});

Search.displayName = 'Search';
