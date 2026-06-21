import type { ComposerActionDescriptor } from '../composerActionTypes';
import { normalizeSessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type { ComposerActionProvider } from './composerActionProviderTypes';
import {
  availability,
  commandGroupLabel,
  COMMAND_GROUP_ORDER,
  getAgentDescription,
  getAgentLabel,
} from './composerActionProviderUtils';

export const sessionAgentSwitchProvider: ComposerActionProvider = {
  id: 'session-agent-switch',
  resolve(input): ComposerActionDescriptor[] {
    const switching = input.profile.composer?.agentSwitching ?? { mode: 'disabled' as const };
    const descriptor = input.descriptor ? normalizeSessionDescriptor(input.descriptor) : null;
    const policy = descriptor?.agentPolicy;
    if (switching.mode !== 'in-session' || !policy || policy.switchableAgentIds.length <= 1) {
      return [];
    }

    const allowedIds = new Set(policy.switchableAgentIds);
    const orderedIds = switching.order
      ? [
          ...switching.order.filter(agentId => allowedIds.has(agentId)),
          ...policy.switchableAgentIds.filter(agentId => !switching.order?.includes(agentId)),
        ]
      : policy.switchableAgentIds;
    const switchableIds = orderedIds.filter(agentId => (
      switching.includeDefaultAgent || agentId !== policy.defaultAgentId
    ));
    const agentsById = new Map(input.availableAgents.map(agent => [agent.id, agent]));

    return switchableIds.map((agentId, index): ComposerActionDescriptor => {
      const agent = agentsById.get(agentId);
      const enabled = Boolean(agent?.enabled);
      const label = agent ? getAgentLabel(input.t, agent) : getAgentLabel(input.t, agentId);
      const description = agent ? getAgentDescription(input.t, agent) : label;

      return {
        id: `agent:${agentId}`,
        providerId: 'session-agent-switch',
        label,
        description,
        kind: 'agent-switch',
        icon: 'agent',
        order: COMMAND_GROUP_ORDER['send-with'] + index,
        current: switching.showCurrentAgent !== false && input.currentAgent === agentId,
        availability: enabled
          ? availability('enabled')
          : availability('disabled', input.t('chatInput.agentUnavailable', {
            defaultValue: 'Agent unavailable in this runtime',
          })),
        select: { type: 'switch-agent', agentId },
        command: `/${agentId}` as `/${string}`,
        commandGroup: 'send-with',
        commandGroupLabel: commandGroupLabel(input.t, 'send-with'),
        menu: {
          section: 'agent',
          control: 'row',
          order: index,
        },
      };
    });
  },
};
