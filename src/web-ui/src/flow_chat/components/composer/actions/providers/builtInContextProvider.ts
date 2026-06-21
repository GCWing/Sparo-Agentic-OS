import type { ComposerActionDescriptor } from '../composerActionTypes';
import type { ComposerActionProvider } from './composerActionProviderTypes';
import { availability, builtInAvailability } from './composerActionProviderUtils';

export const builtInContextProvider: ComposerActionProvider = {
  id: 'built-in-context',
  resolve(input): ComposerActionDescriptor[] {
    return [
      {
        id: 'builtin:attach-context',
        providerId: 'built-in-context',
        label: input.t('chatInput.boostAddContext', { defaultValue: 'Add context' }),
        description: input.t('chatInput.composerCommands.contextDescription', {
          defaultValue: 'Attach workspace files or folders',
        }),
        kind: 'attach-context',
        icon: 'context',
        order: 10,
        availability: availability(builtInAvailability(input.profile, 'attach-context')),
        select: { type: 'open-context-picker' },
        menu: { section: 'context', control: 'row', order: 10 },
      },
      {
        id: 'builtin:attach-image',
        providerId: 'built-in-context',
        label: input.t('input.addImage', { defaultValue: 'Add image' }),
        description: input.t('chatInput.composerCommands.imageDescription', {
          defaultValue: 'Attach an image to the next message',
        }),
        kind: 'attach-image',
        icon: 'image',
        order: 20,
        availability: availability(builtInAvailability(input.profile, 'attach-image')),
        select: { type: 'pick-image' },
        menu: { section: 'context', control: 'row', order: 20 },
      },
      {
        id: 'builtin:skills',
        providerId: 'built-in-context',
        label: input.t('chatInput.boostSkills', { defaultValue: 'Skills' }),
        description: input.t('chatInput.composerCommands.skillsDescription', {
          defaultValue: 'Insert a skill mention',
        }),
        kind: 'skills',
        icon: 'skills',
        order: 30,
        availability: availability(builtInAvailability(input.profile, 'skills')),
        select: { type: 'open-skills-flyout' },
        menu: { section: 'context', control: 'submenu', order: 30 },
      },
    ];
  },
};
