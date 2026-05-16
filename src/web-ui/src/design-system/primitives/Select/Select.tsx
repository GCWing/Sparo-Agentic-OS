/**
 * Select dropdown component
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react';
import './Select.scss';

const DEFAULT_SELECT_TEXT = {
  placeholder: 'Select an option',
  searchPlaceholder: 'Search options',
  empty: 'No options',
  loading: 'Loading',
  selectAll: 'Select all',
  customValueHint: 'Use value',
  clear: 'Clear selection',
  clearSearch: 'Clear search',
};

function CloseGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 2L10 10M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
  description?: string;
  icon?: React.ReactNode;
  group?: string;
}

export interface SelectProps {
  id?: string;
  options?: SelectOption[];
  value?: string | number | (string | number)[];
  defaultValue?: string | number | (string | number)[];
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string | number | (string | number)[]) => void;
  size?: 'small' | 'medium' | 'large';
  label?: string;
  multiple?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  showSelectAll?: boolean;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  maxTagCount?: number;
  searchPlaceholder?: string;
  emptyText?: string;
  renderOption?: (option: SelectOption) => React.ReactNode;
  renderValue?: (option?: SelectOption | SelectOption[]) => React.ReactNode;
  className?: string;
  placement?: 'bottom' | 'top';
  autoClose?: boolean;
  allowCustomValue?: boolean;
  customValueHint?: string;
  selectAllText?: string;
  loadingText?: string;
  clearAriaLabel?: string;
  clearSearchAriaLabel?: string;
  getRemoveOptionAriaLabel?: (option: SelectOption) => string;
  onOpenChange?: (isOpen: boolean) => void;
}

export const Select: React.FC<SelectProps> = ({
  id,
  options = [],
  value,
  defaultValue,
  placeholder,
  disabled = false,
  onChange,
  size = 'medium',
  label,
  multiple = false,
  searchable = false,
  clearable = false,
  showSelectAll = false,
  loading = false,
  error = false,
  errorMessage,
  maxTagCount = 3,
  searchPlaceholder,
  emptyText,
  renderOption,
  renderValue,
  className = '',
  placement = 'bottom',
  autoClose = false,
  allowCustomValue = false,
  customValueHint,
  selectAllText = DEFAULT_SELECT_TEXT.selectAll,
  loadingText = DEFAULT_SELECT_TEXT.loading,
  clearAriaLabel = DEFAULT_SELECT_TEXT.clear,
  clearSearchAriaLabel = DEFAULT_SELECT_TEXT.clearSearch,
  getRemoveOptionAriaLabel = (option) => `Remove ${option.label}`,
  onOpenChange,
}) => {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  const labelId = `${selectId}-label`;
  const listboxId = `${selectId}-listbox`;
  const errorId = `${selectId}-error`;
  const resolvedPlaceholder = placeholder ?? DEFAULT_SELECT_TEXT.placeholder;
  const resolvedSearchPlaceholder = searchPlaceholder ?? DEFAULT_SELECT_TEXT.searchPlaceholder;
  const resolvedEmptyText = emptyText ?? DEFAULT_SELECT_TEXT.empty;
  const resolvedCustomValueHint = customValueHint ?? DEFAULT_SELECT_TEXT.customValueHint;
  const [isOpen, setIsOpen] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string | number | (string | number)[]>(
    value !== undefined ? value : defaultValue !== undefined ? defaultValue : multiple ? [] : ''
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const hasMountedRef = useRef(false);
  
  const selectRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isKeyboardNavigation = useRef(false);

  useEffect(() => {
    if (value !== undefined) {
      setSelectedValue(value);
    }
  }, [value]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery || !searchable) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(opt => 
      opt.label.toLowerCase().includes(query) ||
      opt.description?.toLowerCase().includes(query)
    );
  }, [options, searchQuery, searchable]);

  const activeOptionId =
    isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length
      ? `${selectId}-option-${highlightedIndex}`
      : undefined;

  const groupedOptions = useMemo(() => {
    const groups: { [key: string]: SelectOption[] } = {};
    const ungrouped: SelectOption[] = [];
    
    filteredOptions.forEach(opt => {
      if (opt.group) {
        if (!groups[opt.group]) {
          groups[opt.group] = [];
        }
        groups[opt.group].push(opt);
      } else {
        ungrouped.push(opt);
      }
    });
    
    return { groups, ungrouped, hasGroups: Object.keys(groups).length > 0 };
  }, [filteredOptions]);

  const isSelected = useCallback((optionValue: string | number) => {
    if (multiple) {
      return (selectedValue as (string | number)[]).includes(optionValue);
    }
    return selectedValue === optionValue;
  }, [selectedValue, multiple]);

  const selectedOptions = useMemo(() => {
    if (multiple) {
      return options.filter(opt => 
        (selectedValue as (string | number)[]).includes(opt.value)
      );
    }
    return options.find(opt => opt.value === selectedValue);
  }, [selectedValue, options, multiple]);

  const handleSelect = useCallback((option: SelectOption) => {
    if (option.disabled) return;

    let newValue: string | number | (string | number)[];
    
    if (multiple) {
      const currentValues = selectedValue as (string | number)[];
      if (currentValues.includes(option.value)) {
        newValue = currentValues.filter(v => v !== option.value);
      } else {
        newValue = [...currentValues, option.value];
      }
      setSelectedValue(newValue);
      onChange?.(newValue);
      
      if (autoClose && newValue.length > 0) {
        setIsOpen(false);
        setSearchQuery('');
      }
    } else {
      newValue = option.value;
      setSelectedValue(newValue);
      onChange?.(newValue);
      setIsOpen(false);
      setSearchQuery('');
    }
    
    setHighlightedIndex(-1);
  }, [selectedValue, multiple, onChange, autoClose]);

  const handleSelectAll = useCallback(() => {
    if (!multiple) return;
    
    const currentValues = selectedValue as (string | number)[];
    const availableOptions = filteredOptions.filter(opt => !opt.disabled);
    const availableValues = availableOptions.map(opt => opt.value);
    
    const allSelected = availableValues.every(v => currentValues.includes(v));
    
    let newValue: (string | number)[];
    if (allSelected) {
      newValue = currentValues.filter(v => !availableValues.includes(v));
    } else {
      newValue = [...new Set([...currentValues, ...availableValues])];
    }
    
    setSelectedValue(newValue);
    onChange?.(newValue);
  }, [multiple, selectedValue, filteredOptions, onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const newValue = multiple ? [] : '';
    setSelectedValue(newValue);
    onChange?.(newValue);
    setSearchQuery('');
  }, [multiple, onChange]);

  const handleCustomValueSubmit = useCallback(() => {
    if (!allowCustomValue || multiple || !searchQuery.trim()) return false;
    
    const trimmedValue = searchQuery.trim();
    const existingOption = options.find(opt => 
      opt.value === trimmedValue || opt.label.toLowerCase() === trimmedValue.toLowerCase()
    );
    
    if (existingOption) {
      handleSelect(existingOption);
    } else {
      setSelectedValue(trimmedValue);
      onChange?.(trimmedValue);
      setIsOpen(false);
      setSearchQuery('');
    }
    return true;
  }, [allowCustomValue, multiple, searchQuery, options, handleSelect, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[highlightedIndex]);
        } else if (allowCustomValue && !multiple && searchQuery.trim()) {
          handleCustomValueSubmit();
        }
        break;
        
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        isKeyboardNavigation.current = true;
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setHighlightedIndex(prev => 
            prev < filteredOptions.length - 1 ? prev + 1 : prev
          );
        }
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        isKeyboardNavigation.current = true;
        if (isOpen) {
          setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
        }
        break;
        
      case 'Tab':
        if (isOpen) {
          if (allowCustomValue && !multiple && searchQuery.trim()) {
            handleCustomValueSubmit();
          }
          setIsOpen(false);
        }
        break;
    }
  }, [disabled, isOpen, highlightedIndex, filteredOptions, handleSelect, allowCustomValue, multiple, searchQuery, handleCustomValueSubmit]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        if (allowCustomValue && !multiple && searchQuery.trim()) {
          const trimmedValue = searchQuery.trim();
          const existingOption = options.find(opt => 
            opt.value === trimmedValue || opt.label.toLowerCase() === trimmedValue.toLowerCase()
          );
          if (existingOption) {
            setSelectedValue(existingOption.value);
            onChange?.(existingOption.value);
          } else {
            setSelectedValue(trimmedValue);
            onChange?.(trimmedValue);
          }
        }
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [allowCustomValue, multiple, searchQuery, options, onChange]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, searchable]);

  useEffect(() => {
    if (highlightedIndex >= 0 && isKeyboardNavigation.current) {
      const highlightedElement = document.getElementById(`${selectId}-option-${highlightedIndex}`);
      highlightedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      isKeyboardNavigation.current = false;
    }
  }, [highlightedIndex, selectId]);

  const classNames = [
    'select',
    `select--${size}`,
    `select--placement-${placement}`,
    isOpen && 'select--open',
    disabled && 'select--disabled',
    error && 'select--error',
    multiple && 'select--multiple',
    className
  ]
    .filter(Boolean)
    .join(' ');

  const renderSelectedValue = () => {
    if (renderValue) {
      const customRenderedValue = renderValue(selectedOptions);
      if (customRenderedValue) {
        return customRenderedValue;
      }
    }

    if (multiple) {
      const selected = selectedOptions as SelectOption[];
      if (selected.length === 0) {
        return <span className="select__placeholder">{resolvedPlaceholder}</span>;
      }
      
      const displayTags = selected.slice(0, maxTagCount);
      const remaining = selected.length - maxTagCount;
      
      return (
        <div className="select__tags">
          {displayTags.map(opt => (
            <span key={opt.value} className="select__tag">
              {opt.icon && <span className="select__tag-icon">{opt.icon}</span>}
              <span className="select__tag-label">{opt.label}</span>
              <button
                className="select__tag-remove"
                type="button"
                aria-label={getRemoveOptionAriaLabel(opt)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(opt);
                }}
              >
                <CloseGlyph size={10} />
              </button>
            </span>
          ))}
          {remaining > 0 && (
            <span className="select__tag select__tag--more">+{remaining}</span>
          )}
        </div>
      );
    } else {
      const selected = selectedOptions as SelectOption | undefined;
      if (!selected) {
        if (allowCustomValue && selectedValue && selectedValue !== '') {
          return (
            <span className="select__value">
              <span className="select__value-label select__value-label--custom">{String(selectedValue)}</span>
            </span>
          );
        }
        return <span className="select__placeholder">{resolvedPlaceholder}</span>;
      }
      return (
        <span className="select__value">
          {selected.icon && <span className="select__value-icon">{selected.icon}</span>}
          <span className="select__value-label">{selected.label}</span>
        </span>
      );
    }
  };

  const renderOptionItem = (option: SelectOption, index: number) => {
    const selected = isSelected(option.value);
    const highlighted = index === highlightedIndex;
    
    return (
      <div
        key={option.value}
        id={`${selectId}-option-${index}`}
        className={`select__option ${selected ? 'select__option--selected' : ''} ${
          option.disabled ? 'select__option--disabled' : ''
        } ${highlighted ? 'select__option--highlighted' : ''}`}
        onClick={() => handleSelect(option)}
        onMouseEnter={() => setHighlightedIndex(index)}
        role="option"
        aria-selected={selected}
        aria-disabled={option.disabled}
      >
        {multiple && (
          <span className={`select__checkbox ${selected ? 'select__checkbox--checked' : ''}`}>
            {selected && <CheckGlyph />}
          </span>
        )}
        
        {renderOption ? renderOption(option) : (
          <div className="select__option-content">
            {option.icon && <span className="select__option-icon">{option.icon}</span>}
            <div className="select__option-text">
              <div className="select__option-label">{option.label}</div>
              {option.description && (
                <div className="select__option-description">{option.description}</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={classNames} ref={selectRef}>
      {label && (
        <label id={labelId} className="select__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      
      <div
        id={selectId}
        className="select__trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-disabled={disabled}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={error && errorMessage ? errorId : undefined}
        aria-invalid={error || undefined}
      >
        {renderSelectedValue()}
        
        <div className="select__suffix">
          {loading && (
            <span className="select__loading">
              <span className="select__loading-spinner" />
            </span>
          )}
          {clearable && !loading && (multiple ? (selectedValue as any[]).length > 0 : selectedValue) && (
            <button
              className="select__clear"
              onClick={handleClear}
              type="button"
              aria-label={clearAriaLabel}
            >
              <CloseGlyph />
            </button>
          )}
          <span className={`select__arrow ${isOpen ? 'select__arrow--open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
      </div>

      {isOpen && (
        <div
          className={`select__dropdown select__dropdown--${placement}`}
          ref={dropdownRef}
        >
          {searchable && (
            <div className="select__search">
              <input
                ref={searchInputRef}
                type="text"
                className="select__search-input"
                placeholder={resolvedSearchPlaceholder}
                value={searchQuery}
                role="combobox"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                aria-labelledby={label ? labelId : undefined}
                aria-describedby={error && errorMessage ? errorId : undefined}
                aria-invalid={error || undefined}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                      handleSelect(filteredOptions[highlightedIndex]);
                    } else if (allowCustomValue && !multiple && searchQuery.trim()) {
                      handleCustomValueSubmit();
                    }
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsOpen(false);
                    setSearchQuery('');
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    isKeyboardNavigation.current = true;
                    setHighlightedIndex(prev => 
                      prev < filteredOptions.length - 1 ? prev + 1 : prev
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    isKeyboardNavigation.current = true;
                    setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
                  }
                }}
              />
              {searchQuery && (
                <button
                  className="select__search-clear"
                  type="button"
                  aria-label={clearSearchAriaLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery('');
                    setHighlightedIndex(-1);
                    searchInputRef.current?.focus();
                  }}
                >
                  <CloseGlyph />
                </button>
              )}
            </div>
          )}
          
          {multiple && showSelectAll && filteredOptions.length > 0 && (
            <button className="select__select-all" onClick={handleSelectAll} type="button">
              <span className={`select__checkbox ${
                filteredOptions.filter(opt => !opt.disabled).every(opt => isSelected(opt.value))
                  ? 'select__checkbox--checked' : ''
              }`}>
                {filteredOptions.filter(opt => !opt.disabled).every(opt => isSelected(opt.value)) && <CheckGlyph />}
              </span>
              <span>{selectAllText}</span>
            </button>
          )}
          
          <div id={listboxId} className="select__options" role="listbox" aria-labelledby={label ? labelId : undefined}>
            {filteredOptions.length === 0 ? (
              loading ? (
                <div className="select__empty select__empty--loading">
                  <span className="select__loading-spinner" aria-hidden="true" />
                  <span>{loadingText}</span>
                </div>
              ) : allowCustomValue && !multiple && searchQuery.trim() ? (
                <button
                  className="select__custom-value-hint"
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => handleCustomValueSubmit()}
                >
                  <span className="select__custom-value-text">"{searchQuery.trim()}"</span>
                  <span className="select__custom-value-action">{resolvedCustomValueHint}</span>
                </button>
              ) : (
                <div className="select__empty">{resolvedEmptyText}</div>
              )
            ) : groupedOptions.hasGroups ? (
              (() => {
                let globalIndex = 0;
                return (
                  <>
                    {groupedOptions.ungrouped.map((option) => 
                      renderOptionItem(option, globalIndex++)
                    )}
                    {Object.entries(groupedOptions.groups).map(([groupName, groupOptions]) => (
                      <div key={groupName} className="select__group">
                        <div className="select__group-label">{groupName}</div>
                        {groupOptions.map((option) => 
                          renderOptionItem(option, globalIndex++)
                        )}
                      </div>
                    ))}
                  </>
                );
              })()
            ) : (
              <>
                {filteredOptions.map((option, index) => renderOptionItem(option, index))}
                {allowCustomValue && !multiple && searchQuery.trim() && 
                 !filteredOptions.some(opt => opt.label.toLowerCase() === searchQuery.trim().toLowerCase()) && (
                  <button
                    className="select__custom-value-hint"
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => handleCustomValueSubmit()}
                  >
                    <span className="select__custom-value-text">"{searchQuery.trim()}"</span>
                    <span className="select__custom-value-action">{resolvedCustomValueHint}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      
      {error && errorMessage && (
        <div id={errorId} className="select__error-message">{errorMessage}</div>
      )}
    </div>
  );
};
