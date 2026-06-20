import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Info,
  ShieldCheck,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState, type ToolPresentationPhase } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import './GoalToolCard.scss';

type GoalAction = 'get' | 'note' | 'blocked';
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface GoalGap {
  criterionId?: string;
  description?: string;
}

interface GoalJudgment {
  state?: string;
  summary?: string;
}

interface GoalSnapshot {
  objective?: string;
  status?: string;
  revision?: number;
  gaps: GoalGap[];
  judgment?: GoalJudgment;
}

interface GoalCardData {
  action?: GoalAction | string;
  summary?: string;
  accepted?: boolean;
  message?: string;
  goal?: GoalSnapshot;
}

type JsonRecord = Record<string, unknown>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

function parseData(value: unknown): unknown {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(record: JsonRecord | null | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function numberValue(record: JsonRecord | null | undefined, ...keys: string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function normalizeGaps(value: unknown): GoalGap[] {
  return asArray(value)
    .map(item => {
      const record = asRecord(item);
      if (!record) return null;
      const gap: GoalGap = {
        criterionId: stringValue(record, 'criterionId', 'criterion_id'),
        description: stringValue(record, 'description'),
      };
      return gap.criterionId || gap.description ? gap : null;
    })
    .filter((item): item is GoalGap => Boolean(item));
}

function normalizeGoalSnapshot(value: unknown): GoalSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const contract = asRecord(record.contract);
  const progress = asRecord(record.progress);
  const judgmentRecord = asRecord(record.latestJudgment ?? record.latest_judgment);

  const judgment: GoalJudgment | undefined = judgmentRecord
    ? {
      state: stringValue(judgmentRecord, 'state'),
      summary: stringValue(judgmentRecord, 'summary'),
    }
    : undefined;

  return {
    objective: stringValue(contract, 'resolvedObjective', 'resolved_objective'),
    status: stringValue(record, 'status'),
    revision: numberValue(record, 'revision'),
    gaps: normalizeGaps(progress?.remainingGaps ?? progress?.remaining_gaps),
    judgment,
  };
}

function hasResponseShape(record: JsonRecord | null): boolean {
  if (!record) return false;
  return ['accepted', 'message', 'goal', 'extraction', 'judge'].some(key => key in record);
}

function extractResponseRecord(rawValue: unknown): JsonRecord | null {
  const parsed = parseData(rawValue);
  const record = asRecord(parsed);
  if (hasResponseShape(record)) return record;

  const data = record ? asRecord(record.data) : null;
  if (hasResponseShape(data)) return data;

  const result = record ? asRecord(record.result) : null;
  if (hasResponseShape(result)) return result;

  return record;
}

function normalizeData(rawInput: unknown, rawResult: unknown): GoalCardData {
  const input = asRecord(parseData(rawInput));
  const result = extractResponseRecord(rawResult);
  const goal = normalizeGoalSnapshot(result?.goal);

  return {
    action: stringValue(input, 'action'),
    summary: stringValue(input, 'summary'),
    accepted: typeof result?.accepted === 'boolean' ? result.accepted : undefined,
    message: stringValue(result, 'message'),
    goal,
  };
}

function goalStatusTone(status: string | undefined): Tone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'blocked':
    case 'cancelled':
      return 'danger';
    case 'waiting_user':
    case 'budget_limited':
      return 'warning';
    case 'active':
    case 'judging':
      return 'info';
    default:
      return 'neutral';
  }
}

function judgmentTone(state: string | undefined): Tone {
  switch (state) {
    case 'pass':
      return 'success';
    case 'blocked':
      return 'danger';
    case 'needs_user':
      return 'warning';
    case 'continue':
      return 'info';
    default:
      return 'neutral';
  }
}

function actionTone(data: GoalCardData): Tone {
  switch (data.action) {
    case 'blocked':
      return 'danger';
    case 'note':
      return 'info';
    default:
      return 'neutral';
  }
}

