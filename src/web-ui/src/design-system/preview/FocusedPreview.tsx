import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, PanelRightOpen, X } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import type { PreviewCategory, PreviewExample } from '@/design-system/types';
import { PreviewUsageGuide } from './PreviewUsageGuide';
import './FocusedPreview.css';

interface FocusedPreviewProps {
  category: PreviewCategory;
  example: PreviewExample;
  index: number;
  total: number;
  previousExample: PreviewExample;
  nextExample: PreviewExample;
  onPrevious: () => void;
  onNext: () => void;
}

export const FocusedPreview: React.FC<FocusedPreviewProps> = ({
  category,
  example,
  index,
  total,
  previousExample,
  nextExample,
  onPrevious,
  onNext,
}) => {
  const Example = example.render;
  const tier = category.tier ?? 'primitive';
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const { t } = useTranslation('design-system/preview');

  return (
    <section className={`focused-preview focused-preview--${tier}`}>
      <header className="focused-preview__header">
        <div className="focused-preview__title-group">
          <div className="focused-preview__eyebrow">
            <span>{t(`focused.tiers.${tier}`)}</span>
            <span>{category.name}</span>
          </div>
          <div className="focused-preview__heading">
            <div>
              <h2>{example.name}</h2>
              <p>{example.description}</p>
            </div>
            <code>{example.id}</code>
          </div>
        </div>

        <div className="focused-preview__controls">
          <nav
            className="focused-preview__stepper"
            aria-label={t('focused.examplesAriaLabel')}
          >
            <IconButton
              size="small"
              variant="ghost"
              onClick={onPrevious}
              aria-label={t('focused.previous', { name: previousExample.name })}
              tooltip={t('focused.previous', { name: previousExample.name })}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </IconButton>
            <span>
              {String(index + 1).padStart(2, '0')}
              <i>/</i>
              {String(total).padStart(2, '0')}
            </span>
            <IconButton
              size="small"
              variant="ghost"
              onClick={onNext}
              aria-label={t('focused.next', { name: nextExample.name })}
              tooltip={t('focused.next', { name: nextExample.name })}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </IconButton>
          </nav>
          <Button
            className="focused-preview__usage-trigger"
            size="small"
            variant="ghost"
            onClick={() => setIsUsageOpen((open) => !open)}
            aria-expanded={isUsageOpen}
          >
            <PanelRightOpen size={13} aria-hidden="true" />
            {t('focused.usage')}
          </Button>
        </div>
      </header>

      <div className="focused-preview__body">
        <div className="focused-preview__stage">
          <div className="focused-preview__viewport">
            <Example />
          </div>
        </div>

        {isUsageOpen && (
          <aside
            className="focused-preview__inspector"
            aria-label={t('focused.usageGuidance')}
          >
            <div className="focused-preview__inspector-header">
              <span>{t('focused.usage')}</span>
              <IconButton
                size="xs"
                variant="ghost"
                onClick={() => setIsUsageOpen(false)}
                aria-label={t('focused.closeUsage')}
                tooltip={t('focused.closeUsage')}
              >
                <X size={12} aria-hidden="true" />
              </IconButton>
            </div>
            <PreviewUsageGuide guide={example.ai} variant="panel" />
          </aside>
        )}
      </div>
    </section>
  );
};
