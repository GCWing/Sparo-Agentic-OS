import React from 'react';
import { useI18n } from '../../i18n';
import { RemoteSessionManager } from '../../services/RemoteSessionManager';
import EyebrowLabel from '../../components/EyebrowLabel';
import HairlineDivider from '../../components/HairlineDivider';
import './AppPage.scss';

interface ShellAppPageProps {
  sessionMgr: RemoteSessionManager;
}

const ShellAppPage: React.FC<ShellAppPageProps> = () => {
  const { t } = useI18n();

  return (
    <div className="app-page">
      <div className="app-page__section-head">
        <EyebrowLabel>{t('apps.shell')}</EyebrowLabel>
      </div>
      <HairlineDivider />
      <div className="app-page__placeholder">
        <div className="app-page__placeholder-dot" aria-hidden="true" />
        <strong className="app-page__placeholder-title">{t('apps.manageOnDesktop')}</strong>
        <p className="app-page__placeholder-desc">{t('apps.manageOnDesktopDesc')}</p>
      </div>
    </div>
  );
};

export default ShellAppPage;
