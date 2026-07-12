import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { AppIconSpec } from '@/shared/types/app-manifest';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';

export interface ProductAppHostSurfaceEsmDependency {
  name: string;
  version?: string;
  url?: string;
}

export interface ProductAppHostSurfaceNpmDependency {
  name: string;
  version: string;
}

export type ProductAppHostSurfaceBuildMode = 'nativeEsm' | 'bundled';
export type ProductAppHostSurfaceSourceFileKind = 'script' | 'style' | 'html' | 'worker' | 'json' | 'asset';

export interface ProductAppHostSurfaceEntry {
  uiEntry: string;
  workerEntry?: string;
  styleEntries: string[];
  buildMode: ProductAppHostSurfaceBuildMode;
}

export interface ProductAppHostSurfaceSourceFile {
  path: string;
  kind?: ProductAppHostSurfaceSourceFileKind;
  content: string;
}

export interface ProductAppHostSurfaceSource {
  html: string;
  css: string;
  ui_js: string;
  esm_dependencies: ProductAppHostSurfaceEsmDependency[];
  i18n_messages?: Record<string, Record<string, string>>;
  worker_js: string;
  npm_dependencies: ProductAppHostSurfaceNpmDependency[];
  entry?: ProductAppHostSurfaceEntry;
  source_files?: ProductAppHostSurfaceSourceFile[];
}

export interface ProductAppHostSurfacePermissions {
  fs?: { read?: string[]; write?: string[] };
  shell?: { allow?: string[] };
  net?: { allow?: string[] };
  node?: { enabled?: boolean; max_memory_mb?: number; timeout_ms?: number };
  ai?: {
    enabled?: boolean;
    allowed_models?: string[];
    max_tokens_per_request?: number;
    rate_limit_per_minute?: number;
  };
  iframe?: {
    autoplay?: boolean;
    fullscreen?: boolean;
  };
}

export type ProductAppHostSurfaceBackendSessionPolicy = 'ephemeral' | 'persistent' | 'perEntity' | 'shared';
export type ProductAppHostSurfaceBackendMemoryScope = 'none' | 'appInstance' | 'entity' | 'agentComponent';

export interface ProductAppHostSurfaceBackendActionBinding {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  allowStatePatch?: boolean;
}

export type ProductAppHostSurfaceBackendKind = 'agentComponent' | 'bridgeComponent';

export interface ProductAppHostSurfaceBackendBinding {
  id: string;
  kind: ProductAppHostSurfaceBackendKind;
  componentId: string;
  componentPackageDir?: string;
  capabilityId?: string;
  role?: string;
  sessionPolicy?: ProductAppHostSurfaceBackendSessionPolicy;
  memoryScope?: ProductAppHostSurfaceBackendMemoryScope;
  actions: ProductAppHostSurfaceBackendActionBinding[];
}

export type ProductAppHostSurfaceInteractionMode = 'standalone' | 'composite';
export type ProductAppHostSurfaceInteractionProfile = 'product-app-runtime' | (string & {});
export type ProductAppHostSurfaceInteractionText = string | Record<string, string>;

export interface ProductAppHostSurfaceInteractionChat {
  backendId?: string;
  agentComponentId?: string;
  sessionPolicy?: ProductAppHostSurfaceBackendSessionPolicy;
  memoryScope?: ProductAppHostSurfaceBackendMemoryScope;
  initialPromptKey?: string;
  allowUserPrompt?: boolean;
}

export interface ProductAppHostSurfaceInteractionTab {
  id: string;
  type: 'product-app-runtime';
  title?: ProductAppHostSurfaceInteractionText;
  titleKey?: string;
  route?: string;
  default?: boolean;
  developerOnly?: boolean;
  data?: Record<string, unknown>;
}

export interface ProductAppHostSurfaceInteraction {
  mode: ProductAppHostSurfaceInteractionMode;
  profile?: ProductAppHostSurfaceInteractionProfile;
  title?: ProductAppHostSurfaceInteractionText;
  chat?: ProductAppHostSurfaceInteractionChat;
  tabs?: ProductAppHostSurfaceInteractionTab[];
}

