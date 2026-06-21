import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleCheck,
  CircleX,
  Flag,
  MessageCircleQuestion,
  OctagonAlert,
  Pause,
  PauseCircle,
  Play,
  Save,
  ScanText,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader, IconButton, Textarea } from '@/design-system';
import { goalAPI, type GoalControlAction } from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  useSessionGoalSnapshot,
  useSessionGoalStore,
  type GoalUiPhase,
} from '@/flow_chat/store/sessionGoalStore';
import { useSessionGoalPolling } from './useSessionGoalPolling';

import './GoalHeaderControl.scss';

const log = createLogger('GoalHeaderControl');

interface GoalHeaderControlProps {
  sessionId?: string;
  workspacePath?: string;
}

type GoalHeaderVisualState =
  | 'extracting'
  | 'active'
  | 'reviewing'
  | 'paused'
  | 'needs_input'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

function deriveGoalHeaderVisualState(input: {
  phase: GoalUiPhase;
  goalStatus?: string;
  extractionStatus?: string;
  judgeStatus?: string;
  judgmentState?: string;
  pendingQuestion: string;
}): GoalHeaderVisualState {
  const {
    phase,
    goalStatus,
    extractionStatus,
    judgeStatus,
    judgmentState,
    pendingQuestion,
  } = input;
  const hasGoal = Boolean(goalStatus);

  if (goalStatus === 'cancelled' || phase === 'cancelled') {
    return 'cancelled';
  }
  if (goalStatus === 'completed' || phase === 'completed') {
    return 'completed';
  }
  if (
    goalStatus === 'failed' ||
    phase === 'failed' ||
    phase === 'rejected' ||
    extractionStatus === 'failed' ||
    extractionStatus === 'rejected' ||
    judgeStatus === 'failed' ||
    judgeStatus === 'rejected'
  ) {
    return 'failed';
  }
  if (
    goalStatus === 'blocked' ||
    goalStatus === 'budget_limited' ||
    phase === 'blocked' ||
    phase === 'budget_limited' ||
    judgmentState === 'blocked'
  ) {
    return 'blocked';
  }
  if (phase === 'paused' || goalStatus === 'paused') {
    return 'paused';
  }
  if (pendingQuestion || phase === 'waiting_user' || goalStatus === 'waiting_user') {
    return 'needs_input';
  }

  if (phase === 'extracting' || extractionStatus === 'queued' || extractionStatus === 'running') {
    return 'extracting';
  }
  if (
    phase === 'judging' ||
    goalStatus === 'judging' ||
    judgeStatus === 'queued' ||
    judgeStatus === 'running'
  ) {
    return 'reviewing';
  }
  if (hasGoal) {
    return 'active';
  }

  if (phase === 'needs_clarification' || extractionStatus === 'needs_clarification' || judgmentState === 'needs_user') {
    return 'needs_input';
  }
  if (judgmentState === 'pass') {
    return 'completed';
  }

  return 'active';
}

function goalHeaderIconForState(state: GoalHeaderVisualState): LucideIcon {
  switch (state) {
    case 'extracting':
      return ScanText;
    case 'reviewing':
      return ShieldCheck;
    case 'paused':
      return PauseCircle;
    case 'needs_input':
      return MessageCircleQuestion;
    case 'blocked':
    case 'failed':
      return OctagonAlert;
    case 'completed':
      return CircleCheck;
    case 'cancelled':
      return CircleX;
    case 'active':
    default:
      return Flag;
  }
}

