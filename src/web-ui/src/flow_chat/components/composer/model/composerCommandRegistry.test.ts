import { describe, expect, it } from 'vitest';
import { codingProfile } from '@/app/session-profiles';
import { SESSION_DESCRIPTORS, type SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type { AgentInfo } from '../../../reducers/agentReducer';
import { resolveComposerActionModel } from '../actions/composerActionResolver';
import type { ComposerActionDescriptor } from '../actions/composerActionTypes';
import type { ComposerMcpPromptCommand } from './composerCommands';
import {
  getComposerCommandOptions,
  resolveComposerCommandOption,
} from './composerCommandRegistry';

const t = ((_key: string, options?: { defaultValue?: string }) => (
  options?.defaultValue ?? _key
)) as any;

const debugAgent: AgentInfo = {
  id: 'debug',
  name: 'Debug',
  description: 'Debug with evidence',
  isReadonly: false,
  toolCount: 1,
  enabled: true,
};

const promptCommand: ComposerMcpPromptCommand = {
  kind: 'prompt-template',
  id: 'server:brief',
  command: '/server:brief',
  label: 'Brief',
  serverId: 'server',
  serverName: 'Server',
  promptName: 'brief',
  description: 'Create a brief',
  arguments: [{ name: 'topic', required: true }],
};

function resolveActions({
  descriptor = SESSION_DESCRIPTORS.coding,
  agents = [debugAgent],
  prompts = [promptCommand],
  isBtwSession = false,
  isProcessing = false,
  supportsGoal = true,
}: {
  descriptor?: SessionDescriptor;
  agents?: AgentInfo[];
  prompts?: ComposerMcpPromptCommand[];
  isBtwSession?: boolean;
  isProcessing?: boolean;
  supportsGoal?: boolean;
} = {}): ComposerActionDescriptor[] {
  return resolveComposerActionModel({
    t,
    profile: codingProfile,
    descriptor,
    targetSessionId: 'session-1',
    workspacePath: 'D:/workspace/example',
    storageScope: 'workspace',
    customMetadata: undefined,
    availableAgents: agents,
    currentAgent: descriptor.agentPolicy.activeAgentId,
    isComposerActive: true,
    hasCurrentSession: true,
    hasTargetSession: true,
    isBtwSession,
    isProcessing,
    supportsGoal,
    mcpPromptCommands: prompts,
  }).actions;
}

describe('composerCommandRegistry', () => {
  it('projects semantic action descriptors into slash command options', () => {
    const options = getComposerCommandOptions({
      actions: resolveActions(),
      query: '',
    });

    expect(options.map(option => option.command)).toEqual([
      '/btw',
      '/debug',
      '/goal',
      '/compact',
      '/init',
      '/server:brief',
    ]);
    expect(resolveComposerCommandOption(options, '/goal')?.select).toEqual({
      type: 'add-modifier',
      modifier: 'goal',
    });
    expect(resolveComposerCommandOption(options, '/btw')?.select).toEqual({
      type: 'set-target',
      target: 'btw-draft',
    });
  });

  it('keeps agent commands data-driven instead of filtering to legacy ids', () => {
    const reviewerAgent: AgentInfo = {
      id: 'Reviewer',
      name: 'Reviewer',
      description: 'Review changes',
      isReadonly: false,
      toolCount: 1,
      enabled: true,
    };
    const descriptor: SessionDescriptor = {
      ...SESSION_DESCRIPTORS.coding,
      agentPolicy: {
        defaultAgentId: 'agentic',
        activeAgentId: 'agentic',
        switchableAgentIds: ['agentic', 'Reviewer'],
      },
    };

    const options = getComposerCommandOptions({
      actions: resolveActions({ descriptor, agents: [reviewerAgent], prompts: [] }),
      query: '',
    });

    expect(options.map(option => option.command)).toContain('/Reviewer');
  });

  it('filters by query across command token and visible text', () => {
    const options = getComposerCommandOptions({
      actions: resolveActions(),
      query: 'brief',
    });

    expect(options.map(option => option.command)).toEqual(['/server:brief']);
  });

  it('applies availability from resolved actions', () => {
    const options = getComposerCommandOptions({
      actions: resolveActions({
        isBtwSession: true,
        supportsGoal: false,
        isProcessing: true,
        agents: [],
        prompts: [],
      }),
      query: '',
    });

    expect(options.map(option => option.command)).toEqual([]);
  });

  it('projects app actions when providers expose slash commands', () => {
    const appAction: ComposerActionDescriptor = {
      id: 'app:diagnostics',
      providerId: 'profile',
      label: 'Send diagnostics',
      description: 'Send diagnostics to the current app',
      kind: 'app-action',
      icon: 'app',
      order: 400,
      availability: { state: 'enabled' },
      select: {
        type: 'dispatch-app-action',
        providerId: 'profile',
        actionId: 'send-diagnostics',
        payload: { diagnosticsId: 'diag-1' },
      },
      command: '/diagnostics',
      commandGroup: 'app',
      commandGroupLabel: 'App action',
      menu: { section: 'app', control: 'row', order: 10 },
    };

    const options = getComposerCommandOptions({
      actions: [appAction],
      query: '',
    });

    expect(options).toHaveLength(1);
    expect(options[0]?.kind).toBe('app-action');
    expect(resolveComposerCommandOption(options, '/diagnostics')?.select).toEqual(appAction.select);
  });
});
