export type ChatInputTarget = 'main' | 'btw';

export interface ComposerCommandInteractionState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
}

export const CLOSED_COMPOSER_COMMAND_INTERACTION: ComposerCommandInteractionState = {
  isOpen: false,
  query: '',
  selectedIndex: 0,
};
