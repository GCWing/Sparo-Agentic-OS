 

import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type {
  AgentCapabilityProfile,
  AgentSkillInfo,
  AgentCapabilityConfigItem,
  RuntimeLoggingInfo,
  SkillCatalog,
  SkillLevel,
  SkillMarketDownloadResult,
  SkillMarketItem,
  SkillValidationResult,
} from '../../config/types';

export interface GetSkillConfigsParams {
  forceRefresh?: boolean;
  workspacePath?: string;
}

export interface GetAgentSkillConfigsParams {
  agentId: string;
  forceRefresh?: boolean;
  workspacePath?: string;
}

export interface SetAgentSkillDisabledParams {
  agentId: string;
  skillKey: string;
  disabled: boolean;
  workspacePath?: string;
}

export interface SetAgentSkillSuiteDisabledParams {
  agentId: string;
  suiteKey: string;
  disabled: boolean;
  workspacePath?: string;
}

export interface ReplaceAgentSkillSelectionParams {
  agentId: string;
  enabledSkillKeys: string[];
  enabledSuiteKeys?: string[];
  workspacePath?: string;
}

export interface AddSkillParams {
  sourcePath: string;
  level: SkillLevel;
  workspacePath?: string;
}

export interface DeleteSkillParams {
  skillKey: string;
  workspacePath?: string;
}

export interface DownloadSkillMarketParams {
  packageId: string;
  level?: SkillLevel;
  workspacePath?: string;
}

export interface GetAgentCapabilityProfileParams {
  agentId: string;
  workspacePath?: string;
}

export interface UpdateAgentCapabilityProfileParams {
  agentId: string;
  workspacePath?: string;
  enabled?: boolean;
  model?: string;
  tools?: string[];
  skills?: string[];
  subagents?: string[];
}


