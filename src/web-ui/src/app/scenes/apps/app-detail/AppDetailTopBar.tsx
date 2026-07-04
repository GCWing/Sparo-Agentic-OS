import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface AppDetailTopBarProps {
  onBack: () => void;
  actions?: React.ReactNode;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export const AppDetailTopBar: React.FC<AppDetailTopBarProps> = ({
  onBack,
  actions,
  t,
}) => (
  <div className="app-detail-scene__top-bar">
    <button type="button" className="app-detail-scene__top-bar-back" onClick={onBack}>
      <ArrowLeft size={14} aria-hidden />
      <span>{t('productSystem.detail.topBar.backToApps')}</span>
    </button>
    {actions ? <div className="app-detail-scene__top-actions">{actions}</div> : null}
  </div>
);

export default AppDetailTopBar;
