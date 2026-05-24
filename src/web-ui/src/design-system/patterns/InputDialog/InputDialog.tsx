import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../primitives/Button/Button';
import { Dialog } from '../../primitives/Dialog/Dialog';
import { Input } from '../../primitives/Input/Input';
import './InputDialog.scss';

const DEFAULT_PLACEHOLDER = 'Enter value';
const DEFAULT_CONFIRM_TEXT = 'OK';
const DEFAULT_CANCEL_TEXT = 'Cancel';
const DEFAULT_REQUIRED_ERROR = 'Value is required';

export interface InputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string) => void;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  validator?: (value: string) => string | null;
  required?: boolean;
  inputType?: 'text' | 'password' | 'email' | 'number';
}

export const InputDialog: React.FC<InputDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmText,
  cancelText,
  validator,
  required = true,
  inputType = 'text',
}) => {
  const resolvedPlaceholder = placeholder ?? DEFAULT_PLACEHOLDER;
  const resolvedConfirmText = confirmText ?? DEFAULT_CONFIRM_TEXT;
  const resolvedCancelText = cancelText ?? DEFAULT_CANCEL_TEXT;
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setError(null);
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [defaultValue, open]);

  const validateInput = (nextValue: string): boolean => {
    if (required && !nextValue.trim()) {
      setError(DEFAULT_REQUIRED_ERROR);
      return false;
    }

    const errorMessage = validator?.(nextValue);
    if (errorMessage) {
      setError(errorMessage);
      return false;
    }

    setError(null);
    return true;
  };

  const handleConfirm = () => {
    if (validateInput(value)) {
      onConfirm(value.trim());
      onOpenChange(false);
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    if (error) {
      setError(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="small"
      overlayClassName="input-dialog-overlay"
      initialFocusRef={inputRef}
    >
      <div className="input-dialog">
        <div className="input-dialog__body">
          {description && <p className="input-dialog__description">{description}</p>}
          <Input
            ref={inputRef}
            type={inputType}
            value={value}
            onChange={handleChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleConfirm();
              }
            }}
            placeholder={resolvedPlaceholder}
            error={!!error}
            errorMessage={error || undefined}
            inputSize="medium"
            autoFocus
          />
        </div>

        <div className="input-dialog__actions">
          <Button variant="secondary" size="small" onClick={() => onOpenChange(false)}>
            {resolvedCancelText}
          </Button>
          <Button variant="primary" size="small" onClick={handleConfirm}>
            {resolvedConfirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
