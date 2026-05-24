import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { coauthorCommentPinsPluginKey, type CoauthorCommentPin, type CoauthorCommentPinsState } from './CoauthorCommentPinsPluginKey';

function getBlockStartPosition(doc: ProseMirrorNode, blockId: string): number | null {
  let position: number | null = null;

  doc.forEach((node, offset) => {
    if (typeof node.attrs?.blockId !== 'string' || node.attrs.blockId !== blockId) {
      return;
    }

    position = offset + 1;
  });

  return position;
}

function pinToDecoration(doc: ProseMirrorNode, pin: CoauthorCommentPin, label: string): Decoration | null {
  if (!pin.blockId) {
    return null;
  }

  const position = getBlockStartPosition(doc, pin.blockId);
  if (position === null) {
    return null;
  }

  return Decoration.widget(
    position,
    () => {
      const widget = document.createElement('span');
      widget.className = 'm-editor-rewrite-comment-pin';
      widget.dataset.severity = pin.severity ?? 'info';
      widget.dataset.commentId = pin.id;
      widget.setAttribute('contenteditable', 'false');
      widget.setAttribute('role', 'note');
      widget.setAttribute('aria-label', `${label}: ${pin.message}`);
      widget.title = pin.message;
      widget.textContent = '!';
      return widget;
    },
    {
      key: `coauthor-comment-${pin.id}`,
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
    },
  );
}

export const CoauthorCommentPinsExtension = Extension.create({
  name: 'coauthorCommentPins',

  addProseMirrorPlugins() {
    return [
      new Plugin<CoauthorCommentPinsState | null>({
        key: coauthorCommentPinsPluginKey,
        state: {
          init: () => null,
          apply: (
            transaction,
            value,
            _oldState: EditorState,
            newState: EditorState,
          ) => {
            const meta = transaction.getMeta(coauthorCommentPinsPluginKey);

            if (meta !== undefined) {
              return meta as CoauthorCommentPinsState | null;
            }

            if (!value) {
              return null;
            }

            const pins = value.pins.filter(pin => (
              pin.blockId ? getBlockStartPosition(newState.doc, pin.blockId) !== null : false
            ));

            return pins.length > 0 ? { ...value, pins } : null;
          },
        },
        props: {
          decorations: (state) => {
            const pinsState = coauthorCommentPinsPluginKey.getState(state);
            if (!pinsState || pinsState.pins.length === 0) {
              return null;
            }

            const decorations = pinsState.pins
              .map(pin => pinToDecoration(state.doc, pin, pinsState.labels.comment))
              .filter((decoration): decoration is Decoration => !!decoration);

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
