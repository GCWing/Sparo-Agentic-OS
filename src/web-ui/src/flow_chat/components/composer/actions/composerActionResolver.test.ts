import { describe, expect, it } from 'vitest';
import { agenticOsProfile, codingProfile } from '@/app/session-profiles';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import type { AgentInfo } from '../../../reducers/agentReducer';
import { resolveComposerActionModel } from './composerActionResolver';
import {
  registerProfileComposerActionProvider,
  unregisterProfileComposerActionProvider,
} from './providers/profileComposerActionProvider';

const t = ((_key: string, options?: { defaultValue?: string }) => (
  options?.defaultValue ?? _key
)) as any;

const enabledDebugAgent: AgentInfo = {
  id: 'debug',
  name: 'Debug',
  description: 'Debug with evidence',
  isReadonly: false,
  toolCount: 1,
  enabled: true,
};

function baseInput(overrides = {}) {
  return {
    t,
    profile: codingProfile,
    descriptor: SESSION_DESCRIPTORS.coding,
    targetSessionId: 'session-1',
    workspacePath: 'D:/workspace/example',
    storageScope: 'workspace',
    customMetadata: undefined,
    availableAgents: [enabledDebugAgent],
    currentAgent: 'agentic',
    isComposerActive: true,
    hasCurrentSession: true,
    hasTargetSession: true,
    isBtwSession: false,
    isProcessing: false,
    supportsGoal: true,
    mcpPromptCommands: [],
    ...overrides,
  };
}

describe('composerActionResolver', () => {
  it('resolves agent switch actions from profile policy and session descriptor', () => {
    const model = resolveComposerActionModel(baseInput());
    const agentActions = model.actions.filter(action => action.kind === 'agent-switch');

    expect(agentActions.every(action => action.providerId === 'session-agent-switch')).toBe(true);
    expect(agentActions.map(action => action.id)).toEqual([
      'agent:Plan',
      'agent:debug',
      'agent:Team',
    ]);
    expect(agentActions.find(action => action.id === 'agent:debug')?.availability.state).toBe('enabled');
    expect(agentActions.find(action => action.id === 'agent:Plan')?.availability.state).toBe('disabled');
    expect(model.switchableAgents.map(agent => agent.id)).toEqual(['debug']);
  });

  it('normalizes legacy BitFun Coder descriptors before resolving agent actions', () => {
    const model = resolveComposerActionModel(baseInput({
      descriptor: {
        ...SESSION_DESCRIPTORS.coding,
        agentPolicy: {
          defaultAgentId: 'agentic',
          activeAgentId: 'agentic',
          switchableAgentIds: ['agentic'],
        },
      },
    }));
    const agentActions = model.actions.filter(action => action.kind === 'agent-switch');

    expect(agentActions.map(action => action.id)).toEqual([
      'agent:Plan',
      'agent:debug',
      'agent:Team',
    ]);
  });

  it('derives collapsed action-button visibility from composer policy', () => {
    expect(resolveComposerActionModel(baseInput({
      isComposerActive: false,
      isProcessing: false,
    })).actionButtonVisible).toBe(true);

    expect(resolveComposerActionModel(baseInput({
      profile: agenticOsProfile,
      descriptor: SESSION_DESCRIPTORS.agenticOs,
      currentAgent: 'OSAgent',
      isComposerActive: false,
      isProcessing: false,
    })).actionButtonVisible).toBe(false);
  });

  it('does not expose agent switch actions for profiles without composer agent switching', () => {
    const model = resolveComposerActionModel(baseInput({
      profile: agenticOsProfile,
      descriptor: SESSION_DESCRIPTORS.agenticOs,
      availableAgents: [enabledDebugAgent],
      currentAgent: 'OSAgent',
    }));

    expect(model.canSwitchAgents).toBe(false);
    expect(model.actions.some(action => action.kind === 'agent-switch')).toBe(false);
  });

  it('resolves registered profile providers with session metadata', () => {
    registerProfileComposerActionProvider({
      id: 'profile',
      resolve(input) {
        return [{
          id: 'app:diagnostics',
          providerId: 'profile',
          label: 'Send diagnostics',
          description: String(input.customMetadata?.diagnosticsId ?? 'missing'),
          kind: 'app-action',
          icon: 'app',
          order: 500,
          availability: { state: 'enabled' },
          select: {
            type: 'dispatch-app-action',
            providerId: 'profile',
            actionId: 'send-diagnostics',
            payload: {
              sessionId: input.targetSessionId,
              diagnosticsId: input.customMetadata?.diagnosticsId,
            },
          },
          menu: { section: 'app', control: 'row', order: 10 },
          command: '/diagnostics',
          commandGroup: 'app',
          commandGroupLabel: 'App action',
        }];
      },
    });

    try {
      const model = resolveComposerActionModel(baseInput({
        profile: {
          ...codingProfile,
          composer: {
            ...codingProfile.composer,
            providers: ['profile'],
          },
        },
        customMetadata: { diagnosticsId: 'diag-1' },
      }));

      const action = model.actions.find(item => item.id === 'app:diagnostics');
      expect(action?.description).toBe('diag-1');
      expect(action?.select).toEqual({
        type: 'dispatch-app-action',
        providerId: 'profile',
        actionId: 'send-diagnostics',
        payload: {
          sessionId: 'session-1',
          diagnosticsId: 'diag-1',
        },
      });
      expect(model.menuSections.some(section => section.id === 'app')).toBe(true);
    } finally {
      unregisterProfileComposerActionProvider('profile');
    }
  });
});