function toneClass(tone: Tone): string {
  return `goal-tool-card--tone-${tone}`;
}

function titleize(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function statusLabel(t: Translate, status: string | undefined): string | undefined {
  if (!status) return undefined;
  return t(`toolCards.goal.statuses.${status}`, { defaultValue: titleize(status, status) });
}

function judgmentStateLabel(t: Translate, state: string | undefined): string | undefined {
  if (!state) return undefined;
  return t(`toolCards.goal.judgeStates.${state}`, { defaultValue: titleize(state, state) });
}

function ToneGlyph({ tone, size = 14 }: { tone: Tone; size?: number }) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 size={size} />;
    case 'danger':
      return <XCircle size={size} />;
    case 'warning':
      return <AlertTriangle size={size} />;
    case 'info':
      return <Info size={size} />;
    default:
      return <CircleHelp size={size} />;
  }
}

function ActionGlyph({ action }: { action: GoalAction | string | undefined }) {
  switch (action) {
    case 'blocked':
      return <AlertTriangle size={13} />;
    case 'note':
      return <TrendingUp size={13} />;
    default:
      return <Target size={13} />;
  }
}

function HeaderStatusIcon({ phase, data }: { phase: ToolPresentationPhase; data: GoalCardData }) {
  if (phase === 'running' || phase === 'receiving_input' || phase === 'preparing' || phase === 'ready') {
    return <DotMatrixLoader size="tiny" className="goal-tool-card__loader" />;
  }
  if (phase === 'error' || phase === 'cancelled' || phase === 'interrupted') {
    return <XCircle size={13} />;
  }
  if (phase === 'result') {
    const tone = actionTone(data);
    return (
      <span className={['goal-tool-card__status-icon', toneClass(tone)].join(' ')}>
        <ActionGlyph action={data.action} />
      </span>
    );
  }
  return <Clock3 size={13} />;
}

function actionVerb(t: Translate, data: GoalCardData): string {
  const action = data.action ?? 'get';
  return t(`toolCards.goal.summary.${action}`, {
    defaultValue: t('toolCards.goal.summary.get'),
  });
}

function renderHeaderSummary(
  t: Translate,
  phase: ToolPresentationPhase,
  data: GoalCardData,
  error?: string,
): React.ReactNode {
  if (phase === 'error') {
    return t('toolCards.goal.failed', { error: error || t('toolCards.goal.unknownError') });
  }
  if (phase === 'cancelled') {
    return t('toolCards.goal.cancelled');
  }
  if (phase === 'interrupted') {
    return t('toolCards.goal.interrupted');
  }
  if (phase === 'running' || phase === 'receiving_input' || phase === 'preparing' || phase === 'ready') {
    const action = data.action ?? 'get';
    return t(`toolCards.goal.pending.${action}`, { defaultValue: t('toolCards.goal.pending.get') });
  }

  const verb = actionVerb(t, data);
  const objective = data.goal?.objective;

  return (
    <span className="goal-tool-card__header-summary">
      <span className={['goal-tool-card__header-verb', toneClass(actionTone(data))].join(' ')}>
        {verb}
      </span>
      {objective && (
        <span className="goal-tool-card__header-objective" title={objective}>
          {objective}
        </span>
      )}
    </span>
  );
}

interface GoalSection {
  label: string;
  text: string;
}

function actionNoteSection(t: Translate, data: GoalCardData): GoalSection | null {
  if (!data.summary) return null;
  switch (data.action) {
    case 'blocked':
      return { label: t('toolCards.goal.sections.blocker'), text: data.summary };
    case 'note':
      return { label: t('toolCards.goal.sections.progressNote'), text: data.summary };
    default:
      return { label: t('toolCards.goal.sections.note'), text: data.summary };
  }
}

