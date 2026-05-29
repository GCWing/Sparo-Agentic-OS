/**
 * AskUserQuestion tool card component
 * Displays multiple questions, collects user answers and submits them
 */

import React, { useState, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { Loader2, AlertCircle, Send, MessageCircleQuestion, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FlowToolItem, ToolCardProps } from '../types/flow-chat';
import { toolAPI } from '@/infrastructure/api/service-api/ToolAPI';
import { createLogger } from '@/shared/utils/logger';
import { Button, Checkbox, Input, Radio } from '@/design-system';
import { useToolCardHeightContract } from './useToolCardHeightContract';
import { DefaultToolCardTemplate } from './templates';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import './AskUserQuestionCard.scss';

const log = createLogger('AskUserQuestionCard');

interface QuestionOption {
  label: string;
  description: string;
}

interface QuestionData {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

function normalizeQuestionsFromParams(input: unknown): QuestionData[] {
  if (!input || typeof input !== 'object') return [];
  const raw = input as Record<string, unknown>;
  const qs = raw.questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((q: any) => ({
    question: q.question || '',
    header: q.header || '',
    options: Array.isArray(q.options) ? q.options : [],
    multiSelect: Boolean(q.multiSelect),
  }));
}

/** Same source as FileOperationToolCard: partial JSON while streaming, then final toolCall.input. */
function isAwaitingQuestionPayload(questionsLength: number, toolItem: FlowToolItem): boolean {
  if (questionsLength > 0) return false;
  const runtimeState = deriveToolRuntimeState(toolItem);
  const viewState = getToolViewState(toolItem);
  return runtimeState.inputPhase === 'streaming' || viewState.phase === 'preparing' || runtimeState.lifecycle === 'pending';
}

export const AskUserQuestionCard: React.FC<ToolCardProps> = ({
  toolItem
}) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolCall, toolResult } = toolItem;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';

  const paramsSource = runtimeState.partialInput || runtimeState.input;
  const questions = useMemo(
    () => normalizeQuestionsFromParams(paramsSource),
    [paramsSource]
  );

  const awaitingPayload = isAwaitingQuestionPayload(questions.length, toolItem);
  
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCompletedSummary, setShowCompletedSummary] = useState(isCompleted);
  const toolId = toolItem.id ?? toolCall?.id;
  const { cardRootRef, applyExpandedState } = useToolCardHeightContract({
    toolId,
    toolName: toolItem.toolName,
  });
  const previousStatusRef = useRef(status);

  useLayoutEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (previousStatus !== 'completed' && isCompleted && !showCompletedSummary) {
      applyExpandedState(true, false, (nextExpanded) => {
        setShowCompletedSummary(!nextExpanded);
      }, {
        reason: 'auto',
      });
      return;
    }

    if (!isCompleted && showCompletedSummary) {
      setShowCompletedSummary(false);
    }
  }, [applyExpandedState, isCompleted, showCompletedSummary, status]);

  const isAllAnswered = useCallback(() => {
    if (questions.length === 0) return false;
    
    for (let i = 0; i < questions.length; i++) {
      const answer = answers[i];
      if (!answer) return false;
      if (Array.isArray(answer) && answer.length === 0) return false;
      if (typeof answer === 'string' && answer === '') return false;
    }
    return true;
  }, [answers, questions.length]);

  const handleSingleChange = useCallback((questionIndex: number, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionIndex]: value
    }));
  }, []);

  const handleMultiChange = useCallback((questionIndex: number, value: string, checked: boolean) => {
    setAnswers(prev => {
      const current = prev[questionIndex];
      const currentArray = Array.isArray(current) ? current : [];
      
      if (checked) {
        return { ...prev, [questionIndex]: [...currentArray, value] };
      } else {
        return { ...prev, [questionIndex]: currentArray.filter(v => v !== value) };
      }
    });
  }, []);

  const handleOtherInputChange = useCallback((questionIndex: number, value: string) => {
    setOtherInputs(prev => ({
      ...prev,
      [questionIndex]: value
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isAllAnswered() || isSubmitting || isSubmitted) return;

    const toolId = toolItem.id;
    setIsSubmitting(true);
    try {
      const processedAnswers: Record<string, string | string[]> = {};
      
      for (let i = 0; i < questions.length; i++) {
        const answer = answers[i];
        const otherInput = otherInputs[i] || '';
        
        if (Array.isArray(answer)) {
          processedAnswers[String(i)] = answer.map(v => 
            v === 'Other' ? (otherInput || 'Other') : v
          );
        } else {
          processedAnswers[String(i)] = answer === 'Other' ? (otherInput || 'Other') : answer;
        }
      }

      const answersPayload = processedAnswers;
      
      await toolAPI.submitUserAnswers(toolId, answersPayload);
      
      setIsSubmitted(true);
    } catch (error) {
      log.error('Failed to submit answers', { toolId, error });
    } finally {
      setIsSubmitting(false);
    }
  }, [toolItem.id, answers, otherInputs, questions.length, isAllAnswered, isSubmitting, isSubmitted]);

  const getStatusIcon = () => {
    if (isCompleted) {
      return null;
    }
    if (isSubmitting) {
      return <Loader2 size={16} className="status-icon-loading animate-spin" />;
    }
    return <AlertCircle size={16} className="status-icon-waiting" />;
  };

  const getStatusText = () => {
    if (isCompleted) return t('toolCards.askUser.completed');
    if (isSubmitted) return t('toolCards.askUser.submittedWaiting');
    if (isSubmitting) return t('toolCards.askUser.submitting');
    return t('toolCards.askUser.waitingAnswer');
  };

  const getEffectiveAnswer = useCallback((questionIndex: number): string | string[] | undefined => {
    const localAnswer = answers[questionIndex];
    if (localAnswer !== undefined) return localAnswer;

    if (isCompleted && toolResult?.result) {
      const result = typeof toolResult.result === 'string'
        ? JSON.parse(toolResult.result)
        : toolResult.result;
      return result?.answers?.[String(questionIndex)];
    }
    return undefined;
  }, [answers, isCompleted, toolResult]);

  const renderQuestion = (q: QuestionData, questionIndex: number) => {
    const answer = getEffectiveAnswer(questionIndex);
    const otherInput = otherInputs[questionIndex] || '';
    
    const isOtherSelected = q.multiSelect 
      ? Array.isArray(answer) && answer.includes('Other')
      : answer === 'Other';

    const inputName = `question-${questionIndex}`;
    const isDisabled = isSubmitted || isCompleted || runtimeState.inputPhase === 'streaming';

    return (
      <div key={questionIndex} className="ask-question-item">
        <div className="question-item-header">
          <span className="question-header-chip">{q.header}</span>
          <span className="question-text">{q.question}</span>
        </div>
        
        <div className="question-options">
          {q.options.map((option, optIdx) => {
            const checked = q.multiSelect
              ? Array.isArray(answer) && answer.includes(option.label)
              : answer === option.label;
            const optionClassName = [
              'option-label',
              checked && 'option-label--selected',
            ].filter(Boolean).join(' ');

            return q.multiSelect ? (
              <Checkbox
                key={optIdx}
                className={optionClassName}
                size="small"
                name={inputName}
                value={option.label}
                checked={checked}
                onChange={(e) => handleMultiChange(questionIndex, option.label, e.target.checked)}
                disabled={isDisabled}
              >
                <div className="option-content">
                  <div className="option-label-text">{option.label}</div>
                  <div className="option-description">{option.description}</div>
                </div>
              </Checkbox>
            ) : (
              <Radio
                key={optIdx}
                className={optionClassName}
                size="small"
                name={inputName}
                value={option.label}
                checked={checked}
                onChange={(e) => handleSingleChange(questionIndex, e.target.value)}
                disabled={isDisabled}
              >
                <div className="option-content">
                  <div className="option-label-text">{option.label}</div>
                  <div className="option-description">{option.description}</div>
                </div>
              </Radio>
            );
          })}
          
          {!isOtherSelected ? (
            q.multiSelect ? (
              <Checkbox
                className="option-label option-other"
                size="small"
                name={inputName}
                value="Other"
                checked={false}
                onChange={(e) => {
                  if (e.target.checked) {
                    handleMultiChange(questionIndex, 'Other', true);
                  }
                }}
                disabled={isDisabled}
              >
                <div className="option-content">
                  <div className="option-label-text">{t('toolCards.askUser.other')}</div>
                  <div className="option-description">{t('toolCards.askUser.customInputHint')}</div>
                </div>
              </Checkbox>
              ) : (
              <Radio
                className="option-label option-other"
                size="small"
                name={inputName}
                value="Other"
                checked={false}
                onChange={() => handleSingleChange(questionIndex, 'Other')}
                disabled={isDisabled}
              >
                <div className="option-content">
                  <div className="option-label-text">{t('toolCards.askUser.other')}</div>
                  <div className="option-description">{t('toolCards.askUser.customInputHint')}</div>
                </div>
              </Radio>
            )
          ) : (
            <div className="option-other-input">
              {q.multiSelect ? (
                <Checkbox
                  className="option-other-toggle"
                  size="small"
                  name={inputName}
                  value="Other"
                  checked
                  aria-label={t('toolCards.askUser.other')}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      handleMultiChange(questionIndex, 'Other', false);
                    }
                  }}
                  disabled={isDisabled}
                />
              ) : (
                <Radio
                  className="option-other-toggle"
                  size="small"
                  name={inputName}
                  value="Other"
                  checked
                  aria-label={t('toolCards.askUser.other')}
                  onChange={() => {}}
                  disabled={isDisabled}
                />
              )}
              <Input
                className="other-input-inline"
                inputSize="small"
                placeholder={t('toolCards.askUser.pleaseSpecify')}
                value={otherInput}
                onChange={(e) => handleOtherInputChange(questionIndex, e.target.value)}
                disabled={isDisabled}
                autoFocus
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const getAnswerDisplay = (questionIndex: number): string => {
    const answer = getEffectiveAnswer(questionIndex);
    const otherInput = otherInputs[questionIndex] || '';
    
    if (!answer) return '';
    if (Array.isArray(answer)) {
      return answer.map(v => v === 'Other' ? otherInput || 'Other' : v).join(', ');
    }
    return answer === 'Other' ? otherInput || 'Other' : String(answer);
  };

  const getAnswersSummary = (): string => {
    return questions.map((q, idx) => {
      const answerText = getAnswerDisplay(idx);
      return `${q.header}: ${answerText || t('toolCards.askUser.notAnswered')}`;
    }).join(' | ');
  };

  const renderResult = () => {
    if (!toolResult?.result) return null;
    
    const result = typeof toolResult.result === 'string' 
      ? JSON.parse(toolResult.result) 
      : toolResult.result;
    
    if (result.status === 'timeout') {
      return (
        <div className="result-timeout">
          <AlertCircle size={16} />
          <span>{t('toolCards.askUser.timeout')}</span>
        </div>
      );
    }
    
    return null;
  };

  if (viewState.phase === 'error') {
    return (
      <div
        ref={cardRootRef}
        data-tool-card-id={toolId ?? ''}
        className="ask-user-completed-root"
      >
        <DefaultToolCardTemplate
          toolId={toolId}
          toolName={toolItem.toolName}
          status="error"
          className="ask-user-question-tool-card"
          action={t('toolCards.askUser.headerAction')}
          summary={<span className="ask-user-error-label">{t('toolCards.askUser.validationError')}</span>}
          statusIcon={<XCircle size={14} className="ask-user-error-icon" />}
        />
      </div>
    );
  }

  if (awaitingPayload) {
    return (
      <div
        ref={cardRootRef}
        data-tool-card-id={toolId ?? ''}
        className="ask-user-loading-root"
      >
        <DefaultToolCardTemplate
          toolId={toolId}
          toolName={toolItem.toolName}
          status={status}
          className="ask-user-question-tool-card params-loading"
          action={t('toolCards.askUser.headerAction')}
          summary={<span className="params-loading-text">{t('toolCards.askUser.loadingQuestions')}</span>}
          statusIcon={<Loader2 size={16} className="status-icon-loading animate-spin" />}
        />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div ref={cardRootRef} data-tool-card-id={toolId ?? ''} className="ask-user-completed-root">
        <DefaultToolCardTemplate
          toolId={toolId}
          toolName={toolItem.toolName}
          status="error"
          className="ask-user-question-tool-card"
          action={t('toolCards.askUser.headerAction')}
          summary={<span className="error-message">{t('toolCards.askUser.parseError')}</span>}
          statusIcon={<XCircle size={14} className="ask-user-error-icon" />}
        />
      </div>
    );
  }

  const expandedContent = (
    <div className={`questions-container${showCompletedSummary ? ' expanded' : ''}`}>
      {questions.map((q, idx) => renderQuestion(q, idx))}
    </div>
  );

  return (
    <div
      ref={cardRootRef}
      data-tool-card-id={toolId ?? ''}
      className={
        showCompletedSummary
          ? 'ask-user-completed-root'
          : `ask-user-question-card status-${status}`
      }
    >
      {!showCompletedSummary ? (
        <DefaultToolCardTemplate
          toolId={toolId}
          toolName={toolItem.toolName}
          status={status}
          isExpanded
          expandable
          onToggle={(nextExpanded) => applyExpandedState(isExpanded, nextExpanded, setIsExpanded)}
          className="ask-user-question-tool-card"
          action={t('toolCards.askUser.headerAction')}
          summary={<span className="questions-count">{t('toolCards.askUser.questionsCount', { count: questions.length })}</span>}
          extra={<span className="ask-user-header-status">{getStatusText()}</span>}
          statusIcon={getStatusIcon() ?? undefined}
          expandedContent={(
            <>
              {expandedContent}
              <div className="card-footer-row">
                <div className="footer-actions">
                  <Button
                    variant="primary"
                    size="small"
                    className="submit-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSubmit();
                    }}
                    disabled={!isAllAnswered() || isSubmitting || runtimeState.inputPhase === 'streaming'}
                    isLoading={isSubmitting}
                    title={!isAllAnswered() ? t('toolCards.askUser.answerAllBeforeSubmit') : ""}
                  >
                    {isSubmitting ? (
                      <span>{t('toolCards.askUser.submitting')}</span>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>{t('toolCards.askUser.submit')}</span>
                      </>
                    )}
                  </Button>
                  <div className="tool-status">
                    {getStatusIcon()}
                    <span className="status-text">{getStatusText()}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        />
      ) : (
        <>
          <div className="ask-user-question-completed-wrap">
            <DefaultToolCardTemplate
              toolId={toolId}
              toolName={toolItem.toolName}
              status={status}
              isExpanded={isExpanded}
              expandable
              onToggle={(nextExpanded) => applyExpandedState(isExpanded, nextExpanded, setIsExpanded)}
              className="ask-user-question-tool-card"
              action={t('toolCards.askUser.headerAction')}
              summary={<span className="ask-user-answers-compact-line">{getAnswersSummary()}</span>}
              statusIcon={<MessageCircleQuestion size={12} className="ask-user-icon" />}
              expandedContent={expandedContent}
            />
            {renderResult()}
          </div>
        </>
      )}
    </div>
  );
};
