import type { SlashActionItem } from './composerCommands';

export type BuiltinSlashCommandId = 'btw' | 'compact' | 'init' | 'goal';

export type BuiltinSlashCommandSubmitMode = 'custom' | 'message';

export interface BuiltinSlashCommandContext {
  isBtwSession: boolean;
  supportsGoal: boolean;
}

export interface BuiltinSlashCommandDefinition {
  id: BuiltinSlashCommandId;
  command: `/${string}`;
  labelKey: string;
  defaultLabel: string;
  submitMode: BuiltinSlashCommandSubmitMode;
  requiresTrailingSpaceOnSelect?: boolean;
  available: (context: BuiltinSlashCommandContext) => boolean;
}

export type BuiltinSlashCommandTranslator = (
  key: string,
  options: { defaultValue: string },
) => string;

const alwaysAvailable = () => true;

export const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommandDefinition[] = [
  {
    id: 'btw',
    command: '/btw',
    labelKey: 'btw.title',
    defaultLabel: 'Side question',
    submitMode: 'custom',
    requiresTrailingSpaceOnSelect: true,
    available: ({ isBtwSession }) => !isBtwSession,
  },
  {
    id: 'compact',
    command: '/compact',
    labelKey: 'chatInput.compactAction',
    defaultLabel: 'Compact session',
    submitMode: 'custom',
    available: alwaysAvailable,
  },
  {
    id: 'init',
    command: '/init',
    labelKey: 'chatInput.initAction',
    defaultLabel: 'Generate AGENTS.md',
    submitMode: 'custom',
    available: alwaysAvailable,
  },
  {
    id: 'goal',
    command: '/goal',
    labelKey: 'chatInput.goalAction',
    defaultLabel: 'Goal mode',
    submitMode: 'custom',
    requiresTrailingSpaceOnSelect: true,
    available: ({ supportsGoal }) => supportsGoal,
  },
];

const DEFAULT_CONTEXT: BuiltinSlashCommandContext = {
  isBtwSession: false,
  supportsGoal: true,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandTokenRegExp(command: string): RegExp {
  return new RegExp(`^${escapeRegExp(command)}(?:\\s|$)`, 'i');
}

function getCommandById(id: BuiltinSlashCommandId): BuiltinSlashCommandDefinition {
  const command = BUILTIN_SLASH_COMMANDS.find(item => item.id === id);
  if (!command) {
    throw new Error(`Unknown builtin slash command: ${id}`);
  }
  return command;
}

export function getAvailableBuiltinSlashCommands(
  context: BuiltinSlashCommandContext,
): BuiltinSlashCommandDefinition[] {
  return BUILTIN_SLASH_COMMANDS.filter(command => command.available(context));
}

export function getBuiltinSlashActionItems(
  t: BuiltinSlashCommandTranslator,
  context: BuiltinSlashCommandContext,
  query: string,
): SlashActionItem[] {
  const items = getAvailableBuiltinSlashCommands(context).map(command => ({
    kind: 'action' as const,
    id: command.id,
    command: command.command,
    label: t(command.labelKey, { defaultValue: command.defaultLabel }),
  }));

  const normalizedQuery = (query || '').trim().toLowerCase();
  if (!normalizedQuery) {
    return items;
  }

  return items.filter(item => {
    const commandToken = item.command.slice(1).toLowerCase();
    return commandToken.includes(normalizedQuery) || item.label.toLowerCase().includes(normalizedQuery);
  });
}

export function matchesBuiltinSlashCommand(
  text: string,
  id: BuiltinSlashCommandId,
): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) {
    return false;
  }
  return commandTokenRegExp(getCommandById(id).command).test(trimmed);
}

export function isExactBuiltinSlashCommand(
  text: string,
  id: BuiltinSlashCommandId,
): boolean {
  return text.trim().toLowerCase() === getCommandById(id).command.toLowerCase();
}

export function resolveTypedBuiltinSlashCommand(
  text: string,
  context: BuiltinSlashCommandContext = DEFAULT_CONTEXT,
): BuiltinSlashCommandDefinition | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  return (
    getAvailableBuiltinSlashCommands(context).find(command =>
      commandTokenRegExp(command.command).test(trimmed)
    ) ?? null
  );
}

export function shouldKeepInputOutOfTurnQueue(text: string): boolean {
  return (
    matchesBuiltinSlashCommand(text, 'btw') ||
    matchesBuiltinSlashCommand(text, 'compact') ||
    matchesBuiltinSlashCommand(text, 'goal')
  );
}

export function parseSlashCommandDraft(text: string): {
  hasLeadingSlash: boolean;
  hasWhitespaceAfterCommandToken: boolean;
  query: string;
} {
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return {
      hasLeadingSlash: false,
      hasWhitespaceAfterCommandToken: false,
      query: '',
    };
  }

  const afterSlash = trimmedStart.slice(1);
  const hasWhitespaceAfterCommandToken = /\s/.test(afterSlash);
  const query = afterSlash.trimStart().split(/\s+/, 1)[0]?.toLowerCase() ?? '';

  return {
    hasLeadingSlash: true,
    hasWhitespaceAfterCommandToken,
    query,
  };
}

export function shouldOpenBuiltinActionsWhileProcessing(query: string): boolean {
  return query === '' || query.startsWith('b') || query.startsWith('g');
}

export function buildInputForSelectedBuiltinSlashCommand(
  actionId: string,
  rawInput: string,
  context: BuiltinSlashCommandContext,
): string | null {
  const command = getAvailableBuiltinSlashCommands(context).find(item => item.id === actionId);
  if (!command) {
    return null;
  }

  if (!command.requiresTrailingSpaceOnSelect) {
    return command.command;
  }

  const match = rawInput.match(/^(\s*)\/[^\s]*/);
  if (!match) {
    return `${command.command} `;
  }

  const leadingWhitespace = match[1] || '';
  const rest = rawInput.slice(match[0].length).trimStart();
  return `${leadingWhitespace}${command.command} ${rest}`;
}
