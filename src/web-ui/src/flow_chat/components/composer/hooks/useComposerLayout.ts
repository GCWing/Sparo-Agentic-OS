import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import type { RichTextInputHandle } from '../../RichTextInput';

interface UseComposerLayoutParams {
  editorRef: RefObject<RichTextInputHandle | null>;
  value: string;
  imageCount: number;
}

function getEditorLineMetrics(editor: HTMLDivElement, measureText?: string) {
  const computed = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 24;
  const clone = editor.cloneNode(true) as HTMLDivElement;
  if (measureText !== undefined) {
    clone.textContent = measureText;
  }
  clone.style.position = 'fixed';
  clone.style.left = '-10000px';
  clone.style.top = '0';
  clone.style.width = `${editor.getBoundingClientRect().width}px`;
  clone.style.height = 'auto';
  clone.style.minHeight = '0';
  clone.style.maxHeight = 'none';
  clone.style.flex = 'none';
  clone.style.overflow = 'visible';
  clone.style.visibility = 'hidden';
  clone.style.pointerEvents = 'none';
  document.body.appendChild(clone);
  const contentHeight = clone.scrollHeight;
  clone.remove();
  return {
    contentHeight,
    lineHeight,
    isTall: contentHeight > lineHeight * 1.5,
  };
}

function normalizeLineBreaks(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function hasCommittedLineBreak(value: string) {
  return normalizeLineBreaks(value).includes('\n');
}

function hasRenderedLineBreak(editor: HTMLDivElement) {
  const renderedText = normalizeLineBreaks(editor.innerText || editor.textContent || '');
  return renderedText.includes('\n') || !!editor.querySelector('br, div, p');
}

function getRenderedEmptyLineCount(editor: HTMLDivElement) {
  const renderedText = normalizeLineBreaks(editor.innerText || editor.textContent || '');
  if (renderedText.length > 0) {
    const withoutBrowserTrailingLine = renderedText.endsWith('\n')
      ? renderedText.slice(0, -1)
      : renderedText;
    return Math.max(1, withoutBrowserTrailingLine.split('\n').length);
  }

  const structuralLines = editor.querySelectorAll('br, div, p').length;
  return Math.max(1, structuralLines);
}

export function useComposerLayout({
  editorRef,
  value,
  imageCount,
}: UseComposerLayoutParams) {
  const [isInputMultiline, setIsInputMultiline] = useState(false);

  const shouldUseMultilineInput = useCallback(() => {
    const editor = editorRef.current?.element;
    if (!editor) {
      return false;
    }

    if (imageCount > 0) {
      return true;
    }

    const renderedMetrics = getEditorLineMetrics(editor);

    if (value.trim().length === 0) {
      return getRenderedEmptyLineCount(editor) > 1;
    }

    const hasVisibleLineBreak =
      (hasCommittedLineBreak(value) || hasRenderedLineBreak(editor)) &&
      renderedMetrics.isTall;

    if (hasVisibleLineBreak) {
      return true;
    }

    return getEditorLineMetrics(editor, value).isTall;
  }, [editorRef, imageCount, value]);

  useLayoutEffect(() => {
    const measureMultiline = () => {
      setIsInputMultiline(shouldUseMultilineInput());
    };

    const editor = editorRef.current?.element;
    let frame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measureMultiline);
    };

    const resizeObserver = editor ? new ResizeObserver(scheduleMeasure) : null;
    const mutationObserver = editor ? new MutationObserver(scheduleMeasure) : null;

    scheduleMeasure();

    if (editor && resizeObserver && mutationObserver) {
      resizeObserver.observe(editor);
      mutationObserver.observe(editor, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [editorRef, shouldUseMultilineInput, value]);

  return {
    isInputMultiline,
  };
}
