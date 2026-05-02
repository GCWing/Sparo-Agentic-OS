import React from 'react';
import './EyebrowLabel.scss';

interface EyebrowLabelProps {
  children: React.ReactNode;
  className?: string;
}

const EyebrowLabel: React.FC<EyebrowLabelProps> = ({ children, className }) => (
  <div className={`eyebrow-label${className ? ` ${className}` : ''}`}>
    <span className="eyebrow-label__dot" aria-hidden="true" />
    <span className="eyebrow-label__text">{children}</span>
  </div>
);

export default EyebrowLabel;