export interface ProductAppHostSurfaceRuntimeState {
  source_revision: string;
  deps_revision: string;
  deps_dirty: boolean;
  worker_restart_required: boolean;
  ui_recompile_required: boolean;
}

export interface ProductAppHostSurfaceLocalizedMeta {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface ProductAppHostSurfaceI18n {
  locales?: Record<string, ProductAppHostSurfaceLocalizedMeta>;
}

export interface ProductAppHostSurfaceMeta {
  id: string;
  name: string;
  description: string;
  icon: AppIconSpec;
  category: string;
  tags: string[];
  i18n?: ProductAppHostSurfaceI18n;
  version: number;
  created_at: number;
  updated_at: number;
  permissions: ProductAppHostSurfacePermissions;
  backends?: ProductAppHostSurfaceBackendBinding[];
  interaction?: ProductAppHostSurfaceInteraction;
  permission_rationale?: string;
  runtime?: ProductAppHostSurfaceRuntimeState;
}

export interface ProductAppHostSurface extends ProductAppHostSurfaceMeta {
  source: ProductAppHostSurfaceSource;
  compiled_html: string;
  ai_context?: {
    original_prompt: string;
    conversation_id?: string;
    iteration_history: string[];
  };
}

export interface ProductAppHostSurfaceRuntimeStatus {
  available: boolean;
  kind?: string;
  version?: string;
  path?: string;
}

export interface ProductAppHostSurfaceInstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface ProductAppHostSurfaceRecompileResult {
  success: boolean;
  warnings?: string[];
}

export interface ProductAppRuntimeStorageReadinessProbeResult {
  available?: boolean;
  scope?: string;
  probeKey?: string;
  writeVerified?: boolean;
  readVerified?: boolean;
  deleteVerified?: boolean;
  preservedPreviousValue?: boolean;
}

export interface ProductAppRuntimeAiCompleteOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProductAppRuntimeAiCompleteResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProductAppRuntimeAiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProductAppRuntimeAiChatOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProductAppRuntimeAiChatStartedResult {
  streamId: string;
}

export interface ProductAppRuntimeAiModelInfo {
  id: string;
  name: string;
  provider: string;
  isDefault: boolean;
}

export interface ProductAppRuntimeHostBackendActionResult {
  sessionId: string;
  turnId: string;
  actionRunId: string;
  status: 'started' | 'queued' | string;
  backendId: string;
  action: string;
  agentType: string;
  backendKind: ProductAppHostSurfaceBackendKind;
  backendComponentId: string;
  bridgeResult?: unknown;
}

export interface ProductAppRuntimeHostIssueInput {
  appId: string;
  runtimeContext: ProductAppRuntimeContext;
  severity?: 'fatal' | 'warning' | 'noise';
  message: string;
  source?: string;
  stack?: string;
  category?: string;
  timestampMs?: number;
}

export interface ProductAppRuntimeHostLogInput {
  appId: string;
  runtimeContext: ProductAppRuntimeContext;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  message: string;
  source?: string;
  stack?: string;
  details?: unknown;
  timestampMs?: number;
}

const HOST_SURFACE_CACHE_TTL_MS = 30_000;
const HOST_SURFACE_CACHE_LIMIT = 4;

interface HostSurfaceCacheEntry {
  surface: ProductAppHostSurface;
  expiresAt: number;
}

export class ProductAppRuntimeHostAPI {
  private readonly hostSurfaceCache = new Map<string, HostSurfaceCacheEntry>();
  private readonly pendingHostSurfaces = new Map<string, Promise<ProductAppHostSurface>>();
  private readonly hostSurfaceGenerations = new Map<string, number>();
  private hostSurfaceGeneration = 0;

  private hostSurfaceKey(appId: string, theme?: string, workspacePath?: string): string {
    return [appId, theme ?? 'dark', workspacePath?.trim() ?? ''].join('\u0001');
  }

  private rememberHostSurface(key: string, surface: ProductAppHostSurface): void {
    this.hostSurfaceCache.delete(key);
    this.hostSurfaceCache.set(key, {
      surface,
      expiresAt: Date.now() + HOST_SURFACE_CACHE_TTL_MS,
    });
    while (this.hostSurfaceCache.size > HOST_SURFACE_CACHE_LIMIT) {
      const oldestKey = this.hostSurfaceCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.hostSurfaceCache.delete(oldestKey);
    }
  }

