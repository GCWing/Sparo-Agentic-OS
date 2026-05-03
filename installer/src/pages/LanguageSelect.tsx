import { useState } from 'react';
import { useTranslation } from 'react-i18next';
interface LanguageSelectProps {
  onSelect: (lang: string) => void;
}

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'zh', label: 'Chinese', native: '简体中文' },
];

export function LanguageSelect({ onSelect }: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string>(() => {
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  });

  const handleSelect = (code: string) => {
    setSelected(code);
    i18n.changeLanguage(code);
  };

  const handleContinue = () => {
    if (selected) onSelect(selected);
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        animation: 'heroContentFadeIn 0.8s ease-out 0.2s both',
      }}
    >
      {/* Center content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 32px 40px',
        }}
      >
        {/* Brand name */}
        <div
          style={{
            fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
            fontSize: 42,
            fontWeight: 700,
            color: '#0F172A',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            marginBottom: 12,
          }}
        >
          Sparo OS
        </div>

        {/* Slogan */}
        <div
          style={{
            fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
            fontSize: 14,
            fontWeight: 400,
            color: '#5B6B8C',
            textAlign: 'center',
            lineHeight: 1.5,
            marginBottom: 48,
            letterSpacing: '0.01em',
          }}
        >
          {t('lang.slogan', 'Ignite AI for Everyone')}
        </div>

        {/* Language — text tabs + underline (distinct from solid ignite CTA) */}
        <div
          className="lang-page__locale-row"
          role="radiogroup"
          aria-label={t('lang.subtitle')}
        >
          {LANGUAGES.map((lang) => {
            const isSelected = selected === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelect(lang.code)}
                className={'lang-page__locale-btn' + (isSelected ? ' lang-page__locale-btn--active' : '')}
              >
                {lang.native}
              </button>
            );
          })}
        </div>

        {/* Continue button */}
        <button
          type="button"
          disabled={!selected}
          onClick={handleContinue}
          className="btn btn--ignite lang-page__continue"
        >
          {t('lang.continue')}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

    </div>
  );
}
