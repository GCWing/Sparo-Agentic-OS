import React from 'react';
import { Grid2X2, SlidersHorizontal } from 'lucide-react';
import { SegmentedControl } from '@/design-system';
import type { AppCenterMode } from './types';

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
}) => (
  <div className="apps-scene__mode-nav">
    <SegmentedControl
      className="apps-scene__mode-switch"
      value={currentMode}
      size="small"
      stretch
      data-mode={currentMode}
      ariaLabel={t('productSystem.navigation.label')}
      onChange={(value) => onChange(value as AppCenterMode)}
      options={[
        {
          value: 'home',
          label: t('productSystem.navigation.home'),
          icon: <Grid2X2 size={14} aria-hidden />,
        },
        {
          value: 'manage',
          label: t('productSystem.navigation.manage'),
          icon: <SlidersHorizontal size={14} aria-hidden />,
        },
      ]}
    />
    {actions ? <div className="apps-scene__mode-actions">{actions}</div> : null}
  </div>
);

export default AppCenterModeNav;
