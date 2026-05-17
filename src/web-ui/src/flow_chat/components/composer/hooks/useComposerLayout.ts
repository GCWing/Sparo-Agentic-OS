import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import type { RichTextInputHandle } from '../../RichTextInput';

interface UseComposerLayoutParams {
  editorRef: RefObject<RichTextInputHandle | null>;
  value: string;
  imageCount: number;
}

function getEditorLineMetrics(editor: HTMLDivElement) {
  const computed = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 24;
  const clone = editor.cloneNode(true) as HTMLDivElement;
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

    const { isTall } = getEditorLineMetrics(editor);
    const editorText = editor.innerText || editor.textContent || '';
    const hasExplicitLineBreak =
      value.includes('\n') ||
      (editorText.includes('\n') && isTall);
    return hasExplicitLineBreak || imageCount > 0 || isTall;
  }, [editorRef, imageCount, value]);

  const canCollapseToSingleLineInput = useCallback(() => {
    const editor = editorRef.current?.element;
    const editorText = editor?.innerText || editor?.textContent || '';
    const metrics = editor ? getEditorLineMetrics(editor) : null;
    const hasVisibleLineBreak =
      value.includes('\n') ||
      (editorText.includes('\n') && !!metrics?.isTall);

    if (hasVisibleLineBreak || imageCount > 0) {
      return false;
    }

    if (!editor) {
      return true;
    }

    return !metrics?.isTall;
  }, [editorRef, imageCount, value]);

  useLayoutEffect(() => {
    const measureMultiline = () => {
      const shouldUseMultiline = shouldUseMultilineInput();
      const editor = editorRef.current?.element;
      const isFocused = !!editor && editor.contains(document.activeElement);
      setIsInputMultiline(prev => {
        if (shouldUseMultiline) {
          return true;
        }
        if (prev && isFocused && value.trim().length > 0) {
          return true;
        }
        return false;
      });
    };

    const frame = window.requestAnimationFrame(measureMultiline);
    const editor = editorRef.current?.element;
    const observer = editor ? new ResizeObserver(measureMultiline) : null;
    if (editor && observer) {
      observer.observe(editor);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [editorRef, shouldUseMultilineInput, value]);

  return {
    canCollapseToSingleLineInput,
    isInputMultiline,
    setIsInputMultiline,
  };
}
