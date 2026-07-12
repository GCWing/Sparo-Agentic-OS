import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { createLogger } from '@/shared/utils/logger';
import type { AppDefinedToolCardSpec, ToolCardConfig } from '../types/flow-chat';
import { AppDefinedToolCard } from './AppDefinedToolCard';
import {
  batchToolCardRegistryUpdates,
  hasToolCardConfig,
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
const pendingToolManifestLoads = new Map<string, Promise<boolean>>();
const backendEntryRevisions = new Map<string, number>();
let backendManifestRevision = 0;
const LATE_BOUND_TOOL_PREFIXES = ['agentcomponent__', 'bridgecomponent__'];
const LATE_BOUND_RETRY_DELAYS_MS = [200, 800];
const LATE_BOUND_WATCH_RETRY_DELAYS_MS = [2_000, 4_000, 5_000, 10_000, 30_000, 60_000];

interface ToolManifestWatch {
  retainCount: number;
  retryIndex: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const lateBoundManifestWatches = new Map<string, ToolManifestWatch>();

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

function waitForManifestRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function unregisterBackendTool(toolName: string): void {
  unregisterBackendConfigs.get(toolName)?.();
  unregisterBackendConfigs.delete(toolName);
  unregisterBackendRenderers.get(toolName)?.();
  unregisterBackendRenderers.delete(toolName);
  backendEntryRevisions.delete(toolName);
}

function registerBackendTool(
  info: BackendToolInfo,
  source: 'full' | 'exact' = 'exact',
  fullSyncStartedAtRevision?: number,
): boolean {
  if (!info?.name || TOOL_CARD_CONFIGS[info.name]) {
    return false;
  }

  const currentRevision = backendEntryRevisions.get(info.name);
  if (
    source === 'full'
    && fullSyncStartedAtRevision !== undefined
    && currentRevision !== undefined
    && currentRevision > fullSyncStartedAtRevision
  ) {
    return false;
  }

  batchToolCardRegistryUpdates(() => {
    unregisterBackendConfigs.get(info.name)?.();
    unregisterBackendConfigs.set(info.name, registerToolCardConfig(info.name, inferToolCardConfig(info)));

    unregisterBackendRenderers.get(info.name)?.();
    const unregisterRenderer = registerExtensionRenderer(info);
    if (unregisterRenderer) {
      unregisterBackendRenderers.set(info.name, unregisterRenderer);
    } else {
      unregisterBackendRenderers.delete(info.name);
    }

    backendManifestRevision += 1;
    backendEntryRevisions.set(info.name, backendManifestRevision);
  });

  return true;
}

export async function syncToolCardRegistryFromBackendManifest(): Promise<void> {
  if (syncPromise) {
    return syncPromise;
  }

  const syncStartedAtRevision = backendManifestRevision;
  const operation = (async () => {
    try {
      const tools = await toolAPI.getAllToolsInfo() as BackendToolInfo[];
      const backendToolNames = new Set<string>();

      batchToolCardRegistryUpdates(() => {
        for (const tool of tools) {
          if (tool?.name) {
            backendToolNames.add(tool.name);
            registerBackendTool(tool, 'full', syncStartedAtRevision);
          }
        }

        for (const [toolName, entryRevision] of [...backendEntryRevisions]) {
          if (!backendToolNames.has(toolName) && entryRevision <= syncStartedAtRevision) {
            unregisterBackendTool(toolName);
          }
        }
      });

      log.info('Synced tool card registry from backend manifest', {
        total: tools.length,
        dynamic: backendEntryRevisions.size,
      });
    } catch (error) {
      log.warn('Failed to sync tool card registry from backend manifest', { error });
    }
  })();

  syncPromise = operation;
  void operation.finally(() => {
    if (syncPromise === operation) {
      syncPromise = null;
    }
  });

  return operation;
}

async function loadToolCardRegistryEntry(
  toolName: string,
  retryLateBound: boolean,
): Promise<boolean> {
  const normalizedName = toolName.trim();
  if (!normalizedName) {
    return false;
  }
  if (hasToolCardConfig(normalizedName)) {
    return true;
  }

  const pending = pendingToolManifestLoads.get(normalizedName);
  if (pending) {
    return pending;
  }

  const load = (async () => {
    const retryDelays = retryLateBound
      && LATE_BOUND_TOOL_PREFIXES.some(prefix => normalizedName.startsWith(prefix))
      ? LATE_BOUND_RETRY_DELAYS_MS
      : [];
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        const info = await toolAPI.getToolInfo(normalizedName) as BackendToolInfo | null;
        if (info?.name) {
          registerBackendTool(info);
          return hasToolCardConfig(normalizedName);
        }
      } catch (error) {
        lastError = error;
      }

      const retryDelay = retryDelays[attempt];
      if (retryDelay !== undefined) {
        await waitForManifestRetry(retryDelay);
      }
    }

    const context = { toolName: normalizedName, attempts: retryDelays.length + 1 };
    if (lastError) {
      log.warn('Failed to resolve tool card manifest', { ...context, error: lastError });
    } else {
      log.debug('Tool card manifest is not registered', context);
    }
    return false;
  })();

  pendingToolManifestLoads.set(normalizedName, load);
  void load.finally(() => {
    if (pendingToolManifestLoads.get(normalizedName) === load) {
      pendingToolManifestLoads.delete(normalizedName);
    }
  });

  return load;
}

