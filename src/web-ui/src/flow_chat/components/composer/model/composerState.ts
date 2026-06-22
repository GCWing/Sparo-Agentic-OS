export type ChatInputTarget = 'main' | 'btw';

export interface ComposerCommandInteractionState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  dismissedTokenKey: string | null;
}

export const CLOSED_COMPOSER_COMMAND_INTERACTION: ComposerCommandInteractionState = {
  isOpen: false,
  query: '',
  selectedIndex: 0,
  dismissedTokenKey: null,
};

export function closeComposerCommandInteraction(
  previous: ComposerCommandInteractionState,
  input?: {
    dismissTokenKey?: string | null;
  },
): ComposerCommandInteractionState {
  return {
    ...CLOSED_COMPOSER_COMMAND_INTERACTION,
    dismissedTokenKey: input?.dismissTokenKey ?? previous.dismissedTokenKey,
  };
}

export function clearComposerCommandInteractionDismissal(
  previous: ComposerCommandInteractionState,
): ComposerCommandInteractionState {
  if (!previous.dismissedTokenKey) {
    return previous.isOpen ? CLOSED_COMPOSER_COMMAND_INTERACTION : previous;
  }

  return CLOSED_COMPOSER_COMMAND_INTERACTION;
}

export function openComposerCommandInteraction(
  previous: ComposerCommandInteractionState,
  input: {
    query: string;
    tokenKey: string | null;
  },
): ComposerCommandInteractionState {
  if (input.tokenKey && previous.dismissedTokenKey === input.tokenKey) {
    return {
      ...CLOSED_COMPOSER_COMMAND_INTERACTION,
      dismissedTokenKey: previous.dismissedTokenKey,
    };
  }

  return {
    isOpen: true,
    query: input.query,
    selectedIndex: previous.query === input.query ? previous.selectedIndex : 0,
    dismissedTokenKey: null,
  };
}
