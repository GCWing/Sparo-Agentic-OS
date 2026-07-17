import { ProviderTemplate, ApiFormat } from '../../../shared/types';
import { i18nService } from '@/infrastructure/i18n';
import { extractProviderSegmentFromBaseUrl, matchProviderCatalogItemByBaseUrl } from './providerCatalog';
import type { AIModelConfig } from '../types';

const t = (key: string, options?: Record<string, unknown>) => i18nService.t(key, options);

export interface RedactedModelSecret {
  configured: boolean;
  provider?: string;
  maskedSuffix?: string;
}

export type AIModelSnapshotEntry = Omit<AIModelConfig, 'api_key' | 'api_key_configured'> & {
  api_key?: RedactedModelSecret;
};

export type AIModelSnapshotWriteEntry = Omit<AIModelConfig, 'api_key' | 'api_key_configured'> & {
  api_key?: RedactedModelSecret | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isRedactedModelSecret(value: unknown): value is RedactedModelSecret {
  return isRecord(value) && typeof value.configured === 'boolean';
}

/**
 * Converts the backend's redacted model snapshot into UI-safe metadata. Even
 * if a faulty transport returns a string, the value is discarded immediately
 * and only its configured state is retained.
 */
export function sanitizeAIModelSnapshot(value: unknown): AIModelConfig[] {
  if (!Array.isArray(value)) {
    throw new Error('AI model snapshot must be an array');
  }

  return value.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`AI model snapshot entry ${index} must be an object`);
      }
      if (
        typeof entry.id !== 'string'
        || !entry.id.trim()
        || typeof entry.context_window !== 'number'
        || !Number.isFinite(entry.context_window)
        || entry.context_window <= 0
      ) {
        throw new Error(`AI model snapshot entry ${index} has an invalid identity or context window`);
      }
      const { api_key: apiKey, api_key_configured: _ignored, ...metadata } = entry;
      return {
        ...metadata,
        api_key_configured: isRedactedModelSecret(apiKey)
          ? apiKey.configured
          : typeof apiKey === 'string' && apiKey.trim().length > 0,
      } as unknown as AIModelConfig;
    });
}

/**
 * Builds a transaction value without replacing an existing secret with an
 * empty UI field. The redacted marker is intentionally forwarded so the
 * backend can preserve the current secret by stable model id.
 */
export function prepareAIModelWrite(
  next: AIModelConfig,
  current?: AIModelSnapshotEntry,
): AIModelSnapshotWriteEntry {
  const {
    api_key: draftApiKey,
    api_key_configured: _configured,
    ...metadata
  } = next;
  const explicitApiKey = draftApiKey?.trim();
  if (explicitApiKey) {
    return { ...metadata, api_key: explicitApiKey };
  }
  if (isRedactedModelSecret(current?.api_key)) {
    return { ...metadata, api_key: { ...current.api_key } };
  }
  return { ...metadata, api_key: '' };
}

/**
 * Applies model-level mutations to the latest revisioned snapshot. Entries not
 * named by the mutation are retained verbatim, including models committed by
 * another surface after this component rendered.
 */
export function patchAIModelSnapshot(
  currentValue: unknown,
  upserts: readonly AIModelConfig[],
  removeIds: ReadonlySet<string> = new Set(),
): AIModelSnapshotWriteEntry[] {
  const currentEntries = Array.isArray(currentValue)
    ? currentValue.filter(isRecord) as unknown as AIModelSnapshotEntry[]
    : [];
  const currentById = new Map(
    currentEntries
      .filter((entry) => typeof entry.id === 'string' && entry.id.length > 0)
      .map((entry) => [entry.id as string, entry]),
  );
  const upsertsById = new Map<string, AIModelConfig>();
  for (const upsert of upserts) {
    const id = upsert.id?.trim();
    if (!id) {
      throw new Error('AI model writes require a stable model id');
    }
    upsertsById.set(id, { ...upsert, id });
  }

  const result: AIModelSnapshotWriteEntry[] = [];
  const appliedIds = new Set<string>();
  for (const current of currentEntries) {
    const id = typeof current.id === 'string' ? current.id : '';
    const replacement = id ? upsertsById.get(id) : undefined;
    if (replacement) {
      result.push(prepareAIModelWrite(replacement, current));
      appliedIds.add(id);
      continue;
    }
    if (id && removeIds.has(id)) {
      continue;
    }
    result.push(current);
  }

  for (const [id, upsert] of upsertsById) {
    if (!appliedIds.has(id)) {
      result.push(prepareAIModelWrite(upsert, currentById.get(id)));
    }
  }
  return result;
}

