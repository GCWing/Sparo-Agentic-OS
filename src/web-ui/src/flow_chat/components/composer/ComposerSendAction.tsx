import { ArrowUp, RotateCcw } from 'lucide-react';
import { Badge, IconButton, Tooltip } from '@/design-system';
import type { SessionDerivedState } from '../../state-machine/types';

interface ComposerSendActionProps {
  derivedState: SessionDerivedState | null;
  hasSendablePayload: boolean;
  labels: {
    sendShortcut: string;
    queueShortcut: string;
    stopGeneration: string;
    retry: string;
  };
  onSendOrCancel: () => void;
  onCancel: () => void;
}

export function ComposerSendAction({
  derivedState,
  hasSendablePayload,
  labels,
  onSendOrCancel,
  onCancel,
}: ComposerSendActionProps) {
  if (!derivedState) {
    return (
      <IconButton
        aria-label={labels.sendShortcut}
        className="sparo-chat-input__send-action"
        disabled
        shape="circle"
        size="small"
        variant="brand"
      >
        <ArrowUp size={11} />
      </IconButton>
    );
  }

  const { sendButtonMode, hasQueuedInput } = derivedState;

  if (sendButtonMode === 'cancel') {
    return (
      <Tooltip content={labels.stopGeneration}>
        <IconButton
          aria-label={labels.stopGeneration}
          className="sparo-chat-input__send-action sparo-chat-input__send-action--breathing"
          onClick={onSendOrCancel}
          data-testid="chat-input-cancel-btn"
          shape="circle"
          size="small"
          variant="ghost"
        >
          <div className="sparo-chat-input__breathing-circle" />
          {hasQueuedInput && <Badge className="sparo-chat-input__queued-badge" variant="accent">1</Badge>}
        </IconButton>
      </Tooltip>
    );
  }

  if (sendButtonMode === 'retry') {
    return (
      <IconButton
        aria-label={labels.retry}
        className="sparo-chat-input__send-action sparo-chat-input__send-action--retry"
        onClick={onSendOrCancel}
        tooltip={labels.retry}
        shape="circle"
        size="small"
      >
        <RotateCcw size={11} />
      </IconButton>
    );
  }

  if (sendButtonMode === 'split') {
    return (
      <span className="sparo-chat-input__split-actions">
        <Tooltip content={labels.stopGeneration}>
          <IconButton
            aria-label={labels.stopGeneration}
            className="sparo-chat-input__send-action sparo-chat-input__send-action--breathing"
            onClick={onCancel}
            data-testid="chat-input-cancel-btn"
            shape="circle"
            size="small"
            variant="ghost"
          >
            <div className="sparo-chat-input__breathing-circle" />
          </IconButton>
        </Tooltip>
        <IconButton
          aria-label={labels.queueShortcut}
          className="sparo-chat-input__send-action"
          onClick={onSendOrCancel}
          disabled={!hasSendablePayload}
          data-testid="chat-input-queue-btn"
          tooltip={labels.queueShortcut}
          shape="circle"
          size="small"
          variant="brand"
        >
          <ArrowUp size={11} />
        </IconButton>
      </span>
    );
  }

  return (
    <IconButton
      aria-label={labels.sendShortcut}
      className="sparo-chat-input__send-action"
      onClick={onSendOrCancel}
      disabled={!hasSendablePayload}
      data-testid="chat-input-send-btn"
      tooltip={labels.sendShortcut}
      shape="circle"
      size="small"
      variant="brand"
    >
      <ArrowUp size={11} />
    </IconButton>
  );
}
