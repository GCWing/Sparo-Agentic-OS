import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Select, SelectableRow, StatusDot } from '@/design-system';
import type { AIModelConfig } from '../types';
import { getCompactModelDisplayName, getProviderDisplayName } from '../services/modelConfigs';
import './ModelSelectionRadio.scss';

export interface ModelSelectionRadioProps {
  value: string;
  models: AIModelConfig[];
  onChange: (modelId: string) => void;
  disabled?: boolean;
  layout?: 'horizontal' | 'vertical';
  size?: 'small' | 'medium';
}

const isSpecialModel = (value: string): value is 'primary' | 'fast' => {
  return value === 'primary' || value === 'fast';
};

const getModelSelectionLabel = (model: AIModelConfig): string => {
  return getCompactModelDisplayName(model) || model.id?.trim() || '';
};

const getModelSelectionDescription = (model: AIModelConfig): string | undefined => {
  const providerName = getProviderDisplayName(model).trim();
  const fullModelName = model.model_name?.trim() || model.name?.trim() || '';
  const compactModelName = getModelSelectionLabel(model);
  const parts: string[] = [];

  if (fullModelName && fullModelName !== compactModelName) {
    parts.push(fullModelName);
  }

  const fullNameIncludesProvider = providerName && fullModelName.startsWith(`${providerName}/`);
  if (
    providerName &&
    providerName !== compactModelName &&
    providerName !== fullModelName &&
    !fullNameIncludesProvider
  ) {
    parts.push(providerName);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
};

type SelectionType = 'primary' | 'fast' | 'custom';

interface SelectionRowOption {
  id: SelectionType;
  title: string;
  selected: boolean;
  disabled?: boolean;
  meta?: React.ReactNode;
  details?: React.ReactNode;
}

export const ModelSelectionRadio: React.FC<ModelSelectionRadioProps> = ({
  value,
  models,
  onChange,
  disabled = false,
  layout = 'horizontal',
  size = 'medium',
}) => {
  const { t } = useTranslation('settings/default-model');
  const uniqueId = useId();
  const radioName = `model-selection-${uniqueId}`;

  const selectionType = useMemo<SelectionType>(() => {
    if (value === 'primary') return 'primary';
    if (value === 'fast') return 'fast';
    return 'custom';
  }, [value]);

  const customModelId = useMemo(() => {
    return isSpecialModel(value) ? undefined : value;
  }, [value]);

  const enabledModels = useMemo(() => models.filter(m => m.enabled), [models]);

  const customModelLabel = useMemo(() => {
    if (!customModelId) return undefined;
    const model = enabledModels.find(item => item.id === customModelId);
    return model ? getModelSelectionLabel(model) : customModelId;
  }, [customModelId, enabledModels]);

  const handleSelectionChange = (selection: SelectionType) => {
    if (selection === 'custom') {
      const newModelId = customModelId || models[0]?.id || 'primary';
      onChange(newModelId);
    } else {
      onChange(selection);
    }
  };

  const handleCustomModelChange = (modelId: string | number | (string | number)[]) => {
    if (Array.isArray(modelId)) {
      onChange(String(modelId[0]));
    } else {
      onChange(String(modelId));
    }
  };

  const customSelect = (
    <Select
      value={customModelId || ''}
      onChange={handleCustomModelChange}
      disabled={disabled}
      placeholder={t('selection.selectModel')}
      options={enabledModels.map(model => ({
        label: getModelSelectionLabel(model),
        value: model.id!,
        description: getModelSelectionDescription(model),
      }))}
      size="small"
    />
  );

  const selectionOptions: SelectionRowOption[] = [
    {
      id: 'primary',
      title: t('selection.primary'),
      selected: selectionType === 'primary',
      disabled,
    },
    {
      id: 'fast',
      title: t('selection.fast'),
      selected: selectionType === 'fast',
      disabled,
    },
    {
      id: 'custom',
      title: t('selection.custom'),
      selected: selectionType === 'custom',
      disabled,
      meta: customModelLabel ? (
        <Badge variant="neutral" className="model-selection-radio__meta-badge">
          {customModelLabel}
        </Badge>
      ) : undefined,
      details: selectionType === 'custom' ? customSelect : undefined,
    },
  ];

  const renderSelectionOption = (option: SelectionRowOption) => (
    <div
      key={option.id}
      className={[
        'model-selection-radio__item',
        option.details && 'model-selection-radio__item--with-details',
      ].filter(Boolean).join(' ')}
    >
      <SelectableRow
        role="radio"
        aria-checked={option.selected}
        aria-describedby={option.details ? `${radioName}-${option.id}-details` : undefined}
        selected={option.selected}
        disabled={option.disabled}
        leading={(
          <StatusDot
            tone={option.selected ? 'accent' : 'neutral'}
            size="small"
            label={option.title}
          />
        )}
        title={option.title}
        meta={option.meta}
        className="model-selection-radio__row"
        onClick={() => handleSelectionChange(option.id)}
      />

      {option.details && (
        <div
          id={`${radioName}-${option.id}-details`}
          className="model-selection-radio__details"
        >
          {option.details}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`model-selection-radio model-selection-radio--${layout} model-selection-radio--${size}`}
      role="radiogroup"
    >
      {selectionOptions.map(renderSelectionOption)}
    </div>
  );
};

export default ModelSelectionRadio;
