import React, { forwardRef } from 'react';
import { EmptyState, type EmptyStateProps } from '../../primitives/EmptyState';
import { Panel, PanelBody, PanelHeader, type PanelProps } from '../Panel';
import './EmptyStatePanel.scss';

export interface EmptyStatePanelProps extends Omit<PanelProps, 'children' | 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  emptyState: EmptyStateProps;
}

export const EmptyStatePanel = forwardRef<HTMLDivElement, EmptyStatePanelProps>(
  ({ title, description, actions, emptyState, className = '', ...props }, ref) => (
    <Panel ref={ref} className={['ds-empty-state-panel', className].filter(Boolean).join(' ')} {...props}>
      {(title || description || actions) && (
        <PanelHeader title={title} description={description} actions={actions} />
      )}
      <PanelBody className="ds-empty-state-panel__body">
        <EmptyState {...emptyState} />
      </PanelBody>
    </Panel>
  )
);

EmptyStatePanel.displayName = 'EmptyStatePanel';
