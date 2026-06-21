import { useCallback, useState } from 'react';
import MCPAPI, { type MCPPrompt, type MCPServerInfo } from '@/infrastructure/api/service-api/MCPAPI';
import { createLogger } from '@/shared/utils/logger';
import {
  buildMcpPromptSlashCommand,
  type ComposerMcpPromptCommand,
} from '../model/composerCommands';

const log = createLogger('ComposerMcpPromptCommands');

export function useComposerMcpPromptCommands() {
  const [mcpPromptCommands, setMcpPromptCommands] = useState<ComposerMcpPromptCommand[]>([]);
  const [mcpPromptCommandsLoading, setMcpPromptCommandsLoading] = useState(false);

  const loadMcpPromptCommands = useCallback(async () => {
    setMcpPromptCommandsLoading(true);

    try {
      const servers = await MCPAPI.getServers();
      const connectedServers = servers.filter(
        server => server.status === 'Connected' || server.status === 'Healthy'
      );

      const promptGroups = await Promise.all(
        connectedServers.map(async (server: MCPServerInfo) => {
          try {
            const prompts = await MCPAPI.listPrompts({
              serverId: server.id,
              refresh: true,
            });
            return prompts.map((prompt: MCPPrompt) => ({
              kind: 'prompt-template' as const,
              id: `${server.id}:${prompt.name}`,
              command: buildMcpPromptSlashCommand(server.id, prompt.name),
              label:
                prompt.description?.trim() ||
                `${server.name} MCP prompt`,
              serverId: server.id,
              serverName: server.name,
              promptName: prompt.name,
              description: prompt.description,
              arguments: (prompt.arguments || []).map(argument => ({
                name: argument.name,
                required: argument.required,
                description: argument.description,
              })),
            }));
          } catch (error) {
            log.warn('Failed to load MCP prompts for server', {
              serverId: server.id,
              error,
            });
            return [] as ComposerMcpPromptCommand[];
          }
        })
      );

      setMcpPromptCommands(
        promptGroups
          .flat()
          .sort((a, b) => a.command.localeCompare(b.command))
      );
    } finally {
      setMcpPromptCommandsLoading(false);
    }
  }, []);

  return {
    loadMcpPromptCommands,
    mcpPromptCommands,
    mcpPromptCommandsLoading,
  };
}