type ProviderConfigLike = {
  name?: string;
  model_name?: string;
  base_url?: string;
};

function inferProviderTemplate(config: ProviderConfigLike): ProviderTemplate | undefined {
  const matchedCatalogItem = matchProviderCatalogItemByBaseUrl(config.base_url);
  // Safe module-level forward reference: PROVIDER_TEMPLATES is initialized before this runs.
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  return matchedCatalogItem ? PROVIDER_TEMPLATES[matchedCatalogItem.id] : undefined;
}

export function getProviderTemplateId(config: ProviderConfigLike): string | undefined {
  return inferProviderTemplate(config)?.id;
}

export function getProviderDisplayName(config: ProviderConfigLike): string {
  const inferredTemplate = inferProviderTemplate(config);
  if (inferredTemplate) {
    return t(`settings/ai-model:providers.${inferredTemplate.id}.name`);
  }

  const rawName = config.name?.trim() || '';
  const rawModelName = config.model_name?.trim() || '';
  if (rawName && rawModelName) {
    const dashedSuffix = ` - ${rawModelName}`;
    const slashSuffix = `/${rawModelName}`;

    if (rawName.endsWith(dashedSuffix)) {
      return rawName.slice(0, -dashedSuffix.length).trim();
    }
    if (rawName.endsWith(slashSuffix)) {
      return rawName.slice(0, -slashSuffix.length).trim();
    }
  }

  return rawName || extractProviderSegmentFromBaseUrl(config.base_url) || t('settings/ai-model:providerSelection.customTitle');
}

export function getCompactModelDisplayName(config: ProviderConfigLike): string {
  const modelName = config.model_name?.trim() || '';
  const fallbackName = config.name?.trim() || '';
  const displayName = modelName || fallbackName;

  if (!displayName) return '';

  const slashIndex = displayName.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < displayName.length - 1) {
    return displayName.slice(slashIndex + 1).trim() || displayName;
  }

  return displayName;
}

export function getModelDisplayName(config: ProviderConfigLike): string {
  const providerName = getProviderDisplayName(config);
  const modelName = config.model_name?.trim() || '';

  if (!providerName) return modelName;
  if (!modelName) return providerName;

  return `${providerName}/${modelName}`;
}

