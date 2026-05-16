import React from 'react';
import type { AiUsageGuide } from '@/design-system/types';

interface PreviewUsageGuideProps {
  guide?: AiUsageGuide;
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

export const PreviewUsageGuide: React.FC<PreviewUsageGuideProps> = ({ guide }) => {
  if (!guide) {
    return null;
  }

  return (
    <div className="preview-usage-guide" aria-label="Usage guidance">
      {guide.recipe && (
        <div className="preview-usage-guide__recipe">
          Recipe: <code>{guide.recipe}</code>
        </div>
      )}
      <div className="preview-usage-guide__grid">
        <GuideList title="Use when" items={guide.useWhen} />
        <GuideList title="Compose with" items={guide.composeWith} />
        <GuideList title="Avoid" items={guide.avoid} />
        <GuideList title="States" items={guide.states} />
      </div>
    </div>
  );
};
