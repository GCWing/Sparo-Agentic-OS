import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  COMPOSER_HARD_BREAK_NODE,
  COMPOSER_PARAGRAPH_NODE,
} from './composerDocumentCodec';

export const ComposerDocumentRoot = Node.create({
  name: 'doc',
  topNode: true,
  content: COMPOSER_PARAGRAPH_NODE,
});

export const ComposerParagraph = Node.create({
  name: COMPOSER_PARAGRAPH_NODE,
  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p' }];
  },

  renderHTML() {
    return ['p', 0];
  },
});

export const ComposerText = Node.create({
  name: 'text',
  group: 'inline',
});

export const ComposerHardBreak = Node.create({
  name: COMPOSER_HARD_BREAK_NODE,
  group: 'inline',
  inline: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'br' }];
  },

  renderHTML() {
    return ['br'];
  },

  addKeyboardShortcuts() {
    const insertBreak = () => this.editor.commands.insertContent({ type: this.name });
    return {
      'Shift-Enter': insertBreak,
      'Mod-Enter': insertBreak,
    };
  },
});

/** StarterKit contributes only its battle-tested undo/redo history. */
export const ComposerHistory = StarterKit.configure({
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  document: false,
  dropcursor: false,
  gapcursor: false,
  hardBreak: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  link: false,
  listItem: false,
  listKeymap: false,
  orderedList: false,
  paragraph: false,
  strike: false,
  text: false,
  trailingNode: false,
  underline: false,
  undoRedo: {},
});
