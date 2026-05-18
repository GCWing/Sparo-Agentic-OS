import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/design-system';
import './FlowChatSelectionAddButton.scss';

interface FlowChatSelectionAddButtonProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

interface SelectionButtonState {
  text: string;
  top: number;
  left: number;
}

const BUTTON_SIZE_PX = 32;
const VIEWPORT_PADDING_PX = 8;
const SELECTION_GAP_PX = 10;

function isEditableTarget(node: Node | null): boolean {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return !!element?.closest('input, textarea, select, [contenteditable="true"]');
}

function getSelectionRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }

  const rects = Array.from(range.getClientRects());
  return rects.find(candidate => candidate.width > 0 || candidate.height > 0) ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export const FlowChatSelectionAddButton: React.FC<FlowChatSelectionAddButtonProps> = ({
  containerRef,
}) => {
  const { t } = useTranslation('flow-chat');
  const [buttonState, setButtonState] = useState<SelectionButtonState | null>(null);
  const selectionTextRef = useRef('');

  const updateSelectionButton = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();

    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setButtonState(null);
      selectionTextRef.current = '';
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    if (
      !selectedText ||
      !anchorNode ||
      !focusNode ||
      !container.contains(anchorNode) ||
      !container.contains(focusNode) ||
      isEditableTarget(anchorNode) ||
      isEditableTarget(focusNode)
    ) {
      setButtonState(null);
      selectionTextRef.current = '';
      return;
    }

    const rect = getSelectionRect(range);
    if (!rect) {
      setButtonState(null);
      selectionTextRef.current = '';
      return;
    }

    const topCandidate = rect.top - BUTTON_SIZE_PX - SELECTION_GAP_PX;
    const top = topCandidate >= VIEWPORT_PADDING_PX
      ? topCandidate
      : rect.bottom + SELECTION_GAP_PX;
    const left = rect.left + rect.width / 2 - BUTTON_SIZE_PX / 2;

    selectionTextRef.current = selectedText;
    setButtonState({
      text: selectedText,
      top: clamp(top, VIEWPORT_PADDING_PX, window.innerHeight - BUTTON_SIZE_PX - VIEWPORT_PADDING_PX),
      left: clamp(left, VIEWPORT_PADDING_PX, window.innerWidth - BUTTON_SIZE_PX - VIEWPORT_PADDING_PX),
    });
  }, [containerRef]);

  useEffect(() => {
    let frameId: number | null = null;
    const scheduleUpdate = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = null;
        updateSelectionButton();
      });
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    window.addEventListener('pointerup', scheduleUpdate);
    window.addEventListener('keyup', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      document.removeEventListener('selectionchange', scheduleUpdate);
      window.removeEventListener('pointerup', scheduleUpdate);
      window.removeEventListener('keyup', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [updateSelectionButton]);

  const handleAddToChat = useCallback(() => {
    const text = selectionTextRef.current || buttonState?.text;
    if (!text) return;

    window.dispatchEvent(new CustomEvent('append-chat-input', { detail: { text } }));
    window.getSelection()?.removeAllRanges();
    setButtonState(null);
  }, [buttonState?.text]);

  if (!buttonState) {
    return null;
  }

  const label = t('contextMenu.addSelectionToChat', {
    defaultValue: 'Add selection to chat',
  });

  return (
    <IconButton
      className="flowchat-selection-add-button"
      aria-label={label}
      tooltip={label}
      tooltipPlacement="top"
      tooltipFollowCursor={false}
      variant="brand"
      size="small"
      shape="circle"
      style={{
        top: `${buttonState.top}px`,
        left: `${buttonState.left}px`,
      }}
      onPointerDown={event => {
        event.preventDefault();
      }}
      onClick={handleAddToChat}
    >
      <MessageSquarePlus size={15} strokeWidth={2.25} />
    </IconButton>
  );
};

FlowChatSelectionAddButton.displayName = 'FlowChatSelectionAddButton';
