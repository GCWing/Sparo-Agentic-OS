import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { AgentInfo } from '../../../reducers/agentReducer';
import type {
  SlashActionItem,
  SlashMcpPromptItem,
  SlashAgentItem,
  SlashPickerItem,
} from '../model/composerCommands';

interface UseComposerCommandCatalogParams {
  t: TFunction<'flow-chat'>;
  isBtwSession: boolean;
  canSwitchAgents: boolean;
  incrementalCodeAgents: AgentInfo[];
  mcpPromptCommands: SlashMcpPromptItem[];
  query: string;
}

export function useComposerCommandCatalog({
  t,
  isBtwSession,
  canSwitchAgents,
  incrementalCodeAgents,
  mcpPromptCommands,
  query,
}: UseComposerCommandCatalogParams) {
  const getFilteredActions = useCallback(() => {
    const items: SlashActionItem[] = [
      ...(isBtwSession
        ? []
        : [{
            kind: 'action' as const,
            id: 'btw',
            command: '/btw',
            label: t('btw.title', { defaultValue: 'Side question' }),
          }]),
      {
        kind: 'action',
        id: 'compact',
        command: '/compact',
        label: t('chatInput.compactAction', { defaultValue: 'Compact session' }),
      },
      {
        kind: 'action',
        id: 'init',
        command: '/init',
        label: t('chatInput.initAction', { defaultValue: 'Generate AGENTS.md' }),
      },
    ];

    const q = (query || '').trim().toLowerCase();
    if (!q) return items;

    return items.filter(i => {
      const cmd = i.command.slice(1).toLowerCase();
      return cmd.includes(q) || i.label.toLowerCase().includes(q);
    });
  }, [isBtwSession, query, t]);

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
