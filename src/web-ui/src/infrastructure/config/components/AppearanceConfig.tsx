import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SunMoon } from 'lucide-react';
import { Button, Select } from '@/design-system';
import { FontPreferencePanel } from '@/infrastructure/font-preference';
import { useTheme, ThemeMetadata, ThemeConfig as ThemeConfigType, SYSTEM_THEME_ID } from '@/infrastructure/theme';
import { themeService } from '@/infrastructure/theme/core/ThemeService';
import { useLanguageSelector } from '@/infrastructure/i18n';
import type { LocaleId } from '@/infrastructure/i18n/types';
import type { CustomSettingsProjectionProps } from '../customSettingsProjection';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageLoading,
  ConfigPageMessage,
  ConfigPageRow,
  ConfigPageSection,
} from './common';
import './BasicsConfig.scss';

interface ThemeCarouselItem {
  value: string;
  label: string;
  description: string;
  theme: ThemeConfigType | null;
  systemThemes?: [ThemeConfigType, ThemeConfigType] | null;
}

function includesSettingNamespace(
  settingIds: readonly string[] | undefined,
  namespace: string,
): boolean {
  return settingIds === undefined || settingIds.some(
    (settingId) => settingId === namespace || settingId.startsWith(`${namespace}.`),
  );
}

