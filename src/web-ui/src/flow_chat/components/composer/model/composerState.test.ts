import { describe, expect, it } from 'vitest';
import {
  clearComposerCommandInteractionDismissal,
  closeComposerCommandInteraction,
  openComposerCommandInteraction,
  type ComposerCommandInteractionState,
} from './composerState';

describe('composer command interaction state', () => {
  it('keeps a dismissed slash token closed when an older open attempt runs later', () => {
    const dismissedState: ComposerCommandInteractionState = {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: 'start:0:2:/g',
    };

    expect(openComposerCommandInteraction(dismissedState, {
      query: 'g',
      tokenKey: 'start:0:2:/g',
    })).toEqual(dismissedState);
  });

  it('opens again when the slash token changes after dismissal', () => {
    const dismissedState: ComposerCommandInteractionState = {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: 'start:0:2:/g',
    };

    expect(openComposerCommandInteraction(dismissedState, {
      query: 'go',
      tokenKey: 'start:0:3:/go',
    })).toEqual({
      isOpen: true,
      query: 'go',
      selectedIndex: 0,
      dismissedTokenKey: null,
    });
  });

  it('clears a dismissed slash token when the token leaves the input', () => {
    const dismissedState: ComposerCommandInteractionState = {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: 'start:0:1:/',
    };

    expect(clearComposerCommandInteractionDismissal(dismissedState)).toEqual({
      isOpen: false,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: null,
    });
  });

  it('opens the same slash token again after the previous token lifecycle is cleared', () => {
    const dismissedState: ComposerCommandInteractionState = closeComposerCommandInteraction({
      isOpen: true,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: null,
    }, {
      dismissTokenKey: 'start:0:1:/',
    });
    const tokenGoneState = clearComposerCommandInteractionDismissal(dismissedState);

    expect(openComposerCommandInteraction(tokenGoneState, {
      query: '',
      tokenKey: 'start:0:1:/',
    })).toEqual({
      isOpen: true,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: null,
    });
  });
});
