/**
 * Uniform wrapper for every configurable / readable Section in the detail page.
 * Provides a title, optional count chip, optional right-hand actions, and a
 * body slot. Used by every Agent section so the page reads as one form even
 * though each section is implemented separately.
 */
import React from 'react';

export interface SectionCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  dirty?: boolean;
  children: React.ReactNode;
  id?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  description,
  count,
  actions,
  dirty,
  children,
  id,
}) => (
  <section
    id={id}
    className={['app-detail-section', dirty && 'app-detail-section--dirty']
      .filter(Boolean)
      .join(' ')}
  >
    <header className="app-detail-section__head">
      <div className="app-detail-section__title-wrap">
        <h3 className="app-detail-section__title">{title}</h3>
        {count !== undefined && count !== null ? (
          <span className="app-detail-section__count">{count}</span>
        ) : null}
        {dirty ? <span className="app-detail-section__dirty-dot" aria-hidden="true" /> : null}
      </div>
      {actions ? <div className="app-detail-section__actions">{actions}</div> : null}
    </header>
    {description ? <p className="app-detail-section__description">{description}</p> : null}
    <div className="app-detail-section__body">{children}</div>
  </section>
);
