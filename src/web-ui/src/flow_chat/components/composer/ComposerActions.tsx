import type React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { IconButton } from '@/design-system';

interface ComposerActionsProps {
  left: React.ReactNode;
  sendAction: React.ReactNode;
  isCollapsedProcessing: boolean;
  isExpanded: boolean;
  labels: {
    cancelShortcut: string;
    collapseInput: string;
    expandInput: string;
  };
  onToggleExpand: () => void;
}

export function ComposerActions({
  left,
  sendAction,
  isCollapsedProcessing,
  isExpanded,
  labels,
  onToggleExpand,
}: ComposerActionsProps) {
  return (
    <div className="sparo-chat-input__actions">
      <div className="sparo-chat-input__actions-left">
        {left}
      </div>
      <div className="sparo-chat-input__actions-right">
        {isCollapsedProcessing && (
          <>
            <span className="sparo-chat-input__capsule-divider" />
            <span className="sparo-chat-input__cancel-shortcut">
              <span className="sparo-chat-input__space-key">Esc</span>
              <span>{labels.cancelShortcut}</span>
            </span>
          </>
        )}

        <IconButton
          aria-label={isExpanded ? labels.collapseInput : labels.expandInput}
          className="sparo-chat-input__expand-control"
          variant="ghost"
          size="xs"
          shape="circle"
          onClick={onToggleExpand}
          tooltip={isExpanded ? labels.collapseInput : labels.expandInput}
        >
          {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>

        {sendAction}
      </div>
    </div>
  );
}
