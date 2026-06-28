import { api } from './ApiClient';

export type AgentComponentLevel = 'user' | 'project';

export interface AgentComponentExample {
  title: string;
  prompt: string;
}

export interface AgentComponentToolPolicy {
  allow?: string[];
}

export interface AgentComponentServiceAction {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  promptTemplate?: string;
  memory?: string;
  toolPolicy?: string[];
  bridgeCall?: {
    bridgeId: string;
    capabilityId: string;
    action?: string;
    mode?: string;
  };
}

export interface AgentComponentBridgeCapabilityRef {
  bridgeId: string;
  capabilityId: string;
  alias?: string;
  mode?: string;
}

export interface AgentComponentManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  level: AgentComponentLevel;
  model: string;
  readonly: boolean;
  enabled: boolean;
  tools: string[];
  skills?: string[];
  subagents?: string[];
  toolPolicies?: Record<string, AgentComponentToolPolicy>;
  serviceActions?: AgentComponentServiceAction[];
  bridgeCapabilities?: AgentComponentBridgeCapabilityRef[];
  examples: AgentComponentExample[];
}

export interface AgentComponentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  level: AgentComponentLevel;
  model: string;
  readonly: boolean;
  enabled: boolean;
  tools: string[];
  skills?: string[];
  subagents?: string[];
  serviceActions?: AgentComponentServiceAction[];
  bridgeCapabilities?: AgentComponentBridgeCapabilityRef[];
  examples: AgentComponentExample[];
  path: string;
}

export interface AgentComponentPackage {
  manifest: AgentComponentManifest;
  prompt: string;
  path: string;
}

export const agentComponentAPI = {
  async listAgentComponents(workspacePath?: string): Promise<AgentComponentInfo[]> {
    return api.invoke('list_agent_components', {
      request: { workspacePath },
    });
  },

  async getAgentComponent(id: string, workspacePath?: string, level?: AgentComponentLevel): Promise<AgentComponentPackage> {
    return api.invoke('get_agent_component', {
      request: { id, workspacePath, level },
    });
  },

  async deleteAgentComponent(id: string, level: AgentComponentLevel, workspacePath?: string): Promise<void> {
    return api.invoke('delete_agent_component', {
      request: { id, level, workspacePath },
    });
  },

  async validateAgentComponentPackage(manifest: AgentComponentManifest, prompt: string, workspacePath?: string): Promise<unknown> {
    return api.invoke('validate_agent_component_package', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, workspacePath },
    });
  },

  async createAgentComponent(manifest: AgentComponentManifest, prompt: string, overwrite = false, workspacePath?: string): Promise<AgentComponentPackage> {
    return api.invoke('create_agent_component', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, overwrite, workspacePath },
    });
  },

  async updateAgentComponent(manifest: AgentComponentManifest, prompt: string, workspacePath?: string): Promise<AgentComponentPackage> {
    return api.invoke('update_agent_component', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, overwrite: true, workspacePath },
    });
  },

  async reloadAgentComponents(workspacePath?: string): Promise<AgentComponentInfo[]> {
    return api.invoke('reload_agent_components', {
      request: { workspacePath },
    });
  },

  async exportAgentComponent(id: string, workspacePath?: string, level?: AgentComponentLevel): Promise<unknown> {
    return api.invoke('export_agent_component', {
      request: { id, workspacePath, level },
    });
  },

  async importAgentComponent(payload: unknown): Promise<AgentComponentPackage> {
    return api.invoke('import_agent_component', {
      request: payload,
    });
  },
};
