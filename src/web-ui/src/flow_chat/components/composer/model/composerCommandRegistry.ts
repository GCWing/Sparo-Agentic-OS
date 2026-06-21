import type {
  ComposerActionCommandGroup,
  ComposerActionDescriptor,
  ComposerActionSelect,
} from '../actions/composerActionTypes';
import type { ComposerMcpPromptCommand } from './composerCommands';
import type { ComposerOperationIntent, ComposerTargetIntent } from './composerIntentState';

export type ComposerCommandKind =
  | 'target'
  | 'modifier'
  | 'operation'
  | 'agent-switch'
  | 'prompt-template'
  | 'app-action';

export type ComposerCommandGroup = ComposerActionCommandGroup;

export type ComposerCommandSelect =
  | { type: 'set-target'; target: ComposerTargetIntent }
  | { type: 'add-modifier'; modifier: 'goal' }
  | { type: 'set-operation'; operation: ComposerOperationIntent }
  | { type: 'switch-agent'; agentId: string }
  | { type: 'set-prompt-template'; prompt: ComposerMcpPromptCommand }
  | { type: 'dispatch-app-action'; providerId: string; actionId: string; payload?: unknown };

export interface ComposerCommandOption {
  id: string;
  command: `/${string}`;
  title: string;
  description: string;
  group: ComposerCommandGroup;
  groupLabel: string;
  kind: ComposerCommandKind;
  current?: boolean;
  select: ComposerCommandSelect;
}

export interface ComposerCommandContext {
  currentAgent: string;
  hasCurrentSession: boolean;
  hasTargetSession: boolean;
  isBtwSession: boolean;
  isProcessing: boolean;
  supportsGoal: boolean;
}

export interface GetComposerCommandOptionsInput {
  actions: ComposerActionDescriptor[];
  query: string;
}

const GROUP_ORDER: Record<ComposerCommandGroup, number> = {
  target: 1,
  'send-with': 2,
  'session-action': 3,
  app: 4,
  template: 5,
};

function normalizeQuery(query: string): string {
  return query.trim().replace(/^\//, '').toLowerCase();
}

function optionMatchesQuery(option: ComposerCommandOption, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  const commandToken = option.command.slice(1).toLowerCase();
  return (
    commandToken.includes(normalized) ||
    option.title.toLowerCase().includes(normalized) ||
    option.description.toLowerCase().includes(normalized)
  );
}

function isCommandKind(kind: ComposerActionDescriptor['kind']): kind is ComposerCommandKind {
  return (
    kind === 'target' ||
    kind === 'modifier' ||
    kind === 'operation' ||
    kind === 'agent-switch' ||
    kind === 'prompt-template' ||
    kind === 'app-action'
  );
}

function isCommandSelect(select: ComposerActionSelect): select is ComposerCommandSelect {
  return (
    select.type === 'set-target' ||
    select.type === 'add-modifier' ||
    select.type === 'set-operation' ||
    select.type === 'switch-agent' ||
    select.type === 'set-prompt-template' ||
    select.type === 'dispatch-app-action'
  );
}

function actionToCommandOption(action: ComposerActionDescriptor): ComposerCommandOption | null {
  if (
    !action.command ||
    !action.commandGroup ||
    !action.commandGroupLabel ||
    action.availability.state !== 'enabled' ||
    !isCommandKind(action.kind) ||
    !isCommandSelect(action.select)
  ) {
    return null;
  }

  return {
    id: action.id,
    command: action.command,
    title: action.label,
    description: action.description,
    group: action.commandGroup,
    groupLabel: action.commandGroupLabel,
    kind: action.kind,
    current: action.current,
    select: action.select,
  };
}

export function getComposerCommandOptions({
  actions,
  query,
}: GetComposerCommandOptionsInput): ComposerCommandOption[] {
  return actions
    .map(actionToCommandOption)
    .filter((option): option is ComposerCommandOption => option !== null)
    .filter(option => optionMatchesQuery(option, query))
    .sort((a, b) => {
      const groupDelta = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
      if (groupDelta !== 0) return groupDelta;
      return a.command.localeCompare(b.command);
    });
}

export function resolveComposerCommandOption(
  options: ComposerCommandOption[],
  rawToken: string,
): ComposerCommandOption | null {
  const token = rawToken.trim().replace(/^\//, '').toLowerCase();
  if (!token) return null;
  return options.find(option => option.command.slice(1).toLowerCase() === token) ?? null;
}
