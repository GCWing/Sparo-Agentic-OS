import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, MessageCircleQuestion, MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/design-system';
import { notificationService } from '@/shared/notification-system';
import { copyTextToClipboard } from '@/shared/utils/textSelection';
import { createLogger } from '@/shared/utils/logger';
import { createTransientBtwSession } from '../../services/BtwThreadService';
import { openBtwSessionInAuxPane } from '../../services/childSessionPanels';
import { flowChatStore } from '../../store/FlowChatStore';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { resolveSessionRelationship } from '../../utils/sessionMetadata';
import './FlowChatSelectionAddButton.scss';

interface FlowChatSelectionAddButtonProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

interface SelectionButtonState {
  text: string;
  top: number;
  left: number;
  anchorX: number;
}

const BUTTON_SIZE_PX = 32;
const PILL_FALLBACK_WIDTH_PX = 300;
const VIEWPORT_PADDING_PX = 8;
const SELECTION_GAP_PX = 10;
const log = createLogger('FlowChatSelectionAddButton');

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

function toOneLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function buildDraftSideThreadName(text: string): string {
  const oneLine = toOneLine(text);
  const clipped = oneLine.length > 48 ? `${oneLine.slice(0, 48)}...` : oneLine;
  return clipped || 'Side thread';
}

