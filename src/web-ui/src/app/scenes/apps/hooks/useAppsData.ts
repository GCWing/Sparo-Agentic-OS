import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { agentAppAPI, type AgentAppLevel, type AgentAppServiceAction, type AgentAppExample } from '@/infrastructure/api/service-api/AgentAppAPI';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { SubagentAPI, type AgentSubagentInfo, type SubagentInfo } from '@/infrastructure/api/service-api/SubagentAPI';
import type { AgentCapabilityProfile, AIModelConfig, AgentCapabilityConfigItem, AgentSkillInfo, SkillInfo } from '@/infrastructure/config/types';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useNotification } from '@/shared/notification-system';
import { APP_REGISTRY, type AppEntity, isTopLevelAgent } from '../appRegistry';
import { enrichAgentCapabilities } from '../appsUtils';

export const CAPABILITY_CATEGORIES = ['Coding', 'Documents', 'Analysis', 'Testing', 'Creative', 'Operations'] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export interface AgentCapability {
  category: CapabilityCategory;
  level: number;
}

export interface AgentWithCapabilities {
  id: string;
  name: string;
  description: string;
  isReadonly: boolean;
  toolCount?: number;
  defaultTools?: string[];
  enabled: boolean;
  model?: string;
  skills?: string[];
  subagents?: string[];
  capabilities: AgentCapability[];
  iconKey?: string;
  isAgentApp?: boolean;
  agentAppLevel?: AgentAppLevel;
  agentAppPath?: string;
  tags?: string[];
  category?: string;
  examples?: AgentAppExample[];
  serviceActions?: AgentAppServiceAction[];
}

export interface ToolInfo {
  name: string;
  description: string;
  is_readonly: boolean;
}

export type AppCardModel = AppEntity & {
  includedAgents: AgentWithCapabilities[];
};

