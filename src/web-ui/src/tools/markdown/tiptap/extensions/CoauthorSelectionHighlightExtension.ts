import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  coauthorSelectionHighlightPluginKey,
  type CoauthorSelectionHighlightState,
} from './CoauthorSelectionHighlightPluginKey';

function clampHighlight(
  state: CoauthorSelectionHighlightState,
  docSize: number,
): CoauthorSelectionHighlightState | null {
  const from = Math.max(0, Math.min(state.from, docSize));
  const to = Math.max(from, Math.min(state.to, docSize));

  if (from === to) {
    return null;
  }

  return { ...state, from, to };
}

export const CoauthorSelectionHighlightExtension = Extension.create({
  name: 'coauthorSelectionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<CoauthorSelectionHighlightState | null>({
        key: coauthorSelectionHighlightPluginKey,
        state: {
          init: () => null,
          apply: (
            transaction,
            value,
            _oldState: EditorState,
            newState: EditorState,
          ) => {
            const meta = transaction.getMeta(coauthorSelectionHighlightPluginKey);

            if (meta !== undefined) {
              return meta ? clampHighlight(meta as CoauthorSelectionHighlightState, newState.doc.content.size) : null;
            }

            if (!value) {
              return null;
            }

            const mapped = {
              ...value,
              from: transaction.mapping.map(value.from, 1),
              to: transaction.mapping.map(value.to, -1),
            };

            return clampHighlight(mapped, newState.doc.content.size);
          },
        },
        props: {
          decorations: (state) => {
            const highlight = coauthorSelectionHighlightPluginKey.getState(state);
            if (!highlight) {
              return null;
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(
                highlight.from,
                highlight.to,
                {
                  class: 'm-editor-coauthor-selection-highlight',
                  'data-phase': highlight.phase,
                },
              ),
            ]);
          },
        },
      }),
    ];
  },
});
