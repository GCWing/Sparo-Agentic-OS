import { PluginKey } from '@tiptap/pm/state';

export const COAUTHOR_INLINE_SUGGESTION_EVENT = 'sparo:coauthor-inline-suggestion';

export interface CoauthorInlineSuggestion {
  opId: string;
  type: 'replaceRange' | 'insertAt' | 'deleteRange';
  from: number;
  to: number;
  markdown?: string;
  reason?: string;
}

export interface CoauthorInlineSuggestionsState {
  suggestions: CoauthorInlineSuggestion[];
  labels: {
    accept: string;
    reject: string;
    proposed: string;
    streaming: string;
  };
}

export const coauthorInlineSuggestionsPluginKey = new PluginKey<CoauthorInlineSuggestionsState | null>(
  'meditorCoauthorInlineSuggestions'
);
