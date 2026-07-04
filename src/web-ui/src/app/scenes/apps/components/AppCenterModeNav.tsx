import React from 'react';
import { ArrowLeft } from 'lucide-react';

type AppCenterMode = 'home' | 'manage' | 'component-center';

interface AppCenterModeNavProps {
  currentMode: AppCenterMode;
  onChange: (mode: AppCenterMode) => void;
  actions?: React.ReactNode;
  t: (key: string, options?: Record<string, unknown>) => string;
}

// The main "browse & launch" view is the one destination people land on and use
// every day; management and the component catalog are occasional, secondary
// trips. So instead of three equal-weight tabs, home shows two quiet text
// links, while the secondary pages show a clear way back plus a small switch
// between themselves.
export const AppCenterModeNav: React.FC<AppCenterModeNavProps> = ({
  currentMode,
  onChange,
  actions,
  t,
}) => {
  if (currentMode === 'home') {
    return (
      <div className="apps-scene__mode-nav">
        <div className="apps-scene__mode-nav-secondary">
          <button type="button" className="apps-scene__mode-nav-link" onClick={() => onChange('manage')}>
            {t('productSystem.navigation.manage')}
          </button>
          <button type="button" className="apps-scene__mode-nav-link" onClick={() => onChange('component-center')}>
            {t('productSystem.navigation.components')}
          </button>
        </div>
        {actions ? <div className="apps-scene__mode-actions">{actions}</div> : null}
      </div>
    );
  }

  return (
    <div className="apps-scene__mode-nav">
      <button type="button" className="apps-scene__mode-nav-back" onClick={() => onChange('home')}>
        <ArrowLeft size={14} aria-hidden />
        <span>{t('productSystem.actions.back')}</span>
      </button>
      <div className="apps-scene__mode-nav-switch" role="tablist" aria-label={t('productSystem.navigation.label')}>
        <button
          type="button"
          role="tab"
          aria-selected={currentMode === 'manage'}
          className={`apps-scene__mode-nav-pill${currentMode === 'manage' ? ' is-active' : ''}`}
          onClick={() => onChange('manage')}
        >
          {t('productSystem.navigation.manage')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currentMode === 'component-center'}
          className={`apps-scene__mode-nav-pill${currentMode === 'component-center' ? ' is-active' : ''}`}
          onClick={() => onChange('component-center')}
        >
          {t('productSystem.navigation.components')}
        </button>
      </div>
      {actions ? <div className="apps-scene__mode-actions">{actions}</div> : null}
    </div>
  );
};

export default AppCenterModeNav;
