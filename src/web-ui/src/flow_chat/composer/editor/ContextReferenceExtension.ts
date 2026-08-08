import { mergeAttributes, Node, type NodeViewRendererProps } from '@tiptap/core';
import { COMPOSER_CONTEXT_REFERENCE_NODE } from './composerDocumentCodec';

export interface ContextReferenceExtensionOptions {
  createElement: (referenceId: string) => HTMLSpanElement;
  updateElement: (element: HTMLSpanElement, referenceId: string) => void;
}

function referenceIdFromNode(node: NodeViewRendererProps['node']): string {
  return typeof node.attrs.referenceId === 'string' ? node.attrs.referenceId : '';
}

export const ContextReferenceExtension = Node.create<ContextReferenceExtensionOptions>({
  name: COMPOSER_CONTEXT_REFERENCE_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      createElement: referenceId => {
        const element = document.createElement('span');
        element.dataset.referenceId = referenceId;
        return element;
      },
      updateElement: () => {},
    };
  },

  addAttributes() {
    return {
      referenceId: {
        default: null,
        parseHTML: element => element.getAttribute('data-reference-id'),
        renderHTML: attributes => ({ 'data-reference-id': attributes.referenceId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-composer-context-reference]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-composer-context-reference': '',
        contenteditable: 'false',
      }),
    ];
  },

  renderText() {
    return '';
  },

  addNodeView() {
    return ({ node }) => {
      let referenceId = referenceIdFromNode(node);
      const dom = this.options.createElement(referenceId);
      dom.setAttribute('data-composer-context-reference', '');
      dom.contentEditable = 'false';

      return {
        dom,
        update: nextNode => {
          if (nextNode.type.name !== this.name) return false;
          referenceId = referenceIdFromNode(nextNode);
          this.options.updateElement(dom, referenceId);
          return true;
        },
        selectNode: () => dom.classList.add('rich-text-tag-pill--selected'),
        deselectNode: () => dom.classList.remove('rich-text-tag-pill--selected'),
        stopEvent: event => event.target instanceof Element && Boolean(event.target.closest('button')),
        ignoreMutation: () => true,
      };
    };
  },
});