export const PROVIDER_TEMPLATES: Record<string, ProviderTemplate> = {
  opensparo: {
    id: 'opensparo',
    name: t('settings/ai-model:providers.opensparo.name'),
    baseUrl: 'https://api.opensparo.com',
    format: 'anthropic',
    models: [],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.opensparo.description')
  },

  gemini: {
    id: 'gemini',
    name: t('settings/ai-model:providers.gemini.name'),
    baseUrl: 'https://generativelanguage.googleapis.com',
    format: 'gemini',
    models: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.gemini.description'),
    helpUrl: 'https://aistudio.google.com/app/apikey'
  },

  anthropic: {
    id: 'anthropic',
    name: t('settings/ai-model:providers.anthropic.name'),
    baseUrl: 'https://api.anthropic.com',
    format: 'anthropic',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.anthropic.description'),
    helpUrl: 'https://console.anthropic.com/'
  },
  
  minimax: {
    id: 'minimax',
    name: t('settings/ai-model:providers.minimax.name'),
    baseUrl: 'https://api.minimaxi.com/anthropic',
    format: 'anthropic',
    models: ['MiniMax-M2.7-highspeed', 'MiniMax-M2.5-highspeed'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.minimax.description'),
    helpUrl: 'https://platform.minimax.io/',
    baseUrlOptions: [
      { url: 'https://api.minimaxi.com/anthropic', format: 'anthropic', note: 'default' },
      { url: 'https://api.minimaxi.com/v1', format: 'openai', note: 'OpenAI Compatible' },
    ]
  },

  moonshot: {
    id: 'moonshot',
    name: t('settings/ai-model:providers.moonshot.name'),
    baseUrl: 'https://api.moonshot.cn/v1',
    format: 'openai',
    models: ['kimi-k2.5', 'kimi-k2', 'kimi-k2-thinking'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.moonshot.description'),
    helpUrl: 'https://platform.moonshot.ai/console'
  },

  deepseek: {
    id: 'deepseek',
    name: t('settings/ai-model:providers.deepseek.name'),
    baseUrl: 'https://api.deepseek.com/v1',
    format: 'openai',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.deepseek.description'),
    helpUrl: 'https://platform.deepseek.com/api_keys'
  },

  zhipu: {
    id: 'zhipu',
    name: t('settings/ai-model:providers.zhipu.name'),
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    format: 'openai',
    models: ['glm-5', 'glm-4.7'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.zhipu.description'),
    helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    baseUrlOptions: [
      { url: 'https://open.bigmodel.cn/api/paas/v4', format: 'openai', note: 'default' },
      { url: 'https://open.bigmodel.cn/api/anthropic', format: 'anthropic', note: 'Coding Plan' },
      { url: 'https://open.bigmodel.cn/api/coding/paas/v4', format: 'openai', note: 'Coding Plan' },
    ]
  },

  qwen: {
    id: 'qwen',
    name: t('settings/ai-model:providers.qwen.name'),
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    format: 'openai',
    models: ['Qwen3.5-Plus', 'Qwen3.5-Flash'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.qwen.description'),
    helpUrl: 'https://dashscope.console.aliyun.com/apiKey',
    baseUrlOptions: [
      { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', format: 'openai', note: 'default' },
      { url: 'https://coding.dashscope.aliyuncs.com/v1', format: 'openai', note: 'Coding Plan' },
      { url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic', format: 'anthropic', note: 'Coding Plan' },
    ]
  },

  volcengine: {
    id: 'volcengine',
    name: t('settings/ai-model:providers.volcengine.name'),
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    format: 'openai',
    models: ['doubao-seed-2-0-code-preview-260215', 'doubao-seed-2-0-pro-260215'],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.volcengine.description'),
    helpUrl: 'https://console.volcengine.com/ark/'
  },

  siliconflow: {
    id: 'siliconflow',
    name: t('settings/ai-model:providers.siliconflow.name'),
    baseUrl: 'https://api.siliconflow.cn/v1',
    format: 'openai',
    models: [],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.siliconflow.description'),
    helpUrl: 'https://cloud.siliconflow.cn/account/ak',
    baseUrlOptions: [
      { url: 'https://api.siliconflow.cn/v1', format: 'openai', note: 'default' },
      { url: 'https://api.siliconflow.cn/v1/messages', format: 'anthropic', note: 'Anthropic' },
    ]
  },

  nvidia: {
    id: 'nvidia',
    name: t('settings/ai-model:providers.nvidia.name'),
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    format: 'openai',
    models: [],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.nvidia.description'),
    helpUrl: 'https://build.nvidia.com/settings/api-keys'
  },

  openrouter: {
    id: 'openrouter',
    name: t('settings/ai-model:providers.openrouter.name'),
    baseUrl: 'https://openrouter.ai/api/v1',
    format: 'openai',
    models: [],
    requiresApiKey: true,
    description: t('settings/ai-model:providers.openrouter.description'),
    helpUrl: 'https://openrouter.ai/keys'
  }
};

export const getAllTemplates = (): ProviderTemplate[] => {
  return Object.values(PROVIDER_TEMPLATES);
};

export const getFormatDisplayName = (format: ApiFormat): string => {
  switch (format) {
    case 'openai':
      return t('settings/ai-model:formats.openaiCompatible');
    case 'responses':
      return t('settings/ai-model:formats.responsesApi');
    case 'anthropic':
      return t('settings/ai-model:formats.claudeApi');
    case 'gemini':
      return t('settings/ai-model:formats.geminiApi');
    default:
      return format;
  }
};
