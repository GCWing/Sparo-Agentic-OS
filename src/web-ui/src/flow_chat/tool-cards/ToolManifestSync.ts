import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { createLogger } from '@/shared/utils/logger';
import type { AppDefinedToolCardSpec, ToolCardConfig } from '../types/flow-chat';
import { AppDefinedToolCard } from './AppDefinedToolCard';
import {
  registerToolCardConfig,
  registerToolUiRenderer,
  TOOL_CARD_CONFIGS,
} from './index';

const log = createLogger('ToolManifestSync');

interface BackendToolInfo {
  name: string;
  description?: string;
  input_schema?: unknown;
  inputSchema?: unknown;
  is_readonly?: boolean;
  isReadonly?: boolean;
  needs_permissions?: boolean;
  needsPermissions?: boolean;
  ui?: {
    card?: AppDefinedToolCardSpec;
  };
}

let syncPromise: Promise<void> | null = null;
let scheduledSyncTimer: ReturnType<typeof setTimeout> | null = null;
const unregisterBackendConfigs = new Map<string, () => void>();
const unregisterBackendRenderers = new Map<string, () => void>();

function titleFromToolName(toolName: string): string {
  return toolName
    .replace(/^mcp__/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || toolName;
}

function inferToolCardConfig(info: BackendToolInfo): ToolCardConfig {
  const isReadonly = info.isReadonly ?? info.is_readonly ?? false;
  const needsPermissions = info.needsPermissions ?? info.needs_permissions ?? false;
  const extensionCard = info.ui?.card;

  return {
    toolName: info.name,
    displayName: extensionCard?.displayName ?? extensionCard?.title ?? titleFromToolName(info.name),
    icon: extensionCard?.icon ?? 'TOOL',
    requiresConfirmation: needsPermissions && !isReadonly,
    resultDisplayType: extensionCard?.resultDisplayType ?? (isReadonly ? 'summary' : 'detailed'),
    description: extensionCard?.description ?? info.description ?? `Run ${info.name} tool`,
    displayMode: extensionCard?.displayMode ?? (isReadonly ? 'compact' : 'standard'),
    primaryColor: extensionCard?.primaryColor ?? 'var(--ds-status-surface-neutral-fg)',
    extensionCard,
  };
}

function registerExtensionRenderer(info: BackendToolInfo): (() => void) | undefined {
  const card = info.ui?.card;
  if (!card || card.kind !== 'appDefined') {
    return undefined;
  }

  return registerToolUiRenderer(info.name, {
    component: AppDefinedToolCard,
    template: card.template === 'detail' ? 'detail' : 'compact',
    family: card.family,
  });
}

export async function syncToolCardRegistryFromBackendManifest(options?: { force?: boolean }): Promise<void> {
  if (syncPromise && !options?.force) {
    return syncPromise;
  }

  syncPromise = (async () => {
    try {
      const tools = await toolAPI.getAllToolsInfo() as BackendToolInfo[];
      const backendToolNames = new Set<string>();

      for (const tool of tools) {
        if (!tool?.name || TOOL_CARD_CONFIGS[tool.name]) {
          continue;
        }

        backendToolNames.add(tool.name);
        unregisterBackendConfigs.get(tool.name)?.();
        unregisterBackendConfigs.set(tool.name, registerToolCardConfig(tool.name, inferToolCardConfig(tool)));
        unregisterBackendRenderers.get(tool.name)?.();
        const unregisterRenderer = registerExtensionRenderer(tool);
        if (unregisterRenderer) {
          unregisterBackendRenderers.set(tool.name, unregisterRenderer);
        } else {
          unregisterBackendRenderers.delete(tool.name);
        }
      }

      for (const [toolName, unregister] of unregisterBackendConfigs) {
        if (!backendToolNames.has(toolName)) {
          unregister();
          unregisterBackendConfigs.delete(toolName);
          unregisterBackendRenderers.get(toolName)?.();
          unregisterBackendRenderers.delete(toolName);
        }
      }

      log.info('Synced tool card registry from backend manifest', {
        total: tools.length,
        dynamic: unregisterBackendConfigs.size,
      });
    } catch (error) {
      log.warn('Failed to sync tool card registry from backend manifest', { error });
    }
  })();

  return syncPromise;
}

export function scheduleToolCardRegistrySyncFromBackendManifest(delayMs = 2_500): void {
  if (syncPromise || scheduledSyncTimer) {
    return;
  }

  scheduledSyncTimer = setTimeout(() => {
    scheduledSyncTimer = null;
    void syncToolCardRegistryFromBackendManifest();
  }, delayMs);
}
