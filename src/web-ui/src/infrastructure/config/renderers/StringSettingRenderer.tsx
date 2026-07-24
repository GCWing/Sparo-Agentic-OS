import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { FormField, Textarea, TextField } from '@/design-system';
import { ConfigConfirmationRejectedError } from '../transaction/ConfigTransactionClient';
import type { SettingRendererFieldProps } from './types';

export interface StringSettingRendererProps extends SettingRendererFieldProps<string> {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  conflictMessage?: string;
  onDirtyChange?: (dirty: boolean) => void;
  multiline?: boolean;
  rows?: number;
}

export function StringSettingRenderer({
  id,
  label,
  description,
  value,
  onChange,
  minLength,
  maxLength,
  pattern,
  conflictMessage,
  onDirtyChange,
  multiline = false,
  rows = 6,
  disabled = false,
  loading = false,
  errorMessage,
  onError,
}: StringSettingRendererProps) {
  const [draft, setDraft] = useState(value);
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  const draftRef = useRef(value);
  const baseValueRef = useRef(value);
  const dirtyRef = useRef(false);
  const onDirtyChangeRef = useRef(onDirtyChange);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    if (dirtyRef.current) {
      if (value !== baseValueRef.current) {
        setHasExternalConflict(true);
      }
      return;
    }
    baseValueRef.current = value;
    draftRef.current = value;
    setDraft(value);
    setHasExternalConflict(false);
  }, [value]);

  useEffect(() => () => {
    if (dirtyRef.current) {
      onDirtyChangeRef.current?.(false);
    }
  }, []);

  const updateDirty = (dirty: boolean) => {
    if (dirtyRef.current === dirty) {
      return;
    }
    dirtyRef.current = dirty;
    onDirtyChangeRef.current?.(dirty);
  };

  const commitDraft = async () => {
    if (draftRef.current === baseValueRef.current) {
      updateDirty(false);
      return;
    }
    try {
      await onChange(draftRef.current);
      baseValueRef.current = draftRef.current;
      setHasExternalConflict(false);
      updateDirty(false);
    } catch (error) {
      if (error instanceof ConfigConfirmationRejectedError) {
        return;
      }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !multiline) {
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      draftRef.current = baseValueRef.current;
      setDraft(baseValueRef.current);
      setHasExternalConflict(false);
      updateDirty(false);
      event.currentTarget.blur();
    }
  };

  const sharedProps = {
    value: draft,
    minLength,
    maxLength,
    disabled: disabled || loading,
    error: Boolean(errorMessage || hasExternalConflict),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const nextValue = event.currentTarget.value;
      draftRef.current = nextValue;
      setDraft(nextValue);
      updateDirty(nextValue !== baseValueRef.current);
    },
    onBlur: () => void commitDraft(),
    onKeyDown: handleKeyDown,
  };

  const renderedError = hasExternalConflict ? conflictMessage : errorMessage;
  return (
    <FormField
      controlId={id}
      label={label}
      description={description}
      error={renderedError}
      orientation="horizontal"
      controlWidth={multiline ? 'wide' : 'balanced'}
    >
      {multiline ? (
        <Textarea
          {...sharedProps}
          rows={rows}
          style={{ fontFamily: 'var(--ds-font-family-mono)' }}
        />
      ) : (
        <TextField
          {...sharedProps}
          pattern={pattern}
        />
      )}
    </FormField>
  );
}
