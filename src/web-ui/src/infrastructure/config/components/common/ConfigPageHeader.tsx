import React from 'react';
import './ConfigPageHeader.scss';

export interface ConfigPageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}

export const ConfigPageHeader: React.FC<ConfigPageHeaderProps> = ({
  title,
  subtitle,
  icon: _icon,
  extra,
  className = '',
}) => {
  return (
    <div className={`sparo-config-page-header ${className}`}>
      <div className="sparo-config-page-header__inner">
        <div className="sparo-config-page-header__left">
          <div className="sparo-config-page-header__info">
            <h2 className="sparo-config-page-header__title">{title}</h2>
            {subtitle ? (
              <p className="sparo-config-page-header__subtitle">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {extra && (
          <div className="sparo-config-page-header__extra">
            {extra}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPageHeader;