export const FlowChatSelectionAddButton: React.FC<FlowChatSelectionAddButtonProps> = ({
  containerRef,
}) => {
  const { t } = useTranslation('flow-chat');
  const [buttonState, setButtonState] = useState<SelectionButtonState | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const buttonStateRef = useRef<SelectionButtonState | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const suppressSelectionUpdatesRef = useRef(false);
  const selectionTextRef = useRef('');

  const resetCopyFeedback = useCallback(() => {
    suppressSelectionUpdatesRef.current = false;
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setIsCopied(false);
  }, []);

  const setResolvedButtonState = useCallback((nextState: SelectionButtonState | null) => {
    const previousText = buttonStateRef.current?.text;
    if (!nextState || nextState.text !== previousText) {
      resetCopyFeedback();
    }
    buttonStateRef.current = nextState;
    setButtonState(nextState);
  }, [resetCopyFeedback]);

  const updateSelectionButton = useCallback((options: { allowShow: boolean }) => {
    if (suppressSelectionUpdatesRef.current) {
      return;
    }

    const container = containerRef.current;
    const selection = window.getSelection();

    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setResolvedButtonState(null);
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
      setResolvedButtonState(null);
      selectionTextRef.current = '';
      return;
    }

    const rect = getSelectionRect(range);
    if (!rect) {
      setResolvedButtonState(null);
      selectionTextRef.current = '';
      return;
    }

    const topCandidate = rect.top - BUTTON_SIZE_PX - SELECTION_GAP_PX;
    const top = topCandidate >= VIEWPORT_PADDING_PX
      ? topCandidate
      : rect.bottom + SELECTION_GAP_PX;
    const anchorX = rect.left + rect.width / 2;
    const left = anchorX - PILL_FALLBACK_WIDTH_PX / 2;

    if (!options.allowShow && !buttonStateRef.current) {
      return;
    }

    selectionTextRef.current = selectedText;
    setResolvedButtonState({
      text: selectedText,
      top: clamp(top, VIEWPORT_PADDING_PX, window.innerHeight - BUTTON_SIZE_PX - VIEWPORT_PADDING_PX),
      left: clamp(left, VIEWPORT_PADDING_PX, window.innerWidth - PILL_FALLBACK_WIDTH_PX - VIEWPORT_PADDING_PX),
      anchorX,
    });
  }, [containerRef, setResolvedButtonState]);

  useLayoutEffect(() => {
    if (!buttonState || !toolbarRef.current) {
      return;
    }

    const { width } = toolbarRef.current.getBoundingClientRect();
    if (!width) {
      return;
    }

    const nextLeft = clamp(
      buttonState.anchorX - width / 2,
      VIEWPORT_PADDING_PX,
      window.innerWidth - width - VIEWPORT_PADDING_PX
    );

    if (Math.abs(nextLeft - buttonState.left) > 0.5) {
      setResolvedButtonState({
        ...buttonState,
        left: nextLeft,
      });
    }
  }, [buttonState, setResolvedButtonState]);

  useEffect(() => {
    let frameId: number | null = null;
    const scheduleUpdate = (options: { allowShow: boolean }) => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = null;
        updateSelectionButton(options);
      });
    };
    const scheduleSelectionSettledUpdate = () => scheduleUpdate({ allowShow: true });
    const schedulePassiveUpdate = () => scheduleUpdate({ allowShow: false });
    const hideDuringPointerSelection = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('.flowchat-selection-add-button')) return;
      setResolvedButtonState(null);
      selectionTextRef.current = '';
    };

    document.addEventListener('selectionchange', schedulePassiveUpdate);
    window.addEventListener('pointerdown', hideDuringPointerSelection, true);
    window.addEventListener('pointerup', scheduleSelectionSettledUpdate);
    window.addEventListener('keyup', scheduleSelectionSettledUpdate);
    window.addEventListener('scroll', schedulePassiveUpdate, true);
    window.addEventListener('resize', schedulePassiveUpdate);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      document.removeEventListener('selectionchange', schedulePassiveUpdate);
      window.removeEventListener('pointerdown', hideDuringPointerSelection, true);
      window.removeEventListener('pointerup', scheduleSelectionSettledUpdate);
      window.removeEventListener('keyup', scheduleSelectionSettledUpdate);
      window.removeEventListener('scroll', schedulePassiveUpdate, true);
      window.removeEventListener('resize', schedulePassiveUpdate);
    };
  }, [setResolvedButtonState, updateSelectionButton]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCopySelection = useCallback(async () => {
    const text = selectionTextRef.current || buttonState?.text;
    if (!text) return;

    suppressSelectionUpdatesRef.current = true;

    try {
      const copied = await copyTextToClipboard(text);
      if (!copied) {
        suppressSelectionUpdatesRef.current = false;
        notificationService.error(t('contextMenu.copySelectionFailed', {
          defaultValue: 'Failed to copy selection',
        }));
        return;
      }

      setIsCopied(true);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null;
        suppressSelectionUpdatesRef.current = false;
        window.getSelection()?.removeAllRanges();
        setResolvedButtonState(null);
      }, 560);
    } catch (error) {
      suppressSelectionUpdatesRef.current = false;
      log.error('Failed to copy selected text', { error });
      notificationService.error(t('contextMenu.copySelectionFailed', {
        defaultValue: 'Failed to copy selection',
      }));
    }
  }, [buttonState?.text, setResolvedButtonState, t]);

  const handleAddToChat = useCallback(() => {
    const text = selectionTextRef.current || buttonState?.text;
    if (!text) return;

    window.dispatchEvent(new CustomEvent('append-chat-input', { detail: { text, target: 'main' } }));
    window.getSelection()?.removeAllRanges();
    setResolvedButtonState(null);
  }, [buttonState?.text, setResolvedButtonState]);

  const handleCreateSideQuestion = useCallback(() => {
    const text = selectionTextRef.current || buttonState?.text;
    if (!text) return;

    try {
      const storeState = flowChatStore.getState();
      const parentSessionId = useWorkspaceSurfaceStore.getState().focusedSessionId;
      const parentSession = parentSessionId ? storeState.sessions.get(parentSessionId) : undefined;

      if (!parentSessionId || !parentSession) {
        notificationService.error(t('btw.noSession', { defaultValue: 'No active session for /btw' }));
        return;
      }
      if (resolveSessionRelationship(parentSession).isBtw) {
        notificationService.warning(t('btw.nestedDisabled', { defaultValue: 'Side questions cannot create another side question' }));
        return;
      }

      const workspacePath = parentSession.workspacePath;
      const { childSessionId } = createTransientBtwSession({
        parentSessionId,
        workspacePath,
        childSessionName: buildDraftSideThreadName(text),
        modelId: parentSession.config.modelName,
      });

      openBtwSessionInAuxPane({
        childSessionId,
        parentSessionId,
        workspacePath,
        expand: true,
      });

      window.dispatchEvent(new CustomEvent('fill-chat-input', {
        detail: { message: text, target: 'btw' },
      }));
      window.getSelection()?.removeAllRanges();
      setResolvedButtonState(null);
    } catch (error) {
      log.error('Failed to create side question from selected text', { error });
      notificationService.error(
        error instanceof Error
          ? error.message
          : t('error.unknown', { defaultValue: 'Unknown error' })
      );
    }
  }, [buttonState?.text, setResolvedButtonState, t]);

  if (!buttonState) {
    return null;
  }

  const addToChatLabel = t('contextMenu.addSelectionToChat', {
    defaultValue: 'Add selection to chat',
  });
  const copySelectionLabel = isCopied
    ? t('contextMenu.selectionCopied', { defaultValue: 'Copied' })
    : t('contextMenu.copySelection', { defaultValue: 'Copy selection' });
  const sideQuestionLabel = t('contextMenu.createSideQuestionFromSelection', {
    defaultValue: 'Side question',
  });

  return (
    <div
      ref={toolbarRef}
      className="flowchat-selection-add-button"
      role="toolbar"
      aria-label={t('contextMenu.selectionActions', { defaultValue: 'Selection actions' })}
      style={{
        top: `${buttonState.top}px`,
        left: `${buttonState.left}px`,
      }}
      onPointerDown={event => {
        event.preventDefault();
      }}
    >
      <Tooltip content={copySelectionLabel} placement="top" delay={180} disabled={isCopied}>
        <button
          type="button"
          className={`flowchat-selection-add-button__action flowchat-selection-add-button__copy-action ${isCopied ? 'flowchat-selection-add-button__action--copied' : ''}`}
          onClick={handleCopySelection}
          aria-label={copySelectionLabel}
        >
          {isCopied
            ? <Check size={14} strokeWidth={2.25} aria-hidden />
            : <Copy size={14} strokeWidth={2.25} aria-hidden />}
        </button>
      </Tooltip>
      <span className="flowchat-selection-add-button__divider" aria-hidden />
      <button
        type="button"
        className="flowchat-selection-add-button__action"
        onClick={handleAddToChat}
        title={addToChatLabel}
      >
        <MessageSquarePlus size={14} strokeWidth={2.25} aria-hidden />
        <span>{addToChatLabel}</span>
      </button>
      <span className="flowchat-selection-add-button__divider" aria-hidden />
      <button
        type="button"
        className="flowchat-selection-add-button__action"
        onClick={handleCreateSideQuestion}
        title={sideQuestionLabel}
      >
        <MessageCircleQuestion size={14} strokeWidth={2.25} aria-hidden />
        <span>{sideQuestionLabel}</span>
      </button>
    </div>
  );
};

FlowChatSelectionAddButton.displayName = 'FlowChatSelectionAddButton';
