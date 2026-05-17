import { sanitizeRichText } from './richTextPlainText';

export function getRangeByTextOffsets(root: Node, start: number, end: number): Range | null {
  let current = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent || '').length;
      if (startNode === null && start < current + len) {
        startNode = node;
        startOffset = Math.min(start - current, len);
      }
      if (endNode === null && end <= current + len) {
        endNode = node;
        endOffset = Math.min(end - current, len);
        return true;
      }
      current += len;
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }

    return false;
  };

  walk(root);
  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export function getCursorOffset(editor: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return -1;

  const range = selection.getRangeAt(0);
  if (!range.collapsed) return -1;

  const preRange = document.createRange();
  preRange.selectNodeContents(editor);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

export function setCursorOffset(editor: HTMLElement, offset: number) {
  let remaining = offset;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const len = (node.textContent || '').length;
    if (remaining <= len) {
      window.getSelection()?.collapse(node, remaining);
      return;
    }
    remaining -= len;
  }

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function scrubInvisibleTextNodes(editor: HTMLElement): boolean {
  const cursorOffset = getCursorOffset(editor);
  let didClean = false;
  let removedBeforeCursor = 0;
  let charsSoFar = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const original = node.textContent || '';
    const cleaned = sanitizeRichText(original);
    if (cleaned !== original) {
      if (cursorOffset >= 0 && cursorOffset > charsSoFar) {
        const relevantSlice = original.slice(0, Math.min(cursorOffset - charsSoFar, original.length));
        removedBeforeCursor += relevantSlice.length - sanitizeRichText(relevantSlice).length;
      }
      node.textContent = cleaned;
      didClean = true;
    }
    charsSoFar += original.length;
  }

  if (didClean && cursorOffset >= 0) {
    setCursorOffset(editor, Math.max(cursorOffset - removedBeforeCursor, 0));
  }

  return didClean;
}

export function getSelectionRangeInside(editor: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}

export function getOrCreateEditorEndRange(editor: HTMLElement): Range {
  const existing = getSelectionRangeInside(editor);
  if (existing) return existing;

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

export function insertPlainTextAtSelection(editor: HTMLElement | null, text: string) {
  if (!editor) return;

  editor.focus();
  const selection = window.getSelection();
  const range = getOrCreateEditorEndRange(editor);
  range.deleteContents();

  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function collapseSelectionToEnd(editor: HTMLElement) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
