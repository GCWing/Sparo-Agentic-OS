import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type {
  AgentSkillInfo,
  RuntimeLoggingInfo,
  SkillCatalog,
  SkillLevel,
  SkillMarketDownloadResult,
  SkillMarketItem,
  SkillPackageKind,
  SkillPackageValidationResult,
} from '../../config/types';
import type {
  ConfigCatalog,
  DescribeConfigCatalogRequest,
} from '../../config/catalog/types';
import type {
  ConfigSnapshot,
  GetConfigSnapshotRequest,
} from '../../config/snapshot/types';
import type { ConfigStartupStatus } from '../../config/startup/types';
import type {
  CommitConfigPatchRequest,
  ConfigApplyStatusEvent,
  ConfigCommit,
  ConfigCommittedEvent,
  ConfigRolledBackEvent,
  ConfigPlan,
  PlanConfigPatchRequest,
  RetryConfigApplyRequest,
  UndoConfigCommitRequest,
} from '../../config/transaction/types';

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

export interface AddSkillPackageParams {
  sourcePath: string;
  level: SkillLevel;
  workspacePath?: string;
}

export interface DeleteSkillPackageParams {
  kind: SkillPackageKind;
  key: string;
  workspacePath?: string;
}

export interface DownloadSkillMarketParams {
  packageId: string;
  level?: SkillLevel;
  workspacePath?: string;
}

export class ConfigAPI {
  async getConfigStartupStatus(): Promise<ConfigStartupStatus> {
    try {
      return await api.invoke<ConfigStartupStatus>('get_config_startup_status', {
        request: {},
      });
    } catch (error) {
      throw createTauriCommandError('get_config_startup_status', error);
    }
  }

  async rebuildDefaultConfig(): Promise<ConfigStartupStatus> {
    try {
      return await api.invoke<ConfigStartupStatus>('rebuild_default_config', {
        request: {},
      });
    } catch (error) {
      throw createTauriCommandError('rebuild_default_config', error);
    }
  }

  async describeConfigCatalog(request: DescribeConfigCatalogRequest): Promise<ConfigCatalog> {
    try {
      return await api.invoke<ConfigCatalog>('describe_config_catalog', { request });
    } catch (error) {
      throw createTauriCommandError('describe_config_catalog', error, {
        scope: request.scope,
        query: request.query,
      });
    }
  }

  async getConfigSnapshot(request: GetConfigSnapshotRequest): Promise<ConfigSnapshot> {
    try {
      return await api.invoke<ConfigSnapshot>('get_config_snapshot', { request });
    } catch (error) {
      throw createTauriCommandError('get_config_snapshot', error, { scope: request.scope });
    }
  }

  async planConfigPatch(request: PlanConfigPatchRequest): Promise<ConfigPlan> {
    try {
      return await api.invoke<ConfigPlan>('plan_config_patch', { request });
    } catch (error) {
      throw createTauriCommandError('plan_config_patch', error, {
        requestId: request.requestId,
        expectedRevision: request.expectedRevision,
        settingIds: request.operations.map((operation) => operation.settingId),
      });
    }
  }

  async commitConfigPatch(request: CommitConfigPatchRequest): Promise<ConfigCommit> {
    try {
      return await api.invoke<ConfigCommit>('commit_config_patch', { request });
    } catch (error) {
      throw createTauriCommandError('commit_config_patch', error, {
        planId: request.planId,
        expectedRevision: request.expectedRevision,
        confirmed: request.confirmed,
      });
    }
  }

  async undoConfigCommit(request: UndoConfigCommitRequest): Promise<ConfigCommit> {
    try {
      return await api.invoke<ConfigCommit>('undo_config_commit', { request });
    } catch (error) {
      throw createTauriCommandError('undo_config_commit', error, {
        commitId: request.commitId,
        expectedRevision: request.expectedRevision,
        confirmed: request.confirmed,
      });
    }
  }

  async getConfigCommit(commitId: string): Promise<ConfigCommit> {
    try {
      return await api.invoke<ConfigCommit>('get_config_commit', {
        request: { commitId },
      });
    } catch (error) {
      throw createTauriCommandError('get_config_commit', error, { commitId });
    }
  }

  async retryConfigApply(request: RetryConfigApplyRequest): Promise<ConfigCommit> {
    try {
      return await api.invoke<ConfigCommit>('retry_config_apply', { request });
    } catch (error) {
      throw createTauriCommandError('retry_config_apply', error, {
        commitId: request.commitId,
        consumer: request.consumer,
        expectedAttempt: request.expectedAttempt,
      });
    }
  }

  onConfigCommitted(callback: (event: ConfigCommittedEvent) => void): () => void {
    return api.listen<ConfigCommittedEvent>('config://committed', callback);
  }

  onConfigSnapshotRefreshed(callback: (snapshot: ConfigSnapshot) => void): () => void {
    return api.listen<ConfigSnapshot>('config://snapshot-refreshed', callback);
  }

  onConfigRolledBack(callback: (event: ConfigRolledBackEvent) => void): () => void {
    return api.listen<ConfigRolledBackEvent>('config://rolled-back', callback);
  }

  onConfigApplyStatus(callback: (event: ConfigApplyStatusEvent) => void): () => void {
    return api.listen<ConfigApplyStatusEvent>('config://apply-status', callback);
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

   
  async validateSkillPackagePath(path: string): Promise<SkillPackageValidationResult> {
    try {
      return await api.invoke('validate_skill_package_path', { path });
    } catch (error) {
      throw createTauriCommandError('validate_skill_package_path', error, { path });
    }
  }

  async addSkillPackage({
    sourcePath,
    level,
    workspacePath,
  }: AddSkillPackageParams): Promise<string> {
    try {
      return await api.invoke('add_skill_package', {
        request: { sourcePath, level, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('add_skill_package', error, {
        sourcePath,
        level,
        workspacePath,
      });
    }
  }

  async deleteSkillPackage({
    kind,
    key,
    workspacePath,
  }: DeleteSkillPackageParams): Promise<string> {
    try {
      return await api.invoke('delete_skill_package', {
        request: { kind, key, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('delete_skill_package', error, {
        kind,
        key,
        workspacePath,
      });
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
