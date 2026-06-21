import type { TFunction } from 'i18next';
import type { SessionComposerBuiltinActionId, SessionProfile } from '@/app/session-profiles';
import type { AgentInfo } from '../../../../reducers/agentReducer';
import type {
  ComposerActionAvailability,
  ComposerActionCommandGroup,
} from '../composerActionTypes';

export const COMMAND_GROUP_ORDER: Record<ComposerActionCommandGroup, number> = {
  target: 100,
  'send-with': 200,
  'session-action': 300,
  app: 400,
  template: 500,
};

export function commandGroupLabel(
  t: TFunction<'flow-chat'>,
  group: ComposerActionCommandGroup,
): string {
  const defaults: Record<ComposerActionCommandGroup, string> = {
    target: 'Target',
    'send-with': 'Send with',
    'session-action': 'Session action',
    app: 'App action',
    template: 'Prompt template',
  };
  return t(`chatInput.composerCommands.groups.${group}`, { defaultValue: defaults[group] });
}

export function availability(
  state: ComposerActionAvailability['state'],
  reason?: string,
): ComposerActionAvailability {
  return reason ? { state, reason } : { state };
}

export function builtInAvailability(
  profile: SessionProfile,
  actionId: SessionComposerBuiltinActionId,
): ComposerActionAvailability['state'] {
  return profile.composer?.builtIns?.[actionId] ?? 'enabled';
}

export function getAgentLabel(t: TFunction<'flow-chat'>, agent: AgentInfo | string): string {
  if (typeof agent === 'string') {
    return t(`chatInput.agentNames.${agent}`, { defaultValue: agent }) || agent;
  }
  return t(`chatInput.agentNames.${agent.id}`, { defaultValue: '' }) || agent.name;
}

export function getAgentDescription(t: TFunction<'flow-chat'>, agent: AgentInfo): string {
  return (
    t(`chatInput.agentDescriptions.${agent.id}`, { defaultValue: '' }) ||
    agent.description ||
    agent.name
  );
}
