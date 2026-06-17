import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, Info, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ToolCardProps } from '../types/flow-chat';
import { getToolViewState, type ToolPresentationPhase } from '../runtime/toolViewState';
import { DefaultToolCardTemplate } from './templates';
import { ToolErrorBlock } from './ToolErrorBlock';
import './OutcomeReviewToolCard.scss';

type Verdict = 'pass' | 'pass_with_notes' | 'needs_revision' | 'failed' | 'inconclusive';
type Confidence = 'high' | 'medium' | 'low';
type RiskLevel = 'low' | 'medium' | 'high';
type CheckStatus = 'passed' | 'failed' | 'partial' | 'unverified';
type IssueSeverity = 'blocker' | 'major' | 'minor';
type NextAction = 'report_to_user' | 'continue_work' | 'start_specialist_review' | 'ask_user' | 'stop';
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface AcceptanceCheck {
  criterion?: string;
  status?: CheckStatus | string;
  evidence?: string;
  reasoning?: string;
}

interface OutcomeIssue {
  severity?: IssueSeverity | string;
  title?: string;
  evidence?: string;
  impact?: string;
  suggested_next_step?: string;
}

interface RecommendedNextAction {
  action?: NextAction | string;
  instructions_for_os_agent?: string;
  instructions_for_work_if_revision_needed?: string | null;
}

interface OutcomeReviewPayload {
  work_id?: string | null;
  verdict?: Verdict | string;
  confidence?: Confidence | string;
  risk_level?: RiskLevel | string;
  summary?: string;
  final_effect?: string;
  acceptance_checks?: AcceptanceCheck[];
  issues?: OutcomeIssue[];
  verification_gaps?: string[];
  recommended_next_action?: RecommendedNextAction;
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

function nullableStringValue(record: JsonRecord | null | undefined, ...keys: string[]): string | null | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value === null) return null;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function hasOutcomeShape(record: JsonRecord | null): boolean {
  if (!record) return false;
  return [
    'verdict',
    'confidence',
    'risk_level',
    'summary',
    'final_effect',
    'acceptance_checks',
    'issues',
    'verification_gaps',
    'recommended_next_action',
  ].some(key => key in record);
}

function extractOutcomeRecord(rawValue: unknown): JsonRecord | null {
  const parsed = parseData(rawValue);
  const record = asRecord(parsed);
  if (hasOutcomeShape(record)) {
    return record;
  }

  const data = record ? asRecord(record.data) : null;
  if (hasOutcomeShape(data)) {
    return data;
  }

  const result = record ? asRecord(record.result) : null;
  if (hasOutcomeShape(result)) {
    return result;
  }

  return null;
}

function normalizeAcceptanceChecks(value: unknown): AcceptanceCheck[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      const record = asRecord(item);
      if (!record) return null;
      const check: AcceptanceCheck = {
        criterion: stringValue(record, 'criterion'),
        status: stringValue(record, 'status'),
        evidence: stringValue(record, 'evidence'),
        reasoning: stringValue(record, 'reasoning'),
      };
      return check.criterion || check.evidence || check.reasoning ? check : null;
    })
    .filter((item): item is AcceptanceCheck => Boolean(item));
}

function normalizeIssues(value: unknown): OutcomeIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      const record = asRecord(item);
      if (!record) return null;
      const issue: OutcomeIssue = {
        severity: stringValue(record, 'severity'),
        title: stringValue(record, 'title'),
        evidence: stringValue(record, 'evidence'),
        impact: stringValue(record, 'impact'),
        suggested_next_step: stringValue(record, 'suggested_next_step', 'suggestedNextStep'),
      };
      return issue.title || issue.evidence || issue.impact || issue.suggested_next_step ? issue : null;
    })
    .filter((item): item is OutcomeIssue => Boolean(item));
}

function normalizeVerificationGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeNextAction(value: unknown): RecommendedNextAction | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const action: RecommendedNextAction = {
    action: stringValue(record, 'action'),
    instructions_for_os_agent: stringValue(record, 'instructions_for_os_agent', 'instructionsForOsAgent'),
    instructions_for_work_if_revision_needed: nullableStringValue(
      record,
      'instructions_for_work_if_revision_needed',
      'instructionsForWorkIfRevisionNeeded',
    ),
  };
  return action.action || action.instructions_for_os_agent || action.instructions_for_work_if_revision_needed
    ? action
    : undefined;
}

