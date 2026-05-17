import React from 'react';
import { ConfigPageSection } from './ConfigPageLayout';
import './ConfigCollectionSection.scss';

export interface ConfigCollectionSectionProps {
  title: string;
  toolbar?: React.ReactNode;
  filters?: React.ReactNode;
  editor?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const ConfigCollectionSection: React.FC<ConfigCollectionSectionProps> = ({
  title,
  toolbar,
  filters,
  editor,
  className = '',
  children,
}) => {
  const hasEditor = Boolean(editor);

  return (
    <ConfigPageSection
      title={title}
      className={`sparo-config-collection-section ${hasEditor ? 'sparo-config-collection-section--with-editor' : ''} ${className}`}
    >
      <div className="sparo-config-collection-section__content">
        {toolbar && (
          <div className="sparo-config-collection-section__toolbar">
            {toolbar}
          </div>
        )}
        {editor && (
          <div className="sparo-config-collection-section__editor">
            {editor}
          </div>
        )}
        {filters && (
          <div className="sparo-config-collection-section__filters">
            {filters}
          </div>
        )}
        <div className="sparo-config-collection-section__list">
          {children}
        </div>
      </div>
    </ConfigPageSection>
  );
};

export default ConfigCollectionSection;
