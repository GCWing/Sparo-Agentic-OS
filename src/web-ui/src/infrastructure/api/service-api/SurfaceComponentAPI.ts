import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EsmDep {
  name: string;
  version?: string;
  url?: string;
}

export interface NpmDep {
  name: string;
  version: string;
}

export type SurfaceComponentBuildMode = 'nativeEsm' | 'bundled';
export type SurfaceComponentSourceFileKind = 'script' | 'style' | 'html' | 'worker' | 'json' | 'asset';

export interface SurfaceComponentEntry {
  uiEntry: string;
  workerEntry?: string;
  styleEntries: string[];
  buildMode: SurfaceComponentBuildMode;
}

export interface SurfaceComponentSourceFile {
  path: string;
  kind?: SurfaceComponentSourceFileKind;
  content: string;
}

export interface SurfaceComponentSource {
  html: string;
  css: string;
  ui_js: string;
  esm_dependencies: EsmDep[];
  i18n_messages?: Record<string, Record<string, string>>;
  worker_js: string;
  npm_dependencies: NpmDep[];
  entry?: SurfaceComponentEntry;
  source_files?: SurfaceComponentSourceFile[];
}

export interface SurfaceComponentPermissions {
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
}

export type SurfaceComponentBackendSessionPolicy = 'ephemeral' | 'persistent' | 'perEntity' | 'shared';
export type SurfaceComponentBackendMemoryScope = 'none' | 'appInstance' | 'entity' | 'agentComponent';

export interface SurfaceComponentBackendActionBinding {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  allowStatePatch?: boolean;
}

export type SurfaceComponentBackendKind = 'agentComponent' | 'bridgeComponent';

export interface SurfaceComponentBackendBinding {
  id: string;
  kind: SurfaceComponentBackendKind;
  componentId: string;
  capabilityId?: string;
  role?: string;
  sessionPolicy?: SurfaceComponentBackendSessionPolicy;
  memoryScope?: SurfaceComponentBackendMemoryScope;
  actions: SurfaceComponentBackendActionBinding[];
}

export type SurfaceComponentInteractionMode = 'standalone' | 'composite';
export type SurfaceComponentInteractionProfile = 'surface-component-workbench' | (string & {});
export type SurfaceComponentInteractionText = string | Record<string, string>;

export interface SurfaceComponentInteractionChat {
  backendId?: string;
  agentComponentId?: string;
  sessionPolicy?: SurfaceComponentBackendSessionPolicy;
  memoryScope?: SurfaceComponentBackendMemoryScope;
  initialPromptKey?: string;
  allowUserPrompt?: boolean;
}

export interface SurfaceComponentInteractionTab {
  id: string;
  type: 'surfaceComponent'
    | 'surface-component'
    | 'surfaceComponentRunner'
    | 'surface-component-runner'
    | 'surfaceComponentWorkbenchTab'
    | 'surface-component-workbench-tab'
    | 'backendRuns'
    | 'surfaceComponentDiagnostics'
    | 'surfaceComponentDataView'
    | (string & {});
  title?: SurfaceComponentInteractionText;
  titleKey?: string;
  route?: string;
  default?: boolean;
  developerOnly?: boolean;
  data?: Record<string, unknown>;
}

export interface SurfaceComponentInteraction {
  mode: SurfaceComponentInteractionMode;
  profile?: SurfaceComponentInteractionProfile;
  title?: SurfaceComponentInteractionText;
  chat?: SurfaceComponentInteractionChat;
  tabs?: SurfaceComponentInteractionTab[];
}

// ─── AI Types ─────────────────────────────────────────────────────────────────

