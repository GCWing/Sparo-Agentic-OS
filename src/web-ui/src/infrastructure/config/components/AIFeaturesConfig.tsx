 

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/design-system';
import { ConfigPageHeader, ConfigPageLayout, ConfigPageContent, ConfigPageSection, ConfigPageRow, ConfigPageLoading, ConfigPageMessage } from './common';
import { aiExperienceConfigService, type AIExperienceSettings } from '../services/AIExperienceConfigService';
import { useAIExperienceSettings } from '../hooks';
import { configManager } from '../services/ConfigManager';
import { getCompactModelDisplayName } from '../services/modelConfigs';
import { useNotification, notificationService } from '@/shared/notification-system';
import type { AIModelConfig, DefaultModels } from '../types';
import { ModelSelectionRadio } from './ModelSelectionRadio';
import { createLogger } from '@/shared/utils/logger';
import './AIFeaturesConfig.scss';

const log = createLogger('AIFeaturesConfig');

interface FeatureConfig {
  id: string;
  settingKey?: keyof AIExperienceSettings;  
  agentName?: string;  
}


const FEATURE_CONFIGS: FeatureConfig[] = [
  {
    id: 'sessionTitle',
    settingKey: 'enable_session_title_generation',
    agentName: 'session-title-func-agent',
  },
];

const AIFeaturesConfig: React.FC = () => {
  const { t } = useTranslation('settings/ai-features');
  const notification = useNotification();
  
  
  const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useAIExperienceSettings();
  const [isLoading, setIsLoading] = useState(true);
  
  
  const [models, setModels] = useState<AIModelConfig[]>([]);
  const [defaultModels, setDefaultModels] = useState<DefaultModels>({ primary: null, fast: null });
  const [funcAgentModels, setFuncAgentModels] = useState<Record<string, string>>({});

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    try {
      
      const [
        allModels,
        defaultModelsData,
        funcAgentModelsData
      ] = await Promise.all([
        configManager.getSetting<AIModelConfig[]>('core.ai.models') || [],
        configManager.getSetting<Partial<DefaultModels>>('core.ai.default_models') || {},
        configManager.getSetting<Record<string, string>>('core.ai.func_agent_models') || {}
      ]);

      setModels(allModels);
      setDefaultModels({
        primary: defaultModelsData?.primary || null,
        fast: defaultModelsData?.fast || null,
      });
      setFuncAgentModels(funcAgentModelsData);
    } catch (error) {
      log.error('Failed to load data', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  
  const getModelName = useCallback((modelId: string | null | undefined): string | undefined => {
    if (!modelId) return undefined;
    const model = models.find(m => m.id === modelId);
    return model ? getCompactModelDisplayName(model) || model.id : undefined;
  }, [models]);

  const updateSetting = async <K extends keyof AIExperienceSettings>(
    key: K,
    value: AIExperienceSettings[K]
  ) => {
    if (!settings) {
      notification.error(t('messages.updateFailed'));
      return;
    }
    const newSettings = { ...settings, [key]: value };
    try {
      await aiExperienceConfigService.saveSettings(newSettings);
      notification.success(t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save AI features settings', error);
      notification.error(`${t('messages.saveFailed')}: ` + (error instanceof Error ? error.message : String(error)));
      
    }
  };

  
  function getFeatureIdByAgent(agentName: string): string {
    const feature = FEATURE_CONFIGS.find(f => f.agentName === agentName);
    return feature?.id || agentName;
  }

  const handleAgentSelectionChange = async (
    agentName: string,
    modelId: string
  ) => {
    try {
      const currentFuncAgentModels = await configManager.getSetting<Record<string, string>>('core.ai.func_agent_models') || {};

      const updatedFuncAgentModels = {
        ...currentFuncAgentModels,
        [agentName]: modelId,
      };
      await configManager.setSetting('core.ai.func_agent_models', updatedFuncAgentModels);

      setFuncAgentModels(updatedFuncAgentModels);

      
      let modelDesc = '';
      if (modelId === 'primary') {
        modelDesc = t('model.primary');
      } else if (modelId === 'fast') {
        modelDesc = t('model.fast');
      } else {
        modelDesc = getModelName(modelId) || modelId || '';
      }

      notificationService.success(
        t('models.updateSuccess', { agentName: t(`features.${getFeatureIdByAgent(agentName)}.title`), modelName: modelDesc }),
        { duration: 2000 }
      );
    } catch (error) {
      log.error('Failed to update agent model', { agentName, modelId, error });
      notificationService.error(t('messages.updateFailed'), { duration: 3000 });
    }
  };

  
  
  const enabledModels = models.filter(m => m.enabled);
  const primaryModelName = getModelName(defaultModels.primary) || t('model.notConfigured');
  const fastModelName = getModelName(defaultModels.fast) || t('model.fastUsesPrimary');

  if (isLoading || settingsLoading) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader
          title={t('title')}
        />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageLoading text={t('loading.text')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  if (settingsError || !settings) {
    return (
      <ConfigPageLayout className="sparo-func-agent-config">
        <ConfigPageHeader title={t('title')} />
        <ConfigPageContent className="sparo-func-agent-config__content">
          <ConfigPageMessage message={{ type: 'error', text: t('messages.updateFailed') }} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="sparo-func-agent-config">
      <ConfigPageHeader
        title={t('title')}
      />
      
      <ConfigPageContent className="sparo-func-agent-config__content">
        {FEATURE_CONFIGS.map((feature) => {
          const hasSwitch = !!feature.settingKey;
          const hasModel = !!feature.agentName;
          const isEnabled = hasSwitch ? Boolean(settings[feature.settingKey!]) : true;
          const configuredModelId = hasModel ? (funcAgentModels[feature.agentName!] || 'fast') : 'fast';
          const warning = t(`features.${feature.id}.warning`, '');

          return (
            <ConfigPageSection
              key={feature.id}
              title={t(`features.${feature.id}.title`)}
            >
              {hasSwitch && (
                <ConfigPageRow
                  label={t('common.enable')}
                  description={warning && !isEnabled ? warning : undefined}
                  align="center"
                >
                  <div className="sparo-func-agent-config__row-control">
                    <Switch
                      checked={isEnabled}
                      onChange={(e) => updateSetting(feature.settingKey!, e.target.checked)}
                      size="small"
                    />
                  </div>
                </ConfigPageRow>
              )}

              {hasModel && (
                <ConfigPageRow
                  className="sparo-func-agent-config__model-row"
                  label={t('model.label')}
                  description={enabledModels.length === 0 ? t('models.empty') : undefined}
                  align="center"
                >
                  <div className="sparo-func-agent-config__row-control sparo-func-agent-config__row-control--model">
                    <ModelSelectionRadio
                      value={configuredModelId}
                      models={enabledModels}
                      onChange={(modelId) => handleAgentSelectionChange(feature.agentName!, modelId)}
                      layout="horizontal"
                      size="small"
                      interactionMode="focus-custom"
                      primaryModelName={primaryModelName}
                      fastModelName={fastModelName}
                    />
                  </div>
                </ConfigPageRow>
              )}
            </ConfigPageSection>
          );
        })}
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AIFeaturesConfig;
