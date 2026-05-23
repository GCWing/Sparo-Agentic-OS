/**
 * Model selector component.
 * Shows the active model and allows quick switching.
 *
 * Config linkage:
 * - Unified logic: all agents use ai.agent_models[agent_id]
 * - Supports 'primary' | 'fast' | specific model IDs
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, Check, Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { getProviderDisplayName } from '@/infrastructure/config/services/modelConfigs';
import { getEffectiveReasoningMode, isReasoningVisiblyEnabled } from '@/infrastructure/config/utils/reasoning';
import { globalEventBus } from '@/infrastructure/event-bus';
import type { AIModelConfig } from '@/infrastructure/config/types';
import { Button, Tooltip } from '@/design-system';
import { FlowChatStore } from '../store/FlowChatStore';
import { createLogger } from '@/shared/utils/logger';
import './ModelSelector.scss';

const log = createLogger('ModelSelector');

interface ModelSelectorProps {
  /** Current mode ID. */
  currentAgent: string;
  /** Custom class name. */
  className?: string;
  /** Current session ID (used to update session mode config). */
  sessionId?: string;
}

interface ModelInfo {
  id: string;
  /** User-defined configuration name (AIModelConfig.name). */
  configName: string;
  /** Actual model identifier (AIModelConfig.model_name). */
  modelName: string;
  providerName: string;
  provider: string;
  contextWindow?: number;
  enableThinking?: boolean;
  reasoningEffort?: string;
}

// Helper: identify special model IDs.
const isSpecialModel = (value: string): value is 'primary' | 'fast' => {
  return value === 'primary' || value === 'fast';
};

const formatContextWindow = (contextWindow?: number): string | null => {
  if (!contextWindow) return null;
  return `${Math.round(contextWindow / 1000)}k`;
};

const buildModelMetaText = (model: Pick<ModelInfo, 'providerName' | 'contextWindow'>): string => {
  const parts = [model.providerName];
  const contextWindow = formatContextWindow(model.contextWindow);

  if (contextWindow) {
    parts.push(contextWindow);
  }

  return parts.join(' · ');
};

const buildResolvedModelTooltipText = (
  modelName: string | undefined,
  model: Pick<ModelInfo, 'providerName' | 'contextWindow'> | null | undefined,
  fallback: string
): string => {
  if (!model) return fallback;

  const parts = [];
  if (modelName) {
    parts.push(modelName);
  }

  const metaText = buildModelMetaText(model);
  if (metaText) {
    parts.push(metaText);
  }

  return parts.join(' · ') || fallback;
};

const getModelDisplayLabel = (model: ModelInfo | null, fallback: string): string => {
  if (!model) return fallback;
  if (isSpecialModel(model.id)) return model.configName;
  return model.modelName || model.configName || fallback;
};

const getModelTooltipText = (model: ModelInfo | null, fallback: string): string => {
  if (!model) return fallback;
  if (isSpecialModel(model.id)) {
    return buildResolvedModelTooltipText(model.modelName, model, fallback);
  }
  return buildModelMetaText(model);
};