export interface AiCompleteOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiCompleteResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatOptions {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiChatStartedResult {
  streamId: string;
}

export interface AiModelInfo {
  id: string;
  name: string;
  provider: string;
  isDefault: boolean;
}

export interface SurfaceComponentBackendActionResult {
  sessionId: string;
  turnId: string;
  actionRunId: string;
  status: 'started' | 'queued' | string;
  backendId: string;
  action: string;
  agentType: string;
  backendKind: SurfaceComponentBackendKind;
  backendComponentId: string;
  bridgeResult?: unknown;
}

export interface SurfaceComponentRuntimeState {
  source_revision: string;
  deps_revision: string;
  deps_dirty: boolean;
  worker_restart_required: boolean;
  ui_recompile_required: boolean;
}

export interface SurfaceComponentLocalizedMeta {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface SurfaceComponentI18n {
  locales?: Record<string, SurfaceComponentLocalizedMeta>;
}

export interface SurfaceComponentMeta {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  i18n?: SurfaceComponentI18n;
  version: number;
  created_at: number;
  updated_at: number;
  permissions: SurfaceComponentPermissions;
  backends?: SurfaceComponentBackendBinding[];
  interaction?: SurfaceComponentInteraction;
  permission_rationale?: string;
  runtime?: SurfaceComponentRuntimeState;
}

export interface SurfaceComponent extends SurfaceComponentMeta {
  source: SurfaceComponentSource;
  compiled_html: string;
  ai_context?: {
    original_prompt: string;
    conversation_id?: string;
    iteration_history: string[];
  };
}

export interface CreateSurfaceComponentRequest {
  name: string;
  description: string;
  icon?: string;
  category?: string;
  tags?: string[];
  i18n?: SurfaceComponentI18n;
  source: SurfaceComponentSource;
  permissions?: SurfaceComponentPermissions;
  backends?: SurfaceComponentBackendBinding[];
  interaction?: SurfaceComponentInteraction;
  ai_context?: { original_prompt: string };
  permission_rationale?: string;
}

export interface UpdateSurfaceComponentRequest {
  name?: string;
  description?: string;
  icon?: string;
  category?: string;
  tags?: string[];
  i18n?: SurfaceComponentI18n;
  source?: SurfaceComponentSource;
  permissions?: SurfaceComponentPermissions;
  backends?: SurfaceComponentBackendBinding[];
  interaction?: SurfaceComponentInteraction;
  permission_rationale?: string;
}

export interface RuntimeStatus {
  available: boolean;
  kind?: string;
  version?: string;
  path?: string;
}

export interface InstallResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface RecompileResult {
  success: boolean;
  warnings?: string[];
}

export interface SurfaceComponentRuntimeIssueInput {
  appId: string;
  severity?: 'fatal' | 'warning' | 'noise';
  message: string;
  source?: string;
  stack?: string;
  category?: string;
  timestampMs?: number;
}

export interface SurfaceComponentRuntimeLogInput {
  appId: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  message: string;
  source?: string;
  stack?: string;
  details?: unknown;
  timestampMs?: number;
}

// ─── API (Tauri commands `surface_component_*` / `list_surface_components`, etc.) ─

export class SurfaceComponentAPI {
  async listSurfaceComponents(): Promise<SurfaceComponentMeta[]> {
    try {
      return await api.invoke('list_surface_components', {});
    } catch (error) {
      throw createTauriCommandError('list_surface_components', error);
    }
  }

  async listRecentSurfaceComponents(): Promise<string[]> {
    try {
      return await api.invoke('list_recent_surface_components', {});
    } catch (error) {
      throw createTauriCommandError('list_recent_surface_components', error);
    }
  }

  async recordRecentSurfaceComponent(appId: string): Promise<string[]> {
    try {
      return await api.invoke('record_recent_surface_component', { request: { appId } });
    } catch (error) {
      throw createTauriCommandError('record_recent_surface_component', error, { appId });
    }
  }

  async getSurfaceComponent(appId: string, theme?: string, workspacePath?: string): Promise<SurfaceComponent> {
    try {
      return await api.invoke('get_surface_component', {
        request: { appId, theme: theme ?? undefined, workspacePath }
      });
    } catch (error) {
      throw createTauriCommandError('get_surface_component', error, { appId, workspacePath });
    }
  }

  async createSurfaceComponent(req: CreateSurfaceComponentRequest, workspacePath?: string): Promise<SurfaceComponent> {
    try {
      return await api.invoke('create_surface_component', { request: { ...req, workspacePath } });
    } catch (error) {
      throw createTauriCommandError('create_surface_component', error, { workspacePath });
    }
  }

  async updateSurfaceComponent(appId: string, req: UpdateSurfaceComponentRequest, workspacePath?: string): Promise<SurfaceComponent> {
    try {
      return await api.invoke('update_surface_component', { appId, request: { ...req, workspacePath } });
    } catch (error) {
      throw createTauriCommandError('update_surface_component', error, { appId, workspacePath });
    }
  }

  async deleteSurfaceComponent(appId: string): Promise<void> {
    try {
      await api.invoke('delete_surface_component', { appId });
    } catch (error) {
      throw createTauriCommandError('delete_surface_component', error, { appId });
    }
  }

  async getSurfaceComponentVersions(appId: string): Promise<number[]> {
    try {
      return await api.invoke('get_surface_component_versions', { appId });
    } catch (error) {
      throw createTauriCommandError('get_surface_component_versions', error);
    }
  }

  async rollbackSurfaceComponent(appId: string, version: number): Promise<SurfaceComponent> {
    try {
      return await api.invoke('rollback_surface_component', { appId, version });
    } catch (error) {
      throw createTauriCommandError('rollback_surface_component', error);
    }
  }

  async runtimeStatus(): Promise<RuntimeStatus> {
    try {
      return await api.invoke('surface_component_runtime_status', {});
    } catch (error) {
      throw createTauriCommandError('surface_component_runtime_status', error);
    }
  }

