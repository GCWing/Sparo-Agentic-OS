import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AiUsageGuide } from '@/design-system/types';

interface PreviewUsageGuideProps {
  guide?: AiUsageGuide;
  variant?: 'disclosure' | 'panel';
}

function GuideList({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <section className="preview-usage-guide__section">
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export const PreviewUsageGuide: React.FC<PreviewUsageGuideProps> = ({
  guide,
  variant = 'disclosure',
}) => {
  const { t } = useTranslation('design-system/preview');

  if (!guide) {
    return null;
  }

  const noteCount = [
    guide.useWhen,
    guide.composeWith,
    guide.avoid,
    guide.states,
  ].reduce((count, items) => count + (items?.length ?? 0), 0);

  const body = (
    <div className="preview-usage-guide__body">
      {guide.recipe && (
        <div className="preview-usage-guide__recipe">
          {t('guide.recipe')} <code>{guide.recipe}</code>
        </div>
      )}
      <div className="preview-usage-guide__grid">
        <GuideList title={t('guide.useWhen')} items={guide.useWhen} />
        <GuideList title={t('guide.composeWith')} items={guide.composeWith} />
        <GuideList title={t('guide.avoid')} items={guide.avoid} />
        <GuideList title={t('guide.states')} items={guide.states} />
      </div>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="preview-usage-guide preview-usage-guide--panel">
        <div className="preview-usage-guide__panel-meta">
          {t('guide.notes', { count: noteCount })}
        </div>
        {body}
      </div>
    );
  }

  return (
    <details className="preview-usage-guide">
      <summary>
        <span>{t('focused.usageGuidance')}</span>
        <span className="preview-usage-guide__count">
          {t('guide.notes', { count: noteCount })}
        </span>
      </summary>
      {body}
    </details>
  );
};
