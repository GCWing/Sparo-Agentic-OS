import React, { useCallback, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Flag,
  LoaderCircle,
  Pause,
  PauseCircle,
  Play,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/design-system';
import { goalAPI, type GoalControlAction } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import {
  sessionToActiveSessionMeta,
  useActiveSessionMeta,
  useScopedSession,
} from '@/flow_chat/store/modernFlowChatStore';
import { supportsSessionGoal } from '@/flow_chat/domain/goalSupport';
import {
  useSessionGoalSnapshot,
  useSessionGoalStore,
  type GoalUiPhase,
} from '@/flow_chat/store/sessionGoalStore';
import { useSessionGoalPolling } from './useSessionGoalPolling';

import './ActiveGoalBanner.scss';

const log = createLogger('ActiveGoalBanner');
const GOAL_EXTRACTION_FALLBACK_MESSAGE =
  'AI goal extraction failed; using the user\'s input as the goal.';

// One icon per lifecycle state. Shape carries the meaning (running / done / held /
// attention / question), color is layered on by the phase accent in SCSS.
function medallionIconForPhase(phase: GoalUiPhase) {
  if (phase === 'extracting' || phase === 'judging') return LoaderCircle;
  if (phase === 'completed') return CheckCircle2;
  if (phase === 'paused') return PauseCircle;
  if (
    phase === 'blocked' ||
    phase === 'budget_limited' ||
    phase === 'failed' ||
    phase === 'rejected'
  ) {
    return AlertTriangle;
  }
  if (phase === 'waiting_user' || phase === 'needs_clarification') return CircleHelp;
  return Flag;
}

// Phases where the goal message is worth surfacing inline; routine status echoes stay
// in the detail panel so the banner reads clean.
function isAttentionPhase(phase: GoalUiPhase): boolean {
  return (
    phase === 'blocked' ||
    phase === 'budget_limited' ||
    phase === 'failed' ||
    phase === 'rejected' ||
    phase === 'needs_clarification'
  );
}

interface ActiveGoalBannerProps {
  sessionId?: string | null;
  workspacePath?: string;
}

export const ActiveGoalBanner: React.FC<ActiveGoalBannerProps> = ({
  sessionId,
  workspacePath,
}) => {
  const { t } = useTranslation('flow-chat');
  const activeSession = useActiveSessionMeta();
  const targetSession = useScopedSession(sessionId ?? activeSession.sessionId ?? null);
  const targetSessionMeta = sessionToActiveSessionMeta(targetSession);
  const [busyAction, setBusyAction] = useState<GoalControlAction | null>(null);
  const goalSessionId = sessionId ?? targetSessionMeta.sessionId ?? activeSession.sessionId ?? null;
  const goalDescriptor =
    targetSessionMeta.descriptor ??
    (activeSession.sessionId === goalSessionId ? activeSession.descriptor : undefined);
  const goalWorkspacePath =
    targetSessionMeta.workspacePath ??
    workspacePath ??
    (activeSession.sessionId === goalSessionId ? activeSession.workspacePath : undefined) ??
    '';
  const goalStorageScope = targetSessionMeta.storageScope ?? goalDescriptor?.storageScope;
  const snapshot = useSessionGoalSnapshot(goalSessionId);
  const goal = snapshot.goal ?? null;
  const phase = snapshot.phase;
  const isProcessing = phase === 'extracting' || phase === 'judging';
  const supportsGoal = supportsSessionGoal({
    workspacePath: goalWorkspacePath,
    storageScope: goalStorageScope,
    descriptor: goalDescriptor,
  });

  useSessionGoalPolling({
    enabled: Boolean(supportsGoal && goalSessionId && goalWorkspacePath),
    sessionId: goalSessionId,
    workspacePath: goalWorkspacePath,
    intervalMs: isProcessing ? 1500 : 3000,
  });

  const runAction = useCallback(async (action: GoalControlAction) => {
    if (!goal || !supportsGoal || !goalSessionId || !goalWorkspacePath) return;
    setBusyAction(action);
    try {
      const current = await goalAPI.getSessionGoal(goalSessionId, goalWorkspacePath);
      const targetGoal = current.goal ?? goal;
      const response = await goalAPI.controlSessionGoal({
        sessionId: goalSessionId,
        workspacePath: goalWorkspacePath,
        action,
        expectedGoalId: targetGoal.goalId,
        expectedRevision: action === 'review' ? undefined : targetGoal.revision,
      });
      if (action === 'clear') {
        useSessionGoalStore.getState().applyGoalResponse({
          sessionId: goalSessionId,
          workspacePath: goalWorkspacePath,
          response,
          cleared: true,
        });
      } else {
        useSessionGoalStore.getState().applyGoalResponse({
          sessionId: goalSessionId,
          workspacePath: goalWorkspacePath,
          response,
        });
      }
    } catch (error) {
      log.error('Goal control failed', { action, goalId: goal.goalId, error });
      await useSessionGoalStore.getState().refreshSessionGoal(goalSessionId, goalWorkspacePath);
    } finally {
      setBusyAction(null);
    }
  }, [goal, goalSessionId, goalWorkspacePath, supportsGoal]);

  if (!supportsGoal || phase === 'none') return null;

  const objective = goal?.contract.resolvedObjective
    ?? snapshot.pendingObjective
    ?? t('session.goal.pendingObjective', { defaultValue: 'Extracting goal...' });
  const statusLabel = goal
    ? t(`session.goal.status.${goal.status}`, { defaultValue: goal.status.replace(/_/g, ' ') })
    : t(`session.goal.phase.${phase}`, { defaultValue: phase.replace(/_/g, ' ') });
  const isPaused = goal?.status === 'paused';
  const latestExtraction = snapshot.extraction ?? goal?.latestExtraction;
  const judgeRunStatus = snapshot.judge?.status;
  const judgmentState = goal?.latestJudgment?.state;
  const judgeDisplayStatus =
    judgeRunStatus === 'queued' || judgeRunStatus === 'running'
      ? judgeRunStatus
      : judgmentState ?? judgeRunStatus;
  const gaps = (goal?.progress.remainingGaps?.length
    ? goal.progress.remainingGaps
    : goal?.latestJudgment?.remainingGaps) ?? [];
  const maxContinuationTurns = goal?.budgets?.maxContinuationTurns;
  const turnsLabel = goal && typeof maxContinuationTurns === 'number'
    ? t('session.goal.budget', {
        defaultValue: '{{used}}/{{max}} turns',
        used: goal.progress.continuationTurns,
        max: maxContinuationTurns,
      })
    : null;
  const rawGoalMessage = snapshot.message?.trim() ?? '';
  const isFallbackMessage = rawGoalMessage === GOAL_EXTRACTION_FALLBACK_MESSAGE;
  const goalMessage = isFallbackMessage
    ? t('flowChatHeader.goalPanel.fallbackMessage', {
        defaultValue: 'AI goal extraction failed; using your input as the goal.',
      })
    : rawGoalMessage;
  // Only carry a message into the always-visible bar when it is an exception worth
  // attention; otherwise the goal icon's detail panel holds the full message.
  const inlineNote = goalMessage && (isAttentionPhase(phase) || isFallbackMessage)
    ? goalMessage
    : null;
  const MedallionIcon = medallionIconForPhase(phase);
  const phaseClass = phase.replace(/_/g, '-');

  return (
    <section
      className={`active-goal-banner active-goal-banner--phase-${phaseClass}`}
      data-testid="active-goal-banner"
      data-status={goal?.status ?? phase}
      data-goal-phase={phase}
      data-extraction-status={latestExtraction?.status ?? ''}
      data-judge-status={judgeDisplayStatus ?? ''}
      aria-label={t('session.goal.ariaLabel', { defaultValue: 'Active goal' })}
      aria-busy={isProcessing}
    >
      <span className="active-goal-banner__medallion" aria-hidden="true">
        <MedallionIcon size={16} aria-hidden="true" />
      </span>

      <div className="active-goal-banner__body">
        <div className="active-goal-banner__headline">
          <span className="active-goal-banner__eyebrow">
            {t('session.goal.label', { defaultValue: 'Goal' })}
          </span>
          <span className="active-goal-banner__objective" data-testid="active-goal-objective">
            {objective}
          </span>
        </div>
        <div className="active-goal-banner__sub">
          <span className="active-goal-banner__status" data-testid="active-goal-status">
            {statusLabel}
          </span>
          {turnsLabel && (
            <>
              <span className="active-goal-banner__sep" aria-hidden="true">·</span>
              <span className="active-goal-banner__turns">{turnsLabel}</span>
            </>
          )}
          {inlineNote && (
            <>
              <span className="active-goal-banner__sep" aria-hidden="true">·</span>
              <span className="active-goal-banner__note">{inlineNote}</span>
            </>
          )}
        </div>
      </div>

      <div className="active-goal-banner__side">
        {gaps.length > 0 && (
          <span className="active-goal-banner__gap" data-testid="active-goal-gap">
            {t('session.goal.gap', {
              defaultValue: '{{count}} gap',
              count: gaps.length,
            })}
          </span>
        )}
        {goal && (
          <div className="active-goal-banner__actions">
            {isPaused ? (
              <IconButton
                size="small"
                variant="ghost"
                onClick={() => void runAction('resume')}
                isLoading={busyAction === 'resume'}
                tooltip={t('session.goal.resume', { defaultValue: 'Resume' })}
                aria-label={t('session.goal.resume', { defaultValue: 'Resume' })}
                data-testid="active-goal-resume"
              >
                <Play size={15} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                variant="ghost"
                onClick={() => void runAction('pause')}
                isLoading={busyAction === 'pause'}
                tooltip={t('session.goal.pause', { defaultValue: 'Pause' })}
                aria-label={t('session.goal.pause', { defaultValue: 'Pause' })}
                data-testid="active-goal-pause"
              >
                <Pause size={15} aria-hidden="true" />
              </IconButton>
            )}
            <IconButton
              size="small"
              variant="ghost"
              onClick={() => void runAction('review')}
              isLoading={busyAction === 'review'}
              tooltip={t('session.goal.review', { defaultValue: 'Review' })}
              aria-label={t('session.goal.review', { defaultValue: 'Review' })}
              data-testid="active-goal-review"
            >
              <ClipboardCheck size={15} aria-hidden="true" />
            </IconButton>
            <IconButton
              size="small"
              variant="ghost"
              className="active-goal-banner__clear"
              onClick={() => void runAction('clear')}
              isLoading={busyAction === 'clear'}
              tooltip={t('session.goal.clear', { defaultValue: 'Clear' })}
              aria-label={t('session.goal.clear', { defaultValue: 'Clear' })}
              data-testid="active-goal-clear"
            >
              <X size={15} aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  );
};

export default ActiveGoalBanner;