  invalidateHostSurface(appId?: string): void {
    if (!appId) {
      this.hostSurfaceGeneration += 1;
      this.hostSurfaceCache.clear();
      this.pendingHostSurfaces.clear();
      this.hostSurfaceGenerations.clear();
      return;
    }

    const prefix = `${appId}\u0001`;
    for (const key of this.hostSurfaceCache.keys()) {
      if (key.startsWith(prefix)) this.hostSurfaceCache.delete(key);
    }
    for (const key of this.pendingHostSurfaces.keys()) {
      if (key.startsWith(prefix)) this.pendingHostSurfaces.delete(key);
    }
    this.hostSurfaceGenerations.set(
      appId,
      (this.hostSurfaceGenerations.get(appId) ?? 0) + 1,
    );
  }

  async listHostSurfaces(): Promise<ProductAppHostSurfaceMeta[]> {
    try {
      return await api.invoke('product_app_runtime_list_host_surfaces', {});
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_list_host_surfaces', error);
    }
  }

  async listRecentHostSurfaces(): Promise<string[]> {
    try {
      return await api.invoke('product_app_runtime_list_recent_host_surfaces', {});
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_list_recent_host_surfaces', error);
    }
  }

  async recordRecentHostSurface(appId: string): Promise<string[]> {
    try {
      return await api.invoke('product_app_runtime_record_recent_host_surface', { request: { appId } });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_record_recent_host_surface', error, { appId });
    }
  }

  async getHostSurface(appId: string, theme?: string, workspacePath?: string): Promise<ProductAppHostSurface> {
    const key = this.hostSurfaceKey(appId, theme, workspacePath);
    const cached = this.hostSurfaceCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      // Refresh LRU order without extending the freshness window.
      this.hostSurfaceCache.delete(key);
      this.hostSurfaceCache.set(key, cached);
      return cached.surface;
    }
    if (cached) this.hostSurfaceCache.delete(key);

    const existing = this.pendingHostSurfaces.get(key);
    if (existing) return existing;

    const globalGeneration = this.hostSurfaceGeneration;
    const generation = this.hostSurfaceGenerations.get(appId) ?? 0;
    let pending: Promise<ProductAppHostSurface>;
    pending = api.invoke<ProductAppHostSurface>('product_app_runtime_get_host_surface', {
      request: { appId, theme: theme ?? undefined, workspacePath },
    }).then(async (surface) => {
      const requestIsCurrent = (
        this.hostSurfaceGeneration === globalGeneration
        && (this.hostSurfaceGenerations.get(appId) ?? 0) === generation
      );
      if (!requestIsCurrent) {
        // The source/runtime changed while this request was rendering. Never
        // hand the stale surface to the original waiter; join a fresh render.
        if (this.pendingHostSurfaces.get(key) === pending) {
          this.pendingHostSurfaces.delete(key);
        }
        return this.getHostSurface(appId, theme, workspacePath);
      }
      this.rememberHostSurface(key, surface);
      return surface;
    }).catch((error) => {
      throw createTauriCommandError('product_app_runtime_get_host_surface', error, { appId, workspacePath });
    });
    this.pendingHostSurfaces.set(key, pending);

    try {
      return await pending;
    } finally {
      if (this.pendingHostSurfaces.get(key) === pending) {
        this.pendingHostSurfaces.delete(key);
      }
    }
  }

  async hostRuntimeStatus(): Promise<ProductAppHostSurfaceRuntimeStatus> {
    try {
      return await api.invoke('product_app_runtime_host_runtime_status', {});
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_host_runtime_status', error);
    }
  }

  async listRunningWorkers(): Promise<string[]> {
    try {
      return await api.invoke('product_app_runtime_list_running_workers', {});
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_list_running_workers', error);
    }
  }

  async stopWorker(appId: string): Promise<void> {
    try {
      await api.invoke('product_app_runtime_stop_worker', { appId });
      this.invalidateHostSurface(appId);
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_stop_worker', error, { appId });
    }
  }

