import React, { forwardRef } from 'react';
import { Panel, PanelBody, PanelHeader, type PanelHeaderProps } from '../Panel';
import './SettingsPage.scss';

export type SettingsPageWidth = 'narrow' | 'default' | 'wide' | 'full';

export interface SettingsPageProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: SettingsPageWidth;
}

export const SettingsPage = forwardRef<HTMLDivElement, SettingsPageProps>(
  ({ children, width = 'default', className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={['ds-settings-page', `ds-settings-page--width-${width}`, className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </div>
  )
);

SettingsPage.displayName = 'SettingsPage';

export interface SettingsSectionProps extends PanelHeaderProps {
  children?: React.ReactNode;
}

export const SettingsSection = forwardRef<HTMLDivElement, SettingsSectionProps>(
  ({ title, description, actions, children, className = '', ...props }, ref) => (
    <Panel ref={ref} className={['ds-settings-section', className].filter(Boolean).join(' ')} {...props}>
      {(title || description || actions) && (
        <PanelHeader title={title} description={description} actions={actions} />
      )}
      <PanelBody>{children}</PanelBody>
    </Panel>
  )
);

SettingsSection.displayName = 'SettingsSection';