export class ConfigAPI {
  async getAgentCapabilityProfile({
    agentId,
    workspacePath,
  }: GetAgentCapabilityProfileParams): Promise<AgentCapabilityProfile> {
    try {
      return await api.invoke('get_agent_capability_profile', {
        request: { agentId, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_capability_profile', error, { agentId, workspacePath });
    }
  }

  async updateAgentCapabilityProfile(params: UpdateAgentCapabilityProfileParams): Promise<AgentCapabilityProfile> {
    try {
      return await api.invoke('update_agent_capability_profile', {
        request: params,
      });
    } catch (error) {
      throw createTauriCommandError('update_agent_capability_profile', error, params);
    }
  }

   
  async getConfig(path?: string, options?: { skipRetryOnNotFound?: boolean }): Promise<any> {
    try {
      
      const shouldSkipRetry = options?.skipRetryOnNotFound ?? false;
      
      return await api.invoke('get_config', 
        { request: path ? { path } : {} },
        shouldSkipRetry ? { retries: 0 } : undefined
      );
    } catch (error) {
      
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found') || errorMessage.includes('Config path')) {
        return undefined;
      }
      throw createTauriCommandError('get_config', error, { path });
    }
  }

   
  async setConfig(path: string, value: any): Promise<void> {
    try {
      await api.invoke('set_config', { 
        request: { path, value } 
      });
    } catch (error) {
      throw createTauriCommandError('set_config', error, { path, value });
    }
  }

   
  async resetConfig(path?: string): Promise<void> {
    try {
      await api.invoke('reset_config', { 
        request: path ? { path } : {} 
      });
    } catch (error) {
      throw createTauriCommandError('reset_config', error, { path });
    }
  }

   
  async exportConfig(): Promise<any> {
    try {
      return await api.invoke('export_config', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('export_config', error);
    }
  }

   
  async importConfig(configData: any): Promise<void> {
    try {
      await api.invoke('import_config', { 
        request: { configData } 
      });
    } catch (error) {
      throw createTauriCommandError('import_config', error, { configData });
    }
  }

   
  async reloadConfig(): Promise<void> {
    try {
      await api.invoke('reload_config', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('reload_config', error);
    }
  }

  async getRuntimeLoggingInfo(): Promise<RuntimeLoggingInfo> {
    try {
      return await api.invoke('get_runtime_logging_info', {
        request: {},
      });
    } catch (error) {
      throw createTauriCommandError('get_runtime_logging_info', error);
    }
  }

   
  async getModelConfigs(): Promise<any[]> {
    try {
      return await api.invoke('get_model_configs', { 
        request: {} 
      });
    } catch (error) {
      throw createTauriCommandError('get_model_configs', error);
    }
  }

   
  async saveModelConfig(config: any): Promise<void> {
    try {
      await api.invoke('save_model_config', { 
        request: { config } 
      });
    } catch (error) {
      throw createTauriCommandError('save_model_config', error, { config });
    }
  }

   
  async deleteModelConfig(configId: string): Promise<void> {
    try {
      await api.invoke('delete_model_config', { 
        request: { configId } 
      });
    } catch (error) {
      throw createTauriCommandError('delete_model_config', error, { configId });
    }
  }

  

   
  async getAgentCapabilityConfigs(): Promise<Record<string, AgentCapabilityConfigItem>> {
    try {
      return await api.invoke<Record<string, AgentCapabilityConfigItem>>('get_agent_capability_configs');
    } catch (error) {
      throw createTauriCommandError('get_agent_capability_configs', error);
    }
  }

   
  async getAgentCapabilityConfig(agentId: string): Promise<AgentCapabilityConfigItem> {
    try {
      return await api.invoke<AgentCapabilityConfigItem>('get_agent_capability_config', { agentId });
    } catch (error) {
      throw createTauriCommandError('get_agent_capability_config', error, { agentId });
    }
  }

   
  async setAgentCapabilityConfig(agentId: string, config: any): Promise<string> {
    try {
      return await api.invoke('set_agent_capability_config', { agentId, config });
    } catch (error) {
      throw createTauriCommandError('set_agent_capability_config', error, { agentId, config });
    }
  }

   
  async resetAgentCapabilityConfig(agentId: string): Promise<string> {
    try {
      return await api.invoke('reset_agent_capability_config', { agentId });
    } catch (error) {
      throw createTauriCommandError('reset_agent_capability_config', error, { agentId });
    }
  }

  

   
  async getSubagentConfigs(): Promise<Record<string, { enabled: boolean }>> {
    try {
      return await api.invoke('get_subagent_configs');
    } catch (error) {
      throw createTauriCommandError('get_subagent_configs', error);
    }
  }

   
  async setSubagentConfig(subagentId: string, enabled: boolean): Promise<string> {
    try {
      return await api.invoke('set_subagent_config', { subagentId, enabled });
    } catch (error) {
      throw createTauriCommandError('set_subagent_config', error, { subagentId, enabled });
    }
  }

   
  async deleteSubagent(subagentId: string): Promise<void> {
    try {
      await api.invoke('delete_subagent', {
        request: { subagentId },
      });
    } catch (error) {
      throw createTauriCommandError('delete_subagent', error, { subagentId });
    }
  }

  

   
  async getSkillConfigs({
    forceRefresh,
    workspacePath,
  }: GetSkillConfigsParams = {}): Promise<SkillCatalog> {
    try {
      return await api.invoke('get_skill_configs', { forceRefresh, workspacePath });
    } catch (error) {
      throw createTauriCommandError('get_skill_configs', error, { forceRefresh, workspacePath });
    }
  }

   
  async getAgentSkillConfigs({
    agentId,
    forceRefresh,
    workspacePath,
  }: GetAgentSkillConfigsParams): Promise<AgentSkillInfo[]> {
    try {
      return await api.invoke('get_agent_skill_configs', { agentId, forceRefresh, workspacePath });
    } catch (error) {
      throw createTauriCommandError('get_agent_skill_configs', error, { agentId, forceRefresh, workspacePath });
    }
  }

   
  async setAgentSkillDisabled({
    agentId,
    skillKey,
    disabled,
    workspacePath,
  }: SetAgentSkillDisabledParams): Promise<string> {
    try {
      return await api.invoke('set_agent_skill_disabled', { agentId, skillKey, disabled, workspacePath });
    } catch (error) {
      throw createTauriCommandError('set_agent_skill_disabled', error, { agentId, skillKey, disabled, workspacePath });
    }
  }

  async setAgentSkillSuiteDisabled({
    agentId,
    suiteKey,
    disabled,
    workspacePath,
  }: SetAgentSkillSuiteDisabledParams): Promise<string> {
    try {
      return await api.invoke('set_agent_skill_suite_disabled', {
        request: { agentId, suiteKey, disabled, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('set_agent_skill_suite_disabled', error, {
        agentId,
        suiteKey,
        disabled,
        workspacePath,
      });
    }
  }

  async replaceAgentSkillSelection({
    agentId,
    enabledSkillKeys,
    enabledSuiteKeys,
    workspacePath,
  }: ReplaceAgentSkillSelectionParams): Promise<string> {
    try {
      return await api.invoke('replace_agent_skill_selection', {
        request: { agentId, enabledSkillKeys, enabledSuiteKeys, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('replace_agent_skill_selection', error, {
        agentId,
        enabledSkillKeys,
        enabledSuiteKeys,
        workspacePath,
      });
    }
  }

   
  async validateSkillPath(path: string): Promise<SkillValidationResult> {
    try {
      return await api.invoke('validate_skill_path', { path });
    } catch (error) {
      throw createTauriCommandError('validate_skill_path', error, { path });
    }
  }

   
  async addSkill({
    sourcePath,
    level,
    workspacePath,
  }: AddSkillParams): Promise<string> {
    try {
      return await api.invoke('add_skill', { sourcePath, level, workspacePath });
    } catch (error) {
      throw createTauriCommandError('add_skill', error, { sourcePath, level, workspacePath });
    }
  }

   
  async deleteSkill({
    skillKey,
    workspacePath,
  }: DeleteSkillParams): Promise<string> {
    try {
      return await api.invoke('delete_skill', { skillKey, workspacePath });
    } catch (error) {
      throw createTauriCommandError('delete_skill', error, { skillKey, workspacePath });
    }
  }

  async listSkillMarket(query?: string, limit?: number): Promise<SkillMarketItem[]> {
    try {
      return await api.invoke('list_skill_market', {
        request: { query, limit }
      });
    } catch (error) {
      throw createTauriCommandError('list_skill_market', error, { query, limit });
    }
  }

  async searchSkillMarket(query: string, limit?: number): Promise<SkillMarketItem[]> {
    try {
      return await api.invoke('search_skill_market', {
        request: { query, limit }
      });
    } catch (error) {
      throw createTauriCommandError('search_skill_market', error, { query, limit });
    }
  }

  async downloadSkillMarket({
    packageId,
    level = 'project',
    workspacePath,
  }: DownloadSkillMarketParams): Promise<SkillMarketDownloadResult> {
    try {
      return await api.invoke('download_skill_market', {
        request: { package: packageId, level, workspacePath }
      });
    } catch (error) {
      throw createTauriCommandError('download_skill_market', error, {
        package: packageId,
        level,
        workspacePath,
      });
    }
  }
}


export const configAPI = new ConfigAPI();