  async installDependencies(appId: string): Promise<ProductAppHostSurfaceInstallResult> {
    try {
      const result = await api.invoke<ProductAppHostSurfaceInstallResult>('product_app_runtime_install_dependencies', { appId });
      this.invalidateHostSurface(appId);
      return result;
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_install_dependencies', error, { appId });
    }
  }

  async recompileHostSurface(
    appId: string,
    theme?: string,
    workspacePath?: string,
  ): Promise<ProductAppHostSurfaceRecompileResult> {
    this.invalidateHostSurface(appId);
    try {
      const result = await api.invoke<ProductAppHostSurfaceRecompileResult>('product_app_runtime_recompile_host_surface', {
        request: { appId, theme: theme ?? undefined, workspacePath },
      });
      this.invalidateHostSurface(appId);
      return result;
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_recompile_host_surface', error, { appId, workspacePath });
    }
  }

  async clearRuntimeIssues(appId: string): Promise<void> {
    try {
      await api.invoke('product_app_runtime_clear_runtime_issues', {
        request: { appId },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_clear_runtime_issues', error, { appId });
    }
  }

  async reportRuntimeIssue(issue: ProductAppRuntimeHostIssueInput): Promise<void> {
    try {
      await api.invoke('product_app_runtime_report_runtime_issue', { request: issue });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_report_runtime_issue', error, { appId: issue.appId });
    }
  }

  async reportRuntimeLog(logEntry: ProductAppRuntimeHostLogInput): Promise<void> {
    try {
      await api.invoke('product_app_runtime_report_runtime_log', { request: logEntry });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_report_runtime_log', error, { appId: logEntry.appId });
    }
  }

  async workerCall(
    appId: string,
    method: string,
    params: Record<string, unknown>,
    runtimeContext: ProductAppRuntimeContext,
    workspacePath?: string,
  ): Promise<unknown> {
    try {
      return await api.invoke('product_app_runtime_worker_call', {
        request: { appId, method, params, runtimeContext, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_worker_call', error, { appId, method, workspacePath });
    }
  }

  async probeRuntimeStorage(
    appId: string,
    runtimeContext: ProductAppRuntimeContext,
    workspacePath?: string,
  ): Promise<{ available?: boolean; scope?: string }> {
    try {
      const result = await api.invoke('product_app_runtime_worker_call', {
        request: { appId, method: 'storage.probe', params: {}, runtimeContext, workspacePath },
      });
      if (!isPlainRecord(result)) return {};
      return {
        available: result.available === true ? true : undefined,
        scope: typeof result.scope === 'string' ? result.scope : undefined,
      };
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_worker_call', error, {
        appId,
        method: 'storage.probe',
        workspacePath,
      });
    }
  }

  async probeRuntimeDataLifecycle(
    appId: string,
    runtimeContext: ProductAppRuntimeContext,
    workspacePath?: string,
  ): Promise<ProductAppRuntimeStorageReadinessProbeResult> {
    try {
      const result = await api.invoke('product_app_runtime_worker_call', {
        request: { appId, method: 'storage.readinessProbe', params: {}, runtimeContext, workspacePath },
      });
      if (!isPlainRecord(result)) return {};
      return {
        available: result.available === true ? true : undefined,
        scope: typeof result.scope === 'string' ? result.scope : undefined,
        probeKey: typeof result.probeKey === 'string' ? result.probeKey : undefined,
        writeVerified: result.writeVerified === true,
        readVerified: result.readVerified === true,
        deleteVerified: result.deleteVerified === true,
        preservedPreviousValue: result.preservedPreviousValue === true,
      };
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_worker_call', error, {
        appId,
        method: 'storage.readinessProbe',
        workspacePath,
      });
    }
  }

  async aiComplete(
    appId: string,
    prompt: string,
    runtimeContext: ProductAppRuntimeContext,
    options?: ProductAppRuntimeAiCompleteOptions,
  ): Promise<ProductAppRuntimeAiCompleteResult> {
    try {
      return await api.invoke('product_app_runtime_ai_complete', {
        request: {
          appId,
          runtimeContext,
          prompt,
          systemPrompt: options?.systemPrompt,
          model: options?.model,
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_ai_complete', error, { appId });
    }
  }

  async aiChat(
    appId: string,
    messages: ProductAppRuntimeAiChatMessage[],
    streamId: string,
    runtimeContext: ProductAppRuntimeContext,
    options?: ProductAppRuntimeAiChatOptions,
  ): Promise<ProductAppRuntimeAiChatStartedResult> {
    try {
      return await api.invoke('product_app_runtime_ai_chat', {
        request: {
          appId,
          runtimeContext,
          messages,
          streamId,
          systemPrompt: options?.systemPrompt,
          model: options?.model,
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_ai_chat', error, { appId, streamId });
    }
  }

  async aiCancel(appId: string, streamId: string, runtimeContext: ProductAppRuntimeContext): Promise<void> {
    try {
      await api.invoke('product_app_runtime_ai_cancel', { request: { appId, runtimeContext, streamId } });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_ai_cancel', error, { appId, streamId });
    }
  }

  async aiListModels(appId: string, runtimeContext: ProductAppRuntimeContext): Promise<ProductAppRuntimeAiModelInfo[]> {
    try {
      return await api.invoke('product_app_runtime_ai_list_models', { request: { appId, runtimeContext } });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_ai_list_models', error, { appId });
    }
  }

  async backendCall(
    appId: string,
    target: string,
    input: unknown,
    options: {
      runtimeContext: ProductAppRuntimeContext;
      entityId?: string;
      idempotencyKey?: string;
      workspacePath?: string;
    },
  ): Promise<ProductAppRuntimeHostBackendActionResult> {
    try {
      return await api.invoke('product_app_runtime_backend_call', {
        request: {
          appId,
          target,
          input,
          runtimeContext: options.runtimeContext,
          entityId: options.entityId,
          idempotencyKey: options.idempotencyKey,
          workspacePath: options.workspacePath,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_backend_call', error, { appId, target });
    }
  }

  async backendStatus(
    appId: string,
    actionRunId: string,
    options: { runtimeContext: ProductAppRuntimeContext; sessionId?: string; turnId?: string },
  ): Promise<unknown> {
    try {
      return await api.invoke('product_app_runtime_backend_status', {
        request: {
          appId,
          actionRunId,
          runtimeContext: options.runtimeContext,
          sessionId: options.sessionId,
          turnId: options.turnId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_backend_status', error, { appId, actionRunId });
    }
  }

  async backendCancelRun(
    appId: string,
    actionRunId: string,
    options: { runtimeContext: ProductAppRuntimeContext; sessionId?: string; turnId?: string },
  ): Promise<unknown> {
    try {
      return await api.invoke('product_app_runtime_backend_cancel_run', {
        request: {
          appId,
          actionRunId,
          runtimeContext: options.runtimeContext,
          sessionId: options.sessionId,
          turnId: options.turnId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_backend_cancel_run', error, { appId, actionRunId });
    }
  }

  async renderSlidePage(request: {
    html: string;
    format?: string;
    width?: number;
    height?: number;
  }): Promise<string> {
    try {
      return await api.invoke<string>('product_app_runtime_render_slide_page', {
        request: {
          html: request.html,
          format: request.format ?? 'png',
          width: request.width,
          height: request.height,
        },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_render_slide_page', error);
    }
  }

  async cancelStalePptRuns(workspacePath?: string): Promise<{
    cancelledSessions: number;
    cancelledTurns: number;
    clearedQueues: number;
  }> {
    try {
      return await api.invoke('product_app_runtime_cancel_stale_ppt_runs', {
        request: { workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_cancel_stale_ppt_runs', error, { workspacePath });
    }
  }

  async getPptTurnAssistantText(
    sessionId: string,
    turnId: string,
    workspacePath?: string,
  ): Promise<{ text: string }> {
    try {
      return await api.invoke('product_app_runtime_ppt_turn_assistant_text', {
        request: { sessionId, turnId, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('product_app_runtime_ppt_turn_assistant_text', error, {
        sessionId,
        turnId,
        workspacePath,
      });
    }
  }
}

export const productAppRuntimeHostAPI = new ProductAppRuntimeHostAPI();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