  async workerCall(
    appId: string,
    method: string,
    params: Record<string, unknown>,
    workspacePath?: string,
  ): Promise<unknown> {
    try {
      return await api.invoke('surface_component_worker_call', {
        request: { appId, method, params, workspacePath }
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_worker_call', error, { appId, method, workspacePath });
    }
  }

  async workerStop(appId: string): Promise<void> {
    try {
      await api.invoke('surface_component_worker_stop', { appId });
    } catch (error) {
      throw createTauriCommandError('surface_component_worker_stop', error);
    }
  }

  async workerListRunning(): Promise<string[]> {
    try {
      return await api.invoke('surface_component_worker_list_running', {});
    } catch (error) {
      throw createTauriCommandError('surface_component_worker_list_running', error);
    }
  }

  async installDeps(appId: string): Promise<InstallResult> {
    try {
      return await api.invoke('surface_component_install_deps', { appId });
    } catch (error) {
      throw createTauriCommandError('surface_component_install_deps', error);
    }
  }

  async recompile(appId: string, theme?: string, workspacePath?: string): Promise<RecompileResult> {
    try {
      return await api.invoke('surface_component_recompile', {
        request: { appId, theme: theme ?? undefined, workspacePath }
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_recompile', error, { appId, workspacePath });
    }
  }

  async importFromPath(path: string, workspacePath?: string): Promise<SurfaceComponent> {
    try {
      return await api.invoke('surface_component_import_from_path', {
        request: { path, workspacePath }
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_import_from_path', error, { path, workspacePath });
    }
  }

  async reportRuntimeIssue(issue: SurfaceComponentRuntimeIssueInput): Promise<void> {
    try {
      await api.invoke('surface_component_report_runtime_issue', {
        request: issue,
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_report_runtime_issue', error, { appId: issue.appId });
    }
  }

  async reportRuntimeLog(logEntry: SurfaceComponentRuntimeLogInput): Promise<void> {
    try {
      await api.invoke('surface_component_report_runtime_log', {
        request: logEntry,
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_report_runtime_log', error, { appId: logEntry.appId });
    }
  }

  async clearRuntimeIssues(appId: string): Promise<void> {
    try {
      await api.invoke('surface_component_clear_runtime_issues', {
        request: { appId },
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_clear_runtime_issues', error, { appId });
    }
  }

  async captureMatrix(appId: string): Promise<unknown> {
    try {
      return await api.invoke('surface_component_capture_matrix', {
        request: { appId },
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_capture_matrix', error, { appId });
    }
  }

  // ─── AI commands ────────────────────────────────────────────────────────────

  async aiComplete(appId: string, prompt: string, options?: AiCompleteOptions): Promise<AiCompleteResult> {
    try {
      return await api.invoke('surface_component_ai_complete', {
        request: {
          appId,
          prompt,
          systemPrompt: options?.systemPrompt,
          model: options?.model,
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        }
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_ai_complete', error, { appId });
    }
  }

  async aiChat(
    appId: string,
    messages: AiChatMessage[],
    streamId: string,
    options?: AiChatOptions,
  ): Promise<AiChatStartedResult> {
    try {
      return await api.invoke('surface_component_ai_chat', {
        request: {
          appId,
          messages,
          streamId,
          systemPrompt: options?.systemPrompt,
          model: options?.model,
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        }
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_ai_chat', error, { appId, streamId });
    }
  }

  async aiCancel(appId: string, streamId: string): Promise<void> {
    try {
      await api.invoke('surface_component_ai_cancel', { request: { appId, streamId } });
    } catch (error) {
      throw createTauriCommandError('surface_component_ai_cancel', error, { appId, streamId });
    }
  }

  async aiListModels(appId: string): Promise<AiModelInfo[]> {
    try {
      return await api.invoke('surface_component_ai_list_models', { request: { appId } });
    } catch (error) {
      throw createTauriCommandError('surface_component_ai_list_models', error, { appId });
    }
  }

  async backendCall(
    appId: string,
    target: string,
    input?: unknown,
    options?: { entityId?: string; idempotencyKey?: string; workspacePath?: string },
  ): Promise<SurfaceComponentBackendActionResult> {
    try {
      return await api.invoke('surface_component_backend_call', {
        request: {
          appId,
          target,
          input,
          entityId: options?.entityId,
          idempotencyKey: options?.idempotencyKey,
          workspacePath: options?.workspacePath,
        },
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_backend_call', error, { appId, target });
    }
  }

  async backendStatus(
    appId: string,
    actionRunId: string,
    options?: { sessionId?: string; turnId?: string },
  ): Promise<unknown> {
    try {
      return await api.invoke('surface_component_backend_status', {
        request: {
          appId,
          actionRunId,
          sessionId: options?.sessionId,
          turnId: options?.turnId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_backend_status', error, { appId, actionRunId });
    }
  }

  async backendCancelRun(
    appId: string,
    actionRunId: string,
    options?: { sessionId?: string; turnId?: string },
  ): Promise<unknown> {
    try {
      return await api.invoke('surface_component_backend_cancel_run', {
        request: {
          appId,
          actionRunId,
          sessionId: options?.sessionId,
          turnId: options?.turnId,
        },
      });
    } catch (error) {
      throw createTauriCommandError('surface_component_backend_cancel_run', error, { appId, actionRunId });
    }
  }

}

export const surfaceComponentAPI = new SurfaceComponentAPI();
