import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  COAUTHOR_INLINE_SUGGESTION_EVENT,
  coauthorInlineSuggestionsPluginKey,
  type CoauthorInlineSuggestion,
  type CoauthorInlineSuggestionsState,
} from './CoauthorInlineSuggestionsPluginKey';

function dispatchInlineAction(opId: string, action: 'accept' | 'reject'): void {
  window.dispatchEvent(new CustomEvent(COAUTHOR_INLINE_SUGGESTION_EVENT, {
    detail: { opId, action },
  }));
}

function createSuggestionWidget(
  suggestion: CoauthorInlineSuggestion,
  labels: CoauthorInlineSuggestionsState['labels'],
): HTMLElement {
  const widget = document.createElement('span');
  widget.className = 'm-editor-inline-rewrite';
  widget.dataset.opType = suggestion.type;
  widget.dataset.streaming = suggestion.reason === '__streaming__' ? 'true' : 'false';
  widget.setAttribute('contenteditable', 'false');

  if (suggestion.markdown) {
    const preview = document.createElement('span');
    preview.className = 'm-editor-inline-rewrite__preview';
    preview.textContent = suggestion.markdown;
    preview.setAttribute('aria-label', labels.proposed);
    widget.appendChild(preview);
  }

  if (suggestion.reason === '__streaming__') {
    const streaming = document.createElement('span');
    streaming.className = 'm-editor-inline-rewrite__streaming';
    streaming.textContent = labels.streaming;
    widget.appendChild(streaming);
  }

  const actions = document.createElement('span');
  actions.className = 'm-editor-inline-rewrite__actions';

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'm-editor-inline-rewrite__button';
  accept.textContent = 'OK';
  accept.title = labels.accept;
  accept.setAttribute('aria-label', labels.accept);
  accept.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  accept.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    dispatchInlineAction(suggestion.opId, 'accept');
  });

  const reject = document.createElement('button');
  reject.type = 'button';
  reject.className = 'm-editor-inline-rewrite__button';
  reject.textContent = 'X';
  reject.title = labels.reject;
  reject.setAttribute('aria-label', labels.reject);
  reject.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  reject.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    dispatchInlineAction(suggestion.opId, 'reject');
  });

  actions.append(accept, reject);
  widget.appendChild(actions);

  if (suggestion.reason && suggestion.reason !== '__streaming__') {
    widget.title = suggestion.reason;
  }

  return widget;
}

export const CoauthorInlineSuggestionsExtension = Extension.create({
  name: 'coauthorInlineSuggestions',

  addProseMirrorPlugins() {
    return [
      new Plugin<CoauthorInlineSuggestionsState | null>({
        key: coauthorInlineSuggestionsPluginKey,
        state: {
          init: () => null,
          apply: (
            transaction,
            value,
            _oldState: EditorState,
            newState: EditorState,
          ) => {
            const meta = transaction.getMeta(coauthorInlineSuggestionsPluginKey);

            if (meta !== undefined) {
              return meta as CoauthorInlineSuggestionsState | null;
            }

            if (!value) {
              return null;
            }

            const docSize = newState.doc.content.size;
            const suggestions = value.suggestions.filter(suggestion => (
              suggestion.from >= 0 &&
              suggestion.to >= suggestion.from &&
              suggestion.to <= docSize
            ));

            return suggestions.length > 0 ? { ...value, suggestions } : null;
          },
        },
        props: {
          decorations: (state) => {
            const inlineState = coauthorInlineSuggestionsPluginKey.getState(state);
            if (!inlineState || inlineState.suggestions.length === 0) {
              return null;
            }

            const decorations: Decoration[] = [];
            for (const suggestion of inlineState.suggestions) {
              if (suggestion.from < suggestion.to) {
                decorations.push(Decoration.inline(
                  suggestion.from,
                  suggestion.to,
                  {
                    class: `m-editor-inline-rewrite-range m-editor-inline-rewrite-range--${suggestion.type}`,
                    'data-coauthor-op-id': suggestion.opId,
                  },
                ));
              }

              decorations.push(Decoration.widget(
                suggestion.to,
                () => createSuggestionWidget(suggestion, inlineState.labels),
                {
                  key: `coauthor-inline-${suggestion.opId}`,
                  side: 1,
                  ignoreSelection: true,
                  stopEvent: () => true,
                },
              ));
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