export function useAppsData() {
  const notification = useNotification();
  const { t } = useTranslation('scenes/apps');
  const { workspacePath } = useLastUsedWorkspace();
  const [allAgents, setAllAgents] = useState<AgentWithCapabilities[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [availableSubagents, setAvailableSubagents] = useState<SubagentInfo[]>([]);
  const [modelConfigs, setModelConfigs] = useState<AIModelConfig[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<Record<string, AgentCapabilityProfile>>({});
  const [agentSkills, setAgentSkills] = useState<Record<string, AgentSkillInfo[]>>({});
  const [agentSubagents, setAgentSubagents] = useState<Record<string, AgentSubagentInfo[]>>({});
  const [agentConfigs, setAgentConfigs] = useState<Record<string, AgentCapabilityConfigItem>>({});
  const loadRequestIdRef = useRef(0);

  const toAgentConfig = useCallback((profile: AgentCapabilityProfile): AgentCapabilityConfigItem => ({
    agent_id: profile.agentId,
    enabled_tools: profile.tools.effective,
    enabled: profile.enabled,
    default_tools: profile.tools.defaults,
  }), []);

  const toAgentSkills = useCallback((skills: SkillInfo[], profile: AgentCapabilityProfile): AgentSkillInfo[] => {
    const selected = new Set(profile.skills.effective);
    return skills.map((skill) => ({
      ...skill,
      disabledByAgent: !selected.has(skill.key),
      selectedForRuntime: selected.has(skill.key),
    }));
  }, []);

  const toAgentSubagents = useCallback((subagents: SubagentInfo[], profile: AgentCapabilityProfile): AgentSubagentInfo[] => {
    const selected = new Set(profile.subagents.effective);
    return subagents
      .filter((subagent) => subagent.enabled)
      .map((subagent) => ({
        ...subagent,
        disabledByAgent: !selected.has(subagent.id),
        selectedForRuntime: selected.has(subagent.id),
      }));
  }, []);

  const applyProfiles = useCallback((
    profiles: Record<string, AgentCapabilityProfile>,
    skills: SkillInfo[],
    subagents: SubagentInfo[],
  ) => {
    setAgentProfiles(profiles);
    setAgentConfigs(Object.fromEntries(
      Object.entries(profiles).map(([agentId, profile]) => [agentId, toAgentConfig(profile)]),
    ));
    setAgentSkills(Object.fromEntries(
      Object.entries(profiles).map(([agentId, profile]) => [agentId, toAgentSkills(skills, profile)]),
    ));
    setAgentSubagents(Object.fromEntries(
      Object.entries(profiles).map(([agentId, profile]) => [agentId, toAgentSubagents(subagents, profile)]),
    ));
  }, [toAgentConfig, toAgentSkills, toAgentSubagents]);

  const refreshAgentProfile = useCallback(async (
    agentId: string,
    skills = availableSkills,
    subagents = availableSubagents,
  ) => {
    const profile = await configAPI.getAgentCapabilityProfile({
      agentId,
      workspacePath: workspacePath || undefined,
    });
    setAgentProfiles((prev) => ({ ...prev, [agentId]: profile }));
    setAgentConfigs((prev) => ({ ...prev, [agentId]: toAgentConfig(profile) }));
    setAgentSkills((prev) => ({ ...prev, [agentId]: toAgentSkills(skills, profile) }));
    setAgentSubagents((prev) => ({ ...prev, [agentId]: toAgentSubagents(subagents, profile) }));
    setAllAgents((prev) => prev.map((agent) => agent.id === agentId
      ? enrichAgentCapabilities({
          ...agent,
          toolCount: profile.tools.effective.length,
          defaultTools: profile.tools.defaults,
          enabled: profile.enabled,
          model: profile.model ?? undefined,
          skills: profile.skills.effective,
          subagents: profile.subagents.effective,
        })
      : agent));
    return profile;
  }, [availableSkills, availableSubagents, toAgentConfig, toAgentSkills, toAgentSubagents, workspacePath]);

  const loadAppsData = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setDetailsLoading(true);

    const fetchTools = async (): Promise<ToolInfo[]> => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<ToolInfo[]>('get_all_tools_info');
      } catch {
        return [];
      }
    };

    try {
      const toolsPromise = fetchTools();
      const agents = await agentAPI.listAgents().catch(() => []);
      const generatedAgentApps = await agentAppAPI.listAgentApps(workspacePath || undefined).catch(() => []);

      if (requestId !== loadRequestIdRef.current) return;

      const primaryAgents = agents
        .map((agent) => enrichAgentCapabilities({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          isReadonly: agent.isReadonly,
          toolCount: agent.toolCount,
          defaultTools: agent.defaultTools ?? [],
          enabled: agent.enabled,
          model: undefined,
          capabilities: [],
        }))
        .filter((agent) => isTopLevelAgent({ id: agent.id, agentKind: 'agent' }));
      const generatedAgents = generatedAgentApps.map((app) => enrichAgentCapabilities({
        id: app.id,
        name: app.name,
        description: app.description,
        isReadonly: app.readonly,
        toolCount: app.tools.length,
        defaultTools: app.tools,
        enabled: app.enabled,
        model: app.model,
        skills: app.skills ?? [],
        subagents: app.subagents ?? [],
        capabilities: [],
        iconKey: app.icon,
        isAgentApp: true,
        agentAppLevel: 'user',
        agentAppPath: app.path,
        tags: app.tags,
        category: app.category,
        examples: app.examples,
        serviceActions: app.serviceActions,
      }));

      setAllAgents([...primaryAgents, ...generatedAgents]);
      setLoading(false);

      const [tools, skills, subagents, models] = await Promise.all([
        toolsPromise,
        configAPI.getSkillConfigs({
          workspacePath: workspacePath || undefined,
        }).catch(() => []),
        SubagentAPI.listSubagents({
          workspacePath: workspacePath || undefined,
        }).catch(() => []),
        configAPI.getModelConfigs().catch(() => []),
      ]);
      const profileEntries = await Promise.all(
        [...primaryAgents, ...generatedAgents].map(async (agent) => {
          const profile = await configAPI.getAgentCapabilityProfile({
            agentId: agent.id,
            workspacePath: workspacePath || undefined,
          }).catch(() => null);
          return [agent.id, profile] as const;
        }),
      );
      const profiles = Object.fromEntries(
        profileEntries.filter((entry): entry is readonly [string, AgentCapabilityProfile] => Boolean(entry[1])),
      );

      if (requestId !== loadRequestIdRef.current) return;

      setAvailableTools(tools);
      setAvailableSkills(skills);
      setAvailableSubagents(subagents);
      setModelConfigs(models as AIModelConfig[]);
      applyProfiles(profiles, skills, subagents);
      setAllAgents((prev) => prev.map((agent) => {
        const profile = profiles[agent.id];
        if (!profile) return agent;
        return enrichAgentCapabilities({
          ...agent,
          toolCount: profile.tools.effective.length,
          defaultTools: profile.tools.defaults,
          enabled: profile.enabled,
          model: profile.model ?? undefined,
          skills: profile.skills.effective,
          subagents: profile.subagents.effective,
        });
      }));
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setDetailsLoading(false);
      }
    }
  }, [applyProfiles, workspacePath]);

  useEffect(() => {
    void loadAppsData();
  }, [loadAppsData]);

  const appCards = useMemo(() => {
    const generatedApps = allAgents
      .filter((agent) => !APP_REGISTRY.some((app) =>
        app.kind === 'multi-agent-app'
          ? app.agentIds.includes(agent.id)
          : app.agentId === agent.id
      ))
      .map((agent) => ({
        id: `agent-app-${agent.id}`,
        kind: 'standalone-agent-app' as const,
        nameKey: agent.name,
        descriptionKey: agent.description,
        badgeKey: 'apps.badges.standaloneAgentApp',
        dynamicName: agent.name,
        dynamicDescription: agent.description,
        iconKey: agent.iconKey,
        source: 'user' as const,
        agentId: agent.id,
        includedAgents: [agent],
      }));

    const builtinApps = APP_REGISTRY
      .map((app) => {
        const includedAgents = app.kind === 'multi-agent-app'
          ? app.agentIds.map((id) => allAgents.find((agent) => agent.id === id)).filter(Boolean) as AgentWithCapabilities[]
          : [allAgents.find((agent) => agent.id === app.agentId)].filter(Boolean) as AgentWithCapabilities[];

        return {
          ...app,
          includedAgents,
        } satisfies AppCardModel;
      })
      .filter((app) => app.includedAgents.length > 0);

    return [...builtinApps, ...generatedApps];
  }, [allAgents]);

  const getAgentById = useCallback((agentId: string | null) => {
    if (!agentId) return null;
    return allAgents.find((agent) => agent.id === agentId) ?? null;
  }, [allAgents]);

  const getAppById = useCallback((appId: string | null) => {
    if (!appId) return null;
    const app = APP_REGISTRY.find((item) => item.id === appId);
    if (!app) {
      const generated = allAgents.find((agent) => `agent-app-${agent.id}` === appId);
      if (!generated) return null;
      return {
        id: `agent-app-${generated.id}`,
        kind: 'standalone-agent-app',
        nameKey: generated.name,
        descriptionKey: generated.description,
        badgeKey: 'apps.badges.standaloneAgentApp',
        dynamicName: generated.name,
        dynamicDescription: generated.description,
        iconKey: generated.iconKey,
        source: 'user',
        agentId: generated.id,
        includedAgents: [generated],
      } satisfies AppCardModel;
    }

    const includedAgents = app.kind === 'multi-agent-app'
      ? app.agentIds.map((id) => allAgents.find((agent) => agent.id === id)).filter(Boolean) as AgentWithCapabilities[]
      : [allAgents.find((agent) => agent.id === app.agentId)].filter(Boolean) as AgentWithCapabilities[];

    if (includedAgents.length === 0) return null;

    return {
      ...app,
      includedAgents,
    } satisfies AppCardModel;
  }, [allAgents]);

  const getAgentConfig = useCallback((agentId: string): AgentCapabilityConfigItem | null => {
    const agent = allAgents.find((item) => item.id === agentId);
    if (!agent) return null;

    const profile = agentProfiles[agentId];
    if (profile) return toAgentConfig(profile);

    const userConfig = agentConfigs[agentId];
    const defaultTools = agent.defaultTools ?? [];

    if (!userConfig) {
      return {
        agent_id: agentId,
        enabled_tools: defaultTools,
        enabled: true,
        default_tools: defaultTools,
      };
    }

    return {
      ...userConfig,
      default_tools: userConfig.default_tools ?? defaultTools,
    };
  }, [agentProfiles, allAgents, agentConfigs, toAgentConfig]);

  const getAgentSkills = useCallback((agentId: string): AgentSkillInfo[] => {
    return agentSkills[agentId] ?? [];
  }, [agentSkills]);

  const getAgentSubagents = useCallback((agentId: string): AgentSubagentInfo[] => {
    return agentSubagents[agentId] ?? [];
  }, [agentSubagents]);

  const getModelDisplayName = useCallback((modelRef?: string | null): string => {
    const raw = modelRef?.trim();
    if (!raw) return '';

    const match = modelConfigs.find((model) =>
      model.id === raw || model.name === raw || model.model_name === raw
    );
    if (!match) return raw;

    const configName = match.name?.trim();
    const modelName = match.model_name?.trim();
    if (configName && modelName && configName !== modelName) {
      return `${configName} / ${modelName}`;
    }
    return configName || modelName || raw;
  }, [modelConfigs]);

  const handleSetTools = useCallback(async (agentId: string, toolNames: string[]) => {
    try {
      await configAPI.updateAgentCapabilityProfile({
        agentId,
        workspacePath: workspacePath || undefined,
        tools: Array.from(new Set(toolNames)),
      });
      await refreshAgentProfile(agentId);
      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('agent:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error(t('messages.toolUpdateFailed'));
    }
  }, [notification, refreshAgentProfile, t, workspacePath]);

  const handleSetAgentEnabled = useCallback(async (agentId: string, enabled: boolean) => {
    try {
      await configAPI.updateAgentCapabilityProfile({
        agentId,
        workspacePath: workspacePath || undefined,
        enabled,
      });
      await refreshAgentProfile(agentId);
    } catch {
      notification.error(t('messages.agentAppStatusUpdateFailed'));
    }
  }, [notification, refreshAgentProfile, t, workspacePath]);

  const handleResetTools = useCallback(async (agentId: string) => {
    try {
      const agent = allAgents.find((item) => item.id === agentId);
      if (agent?.isAgentApp) {
        await handleSetTools(agentId, ['LS', 'Read', 'Glob', 'Grep']);
        return;
      }
      await configAPI.resetAgentCapabilityConfig(agentId);
      await refreshAgentProfile(agentId);

      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('agent:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error(t('messages.toolResetFailed'));
    }
  }, [allAgents, handleSetTools, notification, refreshAgentProfile, t]);

  const handleSetSkills = useCallback(async (agentId: string, enabledSkillKeys: string[]) => {
    try {
      await configAPI.updateAgentCapabilityProfile({
        agentId,
        workspacePath: workspacePath || undefined,
        skills: Array.from(new Set(enabledSkillKeys)),
      });
      await refreshAgentProfile(agentId);

      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('agent:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error(t('messages.skillUpdateFailed'));
    }
  }, [notification, refreshAgentProfile, t, workspacePath]);

  const handleSetSubagents = useCallback(async (agentId: string, enabledSubagentIds: string[]) => {
    try {
      await configAPI.updateAgentCapabilityProfile({
        agentId,
        workspacePath: workspacePath || undefined,
        subagents: Array.from(new Set(enabledSubagentIds)),
      });
      await refreshAgentProfile(agentId);

      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('agent:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error(t('messages.subagentUpdateFailed'));
    }
  }, [notification, refreshAgentProfile, t, workspacePath]);

  return {
    allAgents,
    appCards,
    availableTools,
    getAgentById,
    getAppById,
    getAgentConfig,
    getAgentSkills,
    getAgentSubagents,
    getModelDisplayName,
    handleResetTools,
    handleSetAgentEnabled,
    handleSetSkills,
    handleSetSubagents,
    handleSetTools,
    loadAppsData,
    detailsLoading,
    loading,
  };
}


