import type { SelectOption } from '@/design-system';
import type { JsonValue, SettingDescriptor } from '../catalog/types';
import { useSetting } from '../hooks/useSetting';
import { ConfigConfirmationRequiredError } from '../transaction/ConfigTransactionClient';
import { BooleanSettingRenderer } from './BooleanSettingRenderer';
import { EnumSettingRenderer } from './EnumSettingRenderer';
import { NumberSettingRenderer } from './NumberSettingRenderer';
import { StringSettingRenderer } from './StringSettingRenderer';
import { JsonSettingRenderer } from './JsonSettingRenderer';
import { SecretSettingRenderer } from './SecretSettingRenderer';

export interface SettingRendererProps {
  settingId: string;
  translate: (key: string) => string;
  disabled?: boolean;
  onConfirmationRequired?: (error: ConfigConfirmationRequiredError) => Promise<void>;
  onError?: (error: Error) => void;
  onDirtyChange?: (dirty: boolean, baseRevision?: number) => void;
}

function resolveOptions(descriptor: SettingDescriptor): SelectOption[] {
  if (descriptor.resolvedOptions?.length) {
    return descriptor.resolvedOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }
  const schema = descriptor.valueSchema;
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer') {
    return (schema.enum ?? []).map((value) => ({ value, label: String(value) }));
  }
  return [];
}

function getNumberPrecision(descriptor: SettingDescriptor): number | undefined {
  const schema = descriptor.valueSchema;
  if (schema.type === 'integer') {
    return 0;
  }
  if (schema.type !== 'number' || schema.multipleOf === undefined) {
    return undefined;
  }
  const fraction = String(schema.multipleOf).split('.')[1];
  return fraction?.length ?? 0;
}

function canRenderEnum(descriptor: SettingDescriptor): boolean {
  const schema = descriptor.valueSchema;
  if (schema.type !== 'string' && schema.type !== 'number' && schema.type !== 'integer') {
    return false;
  }
  return Boolean(descriptor.resolvedOptions?.length || schema.enum?.length);
}

export function SettingRenderer({
  settingId,
  translate,
  disabled = false,
  onConfirmationRequired,
  onError,
  onDirtyChange,
}: SettingRendererProps) {
  const setting = useSetting(settingId);
  const descriptor = setting.descriptor;
  const value = setting.value;

  if (!descriptor) {
    return null;
  }

  const label = translate(descriptor.presentation.titleKey);
  const description = descriptor.presentation.descriptionKey
    ? translate(descriptor.presentation.descriptionKey)
    : undefined;
  const fieldId = descriptor.presentation.fieldId;
  const errorMessage = setting.error?.message;
  const isDisabled = disabled || descriptor.policy.mutability === 'readOnly';
  const handleError = (error: Error) => {
    onError?.(error);
  };
  const commit = async (nextValue: JsonValue): Promise<void> => {
    try {
      await setting.setValue(nextValue);
    } catch (error) {
      if (error instanceof ConfigConfirmationRequiredError && onConfirmationRequired) {
        await onConfirmationRequired(error);
        return;
      }
      throw error;
    }
  };

  if (setting.storedValue?.kind === 'secret') {
    return (
      <SecretSettingRenderer
        id={fieldId}
        label={label}
        description={description}
        configured={setting.storedValue.configured}
        editable={descriptor.valueSchema.type === 'string'}
        configuredLabel={translate('settings/ai-mode:secret.configured')}
        unconfiguredLabel={translate('settings/ai-mode:secret.unconfigured')}
        placeholder={translate('settings/ai-mode:secret.placeholder')}
        updateLabel={translate('settings/ai-mode:secret.update')}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        onDirtyChange={(dirty) => onDirtyChange?.(dirty, setting.revision)}
        onError={handleError}
        onChange={(nextValue) => commit(nextValue)}
      />
    );
  }

  if (value === undefined) {
    return null;
  }

  if (canRenderEnum(descriptor) && (typeof value === 'string' || typeof value === 'number')) {
    return (
      <EnumSettingRenderer
        id={fieldId}
        label={label}
        value={value}
        options={resolveOptions(descriptor)}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        onError={handleError}
        onChange={commit}
      />
    );
  }

  if (descriptor.valueSchema.type === 'boolean' && typeof value === 'boolean') {
    return (
      <BooleanSettingRenderer
        id={fieldId}
        label={label}
        description={description}
        value={value}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        onError={handleError}
        onChange={commit}
      />
    );
  }

  if (
    (descriptor.valueSchema.type === 'number' || descriptor.valueSchema.type === 'integer')
    && (typeof value === 'number' || (descriptor.valueSchema.nullable && value === null))
  ) {
    const schema = descriptor.valueSchema;
    return (
      <NumberSettingRenderer
        id={fieldId}
        label={label}
        description={description}
        value={value}
        nullable={schema.nullable}
        placeholder={schema.nullable
          ? translate('settings/ai-mode:values.notSet')
          : undefined}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.multipleOf}
        precision={getNumberPrecision(descriptor)}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        onError={handleError}
        onChange={commit}
      />
    );
  }

  if (descriptor.valueSchema.type === 'string' && typeof value === 'string') {
    const schema = descriptor.valueSchema;
    return (
      <StringSettingRenderer
        id={fieldId}
        label={label}
        description={description}
        value={value}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        pattern={schema.pattern}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        conflictMessage={translate('settings/ai-mode:errors.manualConflict')}
        onDirtyChange={(dirty) => onDirtyChange?.(dirty, setting.revision)}
        onError={handleError}
        onChange={commit}
      />
    );
  }

  if (
    (descriptor.valueSchema.type === 'array' || descriptor.valueSchema.type === 'object')
    && (value === null || Array.isArray(value) || typeof value === 'object')
  ) {
    return (
      <JsonSettingRenderer
        id={fieldId}
        label={label}
        description={description}
        value={value}
        disabled={isDisabled}
        loading={setting.isLoading || setting.isSaving}
        errorMessage={errorMessage}
        conflictMessage={translate('settings/ai-mode:errors.manualConflict')}
        invalidJsonMessage={translate('settings/ai-mode:errors.invalidJson')}
        onDirtyChange={(dirty) => onDirtyChange?.(dirty, setting.revision)}
        onError={handleError}
        onChange={commit}
      />
    );
  }

  return null;
}
