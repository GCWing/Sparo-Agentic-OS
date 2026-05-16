import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { createLogger } from '@/shared/utils/logger';
import type { ToolCardConfig } from '../types/flow-chat';
import {
  registerToolCardConfig,
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
}

let syncPromise: Promise<void> | null = null;
const unregisterBackendConfigs = new Map<string, () => void>();

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

  return {
    toolName: info.name,
    displayName: titleFromToolName(info.name),
    icon: 'TOOL',
    requiresConfirmation: needsPermissions && !isReadonly,
    resultDisplayType: isReadonly ? 'summary' : 'detailed',
    description: info.description || `Run ${info.name} tool`,
    displayMode: isReadonly ? 'compact' : 'standard',
    primaryColor: isReadonly ? 'var(--ds-status-surface-neutral-fg)' : 'var(--ds-status-surface-neutral-fg)',
  };
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
      }

      for (const [toolName, unregister] of unregisterBackendConfigs) {
        if (!backendToolNames.has(toolName)) {
          unregister();
          unregisterBackendConfigs.delete(toolName);
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
