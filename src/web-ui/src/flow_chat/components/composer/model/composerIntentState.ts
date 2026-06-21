import type { ComposerMcpPromptCommand } from './composerCommands';

export type ComposerTargetIntent = 'main' | 'btw-thread' | 'btw-draft';
export type ComposerModifierIntent = 'goal';
export type ComposerOperationIntent = 'compact' | 'init';

export interface ComposerIntentState {
  target: ComposerTargetIntent;
  modifiers: ComposerModifierIntent[];
  operation: ComposerOperationIntent | null;
  promptTemplate: ComposerMcpPromptCommand | null;
}

export type ComposerIntentAction =
  | { type: 'SET_TARGET'; target: ComposerTargetIntent }
  | { type: 'ADD_MODIFIER'; modifier: ComposerModifierIntent }
  | { type: 'REMOVE_MODIFIER'; modifier: ComposerModifierIntent }
  | { type: 'SET_OPERATION'; operation: ComposerOperationIntent }
  | { type: 'CLEAR_OPERATION' }
  | { type: 'SET_PROMPT_TEMPLATE'; promptTemplate: ComposerMcpPromptCommand }
  | { type: 'CLEAR_PROMPT_TEMPLATE' }
  | { type: 'RESET_TRANSIENT'; keepTarget?: ComposerTargetIntent };

export const INITIAL_COMPOSER_INTENT: ComposerIntentState = {
  target: 'main',
  modifiers: [],
  operation: null,
  promptTemplate: null,
};

export function composerIntentReducer(
  state: ComposerIntentState,
  action: ComposerIntentAction,
): ComposerIntentState {
  switch (action.type) {
    case 'SET_TARGET':
      return { ...state, target: action.target };
    case 'ADD_MODIFIER':
      return state.modifiers.includes(action.modifier)
        ? state
        : { ...state, modifiers: [...state.modifiers, action.modifier] };
    case 'REMOVE_MODIFIER':
      return {
        ...state,
        modifiers: state.modifiers.filter(modifier => modifier !== action.modifier),
      };
    case 'SET_OPERATION':
      return {
        ...state,
        operation: action.operation,
        promptTemplate: null,
      };
    case 'CLEAR_OPERATION':
      return { ...state, operation: null };
    case 'SET_PROMPT_TEMPLATE':
      return {
        ...state,
        operation: null,
        promptTemplate: action.promptTemplate,
      };
    case 'CLEAR_PROMPT_TEMPLATE':
      return { ...state, promptTemplate: null };
    case 'RESET_TRANSIENT':
      return {
        target: action.keepTarget ?? 'main',
        modifiers: [],
        operation: null,
        promptTemplate: null,
      };
    default:
      return state;
  }
}

export function composerSessionTargetFromIntent(target: ComposerTargetIntent) {
  return target === 'btw-thread' ? 'btw' : 'main';
}

export function hasComposerSubmitIntent(intent: ComposerIntentState): boolean {
  return (
    intent.target === 'btw-draft' ||
    intent.modifiers.length > 0 ||
    intent.operation !== null ||
    intent.promptTemplate !== null
  );
}

export function hasComposerGoalModifier(intent: ComposerIntentState): boolean {
  return intent.modifiers.includes('goal');
}