/**
 * Resolve metadata for a tool that appeared after the startup manifest warm-up.
 * Product App private tools are registered when their app is activated, so
 * correctness cannot depend on a one-time global snapshot.
 */
export async function ensureToolCardRegistryEntry(toolName: string): Promise<boolean> {
  return loadToolCardRegistryEntry(toolName, true);
}

function probeWatchedToolManifest(toolName: string, watch: ToolManifestWatch): void {
  if (
    lateBoundManifestWatches.get(toolName) !== watch
    || watch.retainCount === 0
    || hasToolCardConfig(toolName)
  ) {
    return;
  }

  // A retained watch owns the retry schedule, so each probe performs only one
  // IPC lookup instead of multiplying the short retry burst indefinitely.
  void loadToolCardRegistryEntry(toolName, false).then((registered) => {
    if (
      registered
      || lateBoundManifestWatches.get(toolName) !== watch
      || watch.retainCount === 0
      || hasToolCardConfig(toolName)
    ) {
      return;
    }

    const retryDelay = LATE_BOUND_WATCH_RETRY_DELAYS_MS[
      Math.min(watch.retryIndex, LATE_BOUND_WATCH_RETRY_DELAYS_MS.length - 1)
    ];
    watch.retryIndex += 1;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      probeWatchedToolManifest(toolName, watch);
    }, retryDelay);
  });
}

/**
 * Keep resolving a late-bound manifest while at least one fallback card is
 * mounted. Product App activation can take tens of seconds; retries stay quick
 * through that activation window, then decay to at most one lookup per minute.
 * They stop immediately when the card unmounts or the manifest becomes available.
 */
export function watchToolCardRegistryEntry(toolName: string): () => void {
  const normalizedName = toolName.trim();
  if (!normalizedName || hasToolCardConfig(normalizedName)) {
    return () => {};
  }

  if (!LATE_BOUND_TOOL_PREFIXES.some(prefix => normalizedName.startsWith(prefix))) {
    void ensureToolCardRegistryEntry(normalizedName);
    return () => {};
  }

  let watch = lateBoundManifestWatches.get(normalizedName);
  if (!watch) {
    watch = { retainCount: 0, retryIndex: 0, timer: null };
    lateBoundManifestWatches.set(normalizedName, watch);
  }

  watch.retainCount += 1;
  if (watch.retainCount === 1) {
    probeWatchedToolManifest(normalizedName, watch);
  }

  return () => {
    const currentWatch = lateBoundManifestWatches.get(normalizedName);
    if (currentWatch !== watch) {
      return;
    }

    currentWatch.retainCount = Math.max(0, currentWatch.retainCount - 1);
    if (currentWatch.retainCount === 0) {
      if (currentWatch.timer) {
        clearTimeout(currentWatch.timer);
      }
      lateBoundManifestWatches.delete(normalizedName);
    }
  };
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