function normalizePayload(rawValue: unknown): OutcomeReviewPayload | null {
  const record = extractOutcomeRecord(rawValue);
  if (!record) return null;

  return {
    work_id: nullableStringValue(record, 'work_id', 'workId'),
    verdict: stringValue(record, 'verdict'),
    confidence: stringValue(record, 'confidence'),
    risk_level: stringValue(record, 'risk_level', 'riskLevel'),
    summary: stringValue(record, 'summary'),
    final_effect: stringValue(record, 'final_effect', 'finalEffect'),
    acceptance_checks: normalizeAcceptanceChecks(record.acceptance_checks ?? record.acceptanceChecks),
    issues: normalizeIssues(record.issues),
    verification_gaps: normalizeVerificationGaps(record.verification_gaps ?? record.verificationGaps),
    recommended_next_action: normalizeNextAction(record.recommended_next_action ?? record.recommendedNextAction),
  };
}

function mergePayload(resultPayload: OutcomeReviewPayload | null, inputPayload: OutcomeReviewPayload | null): OutcomeReviewPayload | null {
  if (!resultPayload) return inputPayload;
  if (!inputPayload) return resultPayload;
  return {
    ...inputPayload,
    ...resultPayload,
    acceptance_checks: resultPayload.acceptance_checks?.length
      ? resultPayload.acceptance_checks
      : inputPayload.acceptance_checks,
    issues: resultPayload.issues?.length ? resultPayload.issues : inputPayload.issues,
    verification_gaps: resultPayload.verification_gaps?.length
      ? resultPayload.verification_gaps
      : inputPayload.verification_gaps,
    recommended_next_action: resultPayload.recommended_next_action ?? inputPayload.recommended_next_action,
  };
}

function hasReviewContent(data: OutcomeReviewPayload | null): data is OutcomeReviewPayload {
  return Boolean(data && (
    data.verdict ||
    data.confidence ||
    data.risk_level ||
    data.summary ||
    data.final_effect ||
    data.acceptance_checks?.length ||
    data.issues?.length ||
    data.verification_gaps?.length ||
    data.recommended_next_action
  ));
}

function titleize(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function getLabel(t: Translate, group: string, value: string | undefined, fallback: string): string {
  return t(`toolCards.outcomeReview.${group}.${value ?? 'unknown'}`, {
    defaultValue: titleize(value, fallback),
  });
}

function verdictTone(verdict: string | undefined): Tone {
  switch (verdict) {
    case 'pass':
      return 'success';
    case 'pass_with_notes':
      return 'info';
    case 'needs_revision':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'inconclusive':
    default:
      return 'neutral';
  }
}

function riskTone(risk: string | undefined): Tone {
  switch (risk) {
    case 'low':
      return 'success';
    case 'medium':
      return 'warning';
    case 'high':
      return 'danger';
    default:
      return 'neutral';
  }
}

function confidenceTone(confidence: string | undefined): Tone {
  switch (confidence) {
    case 'high':
      return 'success';
    case 'medium':
      return 'info';
    case 'low':
      return 'warning';
    default:
      return 'neutral';
  }
}

function checkTone(status: string | undefined): Tone {
  switch (status) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'partial':
      return 'warning';
    case 'unverified':
    default:
      return 'neutral';
  }
}

function severityTone(severity: string | undefined): Tone {
  switch (severity) {
    case 'blocker':
      return 'danger';
    case 'major':
      return 'warning';
    case 'minor':
      return 'info';
    default:
      return 'neutral';
  }
}

function nextActionTone(action: string | undefined): Tone {
  switch (action) {
    case 'report_to_user':
      return 'success';
    case 'continue_work':
      return 'warning';
    case 'start_specialist_review':
    case 'ask_user':
      return 'info';
    case 'stop':
      return 'danger';
    default:
      return 'neutral';
  }
}

function toneClass(tone: Tone): string {
  return `outcome-review-card--tone-${tone}`;
}

