import React, { forwardRef } from 'react';
import './ListDetail.scss';

export interface ListDetailProps extends React.HTMLAttributes<HTMLDivElement> {
  list: React.ReactNode;
  detail: React.ReactNode;
  listLabel?: React.ReactNode;
  detailLabel?: React.ReactNode;
  ratio?: 'narrow' | 'balanced' | 'wide';
}

export const ListDetail = forwardRef<HTMLDivElement, ListDetailProps>(
  ({ list, detail, listLabel, detailLabel, ratio = 'balanced', className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={['ds-list-detail', `ds-list-detail--${ratio}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      <aside className="ds-list-detail__list" aria-label={typeof listLabel === 'string' ? listLabel : undefined}>
        {listLabel && <div className="ds-list-detail__label">{listLabel}</div>}
        {list}
      </aside>
      <section className="ds-list-detail__detail" aria-label={typeof detailLabel === 'string' ? detailLabel : undefined}>
        {detailLabel && <div className="ds-list-detail__label">{detailLabel}</div>}
        {detail}
      </section>
    </div>
  )
);

ListDetail.displayName = 'ListDetail';