export const GoalToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const data = useMemo(
    () => normalizeData(toolCall?.input, toolResult?.result),
    [toolCall?.input, toolResult?.result],
  );

  const goal = data.goal;
  const goalTone = goalStatusTone(goal?.status);
  const goalStatusText = statusLabel(t, goal?.status);
  const note = actionNoteSection(t, data);
  const gaps = goal?.gaps ?? [];
  const judgment = goal?.judgment;
  const judgmentText = judgmentStateLabel(t, judgment?.state);

  const hasBody = Boolean(
    goal ||
    data.message ||
    note ||
    gaps.length ||
    judgment ||
    toolResult?.error,
  );

  const expandedContent = hasBody ? (
    <div className="goal-tool-card__expanded" onClick={event => event.stopPropagation()}>
      {goal && (
        <section className={['goal-tool-card__goal', toneClass(goalTone)].join(' ')}>
          <span className="goal-tool-card__goal-icon">
            <Target size={15} />
          </span>
          <div className="goal-tool-card__goal-main">
            <span className="goal-tool-card__goal-objective">
              {goal.objective || t('toolCards.goal.untitled')}
            </span>
            <div className="goal-tool-card__goal-meta">
              {goalStatusText && (
                <span className={['goal-tool-card__status-pill', toneClass(goalTone)].join(' ')}>
                  {goalStatusText}
                </span>
              )}
              {typeof goal.revision === 'number' && (
                <span className="goal-tool-card__meta-chip">
                  {t('toolCards.goal.revision', { revision: goal.revision })}
                </span>
              )}
              {gaps.length > 0 && (
                <span className="goal-tool-card__meta-chip goal-tool-card__meta-chip--warning">
                  {t('toolCards.goal.gapCount', { count: gaps.length })}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {data.message && (
        <section className="goal-tool-card__section goal-tool-card__outcome">
          {typeof data.accepted === 'boolean' && (
            <span
              className={[
                'goal-tool-card__outcome-flag',
                toneClass(data.accepted ? 'success' : 'danger'),
              ].join(' ')}
            >
              <ToneGlyph tone={data.accepted ? 'success' : 'danger'} size={13} />
              {data.accepted
                ? t('toolCards.goal.accepted')
                : t('toolCards.goal.notAccepted')}
            </span>
          )}
          <p className="goal-tool-card__body-text">{data.message}</p>
        </section>
      )}

      {note && (
        <section className="goal-tool-card__section">
          <div className="goal-tool-card__section-title">{note.label}</div>
          <p className="goal-tool-card__body-text">{note.text}</p>
        </section>
      )}

      {judgment && (judgmentText || judgment.summary) && (
        <section className="goal-tool-card__section goal-tool-card__verification">
          <div className="goal-tool-card__section-title">
            <ShieldCheck size={13} aria-hidden="true" />
            {t('toolCards.goal.sections.judgment')}
          </div>
          {judgmentText && (
            <span className={['goal-tool-card__status-text', toneClass(judgmentTone(judgment.state))].join(' ')}>
              {judgmentText}
            </span>
          )}
          {judgment.summary && (
            <p className="goal-tool-card__body-text">{judgment.summary}</p>
          )}
        </section>
      )}

      {gaps.length > 0 && (
        <section className="goal-tool-card__section">
          <div className="goal-tool-card__section-title">
            {t('toolCards.goal.sections.remainingGaps')}
          </div>
          <ul className="goal-tool-card__bullet-list">
            {gaps.map((gap, index) => (
              <li key={`${gap.criterionId ?? index}-${index}`}>
                {gap.description || gap.criterionId}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </div>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="goal-tool-card"
      statusIcon={<HeaderStatusIcon phase={viewState.phase} data={data} />}
      action={`${t('toolCards.goal.title')}:`}
      summary={renderHeaderSummary(t, viewState.phase, data, toolResult?.error)}
      extra={
        viewState.phase === 'result' && goalStatusText
          ? <span className={['goal-tool-card__status', toneClass(goalTone)].join(' ')}>{goalStatusText}</span>
          : undefined
      }
      expandedContent={expandedContent}
    />
  );
});

GoalToolCard.displayName = 'GoalToolCard';