function VerdictIcon({ verdict }: { verdict?: string }) {
  switch (verdict) {
    case 'pass':
      return <CheckCircle2 size={13} />;
    case 'pass_with_notes':
      return <Info size={13} />;
    case 'needs_revision':
      return <AlertTriangle size={13} />;
    case 'failed':
      return <XCircle size={13} />;
    case 'inconclusive':
    default:
      return <CircleHelp size={13} />;
  }
}

function StatusGlyph({ tone }: { tone: Tone }) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 size={14} />;
    case 'danger':
      return <XCircle size={14} />;
    case 'warning':
      return <AlertTriangle size={14} />;
    case 'info':
      return <Info size={14} />;
    case 'neutral':
    default:
      return <CircleHelp size={14} />;
  }
}

function HeaderStatusIcon({ phase, data }: { phase: ToolPresentationPhase; data: OutcomeReviewPayload | null }) {
  if (phase === 'running' || phase === 'receiving_input' || phase === 'preparing' || phase === 'ready') {
    return <DotMatrixLoader size="tiny" />;
  }

  if (phase === 'error' || phase === 'cancelled' || phase === 'interrupted') {
    return <XCircle size={13} />;
  }

  if (data?.verdict) {
    const tone = verdictTone(data.verdict);
    return (
      <span className={['outcome-review-card__status-icon', toneClass(tone)].join(' ')}>
        <VerdictIcon verdict={data.verdict} />
      </span>
    );
  }

  return <Clock3 size={13} />;
}

