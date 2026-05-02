import React from 'react';
import { useI18n } from '../../i18n';
import { useTheme } from '../../theme';
import EyebrowLabel from '../../components/EyebrowLabel';
import HairlineDivider from '../../components/HairlineDivider';
import './AppPage.scss';

const ChevronIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const SettingsAppPage: React.FC = () => {
  const { t, language, setLanguage } = useI18n();
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="app-page">
      <div className="app-page__section-head">
        <EyebrowLabel>{t('me.preferences')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      <button type="button" className="app-page__row app-page__row--btn" onClick={toggleTheme}>
        <div className="app-page__row-body">
          <span className="app-page__row-name">{t('me.appearance')}</span>
        </div>
        <span className="app-page__row-value">{isDark ? t('me.dark') : t('me.light')}</span>
      </button>
      <HairlineDivider />

      <button
        type="button"
        className="app-page__row app-page__row--btn"
        onClick={() => setLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN')}
      >
        <div className="app-page__row-body">
          <span className="app-page__row-name">{t('me.language')}</span>
        </div>
        <span className="app-page__row-value">{language === 'zh-CN' ? '中文' : 'English'}</span>
        <ChevronIcon />
      </button>
      <HairlineDivider />

      <div className="app-page__section-head app-page__section-head--mt">
        <EyebrowLabel>{t('apps.title')}</EyebrowLabel>
      </div>
      <HairlineDivider />

      <div className="app-page__row">
        <div className="app-page__row-body">
          <span className="app-page__row-name">Sparo OS</span>
          <span className="app-page__row-desc">Remote Control v0.1</span>
        </div>
      </div>
      <HairlineDivider />
    </div>
  );
};

export default SettingsAppPage;
