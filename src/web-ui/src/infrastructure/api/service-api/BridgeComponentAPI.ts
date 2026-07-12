import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type BridgeComponentKind = 'cli' | 'sdk' | 'gui' | 'service' | 'mcp' | 'daemon';
export type BridgeComponentRuntimeLanguage = 'javascript' | 'typescript' | 'python' | 'native';

export interface BridgeComponentRuntime {
  language: BridgeComponentRuntimeLanguage;
  entry: string;
  packageManager?: string;
  idleTimeoutMs?: number;
}

export interface BridgeComponentSurfaces {
  launchableApp?: boolean;
  agent?: boolean;
  tool?: boolean;
  productAppRuntimeBackend?: boolean;
}

export interface BridgeComponentPermissions {
  fs?: string[];
  net?: string[];
  shell?: string[];
  gui?: unknown[];
  secrets?: string[];
}

export type BridgeComponentConsumerKind = 'agentComponent' | 'productAppRuntime' | 'management' | 'system';

export interface BridgeComponentCapability {
  id: string;
  title: string;
  description: string;
  category?: string;
  actions?: string[];
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
  usableBy?: BridgeComponentConsumerKind[];
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface BridgeComponentLifecycle {
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
}

export interface BridgeComponentAction {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  streaming?: boolean;
  cancelable?: boolean;
  resumable?: boolean;
}

export interface BridgeComponentManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  kind: BridgeComponentKind;
  runtime: BridgeComponentRuntime;
  surfaces?: BridgeComponentSurfaces;
  capabilities?: BridgeComponentCapability[];
  actions?: BridgeComponentAction[];
  tools?: unknown[];
  lifecycle?: BridgeComponentLifecycle;
  permissions?: BridgeComponentPermissions;
}

export interface BridgeComponentPackage {
  manifest: BridgeComponentManifest;
  path: string;
}

export type BridgeComponentRunStatus = 'pending' | 'running' | 'waitingForApproval' | 'completed' | 'failed' | 'cancelled';

export type BridgeComponentEvent =
  | { type: 'run.started'; run_id: string }
  | { type: 'run.status'; status: BridgeComponentRunStatus; message?: string }
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

export interface BridgeComponentRunResult {
  componentId: string;
  capabilityId?: string;
  action: string;
  runId: string;
  status: BridgeComponentRunStatus;
  events: BridgeComponentEvent[];
  output: unknown;
  stderr?: string;
}

export interface BridgeComponentRun {
  runId: string;
  bridgeId: string;
  capabilityId?: string;
  action: string;
  consumerKind: BridgeComponentConsumerKind;
  consumerId: string;
  workspacePath?: string;
  status: BridgeComponentRunStatus;
  startedAt: number;
  updatedAt: number;
  externalRunRef?: string;
  artifacts: unknown[];
  events: BridgeComponentEvent[];
  output?: unknown;
  stderr?: string;
}

export class BridgeComponentAPI {
  async listBridgeComponents(): Promise<BridgeComponentPackage[]> {
    try {
      return await api.invoke('list_bridge_components', {});
    } catch (error) {
      throw createTauriCommandError('list_bridge_components', error);
    }
  }

  async getBridgeComponent(id: string): Promise<BridgeComponentPackage> {
    try {
      return await api.invoke('get_bridge_component', { request: { id } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_component', error, { id });
    }
  }

  async validateBridgeComponentPackage(manifest: BridgeComponentManifest): Promise<unknown> {
    try {
      return await api.invoke('validate_bridge_component_package', {
        request: { manifest },
      });
    } catch (error) {
      throw createTauriCommandError('validate_bridge_component_package', error);
    }
  }

  async createBridgeComponent(manifest: BridgeComponentManifest, overwrite = false): Promise<BridgeComponentPackage> {
    try {
      return await api.invoke('create_bridge_component', {
        request: { manifest, overwrite },
      });
    } catch (error) {
      throw createTauriCommandError('create_bridge_component', error, { componentId: manifest.id });
    }
  }

  async updateBridgeComponent(manifest: BridgeComponentManifest): Promise<BridgeComponentPackage> {
    try {
      return await api.invoke('update_bridge_component', {
        request: { manifest },
      });
    } catch (error) {
      throw createTauriCommandError('update_bridge_component', error, { componentId: manifest.id });
    }
  }

  async importFromPath(path: string, overwrite = false): Promise<BridgeComponentPackage> {
    try {
      return await api.invoke('import_bridge_component_from_path', {
        request: { path, overwrite },
      });
    } catch (error) {
      throw createTauriCommandError('import_bridge_component_from_path', error, { path, overwrite });
    }
  }

  async deleteBridgeComponent(id: string): Promise<void> {
    try {
      await api.invoke('delete_bridge_component', { request: { id } });
    } catch (error) {
      throw createTauriCommandError('delete_bridge_component', error, { id });
    }
  }

  async runBridgeComponentAction(
    componentId: string,
    action: string,
    input: unknown,
    workspacePath?: string,
    capabilityId?: string,
  ): Promise<BridgeComponentRunResult> {
    try {
      return await api.invoke('run_bridge_component_action', {
        request: { componentId, capabilityId, action, input, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('run_bridge_component_action', error, { componentId, action });
    }
  }

  async listBridgeComponentRuns(componentId?: string): Promise<BridgeComponentRun[]> {
    try {
      return await api.invoke('list_bridge_component_runs', { request: { componentId } });
    } catch (error) {
      throw createTauriCommandError('list_bridge_component_runs', error, { componentId });
    }
  }

  async getBridgeComponentRun(runId: string): Promise<BridgeComponentRun> {
    try {
      return await api.invoke('get_bridge_component_run', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_component_run', error, { runId });
    }
  }

  async cancelBridgeComponentRun(runId: string): Promise<BridgeComponentRun> {
    try {
      return await api.invoke('cancel_bridge_component_run', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('cancel_bridge_component_run', error, { runId });
    }
  }

  async getBridgeComponentRunArtifacts(runId: string): Promise<unknown[]> {
    try {
      return await api.invoke('get_bridge_component_run_artifacts', { request: { runId } });
    } catch (error) {
      throw createTauriCommandError('get_bridge_component_run_artifacts', error, { runId });
    }
  }

  async streamBridgeComponentRunEvents(runId: string, afterIndex?: number): Promise<BridgeComponentEvent[]> {
    try {
      return await api.invoke('stream_bridge_component_run_events', {
        request: { runId, afterIndex },
      });
    } catch (error) {
      throw createTauriCommandError('stream_bridge_component_run_events', error, { runId, afterIndex });
    }
  }
}

export const bridgeComponentAPI = new BridgeComponentAPI();
