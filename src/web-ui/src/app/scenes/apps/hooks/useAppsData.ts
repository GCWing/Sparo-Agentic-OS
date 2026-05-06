import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import { agentAppAPI, type AgentAppLevel } from '@/infrastructure/api/service-api/AgentAppAPI';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import type { ModeConfigItem, ModeSkillInfo } from '@/infrastructure/config/types';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useNotification } from '@/shared/notification-system';
import { APP_REGISTRY, type AppEntity, isPrimaryAgentMode } from '../appRegistry';
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
  capabilities: AgentCapability[];
  iconKey?: string;
  isAgentApp?: boolean;
  agentAppLevel?: AgentAppLevel;
  agentAppPath?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  is_readonly: boolean;
}

export type AppCardModel = AppEntity & {
  includedAgents: AgentWithCapabilities[];
};

export function useAppsData(searchQuery: string) {
  const notification = useNotification();
  const { workspacePath } = useLastUsedWorkspace();
  const [allAgents, setAllAgents] = useState<AgentWithCapabilities[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [modeSkills, setModeSkills] = useState<Record<string, ModeSkillInfo[]>>({});
  const [modeConfigs, setModeConfigs] = useState<Record<string, ModeConfigItem>>({});
  const loadRequestIdRef = useRef(0);

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
      const configsPromise = configAPI.getModeConfigs().catch(() => ({}));
      const modes = await agentAPI.getAvailableModes().catch(() => []);
      const generatedAgentApps = await agentAppAPI.listAgentApps(workspacePath || undefined).catch(() => []);

      if (requestId !== loadRequestIdRef.current) return;

      const primaryAgents = modes
        .map((mode) => enrichAgentCapabilities({
          id: mode.id,
          name: mode.name,
          description: mode.description,
          isReadonly: mode.isReadonly,
          toolCount: mode.toolCount,
          defaultTools: mode.defaultTools ?? [],
          enabled: mode.enabled,
          model: undefined,
          capabilities: [],
        }))
        .filter((agent) => isPrimaryAgentMode({ id: agent.id, agentKind: 'mode' }));
      const generatedAgents = generatedAgentApps.map((app) => enrichAgentCapabilities({
        id: app.id,
        name: app.name,
        description: app.description,
        isReadonly: app.readonly,
        toolCount: app.tools.length,
        defaultTools: app.tools,
        enabled: app.enabled,
        model: app.model,
        capabilities: [],
        iconKey: app.icon,
        isAgentApp: true,
        agentAppLevel: 'user',
        agentAppPath: app.path,
      }));

      setAllAgents([...primaryAgents, ...generatedAgents]);
      setLoading(false);

      const [tools, configs] = await Promise.all([toolsPromise, configsPromise]);
      const skillEntries = await Promise.all(
        modes.map(async (mode) => [
          mode.id,
          await configAPI.getModeSkillConfigs({
            modeId: mode.id,
            workspacePath: workspacePath || undefined,
          }).catch(() => []),
        ] as const),
      );

      if (requestId !== loadRequestIdRef.current) return;

      setAvailableTools(tools);
      setModeSkills(Object.fromEntries(skillEntries));
      setModeConfigs(configs as Record<string, ModeConfigItem>);
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
        setDetailsLoading(false);
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    void loadAppsData();
  }, [loadAppsData]);

  const appCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const generatedApps = allAgents
      .filter((agent) => !APP_REGISTRY.some((app) =>
        app.kind === 'mode-app'
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
        const includedAgents = app.kind === 'mode-app'
          ? app.agentIds.map((id) => allAgents.find((agent) => agent.id === id)).filter(Boolean) as AgentWithCapabilities[]
          : [allAgents.find((agent) => agent.id === app.agentId)].filter(Boolean) as AgentWithCapabilities[];

        return {
          ...app,
          includedAgents,
        } satisfies AppCardModel;
      })
      .filter((app) => app.includedAgents.length > 0);

    return [...builtinApps, ...generatedApps]
      .filter((app) => {
        if (!q) return true;
        return app.id.toLowerCase().includes(q)
          || app.includedAgents.some((agent) => agent.name.toLowerCase().includes(q));
      });
  }, [allAgents, searchQuery]);

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

    const includedAgents = app.kind === 'mode-app'
      ? app.agentIds.map((id) => allAgents.find((agent) => agent.id === id)).filter(Boolean) as AgentWithCapabilities[]
      : [allAgents.find((agent) => agent.id === app.agentId)].filter(Boolean) as AgentWithCapabilities[];

    if (includedAgents.length === 0) return null;

    return {
      ...app,
      includedAgents,
    } satisfies AppCardModel;
  }, [allAgents]);

  const getModeConfig = useCallback((agentId: string): ModeConfigItem | null => {
    const agent = allAgents.find((item) => item.id === agentId);
    if (!agent) return null;

    const userConfig = modeConfigs[agentId];
    const defaultTools = agent.defaultTools ?? [];

    if (!userConfig) {
      return {
        mode_id: agentId,
        enabled_tools: defaultTools,
        enabled: true,
        default_tools: defaultTools,
      };
    }

    return {
      ...userConfig,
      default_tools: userConfig.default_tools ?? defaultTools,
    };
  }, [allAgents, modeConfigs]);

  const getModeSkills = useCallback((agentId: string): ModeSkillInfo[] => {
    return modeSkills[agentId] ?? [];
  }, [modeSkills]);

  const saveModeConfig = useCallback(async (agentId: string, updates: Partial<ModeConfigItem>) => {
    const config = getModeConfig(agentId);
    if (!config) return;

    const updated = { ...config, ...updates };
    await configAPI.setModeConfig(agentId, updated);
    setModeConfigs((prev) => ({ ...prev, [agentId]: updated }));

    try {
      const { globalEventBus } = await import('@/infrastructure/event-bus');
      globalEventBus.emit('mode:config:updated');
    } catch {
      // ignore
    }
  }, [getModeConfig]);

  const handleSetTools = useCallback(async (agentId: string, toolNames: string[]) => {
    try {
      const agent = allAgents.find((item) => item.id === agentId);
      if (agent?.isAgentApp) {
        const packageData = await agentAppAPI.getAgentApp(agentId, workspacePath || undefined, 'user');
        const updatedTools = Array.from(new Set(toolNames));
        const updatedPackage = await agentAppAPI.updateAgentApp({
          ...packageData.manifest,
          level: 'user',
          tools: updatedTools,
        }, packageData.prompt, workspacePath || undefined);
        setAllAgents((prev) => prev.map((item) => item.id === agentId
          ? enrichAgentCapabilities({
              ...item,
              toolCount: updatedPackage.manifest.tools.length,
              defaultTools: updatedPackage.manifest.tools,
              isReadonly: updatedPackage.manifest.readonly,
              enabled: updatedPackage.manifest.enabled,
              model: updatedPackage.manifest.model,
              iconKey: updatedPackage.manifest.icon,
              isAgentApp: true,
              agentAppLevel: 'user',
              agentAppPath: updatedPackage.path,
            })
          : item));
        return;
      }
      await saveModeConfig(agentId, { enabled_tools: Array.from(new Set(toolNames)) });
    } catch {
      notification.error('Tool update failed');
    }
  }, [allAgents, notification, saveModeConfig, workspacePath]);

  const handleSetAgentEnabled = useCallback(async (agentId: string, enabled: boolean) => {
    try {
      const agent = allAgents.find((item) => item.id === agentId);
      if (!agent?.isAgentApp) return;
      const packageData = await agentAppAPI.getAgentApp(agentId, workspacePath || undefined, 'user');
      const updatedPackage = await agentAppAPI.updateAgentApp({
        ...packageData.manifest,
        level: 'user',
        enabled,
      }, packageData.prompt, workspacePath || undefined);
      setAllAgents((prev) => prev.map((item) => item.id === agentId
        ? enrichAgentCapabilities({
            ...item,
            enabled: updatedPackage.manifest.enabled,
            toolCount: updatedPackage.manifest.tools.length,
            defaultTools: updatedPackage.manifest.tools,
            isReadonly: updatedPackage.manifest.readonly,
            model: updatedPackage.manifest.model,
            iconKey: updatedPackage.manifest.icon,
            isAgentApp: true,
            agentAppLevel: 'user',
            agentAppPath: updatedPackage.path,
          })
        : item));
    } catch {
      notification.error('Agent App status update failed');
    }
  }, [allAgents, notification, workspacePath]);

  const handleResetTools = useCallback(async (agentId: string) => {
    try {
      const agent = allAgents.find((item) => item.id === agentId);
      if (agent?.isAgentApp) {
        await handleSetTools(agentId, ['LS', 'Read', 'Glob', 'Grep']);
        return;
      }
      await configAPI.resetModeConfig(agentId);
      const updated = await configAPI.getModeConfigs();
      const updatedSkills = await configAPI.getModeSkillConfigs({
        modeId: agentId,
        workspacePath: workspacePath || undefined,
      });
      setModeConfigs(updated as Record<string, ModeConfigItem>);
      setModeSkills((prev) => ({ ...prev, [agentId]: updatedSkills }));

      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('mode:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error('Tool reset failed');
    }
  }, [allAgents, handleSetTools, notification, workspacePath]);

  const handleSetSkills = useCallback(async (agentId: string, enabledSkillKeys: string[]) => {
    try {
      await configAPI.replaceModeSkillSelection({
        modeId: agentId,
        enabledSkillKeys,
        workspacePath: workspacePath || undefined,
      });

      const updatedSkills = await configAPI.getModeSkillConfigs({
        modeId: agentId,
        workspacePath: workspacePath || undefined,
      });
      setModeSkills((prev) => ({ ...prev, [agentId]: updatedSkills }));

      try {
        const { globalEventBus } = await import('@/infrastructure/event-bus');
        globalEventBus.emit('mode:config:updated');
      } catch {
        // ignore
      }
    } catch {
      notification.error('Skill update failed');
    }
  }, [notification, workspacePath]);

  return {
    allAgents,
    appCards,
    availableTools,
    getAgentById,
    getAppById,
    getModeConfig,
    getModeSkills,
    handleResetTools,
    handleSetAgentEnabled,
    handleSetSkills,
    handleSetTools,
    loadAppsData,
    detailsLoading,
    loading,
  };
}

