import React, { forwardRef } from 'react';
import { Panel, PanelBody, PanelHeader, type PanelProps } from '../Panel';
import './InspectorPanel.scss';

export interface InspectorPanelProps extends Omit<PanelProps, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}

export const InspectorPanel = forwardRef<HTMLDivElement, InspectorPanelProps>(
  ({ title, description, actions, footer, children, className = '', ...props }, ref) => (
    <Panel ref={ref} className={['ds-inspector-panel', className].filter(Boolean).join(' ')} {...props}>
      {(title || description || actions) && (
        <PanelHeader title={title} description={description} actions={actions} />
      )}
      <PanelBody className="ds-inspector-panel__body">{children}</PanelBody>
      {footer && <div className="ds-inspector-panel__footer">{footer}</div>}
    </Panel>
  )
);

InspectorPanel.displayName = 'InspectorPanel';
