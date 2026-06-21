import type React from 'react';
import { Bot, FileText, Flag, MessageSquarePlus, X, Zap } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { SessionGoalSnapshot } from '../../store/sessionGoalStore';
import type { ComposerIntentState } from './model/composerIntentState';

interface ComposerIntentChipLabels {
  remove: string;
  resetAgent: string;
  targetBtwDraft: string;
  targetBtwThread: string;
  goalDraft: string;
  goalActive: string;
  goalPaused: string;
  goalPending: string;
  operationCompact: string;
  operationInit: string;
  promptTemplate: string;
}

interface ComposerIntentChipsProps {
  intent: ComposerIntentState;
  activeGoalSnapshot: SessionGoalSnapshot;
  currentAgent: string;
  defaultAgentId: string;
  canSwitchAgents: boolean;
  getAgentName: (agentId: string) => string;
  labels: ComposerIntentChipLabels;
  onClearTarget: () => void;
  onClearGoalModifier: () => void;
  onClearOperation: () => void;
  onClearPromptTemplate: () => void;
  onResetAgent: (event: React.MouseEvent) => void;
}

function activeGoalLabel(
  snapshot: SessionGoalSnapshot,
  labels: ComposerIntentChipLabels,
): string | null {
  switch (snapshot.phase) {
    case 'extracting':
    case 'judging':
      return labels.goalPending;
    case 'paused':
    case 'waiting_user':
      return labels.goalPaused;
    case 'active':
    case 'blocked':
    case 'budget_limited':
    case 'failed':
    case 'needs_clarification':
      return labels.goalActive;
    default:
      return null;
  }
}

export function ComposerIntentChips({
  intent,
  activeGoalSnapshot,
  currentAgent,
  defaultAgentId,
  canSwitchAgents,
  getAgentName,
  labels,
  onClearTarget,
  onClearGoalModifier,
  onClearOperation,
  onClearPromptTemplate,
  onResetAgent,
}: ComposerIntentChipsProps) {
  const hasGoalModifier = intent.modifiers.includes('goal');
  const goalStatusLabel = hasGoalModifier ? null : activeGoalLabel(activeGoalSnapshot, labels);
  const showAgentChip = canSwitchAgents && currentAgent !== defaultAgentId;

  if (
    intent.target === 'main' &&
    !hasGoalModifier &&
    !goalStatusLabel &&
    !intent.operation &&
    !intent.promptTemplate &&
    !showAgentChip
  ) {
    return null;
  }

  return (
    <div className="sparo-chat-input__intent-chips" aria-live="polite">
      {intent.target === 'btw-draft' && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--target">
          <MessageSquarePlus size={13} aria-hidden />
          <span>{labels.targetBtwDraft}</span>
          <IconButton
            aria-label={`${labels.remove} ${labels.targetBtwDraft}`}
            className="sparo-chat-input__intent-chip-remove"
            onClick={onClearTarget}
            size="xs"
            tooltip={labels.remove}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
      {intent.target === 'btw-thread' && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--target">
          <MessageSquarePlus size={13} aria-hidden />
          <span>{labels.targetBtwThread}</span>
          <IconButton
            aria-label={`${labels.remove} ${labels.targetBtwThread}`}
            className="sparo-chat-input__intent-chip-remove"
            onClick={onClearTarget}
            size="xs"
            tooltip={labels.remove}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
      {hasGoalModifier && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--goal">
          <Flag size={13} aria-hidden />
          <span>{labels.goalDraft}</span>
          <IconButton
            aria-label={`${labels.remove} ${labels.goalDraft}`}
            className="sparo-chat-input__intent-chip-remove"
            onClick={onClearGoalModifier}
            size="xs"
            tooltip={labels.remove}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
      {goalStatusLabel && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--goal sparo-chat-input__intent-chip--readonly">
          <Flag size={13} aria-hidden />
          <span>{goalStatusLabel}</span>
        </span>
      )}
      {intent.operation && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--operation">
          <Zap size={13} aria-hidden />
          <span>{intent.operation === 'compact' ? labels.operationCompact : labels.operationInit}</span>
          <IconButton
            aria-label={`${labels.remove} ${intent.operation}`}
            className="sparo-chat-input__intent-chip-remove"
            onClick={onClearOperation}
            size="xs"
            tooltip={labels.remove}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
      {intent.promptTemplate && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--prompt">
          <FileText size={13} aria-hidden />
          <span>{labels.promptTemplate}: {intent.promptTemplate.promptName}</span>
          <IconButton
            aria-label={`${labels.remove} ${intent.promptTemplate.promptName}`}
            className="sparo-chat-input__intent-chip-remove"
            onClick={onClearPromptTemplate}
            size="xs"
            tooltip={labels.remove}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
      {showAgentChip && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--agent">
          <Bot size={13} aria-hidden />
          <span>{getAgentName(currentAgent) || currentAgent}</span>
          <IconButton
            aria-label={labels.resetAgent}
            className="sparo-chat-input__intent-chip-remove"
            data-testid="composer-agent-reset"
            onClick={onResetAgent}
            size="xs"
            tooltip={labels.resetAgent}
            variant="ghost"
          >
            <X size={11} aria-hidden />
          </IconButton>
        </span>
      )}
    </div>
  );
}
