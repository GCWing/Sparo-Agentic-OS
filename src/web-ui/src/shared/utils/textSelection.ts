 

import { createLogger } from '@/shared/utils/logger';

const log = createLogger('TextSelection');

export interface TextSelection {
  text: string;
  element: HTMLElement;
  range?: Range;
}

 
export const getSelectedText = (): TextSelection | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString().trim();
  
  if (!text) {
    return null;
  }

  const commonAncestor = range.commonAncestorContainer;
  const element = commonAncestor.nodeType === Node.ELEMENT_NODE 
    ? commonAncestor as HTMLElement 
    : commonAncestor.parentElement;

  if (!element) {
    return null;
  }

  return {
    text,
    element,
    range
  };
};

 
export const clearSelection = (): void => {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
};

const copyWithTextareaFallback = (text: string): boolean => {
  const selection = window.getSelection();
  const savedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
    if (selection) {
      selection.removeAllRanges();
      savedRanges.forEach(range => selection.addRange(range));
    }
    activeElement?.focus({ preventScroll: true });
  }
};

 
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        log.warn('Navigator clipboard write failed, trying textarea fallback', { error });
      }
    }

    return copyWithTextareaFallback(text);
  } catch (error) {
    log.error('Failed to copy text to clipboard', error);
    return false;
  }
};

 
export const getElementText = (element: HTMLElement): string => {
  
  if (element.tagName === 'PRE' || element.tagName === 'CODE') {
    return element.textContent || '';
  }
  
  
  return element.innerText || element.textContent || '';
};

 
export const isInFlowChat = (element: HTMLElement): boolean => {
  return element.closest('.flow-chat-container') !== null;
};

 
export const getFlowChatContext = (element: HTMLElement) => {
  const flowChatContainer = element.closest('.flow-chat-container');
  if (!flowChatContainer) {
    return null;
  }

  const dialogTurn = element.closest('.flow-chat-dialog-turn');
  const modelRound = element.closest('.model-round');
  const textBlock = element.closest('.flow-text-block');
  const toolCard = element.closest('.flow-tool-card');
  const userMessage = element.closest('.user-message');

  return {
    container: flowChatContainer as HTMLElement,
    dialogTurn: dialogTurn as HTMLElement | null,
    modelRound: modelRound as HTMLElement | null,
    textBlock: textBlock as HTMLElement | null,
    toolCard: toolCard as HTMLElement | null,
    userMessage: userMessage as HTMLElement | null
  };
};