export const GoalHeaderControl: React.FC<GoalHeaderControlProps> = ({
  sessionId,
  workspacePath,
}) => {
  const { t } = useTranslation('flow-chat');
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftObjective, setDraftObjective] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<GoalControlAction | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useSessionGoalSnapshot(sessionId);
  const applyGoalResponse = useSessionGoalStore(state => state.applyGoalResponse);
  const goal = snapshot.goal ?? null;
  const phase = snapshot.phase;
  const hasGoalUi = phase !== 'none';
  const latestExtraction = snapshot.extraction ?? goal?.latestExtraction;
  const judgeRunStatus = snapshot.judge?.status;
  const judgmentState = goal?.latestJudgment?.state;
  const isExtractingGoal = latestExtraction?.status === 'queued' || latestExtraction?.status === 'running';
  const isJudgingGoal =
    phase === 'judging' ||
    goal?.status === 'judging' ||
    judgeRunStatus === 'queued' ||
    judgeRunStatus === 'running';
  const isProcessing = isExtractingGoal || isJudgingGoal;
  const isPaused = goal?.status === 'paused';
  const judgeDisplayStatus =
    judgeRunStatus === 'queued' || judgeRunStatus === 'running'
      ? judgeRunStatus
      : judgmentState ?? judgeRunStatus;

  useSessionGoalPolling({
    enabled: Boolean(sessionId && workspacePath),
    sessionId,
    workspacePath,
    intervalMs: isProcessing ? 1500 : 3000,
  });

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    return () => document.removeEventListener('mousedown', handlePointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!hasGoalUi) {
      setOpen(false);
      setIsEditing(false);
    }
  }, [hasGoalUi]);

  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setEditError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!isEditing) {
      setDraftObjective(goal?.contract.resolvedObjective ?? '');
      setEditError(null);
    }
  }, [goal?.contract.resolvedObjective, goal?.goalId, goal?.revision, isEditing]);

  const gaps = useMemo(() => (
    goal?.progress.remainingGaps?.length
      ? goal.progress.remainingGaps
      : goal?.latestJudgment?.remainingGaps ?? []
  ), [goal]);
  const objective = goal?.contract.resolvedObjective
    ?? snapshot.pendingObjective
    ?? t('session.goal.pendingObjective', { defaultValue: 'Extracting goal...' });
  const pendingQuestion = goal?.pendingUserQuestion?.trim() ?? '';
  const visualState = deriveGoalHeaderVisualState({
    phase,
    goalStatus: goal?.status,
    extractionStatus: latestExtraction?.status,
    judgeStatus: judgeRunStatus,
    judgmentState,
    pendingQuestion,
  });
  const GoalHeaderIcon = goalHeaderIconForState(visualState);
  const trimmedDraftObjective = draftObjective.trim();
  const currentObjective = goal?.contract.resolvedObjective.trim() ?? '';
  const saveDisabled = isSaving || !trimmedDraftObjective;
  const isPausing = busyAction === 'pause';
  const isResuming = busyAction === 'resume';
  const isReviewing = busyAction === 'review';
  const isReviewBusy = isReviewing || visualState === 'reviewing';
  const isClearing = busyAction === 'clear';

  const runAction = useCallback(async (action: GoalControlAction) => {
    if (!goal || !sessionId || !workspacePath) return;
    setBusyAction(action);
    try {
      const current = await goalAPI.getSessionGoal(sessionId, workspacePath);
      const targetGoal = current.goal ?? goal;
      const response = await goalAPI.controlSessionGoal({
        sessionId,
        workspacePath,
        action,
        expectedGoalId: targetGoal.goalId,
        expectedRevision: action === 'review' ? undefined : targetGoal.revision,
      });
      applyGoalResponse({
        sessionId,
        workspacePath,
        response,
        cleared: action === 'clear',
      });
      if (action === 'clear') setOpen(false);
    } catch (error) {
      log.error('Goal control failed', { action, goalId: goal.goalId, error });
      notificationService.error(
        t('flowChatHeader.goalPanel.controlFailed', {
          defaultValue: 'Goal action failed.',
        }),
        { duration: 3000 },
      );
      await useSessionGoalStore.getState().refreshSessionGoal(sessionId, workspacePath);
    } finally {
      setBusyAction(null);
    }
  }, [applyGoalResponse, goal, sessionId, t, workspacePath]);

  const handleActionClick = useCallback((event: React.MouseEvent, action: GoalControlAction) => {
    event.stopPropagation();
    void runAction(action);
  }, [runAction]);

  const handleToggleDetails = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (goal) {
      setDraftObjective(goal.contract.resolvedObjective);
      setEditError(null);
      setIsEditing(true);
    }
  }, [goal, open]);

  const handleSaveEdit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goal || !sessionId || !workspacePath) return;
    if (!trimmedDraftObjective) {
      setEditError(t('flowChatHeader.goalPanel.emptyEditError', {
        defaultValue: 'Goal cannot be empty.',
      }));
      return;
    }
    if (trimmedDraftObjective === currentObjective) {
      setIsEditing(false);
      setEditError(null);
      setOpen(false);
      return;
    }

    setIsSaving(true);
    setEditError(null);
    try {
      const response = await goalAPI.updateSessionGoal({
        sessionId,
        workspacePath,
        editedObjective: trimmedDraftObjective,
        expectedGoalId: goal.goalId,
        expectedRevision: goal.revision,
      });
      applyGoalResponse({ sessionId, workspacePath, response });
      setIsEditing(false);
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditError(message);
      notificationService.error(
        t('flowChatHeader.goalPanel.updateFailed', {
          defaultValue: 'Failed to update goal.',
        }),
        { duration: 3000 },
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    applyGoalResponse,
    currentObjective,
    goal,
    sessionId,
    t,
    trimmedDraftObjective,
    workspacePath,
  ]);

  if (!hasGoalUi) return null;

  return (
    <div
      className="goal-header-control"
      ref={rootRef}
      data-goal-phase={phase}
      data-status={goal?.status ?? phase}
      data-visual-state={visualState}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="goal-header-control__summary"
        onClick={handleToggleDetails}
        aria-label={t('flowChatHeader.goalPanel.open', { defaultValue: 'Goal details' })}
        aria-expanded={open}
        aria-busy={isProcessing}
        data-testid="flowchat-header-goal"
        data-status={goal?.status ?? phase}
        data-goal-phase={phase}
        data-extraction-status={latestExtraction?.status ?? ''}
        data-judge-status={judgeDisplayStatus ?? ''}
        data-gap-count={gaps.length}
        data-visual-state={visualState}
      >
        <span className="goal-header-control__mark-shell" aria-hidden="true">
          <GoalHeaderIcon className="goal-header-control__mark" size={14} strokeWidth={2.15} />
        </span>
        <span className="goal-header-control__objective" data-testid="flowchat-header-goal-title">
          {objective}
        </span>
      </button>

      {goal && (
        <div className="goal-header-control__actions" onClick={event => event.stopPropagation()}>
          {isPaused ? (
            <IconButton
              className="goal-header-control__action"
              variant="ghost"
              size="xs"
              onClick={event => handleActionClick(event, 'resume')}
              disabled={Boolean(busyAction)}
              aria-busy={isResuming || undefined}
              tooltip={t('flowChatHeader.goalPanel.resume', { defaultValue: 'Resume goal' })}
              aria-label={t('flowChatHeader.goalPanel.resume', { defaultValue: 'Resume goal' })}
              data-testid="flowchat-header-goal-resume"
            >
              {isResuming ? (
                <DotMatrixLoader size="tiny" ariaHidden />
              ) : (
                <Play size={13} aria-hidden="true" />
              )}
            </IconButton>
          ) : (
            <IconButton
              className="goal-header-control__action"
              variant="ghost"
              size="xs"
              onClick={event => handleActionClick(event, 'pause')}
              disabled={Boolean(busyAction)}
              aria-busy={isPausing || undefined}
              tooltip={t('flowChatHeader.goalPanel.pause', { defaultValue: 'Pause goal' })}
              aria-label={t('flowChatHeader.goalPanel.pause', { defaultValue: 'Pause goal' })}
              data-testid="flowchat-header-goal-pause"
            >
              {isPausing ? (
                <DotMatrixLoader size="tiny" ariaHidden />
              ) : (
                <Pause size={13} aria-hidden="true" />
              )}
            </IconButton>
          )}
          <IconButton
            className="goal-header-control__action"
            variant="ghost"
            size="xs"
            onClick={event => handleActionClick(event, 'review')}
            disabled={Boolean(busyAction) || visualState === 'reviewing'}
            aria-busy={isReviewBusy || undefined}
            tooltip={t('flowChatHeader.goalPanel.review', { defaultValue: 'Review goal' })}
            aria-label={t('flowChatHeader.goalPanel.review', { defaultValue: 'Review goal' })}
            data-testid="flowchat-header-goal-review"
          >
            {isReviewBusy ? (
              <DotMatrixLoader size="tiny" ariaHidden />
            ) : (
              <ShieldCheck size={13} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            className="goal-header-control__action goal-header-control__action--clear"
            variant="ghost"
            size="xs"
            onClick={event => handleActionClick(event, 'clear')}
            disabled={Boolean(busyAction)}
            aria-busy={isClearing || undefined}
            tooltip={t('flowChatHeader.goalPanel.cancelExecution', {
              defaultValue: 'Cancel goal execution',
            })}
            aria-label={t('flowChatHeader.goalPanel.cancelExecution', {
              defaultValue: 'Cancel goal execution',
            })}
            data-testid="flowchat-header-goal-clear"
          >
            {isClearing ? (
              <DotMatrixLoader size="tiny" ariaHidden />
            ) : (
              <X size={13} aria-hidden="true" />
            )}
          </IconButton>
        </div>
      )}

      {open && (
        <section
          className="goal-header-panel"
          aria-label={t('flowChatHeader.goalPanel.title', { defaultValue: 'Goal' })}
          data-visual-state={visualState}
          data-testid="flowchat-header-goal-panel"
        >
          {isEditing ? (
            <form className="goal-header-panel__edit-form" onSubmit={handleSaveEdit}>
              <Textarea
                className="goal-header-panel__edit-field"
                aria-label={t('flowChatHeader.goalPanel.objective', { defaultValue: 'Goal' })}
                value={draftObjective}
                onChange={event => setDraftObjective(event.target.value)}
                rows={4}
                autoResize
                error={Boolean(editError)}
                errorMessage={editError ?? undefined}
                disabled={isSaving}
                data-testid="flowchat-header-goal-edit-field"
              />
              <div className="goal-header-panel__edit-actions">
                <IconButton
                  className="goal-header-panel__edit-save"
                  type="submit"
                  variant="accent"
                  size="small"
                  shape="circle"
                  isLoading={isSaving}
                  disabled={saveDisabled}
                  tooltip={t('flowChatHeader.goalPanel.saveEdit', { defaultValue: 'Save' })}
                  aria-label={t('flowChatHeader.goalPanel.saveEdit', { defaultValue: 'Save' })}
                  data-testid="flowchat-header-goal-save"
                >
                  <Save size={13} />
                </IconButton>
              </div>
            </form>
          ) : (
            <div className="goal-header-panel__objective" data-testid="flowchat-header-goal-objective">
              {objective}
            </div>
          )}

          {pendingQuestion && (
            <div className="goal-header-panel__section">
              <div className="goal-header-panel__section-title">
                {t('flowChatHeader.goalPanel.needsInput', { defaultValue: 'Needs input' })}
              </div>
              <div className="goal-header-panel__question">
                {pendingQuestion}
              </div>
            </div>
          )}

          {gaps.length > 0 && (
            <div className="goal-header-panel__section">
              <div className="goal-header-panel__section-title">
                {t('flowChatHeader.goalPanel.gaps', { defaultValue: 'Remaining gaps' })}
              </div>
              <ul className="goal-header-panel__gaps">
                {gaps.slice(0, 4).map(gap => (
                  <li key={`${gap.criterionId}-${gap.description}`}>{gap.description}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default GoalHeaderControl;
