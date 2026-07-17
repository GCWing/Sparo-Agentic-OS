import { Switch } from '@/design-system';
import { dispatchSettingChange, type SettingRendererFieldProps } from './types';

export type BooleanSettingRendererProps = SettingRendererFieldProps<boolean>;

export function BooleanSettingRenderer({
  id,
  label,
  description,
  value,
  onChange,
  disabled = false,
  loading = false,
  onError,
}: BooleanSettingRendererProps) {
  return (
    <Switch
      id={id}
      label={label}
      description={description}
      checked={value}
      disabled={disabled}
      loading={loading}
      onChange={(event) => dispatchSettingChange(onChange, event.currentTarget.checked, onError)}
    />
  );
}
