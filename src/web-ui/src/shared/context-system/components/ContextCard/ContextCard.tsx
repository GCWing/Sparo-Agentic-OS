

import React, { useMemo } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { ContextItem } from '../../../types/context';
import { contextRegistry } from '../../../services/ContextRegistry';
import { useContextStore, selectValidationState, selectIsValidating } from '../../../stores/contextStore';
import { useI18n } from '@/infrastructure/i18n';
import { DotMatrixLoader, IconButton } from '@/design-system';
import './ContextCard.scss';

export interface ContextCardProps {
  context: ContextItem;
  onRemove?: (id: string) => void;
  compact?: boolean;
  interactive?: boolean;
  showPreview?: boolean;
  className?: string;
}

export const ContextCard: React.FC<ContextCardProps> = ({
  context,
  onRemove,
  compact = false,
  interactive = true,
  showPreview = true,
  className = ''
}) => {
  const { t } = useI18n('components');

  const validationState = useContextStore(selectValidationState(context.id));
  const isValidating = useContextStore(selectIsValidating(context.id));


  const renderer = useMemo(() => {
    return contextRegistry.getRenderer(context.type);
  }, [context.type]);


  const definition = useMemo(() => {
    return contextRegistry.getDefinition(context.type);
  }, [context.type]);


  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(context.id);
  };


  const content = renderer
    ? renderer.render(context, { compact, interactive, showPreview })
    : (
      <div className="sparo-context-card__fallback">
        <div className="sparo-context-card__icon">
          <AlertCircle size={20} />
        </div>
        <div className="sparo-context-card__content">
          <div className="sparo-context-card__title">
            {t('contextSystem.contextCard.unknownType', { type: context.type })}
          </div>
        </div>
      </div>
    );


  const validationClass = validationState
    ? validationState.valid
      ? 'sparo-context-card--valid'
      : 'sparo-context-card--invalid'
    : '';

  return (
    <div
      className={`
        sparo-context-card
        sparo-context-card--${context.type}
        ${validationClass}
        ${compact ? 'sparo-context-card--compact' : ''}
        ${interactive ? 'sparo-context-card--interactive' : ''}
        ${className}
      `.trim()}
      data-context-id={context.id}
      data-context-type={context.type}
    >

      {definition && (
        <div
          className="sparo-context-card__indicator"
          style={validationState?.valid === false ? undefined : { backgroundColor: definition.color }}
        />
      )}


      <div className="sparo-context-card__body">
        {content}
      </div>


      {interactive && (
        <div className="sparo-context-card__toolbar">

          <div className="sparo-context-card__validation">
            {isValidating ? (
              <DotMatrixLoader size="tiny" className="sparo-context-card__spinner" />
            ) : validationState ? (
              validationState.valid ? (
                <CheckCircle size={14} className="sparo-context-card__icon--success" />
              ) : (
                <span title={validationState.error}>
                  <AlertCircle
                    size={14}
                    className="sparo-context-card__icon--error"
                  />
                </span>
              )
            ) : null}
          </div>


          {onRemove && (
            <IconButton
              className="sparo-context-card__remove-control"
              onClick={handleRemove}
              aria-label={t('contextSystem.contextCard.removeContext')}
              tooltip={t('contextSystem.contextCard.removeContext')}
              size="xs"
              variant="ghost"
            >
              <X size={14} />
            </IconButton>
          )}
        </div>
      )}


      {validationState && !validationState.valid && validationState.error && (
        <div className="sparo-context-card__error">
          <AlertCircle size={12} />
          <span>{validationState.error}</span>
        </div>
      )}


      {validationState && validationState.valid && validationState.warnings && validationState.warnings.length > 0 && (
        <div className="sparo-context-card__warnings">
          {validationState.warnings.map((warning, idx) => (
            <div key={idx} className="sparo-context-card__warning">
              <AlertCircle size={12} />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ContextCard;