function buildPrimaryModelInfo(
  t: (key: string) => string,
  allModels: AIModelConfig[],
  defaultModels: Record<string, string>,
): ModelInfo {
  const actualModelId = defaultModels.primary;
  const model = actualModelId ? allModels.find(m => m.id === actualModelId) : undefined;
  if (model) {
    return {
      id: 'primary',
      configName: t('modelSelector.primaryModel'),
      modelName: model.model_name,
      providerName: getProviderDisplayName(model),
      provider: model.provider,
      contextWindow: model.context_window,
      enableThinking: isReasoningVisiblyEnabled(getEffectiveReasoningMode(model)),
      reasoningEffort: model.reasoning_effort,
    };
  }
  return {
    id: 'primary',
    configName: t('modelSelector.primaryModel'),
    modelName: t('modelSelector.modelNotConfigured'),
    providerName: t('modelSelector.modelNotConfigured'),
    provider: 'primary',
  };
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentAgent,
  className = '',
  sessionId,
}) => {
  const { t } = useTranslation('flow-chat');
  const [allModels, setAllModels] = useState<AIModelConfig[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({});
  const [agentModels, setAgentModels] = useState<Record<string, string>>({}); // agent_id -> model_id
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load configuration data.
  const loadConfigData = useCallback(async () => {
    try {
      const [models, defaultModelsData, agentModelsData] = await Promise.all([
        configManager.getConfig<AIModelConfig[]>('ai.models') || [],
        configManager.getConfig<any>('ai.default_models') || {},
        configManager.getConfig<Record<string, string>>('ai.agent_models') || {}
      ]);

      setAllModels(models);
      setDefaultModels(defaultModelsData);
      setAgentModels(agentModelsData);

      log.debug('Configuration loaded', {
        modelsCount: models.length
      });
    } catch (error) {
      log.error('Failed to load configuration', error);
    }
  }, []);
  
  useEffect(() => {
    loadConfigData();
    
    const handleConfigUpdate = () => {
      log.debug('Configuration update detected, reloading');
      loadConfigData();
    };
    
    globalEventBus.on('agent:config:updated', handleConfigUpdate);
    
    const unsubscribe = configManager.onConfigChange((path) => {
      if (path.startsWith('ai.')) {
        log.debug('AI configuration changed', { path });
        loadConfigData();
      }
    });
    
    return () => {
      globalEventBus.off('agent:config:updated', handleConfigUpdate);
      unsubscribe();
    };
  }, [loadConfigData]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);
  
  const getCurrentModelId = useCallback((): string => {
    const raw = agentModels[currentAgent] || 'primary';
    const configuredModelId =
      raw === 'default' ? 'primary' : raw;
    if (configuredModelId === 'primary' || configuredModelId === 'fast') {
      return configuredModelId;
    }
    const model = allModels.find(m => m.id === configuredModelId);
    return model ? configuredModelId : 'primary';
  }, [allModels, currentAgent, agentModels]);
  
  const currentAgentl = useMemo((): ModelInfo | null => {
    const modelId = getCurrentModelId();

    if (isSpecialModel(modelId)) {
      const actualModelId = defaultModels[modelId];
      const model =
        actualModelId ? allModels.find(m => m.id === actualModelId) : undefined;

      if (!actualModelId || !model) {
        return modelId === 'primary'
          ? buildPrimaryModelInfo(t, allModels, defaultModels)
          : {
              id: 'fast',
              configName: t('modelSelector.fastModel'),
              modelName: t('modelSelector.modelNotConfigured'),
              providerName: t('modelSelector.modelNotConfigured'),
              provider: 'fast',
            };
      }

      return {
        id: modelId,
        configName: modelId === 'primary' ? t('modelSelector.primaryModel') : t('modelSelector.fastModel'),
        modelName: model.model_name,
        providerName: getProviderDisplayName(model),
        provider: model.provider,
        contextWindow: model.context_window,
        enableThinking: isReasoningVisiblyEnabled(getEffectiveReasoningMode(model)),
        reasoningEffort: model.reasoning_effort,
      };
    }

    const model = allModels.find(m => m.id === modelId);
    if (!model) return buildPrimaryModelInfo(t, allModels, defaultModels);

    return {
      id: model.id || '',
      configName: model.name,
      modelName: model.model_name,
      providerName: getProviderDisplayName(model),
      provider: model.provider,
      contextWindow: model.context_window,
      enableThinking: isReasoningVisiblyEnabled(getEffectiveReasoningMode(model)),
      reasoningEffort: model.reasoning_effort,
    };
  }, [getCurrentModelId, allModels, defaultModels, t]);
  
  const availableModels = useMemo((): ModelInfo[] => {
    return allModels
      .filter(m => {
        if (!m.enabled) return false;
        // Only show chat-capable models (exclude embeddings / image-gen / speech, etc.).
        const capabilities = Array.isArray(m.capabilities) ? m.capabilities : [];
        return capabilities.includes('text_chat');
      })
      .map(m => ({
        id: m.id || '',
        configName: m.name,
        modelName: m.model_name,
        providerName: getProviderDisplayName(m),
        provider: m.provider,
        contextWindow: m.context_window,
        enableThinking: isReasoningVisiblyEnabled(getEffectiveReasoningMode(m)),
        reasoningEffort: m.reasoning_effort,
      }));
  }, [allModels]);
  
  const handleSelectModel = useCallback(async (modelId: string) => {
    if (loading) return;

    setLoading(true);
    try {
      const currentAgentModels = await configManager.getConfig<Record<string, string>>('ai.agent_models') || {};

      const updatedAgentModels = {
        ...currentAgentModels,
        [currentAgent]: modelId,
      };

      await configManager.setConfig('ai.agent_models', updatedAgentModels);
      setAgentModels(updatedAgentModels);

      if (sessionId) {
        const store = FlowChatStore.getInstance();
        store.updateSessionModelName(sessionId, modelId);
        const session = store.getState().sessions.get(sessionId);
        if (!session?.isTransient) {
          await agentAPI.updateSessionModel({
            sessionId,
            modelName: modelId,
          });
        }
      }

      log.info('Agent model updated', { agent: currentAgent, modelId });

      globalEventBus.emit('agent:config:updated');

      setDropdownOpen(false);
    } catch (error) {
      log.error('Failed to switch model', error);
    } finally {
      setLoading(false);
    }
  }, [currentAgent, loading, sessionId]);
  
  if (availableModels.length === 0) {
    return null;
  }

  const currentAgentlId = getCurrentModelId();

  const fallbackTooltip = t('modelSelector.modelNotConfigured');
  const tooltipContent = getModelTooltipText(currentAgentl, fallbackTooltip);

  return (
    <div
      ref={dropdownRef}
      className={`sparo-model-selector ${className}`}
    >
      <Tooltip content={tooltipContent}>
        <Button
          type="button"
          variant="ghost"
          size="small"
          aria-label={tooltipContent}
          className={`sparo-model-selector__trigger ${dropdownOpen ? 'sparo-model-selector__trigger--open' : ''}`}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          disabled={loading}
        >
          <span className="sparo-model-selector__name">
            {getModelDisplayLabel(currentAgentl, t('modelSelector.primaryModel'))}
          </span>
          <ChevronDown size={12} className="sparo-model-selector__chevron" />
        </Button>
      </Tooltip>

      {dropdownOpen && (
        <div className="sparo-model-selector__dropdown">
          <div className="sparo-model-selector__dropdown-header">
            <span>{t('modelSelector.modelSelection')}</span>
            {currentAgent !== 'Dispatcher' && (
              <span className="sparo-model-selector__dropdown-hint">
                {t('modelSelector.currentAgent')}: {currentAgent}
              </span>
            )}
          </div>

          {(() => {
            const primaryModel = allModels.find(m => m.id === defaultModels.primary);
            const primaryTooltip = primaryModel
              ? buildResolvedModelTooltipText(primaryModel.model_name, {
                providerName: getProviderDisplayName(primaryModel),
                contextWindow: primaryModel.context_window
              }, fallbackTooltip)
              : fallbackTooltip;
            return (
              <Tooltip content={primaryTooltip} placement="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className={`sparo-model-selector__option sparo-model-selector__option--special ${currentAgentlId === 'primary' ? 'sparo-model-selector__option--selected' : ''}`}
                  onClick={() => { void handleSelectModel('primary'); }}
                >
                  <div className="sparo-model-selector__option-main">
                    <span className="sparo-model-selector__option-name">{t('modelSelector.primaryModel')}</span>
                  </div>
                  {currentAgentlId === 'primary' && (
                    <Check size={14} className="sparo-model-selector__option-check" />
                  )}
                </Button>
              </Tooltip>
            );
          })()}

          {(() => {
            const fastModel = allModels.find(m => m.id === defaultModels.fast);
            const fastTooltip = fastModel
              ? buildResolvedModelTooltipText(fastModel.model_name, {
                providerName: getProviderDisplayName(fastModel),
                contextWindow: fastModel.context_window
              }, fallbackTooltip)
              : fallbackTooltip;
            return (
              <Tooltip content={fastTooltip} placement="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  className={`sparo-model-selector__option sparo-model-selector__option--special ${currentAgentlId === 'fast' ? 'sparo-model-selector__option--selected' : ''}`}
                  onClick={() => { void handleSelectModel('fast'); }}
                >
                  <div className="sparo-model-selector__option-main">
                    <span className="sparo-model-selector__option-name">{t('modelSelector.fastModel')}</span>
                  </div>
                  {currentAgentlId === 'fast' && (
                    <Check size={14} className="sparo-model-selector__option-check" />
                  )}
                </Button>
              </Tooltip>
            );
          })()}

          <div className="sparo-model-selector__divider" />

          <div className="sparo-model-selector__list">
            {availableModels.map(model => {
              const isSelected = currentAgentlId === model.id;

              return (
                <Tooltip key={model.id} content={buildModelMetaText(model)} placement="right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    className={`sparo-model-selector__option ${isSelected ? 'sparo-model-selector__option--selected' : ''}`}
                    onClick={() => { void handleSelectModel(model.id); }}
                  >
                    <div className="sparo-model-selector__option-main">
                      <span className="sparo-model-selector__option-name">
                        {model.modelName}
                        {model.enableThinking && (
                          <Brain size={10} className="sparo-model-selector__option-thinking" />
                        )}
                      </span>
                    </div>
                    {isSelected && (
                      <Check size={14} className="sparo-model-selector__option-check" />
                    )}
                  </Button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
export default ModelSelector;
