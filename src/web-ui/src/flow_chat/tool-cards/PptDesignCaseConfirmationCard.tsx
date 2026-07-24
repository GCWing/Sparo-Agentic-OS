import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Check, GalleryHorizontal, Palette, Rows3, Shapes } from 'lucide-react';
import { Button, DotMatrixLoader, Textarea } from '@/design-system';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { createLogger } from '@/shared/utils/logger';
import type { ToolCardProps } from '../types/flow-chat';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { BaseToolCard } from './BaseToolCard';
import { ToolArtifactFrame } from './ToolArtifactFrame';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolHeaderLayout } from './ToolHeaderLayout';
import { useToolDisclosureController } from './ToolDisclosureController';
import { getToolCardStatusFromViewState } from './toolStatus';
import './PptDesignCaseConfirmationCard.scss';

const log = createLogger('PptDesignCaseConfirmationCard');

interface DesignCaseSlide {
  slideId: string;
  title: string;
  pageRole: string;
  recipeId?: string;
  previewRef: string;
}

interface DesignDirection {
  keywords?: string[];
  tone?: string;
  audienceFit?: string;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function parseResult(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function previewUrl(ref: string): string {
  const value = ref.trim();
  if (/^(data:|https?:)/i.test(value)) return value;
  return isTauriRuntime() ? convertFileSrc(value) : value;
}

export const PptDesignCaseConfirmationCard: React.FC<ToolCardProps> = ({
  toolItem,
  mutationsDisabled = false,
}) => {
  const { t } = useTranslation('flow-chat');
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const toolStatus = getToolCardStatusFromViewState(viewState);
  const params = asRecord(runtimeState.partialInput || runtimeState.input || toolItem.toolCall?.input);
  const slides = Array.isArray(params.sampleSlides)
    ? params.sampleSlides.filter((slide: unknown): slide is DesignCaseSlide => {
        const item = asRecord(slide);
        return Boolean(item.slideId && item.title && item.pageRole && item.previewRef);
      }).slice(0, 3)
    : [];
  const direction = asRecord(params.colorDirection) as DesignDirection;
  const result = parseResult(toolItem.toolResult?.result);
  const decision = asRecord(asRecord(result.bridge).output).decision;
  const outcome = typeof decision?.outcome === 'string' ? decision.outcome : undefined;
  const failure = toolItem.toolResult?.error || t('toolCards.pptDesignCase.failure');
  const toolId = toolItem.id || toolItem.toolCall?.id;
  const isTerminal = viewState.isTerminal;
  const isFailed = viewState.phase === 'error' || toolItem.toolResult?.success === false;
  const awaitingDecision = !isTerminal && !isFailed && slides.length === 3 && runtimeState.inputPhase !== 'streaming';
  const awaitingPayload = !isTerminal && !isFailed && slides.length !== 3;
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedOutcome, setSubmittedOutcome] = useState<'approved' | 'revise' | null>(null);
  const { cardRootRef, isExpanded, toggleExpanded } = useToolDisclosureController({
    toolId,
    toolName: toolItem.toolName,
    status: toolStatus,
    initialExpanded: true,
    autoExpandStatuses: ['preparing', 'receiving', 'running', 'pending_confirmation'],
  });

  const submitDecision = useCallback(async (nextOutcome: 'approved' | 'revise', nextFeedback = '') => {
    if (!toolId || isSubmitting || mutationsDisabled) return;
    setIsSubmitting(true);
    setSubmittedOutcome(nextOutcome);
    try {
      await toolAPI.submitUserAnswers(toolId, {
        decision: nextOutcome,
        actor: 'user',
        reviewCapability: 'multimodal',
        feedback: nextFeedback.trim(),
      });
    } catch (error) {
      log.error('Failed to submit Design Case decision', { toolId, error });
      setIsSubmitting(false);
      setSubmittedOutcome(null);
    }
  }, [isSubmitting, mutationsDisabled, toolId]);

  const submitPresetRevision = useCallback((kind: 'color' | 'density' | 'language') => {
    const messages = {
      color: t('toolCards.pptDesignCase.revisionColorFeedback'),
      density: t('toolCards.pptDesignCase.revisionDensityFeedback'),
      language: t('toolCards.pptDesignCase.revisionLanguageFeedback'),
    };
    void submitDecision('revise', messages[kind]);
  }, [submitDecision, t]);

  const handleCardClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, label')) return;
    toggleExpanded('manual');
  };