function MetaLine({
  items,
}: {
  items: Array<{
    label: React.ReactNode;
    value: React.ReactNode;
    tone?: Tone;
    mono?: boolean;
  }>;
}) {
  const visibleItems = items.filter(item => item.value !== undefined && item.value !== null && item.value !== '');
  if (visibleItems.length === 0) return null;

  return (
    <div className="outcome-review-card__meta-line">
      {visibleItems.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="outcome-review-card__meta-separator">/</span>}
          <span className="outcome-review-card__meta-item">
            <span className="outcome-review-card__meta-label">{item.label}</span>
            <span
              className={[
                'outcome-review-card__meta-value',
                item.tone ? toneClass(item.tone) : '',
                item.mono ? 'outcome-review-card__meta-value--mono' : '',
              ].filter(Boolean).join(' ')}
            >
              {item.value}
            </span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function StatusText({ value, tone = 'neutral' }: { value: React.ReactNode; tone?: Tone }) {
  return (
    <span className={['outcome-review-card__status-text', toneClass(tone)].join(' ')}>
      {value}
    </span>
  );
}

function renderHeaderSummary(
  t: Translate,
  phase: ToolPresentationPhase,
  data: OutcomeReviewPayload | null,
  error?: string,
): React.ReactNode {
  if (phase === 'error') {
    return t('toolCards.outcomeReview.failed', { error: error || t('toolCards.outcomeReview.unknownError') });
  }
  if (phase === 'cancelled') {
    return t('toolCards.outcomeReview.cancelled');
  }
  if (phase === 'interrupted') {
    return t('toolCards.outcomeReview.interrupted');
  }
  if (phase === 'running') {
    return t('toolCards.outcomeReview.submitting');
  }
  if (phase === 'receiving_input') {
    return t('toolCards.outcomeReview.receiving');
  }
  if (phase === 'preparing' || phase === 'ready') {
    return t('toolCards.outcomeReview.preparing');
  }

  if (!data?.summary && !data?.verdict) {
    return t('toolCards.outcomeReview.submitted');
  }

  const verdictLabel = getLabel(t, 'verdicts', data.verdict, t('toolCards.outcomeReview.verdictFallback'));
  return (
    <span className="outcome-review-card__header-summary">
      {data.verdict && (
        <span className={['outcome-review-card__header-verdict', toneClass(verdictTone(data.verdict))].join(' ')}>
          {verdictLabel}
        </span>
      )}
      {data.summary && (
        <span className="outcome-review-card__header-text">{data.summary}</span>
      )}
    </span>
  );
}

function renderCheckStatusIcon(status: string | undefined) {
  const tone = checkTone(status);
  return (
    <span className={['outcome-review-card__item-icon', toneClass(tone)].join(' ')}>
      <StatusGlyph tone={tone} />
    </span>
  );
}

export const OutcomeReviewToolCard: React.FC<ToolCardProps> = React.memo(({ toolItem }) => {
  const { t } = useTranslation('flow-chat');
  const { toolCall, toolResult, status } = toolItem;
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolId = toolItem.id ?? toolCall?.id;

  const inputPayload = useMemo(() => normalizePayload(toolCall?.input), [toolCall?.input]);
  const resultPayload = useMemo(() => normalizePayload(toolResult?.result), [toolResult?.result]);
  const reviewData = useMemo(
    () => mergePayload(resultPayload, inputPayload),
    [inputPayload, resultPayload],
  );
  const hasData = hasReviewContent(reviewData);

  const verdictLabel = getLabel(t, 'verdicts', reviewData?.verdict, t('toolCards.outcomeReview.verdictFallback'));
  const riskLabel = getLabel(t, 'riskLevels', reviewData?.risk_level, t('toolCards.outcomeReview.riskFallback'));
  const confidenceLabel = getLabel(
    t,
    'confidenceLevels',
    reviewData?.confidence,
    t('toolCards.outcomeReview.confidenceFallback'),
  );
  const nextAction = reviewData?.recommended_next_action;
  const nextActionLabel = getLabel(
    t,
    'nextActions',
    nextAction?.action,
    t('toolCards.outcomeReview.nextActionFallback'),
  );
  const checks = reviewData?.acceptance_checks ?? [];
  const issues = reviewData?.issues ?? [];
  const gaps = reviewData?.verification_gaps ?? [];
  const passedChecks = checks.filter(check => check.status === 'passed').length;
  const unresolvedChecks = checks.filter(check => check.status && check.status !== 'passed').length;

  const expandedContent = hasData || toolResult?.error ? (
    <div className="outcome-review-card__expanded" onClick={event => event.stopPropagation()}>
      {hasData && (
        <>
          <section className={['outcome-review-card__decision', toneClass(verdictTone(reviewData.verdict))].join(' ')}>
            <div className="outcome-review-card__decision-main">
              <span className="outcome-review-card__decision-label">{t('toolCards.outcomeReview.verdict')}</span>
              <span className="outcome-review-card__decision-value">{verdictLabel}</span>
              {reviewData.summary && (
                <span className="outcome-review-card__decision-summary">{reviewData.summary}</span>
              )}
            </div>
            <MetaLine
              items={[
                reviewData.risk_level
                  ? {
                    label: t('toolCards.outcomeReview.risk'),
                    value: riskLabel,
                    tone: riskTone(reviewData.risk_level),
                  }
                  : { label: '', value: undefined },
                reviewData.confidence
                  ? {
                    label: t('toolCards.outcomeReview.confidence'),
                    value: confidenceLabel,
                    tone: confidenceTone(reviewData.confidence),
                  }
                  : { label: '', value: undefined },
                reviewData.work_id
                  ? {
                    label: t('toolCards.outcomeReview.workId'),
                    value: reviewData.work_id,
                    mono: true,
                  }
                  : { label: '', value: undefined },
              ]}
            />
          </section>

          {reviewData.final_effect && (
            <section className="outcome-review-card__section">
              <div className="outcome-review-card__section-title">{t('toolCards.outcomeReview.finalEffect')}</div>
              <p className="outcome-review-card__body-text">{reviewData.final_effect}</p>
            </section>
          )}

          {nextAction && (
            <section className="outcome-review-card__section outcome-review-card__next">
              <div className="outcome-review-card__section-title">{t('toolCards.outcomeReview.nextStep')}</div>
              <div className="outcome-review-card__next-line">
                <StatusText value={nextActionLabel} tone={nextActionTone(nextAction.action)} />
              </div>
              {nextAction.instructions_for_os_agent && (
                <p className="outcome-review-card__body-text">{nextAction.instructions_for_os_agent}</p>
              )}
              {nextAction.instructions_for_work_if_revision_needed && (
                <div className="outcome-review-card__revision-note">
                  <span>{t('toolCards.outcomeReview.revisionInstruction')}</span>
                  <p>{nextAction.instructions_for_work_if_revision_needed}</p>
                </div>
              )}
            </section>
          )}

          {checks.length > 0 && (
            <section className="outcome-review-card__section">
              <div className="outcome-review-card__section-heading">
                <span className="outcome-review-card__section-title">
                  {t('toolCards.outcomeReview.acceptanceChecks')}
                </span>
                <span className="outcome-review-card__section-meta">
                  {t('toolCards.outcomeReview.checkSummary', {
                    passed: passedChecks,
                    unresolved: unresolvedChecks,
                    total: checks.length,
                  })}
                </span>
              </div>
              <div className="outcome-review-card__check-list">
                {checks.map((check, index) => {
                  const statusLabel = getLabel(
                    t,
                    'checkStatuses',
                    check.status,
                    t('toolCards.outcomeReview.checkStatusFallback'),
                  );
                  return (
                    <article key={`${check.criterion ?? index}-${index}`} className="outcome-review-card__check-item">
                      <div className="outcome-review-card__item-header">
                        {renderCheckStatusIcon(check.status)}
                        <span className="outcome-review-card__item-title">
                          {check.criterion || t('toolCards.outcomeReview.unnamedCheck')}
                        </span>
                        <StatusText value={statusLabel} tone={checkTone(check.status)} />
                      </div>
                      {check.evidence && (
                        <p className="outcome-review-card__item-text">
                          <span>{t('toolCards.outcomeReview.evidence')}</span>
                          {check.evidence}
                        </p>
                      )}
                      {check.reasoning && (
                        <p className="outcome-review-card__item-text outcome-review-card__item-text--muted">
                          <span>{t('toolCards.outcomeReview.reasoning')}</span>
                          {check.reasoning}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {issues.length > 0 && (
            <section className="outcome-review-card__section">
              <div className="outcome-review-card__section-title">
                {t('toolCards.outcomeReview.issues', { count: issues.length })}
              </div>
              <div className="outcome-review-card__issue-list">
                {issues.map((issue, index) => {
                  const severityLabel = getLabel(
                    t,
                    'severities',
                    issue.severity,
                    t('toolCards.outcomeReview.severityFallback'),
                  );
                  return (
                    <article key={`${issue.title ?? index}-${index}`} className="outcome-review-card__issue-item">
                      <div className="outcome-review-card__item-header">
                        <StatusText value={severityLabel} tone={severityTone(issue.severity)} />
                        <span className="outcome-review-card__item-title">
                          {issue.title || t('toolCards.outcomeReview.untitledIssue')}
                        </span>
                      </div>
                      {issue.impact && (
                        <p className="outcome-review-card__item-text">
                          <span>{t('toolCards.outcomeReview.impact')}</span>
                          {issue.impact}
                        </p>
                      )}
                      {issue.evidence && (
                        <p className="outcome-review-card__item-text">
                          <span>{t('toolCards.outcomeReview.evidence')}</span>
                          {issue.evidence}
                        </p>
                      )}
                      {issue.suggested_next_step && (
                        <p className="outcome-review-card__item-text outcome-review-card__item-text--muted">
                          <span>{t('toolCards.outcomeReview.suggestedNextStep')}</span>
                          {issue.suggested_next_step}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {gaps.length > 0 && (
            <section className="outcome-review-card__section">
              <div className="outcome-review-card__section-title">{t('toolCards.outcomeReview.verificationGaps')}</div>
              <ul className="outcome-review-card__gap-list">
                {gaps.map((gap, index) => (
                  <li key={`${gap}-${index}`}>{gap}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {toolResult?.error && <ToolErrorBlock message={toolResult.error} />}
    </div>
  ) : undefined;

  return (
    <DefaultToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      className="outcome-review-card"
      statusIcon={<HeaderStatusIcon phase={viewState.phase} data={reviewData} />}
      action={`${t('toolCards.outcomeReview.title')}:`}
      summary={renderHeaderSummary(t, viewState.phase, reviewData, toolResult?.error)}
      expandedContent={expandedContent}
    />
  );
});

OutcomeReviewToolCard.displayName = 'OutcomeReviewToolCard';
