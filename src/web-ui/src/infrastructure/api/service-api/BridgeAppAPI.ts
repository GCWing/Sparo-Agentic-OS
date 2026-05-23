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
  gui?: string[];
  secrets?: string[];
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
  actions?: BridgeAppAction[];
  permissions?: BridgeAppPermissions;
}

export interface BridgeAppPackage {
  manifest: BridgeAppManifest;
  path: string;
}

export type BridgeAppRunStatus = 'pending' | 'running' | 'waitingForApproval' | 'completed' | 'failed' | 'cancelled';

export type BridgeAppEvent =
  | { type: 'run.started'; run_id: string }
  | { type: 'text.delta'; text: string }
  | { type: 'thinking.delta'; text: string }
  | { type: 'tool.started'; name: string; input?: unknown }
  | { type: 'tool.completed'; name: string; output?: unknown }
  | { type: 'artifact.created'; artifact?: unknown }
  | { type: 'approval.required'; request?: unknown }
  | { type: 'run.completed'; output?: unknown }
  | { type: 'run.failed'; error?: unknown };

export interface BridgeAppRunResult {
  appId: string;
  action: string;
  runId: string;
  status: BridgeAppRunStatus;
  events: BridgeAppEvent[];
  output: unknown;
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
  ): Promise<BridgeAppRunResult> {
    try {
      return await api.invoke('run_bridge_app_action', {
        request: { appId, action, input, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('run_bridge_app_action', error, { appId, action });
    }
  }
}

export const bridgeAppAPI = new BridgeAppAPI();
