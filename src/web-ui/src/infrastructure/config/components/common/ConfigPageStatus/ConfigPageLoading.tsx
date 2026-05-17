import React from 'react';
import './ConfigPage.scss';

export interface ConfigPageLoadingProps {
  text: string;
  className?: string;
}

export const ConfigPageLoading: React.FC<ConfigPageLoadingProps> = ({
  text,
  className = '',
}) => {
  return (
    <div className={`sparo-config-page-loading ${className}`}>
      {text}
    </div>
  );
};

