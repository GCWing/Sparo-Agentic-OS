import type { ComposerActionDescriptor } from '../composerActionTypes';
import type { ComposerActionProvider } from './composerActionProviderTypes';
import { availability, builtInAvailability, commandGroupLabel, COMMAND_GROUP_ORDER } from './composerActionProviderUtils';

export const mcpPromptProvider: ComposerActionProvider = {
  id: 'mcp-prompt',
  resolve(input): ComposerActionDescriptor[] {
    return input.mcpPromptCommands.map(prompt => ({
      id: `prompt:${prompt.id}`,
      providerId: 'mcp-prompt',
      label: prompt.promptName,
      description: prompt.description?.trim() || `${prompt.serverName} / ${prompt.label}`,
      kind: 'prompt-template',
      icon: 'prompt',
      order: COMMAND_GROUP_ORDER.template,
      availability: availability(builtInAvailability(input.profile, 'prompt-template')),
      select: { type: 'set-prompt-template', prompt },
      command: prompt.command as `/${string}`,
      commandGroup: 'template',
      commandGroupLabel: commandGroupLabel(input.t, 'template'),
    }));
  },
};
