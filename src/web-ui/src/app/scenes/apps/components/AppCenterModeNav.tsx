import React from 'react';
import { ModeSwitch } from '@/design-system';

type AppCenterMode = 'home' | 'manage' | 'component-center';

const APP_CENTER_MODES = ['home', 'manage', 'component-center'] as const;

interface AppCenterModeNavProps {
  currentMode: AppCenterMode;
  onChange: (mode: AppCenterMode) => void;
  actions?: React.ReactNode;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const AppCenterModeNav: React.FC<AppCenterModeNavProps> = ({
  currentMode,
  onChange,
  actions,
  t,
}) => {
  return (
    <div className="apps-scene__mode-nav">
      <ModeSwitch
        value={currentMode}
        onChange={(value) => onChange(value as AppCenterMode)}
        ariaLabel={t('productSystem.navigation.label')}
        options={APP_CENTER_MODES.map((mode) => ({
          value: mode,
          label: t(`productSystem.navigation.${mode === 'component-center' ? 'components' : mode}`),
        }))}
      />
      {actions ? (
        <div className="apps-scene__mode-actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default AppCenterModeNav;
