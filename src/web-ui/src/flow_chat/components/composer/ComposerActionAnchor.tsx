import type React from 'react';
import { Plus, X } from 'lucide-react';
import { IconButton, Tooltip } from '@/design-system';

interface ComposerActionAnchorLabels {
  addBoostTooltip: string;
  resetAgent: string;
  switchAgent: string;
}

interface ComposerActionAnchorProps {
  dropdownOpen: boolean;
  selectedAgentLabel?: string | null;
  labels: ComposerActionAnchorLabels;
  onToggleDropdown: (event: React.MouseEvent) => void;
  onResetAgent: (event: React.MouseEvent) => void;
}

export function ComposerActionAnchor({
  dropdownOpen,
  selectedAgentLabel,
  labels,
  onToggleDropdown,
  onResetAgent,
}: ComposerActionAnchorProps) {
  const hasSelectedAgent = Boolean(selectedAgentLabel);

  return (
    <div
      className={[
        'sparo-chat-input__action-anchor',
        hasSelectedAgent ? 'sparo-chat-input__action-anchor--agent-selected' : '',
      ].filter(Boolean).join(' ')}
      data-agent-selected={hasSelectedAgent || undefined}
    >
      <Tooltip content={labels.addBoostTooltip}>
        <IconButton
          aria-label={labels.addBoostTooltip}
          className="sparo-chat-input__agent-boost-add sparo-chat-input__action-anchor-plus"
          variant="ghost"
          size="xs"
          aria-haspopup="menu"
          aria-expanded={dropdownOpen}
          onClick={onToggleDropdown}
        >
          <Plus size={14} strokeWidth={2.25} />
        </IconButton>
      </Tooltip>

      {hasSelectedAgent && (
        <>
          <button
            type="button"
            className="sparo-chat-input__action-anchor-agent"
            aria-label={`${labels.switchAgent}: ${selectedAgentLabel}`}
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
            onClick={onToggleDropdown}
          >
            <span>{selectedAgentLabel}</span>
          </button>
          <IconButton
            aria-label={labels.resetAgent}
            className="sparo-chat-input__action-anchor-reset"
            data-testid="composer-agent-reset"
            onClick={onResetAgent}
            size="xs"
            tooltip={labels.resetAgent}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </>
      )}
    </div>
  );
}
