import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../../reducers/agentReducer';
import type { ComposerMcpPromptCommand } from './composerCommands';
import {
  getComposerCommandOptions,
  resolveComposerCommandOption,
  type ComposerCommandContext,
} from './composerCommandRegistry';

const t = ((_key: string, options?: { defaultValue?: string }) => (
  options?.defaultValue ?? _key
)) as any;

const baseContext: ComposerCommandContext = {
  canSwitchAgents: true,
  currentAgent: 'agentic',
  hasCurrentSession: true,
  hasTargetSession: true,
  isBtwSession: false,
  isProcessing: false,
  supportsGoal: true,
};

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

describe('composerCommandRegistry', () => {
  it('returns semantic command options instead of input text mutations', () => {
    const options = getComposerCommandOptions({
      t,
      context: baseContext,
      incrementalAgents: [debugAgent],
      mcpPromptCommands: [promptCommand],
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

  it('filters by query across command token and visible text', () => {
    const options = getComposerCommandOptions({
      t,
      context: baseContext,
      incrementalAgents: [debugAgent],
      mcpPromptCommands: [promptCommand],
      query: 'brief',
    });

    expect(options.map(option => option.command)).toEqual(['/server:brief']);
  });

  it('applies availability from command context', () => {
    const options = getComposerCommandOptions({
      t,
      context: {
        ...baseContext,
        isBtwSession: true,
        supportsGoal: false,
        isProcessing: true,
      },
      incrementalAgents: [],
      mcpPromptCommands: [],
      query: '',
    });

    expect(options.map(option => option.command)).toEqual([]);
  });
});
