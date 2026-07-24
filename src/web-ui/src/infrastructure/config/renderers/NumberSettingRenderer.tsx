import { FormField, NumberField } from '@/design-system';
import { dispatchSettingChange, type SettingRendererFieldProps } from './types';

export interface NumberSettingRendererProps extends SettingRendererFieldProps<number | null> {
  nullable?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}

export function NumberSettingRenderer({
  id,
  label,
  description,
  value,
  onChange,
  nullable = false,
  placeholder,
  min,
  max,
  step,
  precision,
  disabled = false,
  loading = false,
  errorMessage,
  onError,
}: NumberSettingRendererProps) {
  const commonProps = {
    min,
    max,
    step,
    precision,
    placeholder,
    disabled: disabled || loading,
    error: Boolean(errorMessage),
  };

  return (
    <FormField
      controlId={id}
      label={label}
      description={description}
      error={errorMessage}
      orientation="horizontal"
      controlWidth="compact"
    >
      {nullable ? (
        <NumberField
          {...commonProps}
          nullable
          value={value}
          onChange={(nextValue) => dispatchSettingChange(onChange, nextValue, onError)}
        />
      ) : (
        <NumberField
          {...commonProps}
          value={value as number}
          onChange={(nextValue) => dispatchSettingChange(onChange, nextValue, onError)}
        />
      )}
    </FormField>
  );
}
