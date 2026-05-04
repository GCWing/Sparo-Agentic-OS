import { api } from './ApiClient';

export type AgentAppLevel = 'user';

export interface AgentAppExample {
  title: string;
  prompt: string;
}

export interface AgentAppToolPolicy {
  allow?: string[];
}

export interface AgentAppManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  level: AgentAppLevel;
  model: string;
  readonly: boolean;
  enabled: boolean;
  tools: string[];
  toolPolicies?: Record<string, AgentAppToolPolicy>;
  examples: AgentAppExample[];
}

export interface AgentAppInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  level: AgentAppLevel;
  model: string;
  readonly: boolean;
  enabled: boolean;
  tools: string[];
  examples: AgentAppExample[];
  path: string;
}

export interface AgentAppPackage {
  manifest: AgentAppManifest;
  prompt: string;
  path: string;
}

export const agentAppAPI = {
  async listAgentApps(workspacePath?: string): Promise<AgentAppInfo[]> {
    return api.invoke('list_agent_apps', {
      request: { workspacePath },
    });
  },

  async getAgentApp(id: string, workspacePath?: string, level?: AgentAppLevel): Promise<AgentAppPackage> {
    return api.invoke('get_agent_app', {
      request: { id, workspacePath, level },
    });
  },

  async deleteAgentApp(id: string, level: AgentAppLevel, workspacePath?: string): Promise<void> {
    return api.invoke('delete_agent_app', {
      request: { id, level, workspacePath },
    });
  },

  async validateAgentAppPackage(manifest: AgentAppManifest, prompt: string, workspacePath?: string): Promise<unknown> {
    return api.invoke('validate_agent_app_package', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, workspacePath },
    });
  },

  async createAgentApp(manifest: AgentAppManifest, prompt: string, overwrite = false, workspacePath?: string): Promise<AgentAppPackage> {
    return api.invoke('create_agent_app', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, overwrite, workspacePath },
    });
  },

  async updateAgentApp(manifest: AgentAppManifest, prompt: string, workspacePath?: string): Promise<AgentAppPackage> {
    return api.invoke('update_agent_app', {
      request: { manifest: { ...manifest, level: 'user' }, prompt, overwrite: true, workspacePath },
    });
  },

  async reloadAgentApps(workspacePath?: string): Promise<AgentAppInfo[]> {
    return api.invoke('reload_agent_apps', {
      request: { workspacePath },
    });
  },

  async exportAgentApp(id: string, workspacePath?: string, level?: AgentAppLevel): Promise<unknown> {
    return api.invoke('export_agent_app', {
      request: { id, workspacePath, level },
    });
  },

  async importAgentApp(payload: unknown): Promise<AgentAppPackage> {
    return api.invoke('import_agent_app', {
      request: payload,
    });
  },
};
