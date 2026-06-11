import { createLogger } from '@/shared/utils/logger';
import { requestWorkRefresh } from '@/app/agentic-os/work/data/workStore';
import { useDesignArtifactStore } from '@/tools/design-canvas/store/designArtifactStore';
import { useDesignTokensStore } from '@/tools/design-canvas/store/designTokensStore';

const log = createLogger('ToolEffectRegistry');

export interface CompletedToolEffectContext {
  sessionId: string;
  turnId: string;
  toolId: string;
  toolName: string;
  result: unknown;
}

export type CompletedToolEffect = (context: CompletedToolEffectContext) => void;

const completedEffects = new Map<string, CompletedToolEffect[]>();

export function registerCompletedToolEffect(toolName: string, effect: CompletedToolEffect): () => void {
  const effects = completedEffects.get(toolName) ?? [];
  effects.push(effect);
  completedEffects.set(toolName, effects);

  return () => {
    const nextEffects = completedEffects.get(toolName)?.filter((candidate) => candidate !== effect) ?? [];
    if (nextEffects.length === 0) {
      completedEffects.delete(toolName);
      return;
    }
    completedEffects.set(toolName, nextEffects);
  };
}

export function unregisterCompletedToolEffects(toolName: string): void {
  completedEffects.delete(toolName);
}

registerCompletedToolEffect('DesignArtifact', ({ result }) => {
  if (!result || typeof result !== 'object') {
    return;
  }

  const data = result as Record<string, any>;
  if (data.manifest) {
    useDesignArtifactStore
      .getState()
      .upsertManifest(data.manifest, data.artifact_event || 'ok');
  }

  if (Array.isArray(data.manifests)) {
    useDesignArtifactStore.getState().upsertManifests(data.manifests);
  }
});

registerCompletedToolEffect('DesignTokens', ({ result }) => {
  if (!result || typeof result !== 'object') {
    return;
  }

  const data = result as Record<string, any>;
  if (data.data?.tokens) {
    const scopeKey = String(data.data?.path || 'workspace');
    useDesignTokensStore.getState().upsert(scopeKey, data.data.tokens);
  }

  if (Array.isArray(data.data?.items)) {
    for (const item of data.data.items) {
      if (item?.path && item?.tokens) {
        useDesignTokensStore.getState().upsert(String(item.path), item.tokens);
      }
    }
  }
});

registerCompletedToolEffect('Work', () => {
  requestWorkRefresh('work-tool-completed');
});

function pickAgentAppId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const data = result as Record<string, any>;
  const manifest = data.manifest && typeof data.manifest === 'object'
    ? data.manifest as Record<string, any>
    : data;

  return typeof manifest.id === 'string'
    ? manifest.id
    : typeof data.id === 'string'
      ? data.id
      : undefined;
}

for (const toolName of ['CreateAgentApp', 'UpdateAgentApp', 'CreateAgentAppJsTool']) {
  registerCompletedToolEffect(toolName, ({ result }) => {
    const appId = pickAgentAppId(result);
    window.dispatchEvent(new CustomEvent('agent-app-updated', {
      detail: { appId },
    }));
  });
}

function pickLiveAppId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const data = result as Record<string, any>;
  return typeof data.app_id === 'string'
    ? data.app_id
    : typeof data.appId === 'string'
      ? data.appId
      : typeof data.id === 'string'
        ? data.id
        : undefined;
}

for (const toolName of ['InitLiveApp', 'LiveAppRecompile']) {
  registerCompletedToolEffect(toolName, ({ result }) => {
    const appId = pickLiveAppId(result);
    if (!appId) {
      return;
    }

    window.dispatchEvent(new CustomEvent('live-app-updated', {
      detail: { id: appId, appId },
    }));
  });
}

export function runCompletedToolEffects(context: CompletedToolEffectContext): void {
  const effects = completedEffects.get(context.toolName);
  if (!effects || effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    try {
      effect(context);
    } catch (error) {
      log.error('Completed tool effect failed', {
        toolName: context.toolName,
        toolId: context.toolId,
        error,
      });
    }
  }
}
