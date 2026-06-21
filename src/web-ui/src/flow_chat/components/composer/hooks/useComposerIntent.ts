import { useCallback, useMemo, useReducer } from 'react';
import type { ComposerCommandOption } from '../model/composerCommandRegistry';
import {
  composerIntentReducer,
  hasComposerSubmitIntent,
  INITIAL_COMPOSER_INTENT,
  type ComposerModifierIntent,
  type ComposerOperationIntent,
  type ComposerTargetIntent,
} from '../model/composerIntentState';
import type { ComposerMcpPromptCommand } from '../model/composerCommands';

export function useComposerIntent() {
  const [intent, dispatch] = useReducer(composerIntentReducer, INITIAL_COMPOSER_INTENT);

  const actions = useMemo(() => ({
    setTarget: (target: ComposerTargetIntent) => dispatch({ type: 'SET_TARGET', target }),
    addModifier: (modifier: ComposerModifierIntent) => dispatch({ type: 'ADD_MODIFIER', modifier }),
    removeModifier: (modifier: ComposerModifierIntent) => dispatch({ type: 'REMOVE_MODIFIER', modifier }),
    setOperation: (operation: ComposerOperationIntent) => dispatch({ type: 'SET_OPERATION', operation }),
    clearOperation: () => dispatch({ type: 'CLEAR_OPERATION' }),
    setPromptTemplate: (promptTemplate: ComposerMcpPromptCommand) => {
      dispatch({ type: 'SET_PROMPT_TEMPLATE', promptTemplate });
    },
    clearPromptTemplate: () => dispatch({ type: 'CLEAR_PROMPT_TEMPLATE' }),
    resetTransient: (keepTarget?: ComposerTargetIntent) => {
      dispatch({ type: 'RESET_TRANSIENT', keepTarget });
    },
  }), []);

  const applyCommandOption = useCallback((option: ComposerCommandOption) => {
    const select = option.select;

    switch (select.type) {
      case 'set-target':
        dispatch({ type: 'SET_TARGET', target: select.target });
        break;
      case 'add-modifier':
        dispatch({ type: 'ADD_MODIFIER', modifier: select.modifier });
        break;
      case 'set-operation':
        dispatch({ type: 'SET_OPERATION', operation: select.operation });
        break;
      case 'set-prompt-template':
        dispatch({ type: 'SET_PROMPT_TEMPLATE', promptTemplate: select.prompt });
        break;
      case 'switch-agent':
        break;
      default:
        break;
    }
  }, []);

  return {
    intent,
    intentActions: actions,
    applyCommandOption,
    hasSubmitIntent: hasComposerSubmitIntent(intent),
  };
}
