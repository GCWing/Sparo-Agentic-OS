import type { ComposerActionDescriptor } from '../composerActionTypes';
import type { ComposerActionProvider } from './composerActionProviderTypes';
import { availability, builtInAvailability, commandGroupLabel, COMMAND_GROUP_ORDER } from './composerActionProviderUtils';

export const builtInTargetProvider: ComposerActionProvider = {
  id: 'built-in-target',
  resolve(input): ComposerActionDescriptor[] {
    if (!input.hasCurrentSession || input.isBtwSession) return [];

    return [{
      id: 'target:btw-draft',
      providerId: 'built-in-target',
      label: input.t('btw.title', { defaultValue: 'Side question' }),
      description: input.t('chatInput.composerCommands.btwDescription', {
        defaultValue: 'Ask in a focused side thread',
      }),
      kind: 'target',
      icon: 'btw',
      order: COMMAND_GROUP_ORDER.target,
      availability: availability(builtInAvailability(input.profile, 'btw')),
      select: { type: 'set-target', target: 'btw-draft' },
      command: '/btw',
      commandGroup: 'target',
      commandGroupLabel: commandGroupLabel(input.t, 'target'),
      menu: {
        section: 'intent',
        control: 'row',
        order: 10,
        testId: 'chat-input-boost-start-btw',
      },
    }];
  },
};
