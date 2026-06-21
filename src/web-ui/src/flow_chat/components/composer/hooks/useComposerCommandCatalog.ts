import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { AgentInfo } from '../../../reducers/agentReducer';
import type {
  SlashMcpPromptItem,
  SlashAgentItem,
  SlashPickerItem,
} from '../model/composerCommands';
import {
  getBuiltinSlashActionItems,
  type BuiltinSlashCommandContext,
} from '../model/builtinSlashCommands';

interface UseComposerCommandCatalogParams {
  t: TFunction<'flow-chat'>;
  builtinCommandContext: BuiltinSlashCommandContext;
  canSwitchAgents: boolean;
  incrementalCodeAgents: AgentInfo[];
  mcpPromptCommands: SlashMcpPromptItem[];
  query: string;
}

export function useComposerCommandCatalog({
  t,
  builtinCommandContext,
  canSwitchAgents,
  incrementalCodeAgents,
  mcpPromptCommands,
  query,
}: UseComposerCommandCatalogParams) {
  const getFilteredActions = useCallback(() => {
    return getBuiltinSlashActionItems(t, builtinCommandContext, query);
  }, [builtinCommandContext, query, t]);

  const getFilteredMcpPromptCommands = useCallback((): SlashMcpPromptItem[] => {
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      return mcpPromptCommands;
    }

    return mcpPromptCommands.filter(item => {
      const commandToken = item.command.slice(1).toLowerCase();
      return (
        commandToken.includes(q) ||
        item.serverName.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q)
      );
    });
  }, [mcpPromptCommands, query]);

  const resolveTypedMcpPromptCommand = useCallback((text: string): SlashMcpPromptItem | null => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const token = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() || '';
    if (!token) {
      return null;
    }

    return (
      mcpPromptCommands.find(item => item.command.slice(1).toLowerCase() === token) || null
    );
  }, [mcpPromptCommands]);

  const getSlashPickerItems = useCallback((): SlashPickerItem[] => {
    const actions = getFilteredActions();
    const mcpPrompts = getFilteredMcpPromptCommands();
    let agentList = incrementalCodeAgents;
    if (canSwitchAgents && query) {
      const q = query;
      agentList = incrementalCodeAgents.filter(
        agent =>
          agent.name.toLowerCase().includes(q) ||
          agent.id.toLowerCase().includes(q)
      );
    }
    const agents: SlashAgentItem[] = (canSwitchAgents ? agentList : []).map(agent => ({
      kind: 'agent',
      id: agent.id,
      name: agent.name,
    }));
    return [...actions, ...mcpPrompts, ...agents];
  }, [canSwitchAgents, getFilteredActions, getFilteredMcpPromptCommands, incrementalCodeAgents, query]);

  const getFilteredIncrementalAgents = useCallback(() => {
    if (!canSwitchAgents) return [];
    if (!query) return incrementalCodeAgents;
    return incrementalCodeAgents.filter(
      agent =>
        agent.name.toLowerCase().includes(query) ||
        agent.id.toLowerCase().includes(query)
    );
  }, [canSwitchAgents, incrementalCodeAgents, query]);

  return {
    getFilteredActions,
    getFilteredIncrementalAgents,
    getSlashPickerItems,
    resolveTypedMcpPromptCommand,
  };
}
