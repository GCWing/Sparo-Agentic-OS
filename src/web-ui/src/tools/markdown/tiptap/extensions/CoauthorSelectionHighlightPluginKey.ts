import { PluginKey } from '@tiptap/pm/state';

export type CoauthorSelectionHighlightPhase = 'selected' | 'processing';

export interface CoauthorSelectionHighlightState {
  from: number;
  to: number;
  phase: CoauthorSelectionHighlightPhase;
}

export const coauthorSelectionHighlightPluginKey = new PluginKey<CoauthorSelectionHighlightState | null>(
  'markdownCoauthorSelectionHighlight'
);