function AppearanceBasicsSection({ settingIds }: Pick<
  CustomSettingsProjectionProps,
  'settingIds'
>) {
  const { t } = useTranslation('settings/appearance');
  const { t: tCommon } = useTranslation('common');
  const { themeId, themes, setTheme, loading, error, retry } = useTheme();
  const { currentLanguage, supportedLocales, selectLanguage, isChanging } = useLanguageSelector();
  const showLanguage = includesSettingNamespace(settingIds, 'core.app.language');
  const showThemes = includesSettingNamespace(settingIds, 'core.themes');

  const getThemeDisplayName = useCallback((theme: ThemeMetadata) => {
    const i18nKey = `appearance.presets.${theme.id}`;
    return theme.builtin
      ? t(`${i18nKey}.name`, { defaultValue: theme.name })
      : theme.name;
  }, [t]);

  const getThemeDisplayDescription = useCallback((theme: ThemeMetadata) => {
    const i18nKey = `appearance.presets.${theme.id}`;
    return theme.builtin
      ? t(`${i18nKey}.description`, { defaultValue: theme.description || '' })
      : theme.description || '';
  }, [t]);

  const themeCarouselItems: ThemeCarouselItem[] = useMemo(
    () => {
      const resolvedThemeId = themeService.getResolvedThemeId();
      const resolvedTheme = resolvedThemeId
        ? themeService.getTheme(resolvedThemeId) ?? null
        : null;
      const lightPreview = themeService.getTheme('light') ?? resolvedTheme;
      const darkPreview = themeService.getTheme('dark') ?? resolvedTheme;

      return [
        {
          value: SYSTEM_THEME_ID,
          label: t('appearance.systemTheme'),
          description: t('appearance.systemThemeDescription'),
          theme: resolvedTheme,
          systemThemes: lightPreview && darkPreview ? [lightPreview, darkPreview] : null,
        },
        ...themes.map((theme) => ({
          value: theme.id,
          label: getThemeDisplayName(theme),
          description: getThemeDisplayDescription(theme),
          theme: themeService.getTheme(theme.id) ?? null,
          systemThemes: null,
        })),
      ];
    },
    [themes, t, getThemeDisplayDescription, getThemeDisplayName]
  );

  const selectedThemeIndex = themeId
    ? themeCarouselItems.findIndex((item) => item.value === themeId)
    : -1;
  const selectedTheme = selectedThemeIndex >= 0
    ? themeCarouselItems[selectedThemeIndex]
    : null;

  const handleThemeJump = useCallback((value: string) => {
    if (loading || value === themeId) return;
    void setTheme(value);
  }, [loading, setTheme, themeId]);

  return (
    <div className="theme-config">
      <div className="theme-config__content">
        <ConfigPageSection title={t('appearance.title')}>
          {showLanguage ? (
            <ConfigPageRow
              label={t('appearance.language')}
              description={t('appearance.languageRowHint', {
                defaultValue: 'Choose one language pack as the active UI language.',
              })}
              align="center"
            >
              <div className="theme-config__language-select">
                <Select
                  value={currentLanguage}
                  onChange={(value) =>
                    selectLanguage(String(Array.isArray(value) ? value[0] ?? '' : value) as LocaleId)
                  }
                  options={supportedLocales.map((locale) => ({
                    value: locale.id,
                    label: locale.nativeName,
                  }))}
                  disabled={isChanging}
                  placeholder={t('appearance.language')}
                />
              </div>
            </ConfigPageRow>
          ) : null}
          {showThemes ? loading ? (
            <ConfigPageLoading text={t('appearance.themeLoading')} />
          ) : error || !themeId || !selectedTheme ? (
            <div className="theme-config__theme-carousel-row">
              <div className="theme-config__theme-picker">
                <ConfigPageMessage
                  message={{ type: 'error', text: t('appearance.themeLoadFailed') }}
                />
                <Button variant="secondary" size="small" onClick={() => void retry()}>
                  {tCommon('actions.retry')}
                </Button>
              </div>
            </div>
          ) : (
          <div className="theme-config__theme-carousel-row">
            <div className="theme-config__theme-picker">
              <div
                className="theme-config__theme-carousel"
                aria-label={t('appearance.themes')}
              >
                <div className="theme-config__theme-carousel-stage">
                  <div
                    key={`${selectedTheme.value}-info`}
                    className="theme-config__theme-info"
                  >
                    <span className="theme-config__theme-info-kicker">{t('appearance.themes')}</span>
                    <div className="theme-config__theme-info-line">
                      <strong className="theme-config__theme-info-title">{selectedTheme.label}</strong>
                      <span className="theme-config__theme-info-description">{selectedTheme.description}</span>
                    </div>
                  </div>
                  <div
                    key={`${selectedTheme.value}-preview`}
                    className="theme-config__selected-preview"
                    aria-hidden="true"
                  >
                    {selectedTheme.systemThemes ? (
                      <SystemThemePreview
                        lightTheme={selectedTheme.systemThemes[0]}
                        darkTheme={selectedTheme.systemThemes[1]}
                      />
                    ) : selectedTheme.theme ? (
                      <ThemePreviewThumbnail theme={selectedTheme.theme} />
                    ) : null}
                  </div>
                </div>
                <div className="theme-config__theme-carousel-controls">
                  <div className="theme-config__theme-carousel-dots">
                    {themeCarouselItems.map((item, index) => {
                      const active = index === selectedThemeIndex;
                      const colors = item.theme?.colors;
                      return (
                        <React.Fragment key={item.value}>
                          <button
                            type="button"
                            className={[
                              'theme-config__theme-carousel-dot',
                              item.systemThemes && 'theme-config__theme-carousel-dot--system',
                              active && 'theme-config__theme-carousel-dot--active',
                            ].filter(Boolean).join(' ')}
                            onClick={() => handleThemeJump(item.value)}
                            disabled={loading}
                            aria-label={item.label}
                            aria-current={active ? 'true' : undefined}
                            title={item.label}
                            style={{
                              background: item.systemThemes ? undefined : colors?.background.primary,
                              borderColor: item.systemThemes
                                ? undefined
                                : active
                                  ? colors?.accent['500']
                                  : colors?.border.base,
                            }}
                          >
                            {item.systemThemes ? (
                              <SunMoon
                                className="theme-config__theme-carousel-dot-system-icon"
                                size={16}
                                strokeWidth={1.9}
                                aria-hidden="true"
                              />
                            ) : (
                              <>
                                <span
                                  className="theme-config__theme-carousel-dot-band"
                                  style={{ background: colors?.background.secondary }}
                                />
                                <span
                                  className="theme-config__theme-carousel-dot-band"
                                  style={{ background: colors?.background.scene }}
                                />
                                <span
                                  className="theme-config__theme-carousel-dot-band"
                                  style={{ background: colors?.accent['500'] }}
                                />
                              </>
                            )}
                          </button>
                          {item.value === SYSTEM_THEME_ID && themeCarouselItems.length > 1 ? (
                            <span className="theme-config__theme-carousel-divider" aria-hidden="true" />
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          ) : null}
        </ConfigPageSection>
      </div>
    </div>
  );
}

interface SystemThemePreviewProps {
  lightTheme: ThemeConfigType;
  darkTheme: ThemeConfigType;
}

function SystemThemePreview({ lightTheme, darkTheme }: SystemThemePreviewProps) {
  const { t } = useTranslation('settings/appearance');

  return (
    <div className="theme-system-preview">
      <div className="theme-system-preview__pane">
        <ThemePreviewThumbnail theme={lightTheme} />
      </div>
      <div className="theme-system-preview__pane">
        <ThemePreviewThumbnail theme={darkTheme} />
      </div>
      <div className="theme-system-preview__badge">
        <SunMoon size={12} strokeWidth={1.9} aria-hidden="true" />
        <span>{t('appearance.systemThemeBadge', { defaultValue: 'System' })}</span>
      </div>
    </div>
  );
}

interface ThemePreviewThumbnailProps {
  theme: ThemeConfigType;
}

function ThemePreviewThumbnail({ theme }: ThemePreviewThumbnailProps) {
  const { colors } = theme;
  const { t } = useTranslation('common');

  return (
    <div
      className="theme-preview-thumbnail"
      style={{
        background: colors.background.primary,
        borderColor: colors.border.base,
      }}
    >
      <div
        className="theme-preview-thumbnail__titlebar"
        style={{
          background: colors.background.secondary,
          borderColor: colors.border.subtle,
        }}
      >
        <div className="theme-preview-thumbnail__menu">
          <span
            className="theme-preview-thumbnail__menu-dot"
            style={{ background: colors.accent['500'] }}
          />
        </div>

        <div className="theme-preview-thumbnail__title" style={{ color: colors.text.muted }}>
          {t('app.name')}
        </div>

        <div className="theme-preview-thumbnail__window-controls">
          <span className="theme-preview-thumbnail__window-control" style={{ color: colors.text.secondary }}>
            <svg width="8" height="8" viewBox="0 0 14 14" fill="none">
              <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>

          <span className="theme-preview-thumbnail__window-control" style={{ color: colors.text.secondary }}>
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
              <rect
                x="2"
                y="2"
                width="8"
                height="8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>

          <span
            className="theme-preview-thumbnail__window-control theme-preview-thumbnail__window-control--close"
            style={{ color: colors.text.secondary }}
          >
            <svg width="8" height="8" viewBox="0 0 14 14" fill="none">
              <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        </div>
      </div>

      <div className="theme-preview-thumbnail__main">
        <div
          className="theme-preview-thumbnail__sidebar"
          style={{
            background: colors.background.secondary,
            borderColor: colors.border.subtle,
          }}
        >
          <div className="theme-preview-thumbnail__tree-item">
            <span
              className="theme-preview-thumbnail__folder-icon"
              style={{ background: colors.accent['500'] }}
            />
            <span
              className="theme-preview-thumbnail__tree-text"
              style={{ background: colors.text.secondary }}
            />
          </div>

          {[1, 2, 3].map((i) => (
            <div key={i} className="theme-preview-thumbnail__tree-item theme-preview-thumbnail__tree-item--file">
              <span
                className="theme-preview-thumbnail__file-icon"
                style={{ background: colors.semantic.info }}
              />
              <span
                className="theme-preview-thumbnail__tree-text theme-preview-thumbnail__tree-text--short"
                style={{ background: colors.text.muted }}
              />
            </div>
          ))}
        </div>

        <div className="theme-preview-thumbnail__chat" style={{ background: colors.background.scene }}>
          <div
            className="theme-preview-thumbnail__message theme-preview-thumbnail__message--user"
            style={{
              background: colors.accent['200'],
              borderColor: colors.accent['400'],
            }}
          >
            <div
              className="theme-preview-thumbnail__message-line"
              style={{ background: colors.text.primary }}
            />
          </div>

          <div
            className="theme-preview-thumbnail__message theme-preview-thumbnail__message--ai"
            style={{
              background: colors.element.subtle,
              borderColor: colors.border.subtle,
            }}
          >
            <div
              className="theme-preview-thumbnail__message-line"
              style={{ background: colors.text.secondary }}
            />
            <div
              className="theme-preview-thumbnail__message-line theme-preview-thumbnail__message-line--short"
              style={{ background: colors.text.muted }}
            />
          </div>

          <div
            className="theme-preview-thumbnail__code-block"
            style={{
              background: colors.background.tertiary,
              borderColor: colors.border.base,
            }}
          >
            <div
              className="theme-preview-thumbnail__code-line"
              style={{ background: colors.purple?.['500'] || colors.accent['500'] }}
            />
            <div
              className="theme-preview-thumbnail__code-line theme-preview-thumbnail__code-line--long"
              style={{ background: colors.semantic.success }}
            />
          </div>
        </div>

        <div
          className="theme-preview-thumbnail__editor"
          style={{
            background: colors.background.workbench,
            borderColor: colors.border.subtle,
          }}
        >
          <div
            className="theme-preview-thumbnail__tabs"
            style={{
              background: colors.background.secondary,
              borderColor: colors.border.subtle,
            }}
          >
            <span
              className="theme-preview-thumbnail__tab theme-preview-thumbnail__tab--active"
              style={{
                background: colors.background.primary,
                borderColor: colors.accent['500'],
              }}
            />
            <span
              className="theme-preview-thumbnail__tab"
              style={{ background: colors.element.subtle }}
            />
          </div>

          <div className="theme-preview-thumbnail__code-content">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="theme-preview-thumbnail__editor-line">
                <span
                  className="theme-preview-thumbnail__line-number"
                  style={{ background: colors.text.disabled }}
                />
                <span
                  className="theme-preview-thumbnail__line-code"
                  style={{
                    background: i % 2 === 0 ? colors.accent['500'] : colors.text.secondary,
                    width: `${30 + (i * 8) % 40}%`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="theme-preview-thumbnail__statusbar"
        style={{
          background: colors.background.secondary,
          borderColor: colors.border.subtle,
        }}
      >
        <div className="theme-preview-thumbnail__status-section">
          <span
            className="theme-preview-thumbnail__status-icon"
            style={{ background: colors.accent['500'] }}
          />
          <span
            className="theme-preview-thumbnail__status-text"
            style={{ background: colors.text.muted }}
          />
        </div>

        <div className="theme-preview-thumbnail__status-section">
          <span className="theme-preview-thumbnail__git-icon" style={{ color: colors.git.branch }}>
            <svg width="7" height="7" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 6v4c0 1.1.9 2 2 2h4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
          <span
            className="theme-preview-thumbnail__status-text theme-preview-thumbnail__status-text--branch"
            style={{ background: colors.git.branch }}
          />
        </div>

        <span
          className="theme-preview-thumbnail__status-icon theme-preview-thumbnail__status-icon--notification"
          style={{ background: colors.semantic.info }}
        />
      </div>
    </div>
  );
}

const AppearanceConfig: React.FC<CustomSettingsProjectionProps> = ({ settingIds }) => {
  const { t } = useTranslation('settings/appearance');
  const isScopedProjection = settingIds !== undefined;
  const showBasics = includesSettingNamespace(settingIds, 'core.app.language')
    || includesSettingNamespace(settingIds, 'core.themes');
  const showFont = includesSettingNamespace(settingIds, 'core.font');

  return (
    <ConfigPageLayout className="sparo-appearance-config">
      {!isScopedProjection ? (
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
      ) : null}
      <ConfigPageContent className="sparo-basics-config__content">
        {showBasics ? <AppearanceBasicsSection settingIds={settingIds} /> : null}
        {showFont ? <FontPreferencePanel settingIds={settingIds} /> : null}
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AppearanceConfig;
