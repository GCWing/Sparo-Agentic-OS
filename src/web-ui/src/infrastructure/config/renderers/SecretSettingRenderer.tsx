import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, Button, FormField, TextField } from '@/design-system';
import { ConfigConfirmationRejectedError } from '../transaction/ConfigTransactionClient';

export interface SecretSettingRendererProps {
  id: string;
  label: string;
  description?: string;
  configured: boolean;
  editable: boolean;
  configuredLabel: string;
  unconfiguredLabel: string;
  placeholder: string;
  updateLabel: string;
  disabled?: boolean;
  loading?: boolean;
  errorMessage?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (value: string) => Promise<void>;
  onError?: (error: Error) => void;
}

export function SecretSettingRenderer({
  id,
  label,
  description,
  configured,
  editable,
  configuredLabel,
  unconfiguredLabel,
  placeholder,
  updateLabel,
  disabled = false,
  loading = false,
  errorMessage,
  onDirtyChange,
  onChange,
  onError,
}: SecretSettingRendererProps) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dirtyRef = useRef(false);
  const onDirtyChangeRef = useRef(onDirtyChange);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

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

  const clearDraft = () => {
    setDraft('');
    updateDirty(false);
  };

  const commit = async () => {
    if (!draft || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onChange(draft);
      clearDraft();
    } catch (error) {
      if (!(error instanceof ConfigConfirmationRejectedError)) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const status = configured ? configuredLabel : unconfiguredLabel;
  if (!editable) {
    return (
      <FormField
        controlId={id}
        label={label}
        description={description}
        orientation="horizontal"
        controlWidth="compact"
        error={errorMessage}
      >
        <Badge variant={configured ? 'success' : 'neutral'}>{status}</Badge>
      </FormField>
    );
  }

  const isDisabled = disabled || loading || isSubmitting;
  return (
    <TextField
      id={id}
      type="password"
      autoComplete="new-password"
      label={label}
      description={[description, status].filter(Boolean).join(' · ')}
      value={draft}
      placeholder={placeholder}
      disabled={isDisabled}
      error={Boolean(errorMessage)}
      errorMessage={errorMessage}
      suffix={(
        <Button
          variant="secondary"
          size="small"
          disabled={isDisabled || !draft}
          onClick={() => void commit()}
        >
          {updateLabel}
        </Button>
      )}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        updateDirty(Boolean(value));
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        } else if (event.key === 'Escape') {
          clearDraft();
        }
      }}
    />
  );
}
