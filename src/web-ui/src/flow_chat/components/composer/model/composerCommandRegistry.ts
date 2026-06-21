import type { TFunction } from 'i18next';
import type { AgentInfo } from '../../../reducers/agentReducer';
import type { ComposerMcpPromptCommand } from './composerCommands';
import type { ComposerOperationIntent, ComposerTargetIntent } from './composerIntentState';

export type ComposerCommandKind =
  | 'target'
  | 'modifier'
  | 'operation'
  | 'agent-switch'
  | 'prompt-template';

export type ComposerCommandGroup =
  | 'target'
  | 'send-with'
  | 'session-action'
  | 'template';

export type ComposerCommandSelect =
  | { type: 'set-target'; target: ComposerTargetIntent }
  | { type: 'add-modifier'; modifier: 'goal' }
  | { type: 'set-operation'; operation: ComposerOperationIntent }
  | { type: 'switch-agent'; agentId: string }
  | { type: 'set-prompt-template'; prompt: ComposerMcpPromptCommand };

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
  canSwitchAgents: boolean;
  currentAgent: string;
  hasCurrentSession: boolean;
  hasTargetSession: boolean;
  isBtwSession: boolean;
  isProcessing: boolean;
  supportsGoal: boolean;
}

export interface GetComposerCommandOptionsInput {
  t: TFunction<'flow-chat'>;
  context: ComposerCommandContext;
  incrementalAgents: AgentInfo[];
  mcpPromptCommands: ComposerMcpPromptCommand[];
  query: string;
}

const GROUP_ORDER: Record<ComposerCommandGroup, number> = {
  target: 1,
  'send-with': 2,
  'session-action': 3,
  template: 4,
};

function groupLabel(t: TFunction<'flow-chat'>, group: ComposerCommandGroup): string {
  const defaults: Record<ComposerCommandGroup, string> = {
    target: 'Target',
    'send-with': 'Send with',
    'session-action': 'Session action',
    template: 'Prompt template',
  };
  return t(`chatInput.composerCommands.groups.${group}`, { defaultValue: defaults[group] });
}

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

function builtInCommandOptions(
  t: TFunction<'flow-chat'>,
  context: ComposerCommandContext,
): ComposerCommandOption[] {
  const options: ComposerCommandOption[] = [];

  if (context.hasCurrentSession && !context.isBtwSession) {
    options.push({
      id: 'target:btw-draft',
      command: '/btw',
      title: t('btw.title', { defaultValue: 'Side question' }),
      description: t('chatInput.composerCommands.btwDescription', {
        defaultValue: 'Ask in a focused side thread',
      }),
      group: 'target',
      groupLabel: groupLabel(t, 'target'),
      kind: 'target',
      select: { type: 'set-target', target: 'btw-draft' },
    });
  }

  if (context.supportsGoal) {
    options.push({
      id: 'modifier:goal',
      command: '/goal',
      title: t('chatInput.goalAction', { defaultValue: 'Goal mode' }),
      description: t('chatInput.composerCommands.goalDescription', {
        defaultValue: 'Track this request until completion',
      }),
      group: 'send-with',
      groupLabel: groupLabel(t, 'send-with'),
      kind: 'modifier',
      select: { type: 'add-modifier', modifier: 'goal' },
    });
  }

  if (context.hasTargetSession && !context.isProcessing) {
    options.push(
      {
        id: 'operation:compact',
        command: '/compact',
        title: t('chatInput.compactAction', { defaultValue: 'Compact session' }),
        description: t('chatInput.composerCommands.compactDescription', {
          defaultValue: 'Compress the current session context',
        }),
        group: 'session-action',
        groupLabel: groupLabel(t, 'session-action'),
        kind: 'operation',
        select: { type: 'set-operation', operation: 'compact' },
      },
      {
        id: 'operation:init',
        command: '/init',
        title: t('chatInput.initAction', { defaultValue: 'Generate AGENTS.md' }),
        description: t('chatInput.composerCommands.initDescription', {
          defaultValue: 'Generate or update workspace instructions',
        }),
        group: 'session-action',
        groupLabel: groupLabel(t, 'session-action'),
        kind: 'operation',
        select: { type: 'set-operation', operation: 'init' },
      },
    );
  }

  return options;
}

function agentCommandOptions(
  t: TFunction<'flow-chat'>,
  context: ComposerCommandContext,
  incrementalAgents: AgentInfo[],
): ComposerCommandOption[] {
  if (!context.canSwitchAgents) return [];

  return incrementalAgents.map(agent => ({
    id: `agent:${agent.id}`,
    command: `/${agent.id}` as `/${string}`,
    title: t(`chatInput.agentNames.${agent.id}`, { defaultValue: agent.name }) || agent.name,
    description:
      t(`chatInput.agentDescriptions.${agent.id}`, { defaultValue: '' }) ||
      agent.description ||
      agent.name,
    group: 'send-with',
    groupLabel: groupLabel(t, 'send-with'),
    kind: 'agent-switch',
    current: agent.id === context.currentAgent,
    select: { type: 'switch-agent', agentId: agent.id },
  }));
}

function promptCommandOptions(
  t: TFunction<'flow-chat'>,
  mcpPromptCommands: ComposerMcpPromptCommand[],
): ComposerCommandOption[] {
  return mcpPromptCommands.map(prompt => ({
    id: `prompt:${prompt.id}`,
    command: prompt.command as `/${string}`,
    title: prompt.promptName,
    description: prompt.description?.trim() || `${prompt.serverName} / ${prompt.label}`,
    group: 'template',
    groupLabel: groupLabel(t, 'template'),
    kind: 'prompt-template',
    select: { type: 'set-prompt-template', prompt },
  }));
}

export function getComposerCommandOptions({
  t,
  context,
  incrementalAgents,
  mcpPromptCommands,
  query,
}: GetComposerCommandOptionsInput): ComposerCommandOption[] {
  const options = [
    ...builtInCommandOptions(t, context),
    ...agentCommandOptions(t, context, incrementalAgents),
    ...promptCommandOptions(t, mcpPromptCommands),
  ];

  return options
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