  const header = (
    <ToolHeaderLayout
      icon={<GalleryHorizontal size={14} />}
      content={(
        <div className="ppt-design-case-card__title">
          <span>{t('toolCards.pptDesignCase.title')}</span>
          {awaitingDecision && (
            <span className="ppt-design-case-card__status is-waiting">
              <DotMatrixLoader size="tiny" />
              {t('toolCards.pptDesignCase.awaiting')}
            </span>
          )}
          {outcome === 'approved' && (
            <span className="ppt-design-case-card__status is-approved">
              <Check size={12} />
              {t('toolCards.pptDesignCase.approved')}
            </span>
          )}
          {outcome === 'revise' && (
            <span className="ppt-design-case-card__status is-revise">
              {t('toolCards.pptDesignCase.revisionRequested')}
            </span>
          )}
        </div>
      )}
    />
  );

  return (
    <div ref={cardRootRef} data-tool-card-id={toolId || ''}>
      <BaseToolCard
        status={toolStatus}
        isExpanded={isExpanded}
        onClick={handleCardClick}
        headerExpandAffordance
        requiresConfirmation={awaitingDecision}
        className="ppt-design-case-card"
        header={header}
        isFailed={isFailed}
        expandedContent={isExpanded ? (
          <ToolArtifactFrame
            loading={awaitingPayload}
            loadingLabel={t('toolCards.pptDesignCase.preparing')}
            error={isFailed ? <ToolErrorBlock title={t('toolCards.pptDesignCase.errorTitle')} message={failure} /> : undefined}
            className="ppt-design-case-card__artifact"
          >
            <div className="ppt-design-case-card__body">
              <div className="ppt-design-case-card__brief">
                <div>
                  <span>{t('toolCards.pptDesignCase.direction')}</span>
                  <strong>{direction.keywords?.join(' · ') || direction.tone || t('toolCards.pptDesignCase.inferred')}</strong>
                </div>
                <div>
                  <span>{t('toolCards.pptDesignCase.density')}</span>
                  <strong>{String(params.density || t('toolCards.pptDesignCase.inferred'))}</strong>
                </div>
                {direction.audienceFit && (
                  <div className="ppt-design-case-card__audience">
                    <span>{t('toolCards.pptDesignCase.audienceFit')}</span>
                    <strong>{direction.audienceFit}</strong>
                  </div>
                )}
              </div>

              <div className="ppt-design-case-card__previews">
                {slides.map((slide, index) => (
                  <figure key={slide.slideId} className="ppt-design-case-card__preview">
                    <img src={previewUrl(slide.previewRef)} alt={t('toolCards.pptDesignCase.previewAlt', { title: slide.title })} />
                    <figcaption>
                      <span>{String(index + 1).padStart(2, '0')} · {slide.pageRole}</span>
                      <strong>{slide.title}</strong>
                    </figcaption>
                  </figure>
                ))}
              </div>

              {awaitingDecision && (
                <div className="ppt-design-case-card__decision">
                  <p>{t('toolCards.pptDesignCase.guidance')}</p>
                  <div className="ppt-design-case-card__primary-actions">
                    <Button
                      size="small"
                      variant="primary"
                      onClick={() => void submitDecision('approved')}
                      isLoading={isSubmitting && submittedOutcome === 'approved'}
                      disabled={isSubmitting || mutationsDisabled}
                    >
                      <Check size={14} />
                      {t('toolCards.pptDesignCase.approveAction')}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => submitPresetRevision('color')} disabled={isSubmitting || mutationsDisabled}>
                      <Palette size={14} />
                      {t('toolCards.pptDesignCase.adjustColor')}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => submitPresetRevision('density')} disabled={isSubmitting || mutationsDisabled}>
                      <Rows3 size={14} />
                      {t('toolCards.pptDesignCase.adjustDensity')}
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => submitPresetRevision('language')} disabled={isSubmitting || mutationsDisabled}>
                      <Shapes size={14} />
                      {t('toolCards.pptDesignCase.adjustLanguage')}
                    </Button>
                  </div>
                  <div className="ppt-design-case-card__custom-feedback">
                    <Textarea
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      placeholder={t('toolCards.pptDesignCase.feedbackPlaceholder')}
                      maxLength={1000}
                      autoResize
                      disabled={isSubmitting || mutationsDisabled}
                    />
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => void submitDecision('revise', feedback)}
                      isLoading={isSubmitting && submittedOutcome === 'revise'}
                      disabled={!feedback.trim() || isSubmitting || mutationsDisabled}
                    >
                      {t('toolCards.pptDesignCase.submitFeedback')}
                    </Button>
                  </div>
                </div>
              )}

              {isTerminal && !isFailed && (
                <div className={`ppt-design-case-card__receipt is-${outcome || 'completed'}`}>
                  {outcome === 'approved'
                    ? t('toolCards.pptDesignCase.approvedReceipt')
                    : t('toolCards.pptDesignCase.revisionReceipt')}
                </div>
              )}
            </div>
          </ToolArtifactFrame>
        ) : undefined}
      />
    </div>
  );
};

export default PptDesignCaseConfirmationCard;
