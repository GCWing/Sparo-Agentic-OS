import type { ComposerActionDescriptor } from '../composerActionTypes';
import type { ComposerActionProvider } from './composerActionProviderTypes';
import { availability, builtInAvailability, commandGroupLabel, COMMAND_GROUP_ORDER } from './composerActionProviderUtils';

export const builtInOperationProvider: ComposerActionProvider = {
  id: 'built-in-operation',
  resolve(input): ComposerActionDescriptor[] {
    const actions: ComposerActionDescriptor[] = [];

    if (input.supportsGoal) {
      actions.push({
        id: 'modifier:goal',
        providerId: 'built-in-operation',
        label: input.t('chatInput.goalAction', { defaultValue: 'Goal mode' }),
        description: input.t('chatInput.composerCommands.goalDescription', {
          defaultValue: 'Track this request until completion',
        }),
        kind: 'modifier',
        icon: 'goal',
        order: COMMAND_GROUP_ORDER['send-with'] - 10,
        availability: availability(builtInAvailability(input.profile, 'goal')),
        select: { type: 'add-modifier', modifier: 'goal' },
        command: '/goal',
        commandGroup: 'send-with',
        commandGroupLabel: commandGroupLabel(input.t, 'send-with'),
        menu: { section: 'intent', control: 'row', order: 20 },
      });
    }

    if (input.hasTargetSession && !input.isProcessing) {
      actions.push(
        {
          id: 'operation:compact',
          providerId: 'built-in-operation',
          label: input.t('chatInput.compactAction', { defaultValue: 'Compact session' }),
          description: input.t('chatInput.composerCommands.compactDescription', {
            defaultValue: 'Compress the current session context',
          }),
          kind: 'operation',
          icon: 'compact',
          order: COMMAND_GROUP_ORDER['session-action'],
          availability: availability(builtInAvailability(input.profile, 'compact')),
          select: { type: 'set-operation', operation: 'compact' },
          command: '/compact',
          commandGroup: 'session-action',
          commandGroupLabel: commandGroupLabel(input.t, 'session-action'),
          menu: { section: 'intent', control: 'row', order: 30 },
        },
        {
          id: 'operation:init',
          providerId: 'built-in-operation',
          label: input.t('chatInput.initAction', { defaultValue: 'Generate AGENTS.md' }),
          description: input.t('chatInput.composerCommands.initDescription', {
            defaultValue: 'Generate or update workspace instructions',
          }),
          kind: 'operation',
          icon: 'init',
          order: COMMAND_GROUP_ORDER['session-action'] + 1,
          availability: availability(builtInAvailability(input.profile, 'init')),
          select: { type: 'set-operation', operation: 'init' },
          command: '/init',
          commandGroup: 'session-action',
          commandGroupLabel: commandGroupLabel(input.t, 'session-action'),
          menu: { section: 'intent', control: 'row', order: 40 },
        },
      );
    }

    return actions;
  },
};
