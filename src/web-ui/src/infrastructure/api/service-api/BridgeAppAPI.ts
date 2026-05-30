import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type BridgeAppKind = 'cli' | 'sdk' | 'gui' | 'service' | 'mcp' | 'daemon';
export type BridgeAppRuntimeLanguage = 'javascript' | 'typescript' | 'python' | 'native';

export interface BridgeAppRuntime {
  language: BridgeAppRuntimeLanguage;
  entry: string;
  packageManager?: string;
}

export interface BridgeAppSurfaces {
  launchableApp?: boolean;
  agent?: boolean;
  tool?: boolean;
  liveAppBackend?: boolean;
}

export interface BridgeAppPermissions {
  fs?: string[];
  net?: string[];
  shell?: string[];
  gui?: unknown[];
  secrets?: string[];
}

export type BridgeAppConsumerKind = 'agentApp' | 'liveApp' | 'liveAppBackend' | 'management' | 'system';

export interface BridgeAppCapability {
  id: string;
  title: string;
  description: string;
  category?: string;
  actions?: string[];
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
  usableBy?: BridgeAppConsumerKind[];
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface BridgeAppLifecycle {
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
}

export interface BridgeAppAction {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
}

export interface BridgeAppManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  kind: BridgeAppKind;
  runtime: BridgeAppRuntime;
  surfaces?: BridgeAppSurfaces;
  capabilities?: BridgeAppCapability[];
  actions?: BridgeAppAction[];
  tools?: unknown[];
  lifecycle?: BridgeAppLifecycle;
  permissions?: BridgeAppPermissions;
}

export interface BridgeAppPackage {
  manifest: BridgeAppManifest;
  path: string;
}

export type BridgeAppRunStatus = 'pending' | 'running' | 'waitingForApproval' | 'completed' | 'failed' | 'cancelled';

export type BridgeAppEvent =
  | { type: 'run.started'; run_id: string }
  | { type: 'run.status'; status: BridgeAppRunStatus; message?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'thinking.delta'; text: string }
  | { type: 'tool.started'; name: string; input?: unknown }
  | { type: 'tool.delta'; name: string; delta?: unknown }
  | { type: 'tool.completed'; name: string; output?: unknown }
  | { type: 'artifact.created'; artifact?: unknown }
  | { type: 'approval.required'; request?: unknown }
  | { type: 'approval.resolved'; response?: unknown }
  | { type: 'run.completed'; output?: unknown }
  | { type: 'run.failed'; error?: unknown }
  | { type: 'run.cancelled'; reason?: unknown };

export interface BridgeAppRunResult {
  appId: string;
  capabilityId?: string;
  action: string;
  runId: string;
  status: BridgeAppRunStatus;
  events: BridgeAppEvent[];
  output: unknown;
  stderr?: string;
}

export interface BridgeAppRun {
  runId: string;
  bridgeId: string;
  capabilityId?: string;
  action: string;
  consumerKind: BridgeAppConsumerKind;
  consumerId: string;
  workspacePath?: string;
  status: BridgeAppRunStatus;
  startedAt: number;
  updatedAt: number;
  externalRunRef?: string;
  artifacts: unknown[];
  events: BridgeAppEvent[];
  output?: unknown;
  stderr?: string;
}

export class BridgeAppAPI {
  async listBridgeApps(): Promise<BridgeAppPackage[]> {
    try {
      return await api.invoke('list_bridge_apps', {});
    } catch (error) {
      throw createTauriCommandError('list_bridge_apps', error);
    }
  }

  async getBridgeApp(id: string): Promise<BridgeAppPackage> {
    try {
      return await api.invoke('get_bridge_app', { request: { id } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_app', error, { id });
    }
  }

  async validateBridgeAppPackage(manifest: BridgeAppManifest): Promise<unknown> {
    try {
      return await api.invoke('validate_bridge_app_package', {
        request: { manifest },
      });
    } catch (error) {
      throw createTauriCommandError('validate_bridge_app_package', error);
    }
  }

  async createBridgeApp(manifest: BridgeAppManifest, overwrite = false): Promise<BridgeAppPackage> {
    try {
      return await api.invoke('create_bridge_app', {
        request: { manifest, overwrite },
      });
    } catch (error) {
      throw createTauriCommandError('create_bridge_app', error, { appId: manifest.id });
    }
  }

  async updateBridgeApp(manifest: BridgeAppManifest): Promise<BridgeAppPackage> {
    try {
      return await api.invoke('update_bridge_app', {
        request: { manifest },
      });
    } catch (error) {
      throw createTauriCommandError('update_bridge_app', error, { appId: manifest.id });
    }
  }

  async importFromPath(path: string, overwrite = false): Promise<BridgeAppPackage> {
    try {
      return await api.invoke('import_bridge_app_from_path', {
        request: { path, overwrite },
      });
    } catch (error) {
      throw createTauriCommandError('import_bridge_app_from_path', error, { path, overwrite });
    }
  }

  async deleteBridgeApp(id: string): Promise<void> {
    try {
      await api.invoke('delete_bridge_app', { request: { id } });
    } catch (error) {
      throw createTauriCommandError('delete_bridge_app', error, { id });
    }
  }

  async runBridgeAppAction(
    appId: string,
    action: string,
    input: unknown,
    workspacePath?: string,
    capabilityId?: string,
  ): Promise<BridgeAppRunResult> {
    try {
      return await api.invoke('run_bridge_app_action', {
        request: { appId, capabilityId, action, input, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('run_bridge_app_action', error, { appId, action });
    }
  }

  async listBridgeAppRuns(appId?: string): Promise<BridgeAppRun[]> {
    try {
      return await api.invoke('list_bridge_app_runs', { request: { appId } });
    } catch (error) {
      throw createTauriCommandError('list_bridge_app_runs', error, { appId });
    }
  }

  async getBridgeAppRun(runId: string): Promise<BridgeAppRun> {
    try {
      return await api.invoke('get_bridge_app_run', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_app_run', error, { runId });
    }
  }

  async cancelBridgeAppRun(runId: string): Promise<BridgeAppRun> {
    try {
      return await api.invoke('cancel_bridge_app_run', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('cancel_bridge_app_run', error, { runId });
    }
  }

  async getBridgeAppRunArtifacts(runId: string): Promise<unknown[]> {
    try {
      return await api.invoke('get_bridge_app_run_artifacts', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_app_run_artifacts', error, { runId });
    }
  }

  async streamBridgeAppRunEvents(runId: string, afterIndex?: number): Promise<BridgeAppEvent[]> {
    try {
      return await api.invoke('stream_bridge_app_run_events', {
        request: { runId, afterIndex },
      });
    } catch (error) {
      throw createTauriCommandError('stream_bridge_app_run_events', error, { runId, afterIndex });
    }
  }
}

export const bridgeAppAPI = new BridgeAppAPI();
