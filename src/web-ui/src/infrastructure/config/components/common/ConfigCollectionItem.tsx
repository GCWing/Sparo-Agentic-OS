import React, { useState } from 'react';
import './ConfigCollectionItem.scss';

export interface ConfigCollectionItemProps {
  label: React.ReactNode;
  badge?: React.ReactNode;
  badgePlacement?: 'inline' | 'below';
  control: React.ReactNode;
  details?: React.ReactNode;
  disabled?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export const ConfigCollectionItem: React.FC<ConfigCollectionItemProps> = ({
  label,
  badge,
  badgePlacement = 'inline',
  control,
  details,
  disabled = false,
  expanded: expandedProp,
  onToggle,
  className = '',
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isControlled = expandedProp !== undefined;
  const isExpanded = isControlled ? expandedProp : internalExpanded;
  const hasDetails = Boolean(details);

  const handleRowClick = () => {
    if (!hasDetails) return;
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  return (
    <div
      className={`sparo-collection-item ${isExpanded ? 'is-expanded' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
    >
      <div className="sparo-config-page-row sparo-config-page-row--center sparo-collection-item__row">
        {hasDetails ? (
          <button
            type="button"
            className="sparo-config-page-row__meta sparo-collection-item__main sparo-collection-item__main--clickable"
            onClick={handleRowClick}
            aria-expanded={isExpanded}
          >
            <div
              className={`sparo-config-page-row__label sparo-collection-item__label ${
                badgePlacement === 'below' ? 'sparo-collection-item__label--stacked' : ''
              }`}
            >
              <span className="sparo-collection-item__name">{label}</span>
              {badge && (
                <span
                  className={`sparo-collection-item__badges ${
                    badgePlacement === 'below'
                      ? 'sparo-collection-item__badges--stacked'
                      : 'sparo-collection-item__badges--inline'
                  }`}
                >
                  {badge}
                </span>
              )}
            </div>
          </button>
        ) : (
          <div className="sparo-config-page-row__meta sparo-collection-item__main">
            <div
              className={`sparo-config-page-row__label sparo-collection-item__label ${
                badgePlacement === 'below' ? 'sparo-collection-item__label--stacked' : ''
              }`}
            >
              <span className="sparo-collection-item__name">{label}</span>
              {badge && (
                <span
                  className={`sparo-collection-item__badges ${
                    badgePlacement === 'below'
                      ? 'sparo-collection-item__badges--stacked'
                      : 'sparo-collection-item__badges--inline'
                  }`}
                >
                  {badge}
                </span>
              )}
            </div>
          </div>
        )}
        <div
          className="sparo-config-page-row__control"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sparo-collection-item__control">{control}</div>
        </div>
      </div>

      {isExpanded && details && (
        <div className="sparo-collection-item__details">{details}</div>
      )}
    </div>
  );
};

export default ConfigCollectionItem;
