import React from 'react';
import { useTranslation } from 'react-i18next';
import './WelcomePanel.css';

interface FallbackWelcomePanelProps {
  className?: string;
}

/**
 * Product-neutral empty state for FlowChat surfaces without a dedicated
 * profile welcome experience.
 */
export const FallbackWelcomePanel: React.FC<FallbackWelcomePanelProps> = ({
  className = '',
}) => {
  const { t } = useTranslation('flow-chat');

  return (
    <div
      className={['welcome-panel', 'welcome-panel--fallback', className]
        .filter(Boolean)
        .join(' ')}
      data-testid="flow-chat-fallback-welcome"
    >
      <div className="welcome-panel__content">
        <div className="welcome-panel__greeting">
          <div className="welcome-panel__greeting-text">
            <h1 className="welcome-panel__heading">
              {t('welcome.fallback.heading')}
            </h1>
            <p className="welcome-panel__tagline">
              {t('welcome.fallback.tagline')}
            </p>
          </div>
        </div>

        <div className="welcome-panel__divider" />

        <div className="welcome-panel__narrative">
          <p className="welcome-panel__narrative-text">
            {t('welcome.fallback.narrative')}
          </p>
        </div>
      </div>
    </div>
  );
};

FallbackWelcomePanel.displayName = 'FallbackWelcomePanel';
