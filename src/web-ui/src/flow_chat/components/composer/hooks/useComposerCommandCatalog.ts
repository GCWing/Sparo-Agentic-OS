import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { ModeInfo } from '../../../reducers/modeReducer';
import type {
  SlashActionItem,
  SlashMcpPromptItem,
  SlashModeItem,
  SlashPickerItem,
} from '../model/composerCommands';

interface UseComposerCommandCatalogParams {
  t: TFunction<'flow-chat'>;
  isBtwSession: boolean;
  isDispatcherSession: boolean;
  canSwitchModes: boolean;
  incrementalCodeModes: ModeInfo[];
  mcpPromptCommands: SlashMcpPromptItem[];
  query: string;
}

export function useComposerCommandCatalog({
  t,
  isBtwSession,
  isDispatcherSession,
  canSwitchModes,
  incrementalCodeModes,
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
      ...(isDispatcherSession
        ? [{
            kind: 'action' as const,
            id: 'scan_host',
            command: '/scan_host',
            label: t('chatInput.scanHostAction', { defaultValue: 'Scan host overview' }),
          }]
        : []),
    ];

    const q = (query || '').trim().toLowerCase();
    if (!q) return items;

    return items.filter(i => {
      const cmd = i.command.slice(1).toLowerCase();
      return cmd.includes(q) || i.label.toLowerCase().includes(q);
    });
  }, [isBtwSession, isDispatcherSession, query, t]);

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
    let modeList = incrementalCodeModes;
    if (canSwitchModes && query) {
      const q = query;
      modeList = incrementalCodeModes.filter(
        mode =>
          mode.name.toLowerCase().includes(q) ||
          mode.id.toLowerCase().includes(q)
      );
    }
    const modes: SlashModeItem[] = (canSwitchModes ? modeList : []).map(mode => ({
      kind: 'mode',
      id: mode.id,
      name: mode.name,
    }));
    return [...actions, ...mcpPrompts, ...modes];
  }, [canSwitchModes, getFilteredActions, getFilteredMcpPromptCommands, incrementalCodeModes, query]);

  const getFilteredIncrementalModes = useCallback(() => {
    if (!canSwitchModes) return [];
    if (!query) return incrementalCodeModes;
    return incrementalCodeModes.filter(
      mode =>
        mode.name.toLowerCase().includes(query) ||
        mode.id.toLowerCase().includes(query)
    );
  }, [canSwitchModes, incrementalCodeModes, query]);

  return {
    getFilteredActions,
    getFilteredIncrementalModes,
    getSlashPickerItems,
    resolveTypedMcpPromptCommand,
  };
}
