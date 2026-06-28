import React from 'react';
import { useI18n } from '../i18n';
import { useShellStore } from '../app/shellStore';
import type { SceneId } from '../app/shellStore';
import EyebrowLabel from '../components/EyebrowLabel';
import HairlineDivider from '../components/HairlineDivider';
import './AppsScene.scss';

interface AppEntry {
  id: SceneId;
  label: string;
  desc: string;
  available: boolean;
}

const ChevronIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const AppsScene: React.FC = () => {
  const { t } = useI18n();
  const { push } = useShellStore();

  const apps: AppEntry[] = [
    { id: 'app:skills', label: t('apps.skills'), desc: t('apps.skillsDesc'), available: true },
    { id: 'app:settings', label: t('apps.settings'), desc: t('apps.settingsDesc'), available: true },
  ];

  const comingSoon = [
    'Surface Components',
    'Subagents',
    'Tools',
    'File Browser',
    'Design Canvas',
  ];

  return (
    <div className="apps-scene">
      <div className="apps-scene__list">
        <div className="apps-scene__section-head">
          <EyebrowLabel>{t('apps.title')}</EyebrowLabel>
        </div>
        <HairlineDivider />

        {apps.map((app, idx) => (
          <React.Fragment key={app.id}>
            <button
              type="button"
              className="apps-row"
              onClick={() => push(app.id)}
            >
              <span className="apps-row__num">{String(idx + 1).padStart(2, '0')}</span>
              <div className="apps-row__body">
                <span className="apps-row__label">{app.label}</span>
                <span className="apps-row__desc">{app.desc}</span>
              </div>
              <ChevronIcon />
            </button>
            <HairlineDivider />
          </React.Fragment>
        ))}

        <div className="apps-scene__section-head apps-scene__section-head--mt">
          <EyebrowLabel>{t('apps.comingSoon')}</EyebrowLabel>
        </div>
        <HairlineDivider />

        {comingSoon.map((name, idx) => (
          <React.Fragment key={name}>
            <div className="apps-row apps-row--disabled">
              <span className="apps-row__num">{String(apps.length + idx + 1).padStart(2, '0')}</span>
              <div className="apps-row__body">
                <span className="apps-row__label apps-row__label--muted">{name}</span>
              </div>
              <span className="apps-row__badge">{t('apps.comingSoon')}</span>
            </div>
            <HairlineDivider />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default AppsScene;
