import { FormField, Select, type SelectOption } from '@/design-system';
import { dispatchSettingChange, type SettingRendererFieldProps } from './types';

export interface EnumSettingRendererProps extends SettingRendererFieldProps<string | number> {
  options: readonly SelectOption[];
}

export function EnumSettingRenderer({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  errorMessage,
  onError,
}: EnumSettingRendererProps) {
  return (
    <FormField
      controlId={id}
      label={label}
      error={errorMessage}
      orientation="horizontal"
      controlWidth="balanced"
    >
      <Select
        value={value}
        options={[...options]}
        disabled={disabled}
        loading={loading}
        error={Boolean(errorMessage)}
        onChange={(nextValue) => {
          if (!Array.isArray(nextValue)) {
            dispatchSettingChange(onChange, nextValue, onError);
          }
        }}
      />
    </FormField>
  );
}
