import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, ClipboardCheck, Flag, LoaderCircle, PauseCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/design-system';
import { useSessionGoalSnapshot, type GoalUiPhase } from '@/flow_chat/store/sessionGoalStore';
import { useSessionGoalPolling } from './useSessionGoalPolling';

import './GoalHeaderControl.scss';

const GOAL_EXTRACTION_FALLBACK_MESSAGE =
  'AI goal extraction failed; using the user\'s input as the goal.';

interface GoalHeaderControlProps {
  sessionId?: string;
  workspacePath?: string;
}

function statusIconForPhase(phase: GoalUiPhase) {
  if (phase === 'extracting' || phase === 'judging') return LoaderCircle;
  if (phase === 'completed') return CheckCircle2;
  if (phase === 'paused') return PauseCircle;
  if (phase === 'blocked' || phase === 'budget_limited' || phase === 'failed' || phase === 'rejected') {
    return AlertTriangle;
  }
  if (phase === 'needs_clarification' || phase === 'waiting_user') {
    return CircleHelp;
  }
  return Flag;
}

export const GoalHeaderControl: React.FC<GoalHeaderControlProps> = ({
  sessionId,
  workspacePath,
}) => {
  const { t } = useTranslation('flow-chat');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useSessionGoalSnapshot(sessionId);
  const goal = snapshot.goal ?? null;
  const phase = snapshot.phase;
  const hasGoalUi = phase !== 'none';
  const extractionStatus = snapshot.extraction?.status ?? goal?.latestExtraction?.status ?? '';
  const judgeRunStatus = snapshot.judge?.status;
  const judgmentState = goal?.latestJudgment?.state;
  const judgeStatus =
    judgeRunStatus === 'queued' || judgeRunStatus === 'running'
      ? judgeRunStatus
      : judgmentState ?? judgeRunStatus ?? '';
  const isProcessing = phase === 'extracting' || phase === 'judging';
  const StatusIcon = statusIconForPhase(phase);

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
    }
  }, [hasGoalUi]);

  const gaps = useMemo(
    () => goal?.progress.remainingGaps?.length
      ? goal.progress.remainingGaps
      : goal?.latestJudgment?.remainingGaps ?? [],
    [goal],
  );
  const objective = goal?.contract.resolvedObjective
    ?? snapshot.pendingObjective
    ?? t('session.goal.pendingObjective', { defaultValue: 'Extracting goal...' });
  const rawGoalMessage = snapshot.message?.trim() ?? '';
  const goalMessage = rawGoalMessage === GOAL_EXTRACTION_FALLBACK_MESSAGE
    ? t('flowChatHeader.goalPanel.fallbackMessage', {
        defaultValue: 'AI goal extraction failed; using your input as the goal.',
      })
    : rawGoalMessage;
  const phaseLabel = t(`session.goal.phase.${phase}`, {
    defaultValue: phase.replace(/_/g, ' '),
  });
  const statusLabel = goal
    ? t(`session.goal.status.${goal.status}`, { defaultValue: goal.status.replace(/_/g, ' ') })
    : phaseLabel;
  const judgeKey = judgeStatus || undefined;
  const judgeLabel = judgeKey
    ? t(`session.goal.judgeStatus.${judgeKey}`, {
        defaultValue: judgeKey.replace(/_/g, ' '),
      })
    : t('flowChatHeader.goalPanel.noJudgment', { defaultValue: 'No judgment yet' });
  const extractionLabel = extractionStatus
    ? t(`session.goal.extractionStatus.${extractionStatus}`, {
        defaultValue: extractionStatus.replace(/_/g, ' '),
      })
    : t('flowChatHeader.goalPanel.noExtraction', { defaultValue: 'No extraction yet' });

  if (!hasGoalUi) return null;

  const phaseClass = phase.replace(/_/g, '-');

  return (
    <div className="goal-header-control" ref={rootRef} data-goal-phase={phase}>
      <IconButton
        className={[
          'goal-header-control__button',
          `goal-header-control__button--phase-${phaseClass}`,
          open && 'goal-header-control__button--active',
          isProcessing && 'goal-header-control__button--processing',
        ].filter(Boolean).join(' ')}
        variant="ghost"
        size="xs"
        onClick={() => setOpen(value => !value)}
        tooltip={t('flowChatHeader.goalPanel.open', { defaultValue: 'Goal details' })}
        aria-label={t('flowChatHeader.goalPanel.open', { defaultValue: 'Goal details' })}
        aria-expanded={open}
        aria-busy={isProcessing}
        data-testid="flowchat-header-goal"
        data-goal-phase={phase}
        data-extraction-status={extractionStatus}
        data-judge-status={judgeStatus}
      >
        <StatusIcon size={14} />
      </IconButton>

      {open && (
        <section
          className="goal-header-panel"
          aria-label={t('flowChatHeader.goalPanel.title', { defaultValue: 'Goal' })}
          data-testid="flowchat-header-goal-panel"
        >
          <div className="goal-header-panel__top">
            <div className="goal-header-panel__title-row">
              <span className="goal-header-panel__icon" aria-hidden>
                <ClipboardCheck size={14} />
              </span>
              <span className="goal-header-panel__title">
                {t('flowChatHeader.goalPanel.title', { defaultValue: 'Goal' })}
              </span>
            </div>
            <IconButton
              className="goal-header-panel__close"
              variant="ghost"
              size="xs"
              onClick={() => setOpen(false)}
              tooltip={t('flowChatHeader.goalPanel.close', { defaultValue: 'Close goal details' })}
              aria-label={t('flowChatHeader.goalPanel.close', { defaultValue: 'Close goal details' })}
            >
              <X size={14} />
            </IconButton>
          </div>

          <div className="goal-header-panel__objective">
            {objective}
          </div>

          {goalMessage && (
            <div className="goal-header-panel__message" data-testid="flowchat-header-goal-message">
              {goalMessage}
            </div>
          )}

          <dl className="goal-header-panel__facts">
            <div>
              <dt>{t('flowChatHeader.goalPanel.status', { defaultValue: 'Status' })}</dt>
              <dd>{statusLabel}</dd>
            </div>
            <div>
              <dt>{t('flowChatHeader.goalPanel.revision', { defaultValue: 'Revision' })}</dt>
              <dd>{goal ? t('session.goal.revision', { defaultValue: 'r{{revision}}', revision: goal.revision }) : '-'}</dd>
            </div>
            <div>
              <dt>{t('flowChatHeader.goalPanel.extraction', { defaultValue: 'Extraction' })}</dt>
              <dd>{extractionLabel}</dd>
            </div>
            <div>
              <dt>{t('flowChatHeader.goalPanel.judge', { defaultValue: 'Judge' })}</dt>
              <dd>{judgeLabel}</dd>
            </div>
          </dl>

          <div className="goal-header-panel__section">
            <div className="goal-header-panel__section-title">
              {t('flowChatHeader.goalPanel.gaps', { defaultValue: 'Remaining gaps' })}
            </div>
            {gaps.length > 0 ? (
              <ul className="goal-header-panel__gaps">
                {gaps.slice(0, 4).map(gap => (
                  <li key={`${gap.criterionId}-${gap.description}`}>{gap.description}</li>
                ))}
              </ul>
            ) : (
              <div className="goal-header-panel__empty">
                {t('flowChatHeader.goalPanel.noGaps', { defaultValue: 'No recorded gaps' })}
              </div>
            )}
          </div>

          {goal && (
            <div className="goal-header-panel__footer">
              {typeof goal.budgets?.maxContinuationTurns === 'number' && (
                <span>
                  {t('session.goal.budget', {
                    defaultValue: '{{used}}/{{max}} turns',
                    used: goal.progress.continuationTurns,
                    max: goal.budgets.maxContinuationTurns,
                  })}
                </span>
              )}
              <span>
                {t('flowChatHeader.goalPanel.judgments', {
                  defaultValue: '{{count}} judgments',
                  count: goal.progress.judgeRuns ?? 0,
                })}
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default GoalHeaderControl;
