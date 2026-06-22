import { FileText, Flag, MessageSquarePlus, X, Zap } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { ChatInputTarget } from './model/composerState';
import type { SessionGoalSnapshot } from '../../store/sessionGoalStore';
import type { ComposerIntentState } from './model/composerIntentState';

interface ComposerIntentRailLabels {
  remove: string;
  targetMain: string;
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

interface ComposerIntentRailProps {
  intent: ComposerIntentState;
  activeGoalSnapshot: SessionGoalSnapshot;
  inputTarget: ChatInputTarget;
  showTargetToggle: boolean;
  labels: ComposerIntentRailLabels;
  onClearTarget: () => void;
  onToggleTarget: () => void;
  onClearGoalModifier: () => void;
  onClearOperation: () => void;
  onClearPromptTemplate: () => void;
}

function activeGoalLabel(
  snapshot: SessionGoalSnapshot,
  labels: ComposerIntentRailLabels,
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

export function ComposerIntentRail({
  intent,
  activeGoalSnapshot,
  inputTarget,
  showTargetToggle,
  labels,
  onClearTarget,
  onToggleTarget,
  onClearGoalModifier,
  onClearOperation,
  onClearPromptTemplate,
}: ComposerIntentRailProps) {
  const hasGoalModifier = intent.modifiers.includes('goal');
  const goalStatusLabel = hasGoalModifier ? null : activeGoalLabel(activeGoalSnapshot, labels);
  const showTargetChip =
    intent.target === 'btw-draft' ||
    intent.target === 'btw-thread' ||
    showTargetToggle;

  if (
    !showTargetChip &&
    !hasGoalModifier &&
    !goalStatusLabel &&
    !intent.operation &&
    !intent.promptTemplate
  ) {
    return null;
  }

  const targetLabel = intent.target === 'btw-draft'
    ? labels.targetBtwDraft
    : inputTarget === 'btw'
      ? labels.targetBtwThread
      : labels.targetMain;
  const handleTargetClick =
    intent.target === 'btw-draft' || intent.target === 'btw-thread'
      ? onClearTarget
      : onToggleTarget;

  return (
    <div className="sparo-chat-input__intent-chips" aria-live="polite">
      {showTargetChip && (
        <IconButton
          aria-label={targetLabel}
          className="sparo-chat-input__intent-icon sparo-chat-input__intent-icon--target"
          onClick={handleTargetClick}
          size="xs"
          tooltip={targetLabel}
          variant="ghost"
        >
          <MessageSquarePlus size={13} aria-hidden />
        </IconButton>
      )}
      {hasGoalModifier && (
        <IconButton
          aria-label={`${labels.remove} ${labels.goalDraft}`}
          className="sparo-chat-input__intent-icon sparo-chat-input__intent-icon--goal"
          onClick={onClearGoalModifier}
          size="xs"
          tooltip={labels.goalDraft}
          variant="ghost"
        >
          <Flag size={13} aria-hidden />
        </IconButton>
      )}
      {goalStatusLabel && (
        <span
          aria-label={goalStatusLabel}
          className="sparo-chat-input__intent-icon sparo-chat-input__intent-icon--goal sparo-chat-input__intent-icon--readonly"
          role="status"
          title={goalStatusLabel}
        >
          <Flag size={13} aria-hidden />
        </span>
      )}
      {intent.operation && (
        <span className="sparo-chat-input__intent-chip sparo-chat-input__intent-chip--operation">
          <Zap size={13} aria-hidden />
          <span className="sparo-chat-input__intent-chip-label">
            {intent.operation === 'compact' ? labels.operationCompact : labels.operationInit}
          </span>
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
          <span className="sparo-chat-input__intent-chip-label">
            {labels.promptTemplate}: {intent.promptTemplate.promptName}
          </span>
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
    </div>
  );
}
