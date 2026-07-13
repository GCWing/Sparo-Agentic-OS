import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Info, Languages, Sun, SunMoon } from 'lucide-react';
import { Button, SegmentedControl, Tooltip } from '@/design-system';
import { useLanguageSelector } from '@/infrastructure/i18n';
import type { LocaleId, LocaleMetadata } from '@/infrastructure/i18n/types';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { builtinThemes, SYSTEM_THEME_ID, themeService, useTheme } from '@/infrastructure/theme';
import type { ThemeSelectionId } from '@/infrastructure/theme';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('WorkspaceHubUtilityRail');
const COLLAPSE_AFTER_SELECTION_MS = 280;

interface WorkspaceHubUtilityRailProps {
  onOpenAbout: () => void;
}

type ExpandedControl = 'theme' | 'language' | null;

type ChoiceStyle = React.CSSProperties & {
  '--hub-choice-count': number;
  '--hub-choice-index': number;
};

type ThemePreviewStyle = React.CSSProperties & {
  '--hub-theme-preview-left'?: string;
  '--hub-theme-preview-right'?: string;
};

type CurrentThemePreviewStyle = React.CSSProperties & {
  '--hub-current-theme-accent'?: string;
  '--hub-current-theme-foreground'?: string;
  '--hub-current-theme-surface-primary'?: string;
  '--hub-current-theme-border'?: string;
};

function choiceStyle(index: number, count: number): ChoiceStyle {
  return {
    '--hub-choice-count': Math.max(count, 1),
    '--hub-choice-index': Math.max(index, 0),
  };
}

function compactLocaleLabel(locale: LocaleMetadata): string {
  if (locale.id.toLowerCase().startsWith('zh')) return '中文';
  return locale.id.split('-')[0]?.toUpperCase() || locale.nativeName.slice(0, 2);
}

function ThemeColorPreview({
  left,
  right,
  label,
}: {
  left?: string;
  right?: string;
  label: string;
}) {
  const style: ThemePreviewStyle = {
    '--hub-theme-preview-left': left,
    '--hub-theme-preview-right': right,
  };

  return (
    <Tooltip content={label} placement="top" delay={200}>
      <span className="sparo-workspace-hub__theme-preview" style={style} aria-hidden="true" />
    </Tooltip>
  );
}

function CurrentThemePreview({
  accent,
  foreground,
  surfacePrimary,
  border,
}: {
  accent?: string;
  foreground?: string;
  surfacePrimary?: string;
  border?: string;
}) {
  const style: CurrentThemePreviewStyle = {
    '--hub-current-theme-accent': accent,
    '--hub-current-theme-foreground': foreground,
    '--hub-current-theme-surface-primary': surfacePrimary,
    '--hub-current-theme-border': border,
  };

  return (
    <span className="sparo-workspace-hub__current-theme-preview" style={style} aria-hidden="true">
      <span className="sparo-workspace-hub__current-theme-swatch is-primary" />
      <span className="sparo-workspace-hub__current-theme-swatch is-secondary" />
      <span className="sparo-workspace-hub__current-theme-swatch is-accent" />
    </span>
  );
}

export const WorkspaceHubUtilityRail: React.FC<WorkspaceHubUtilityRailProps> = ({
  onOpenAbout,
}) => {
  const { t } = useI18n('common');
  const { currentLanguage, supportedLocales, selectLanguage, isChanging } = useLanguageSelector();
  const { theme, themeId, themeType, themes, setTheme, loading: themeLoading } = useTheme();
  const [expandedControl, setExpandedControl] = useState<ExpandedControl>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const themeTriggerRef = useRef<HTMLButtonElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const themeControlRef = useRef<HTMLDivElement>(null);
  const languageControlRef = useRef<HTMLDivElement>(null);

  const activeThemeChoice = themeId === SYSTEM_THEME_ID ? SYSTEM_THEME_ID : (themeId || themeType);
  const themeOptions = useMemo(() => {
    const previewFor = (id: string) => {
      const candidate = themeService.getTheme(id) ?? builtinThemes.find((item) => item.id === id);
      return {
        left: candidate?.colors.background.primary,
        right: candidate?.colors.accent[500],
      };
    };

    return [
      {
        value: SYSTEM_THEME_ID,
        label: <span className="sparo-workspace-hub__sr-only">{t('nav.menuPanel.hub.controls.systemTheme')}</span>,
        icon: (
          <Tooltip content={t('nav.menuPanel.hub.controls.systemTheme')} placement="top" delay={200}>
            <span className="sparo-workspace-hub__system-theme-preview">
              <SunMoon size={16} strokeWidth={1.9} aria-hidden="true" />
            </span>
          </Tooltip>
        ),
      },
      ...themes.map((candidate) => ({
        value: candidate.id,
        label: <span className="sparo-workspace-hub__sr-only">{candidate.name}</span>,
        icon: <ThemeColorPreview {...previewFor(candidate.id)} label={candidate.name} />,
      })),
    ];
  }, [t, themes]);
  const languageOptions = useMemo(() => supportedLocales.map((locale) => ({
    value: locale.id,
    label: <span title={locale.nativeName}>{compactLocaleLabel(locale)}</span>,
  })), [supportedLocales]);

  const themeIndex = themeOptions.findIndex((option) => option.value === activeThemeChoice);
  const languageIndex = languageOptions.findIndex((option) => option.value === currentLanguage);
  const currentLocale = supportedLocales.find((locale) => locale.id === currentLanguage);

  const currentThemeLabel = activeThemeChoice === SYSTEM_THEME_ID
    ? t('nav.menuPanel.hub.controls.systemThemeShort')
    : activeThemeChoice === 'light'
      ? t('nav.menuPanel.hub.controls.lightTheme')
      : activeThemeChoice === 'dark'
        ? t('nav.menuPanel.hub.controls.darkTheme')
        : theme?.name || activeThemeChoice;
  const currentLanguageLabel = currentLocale ? compactLocaleLabel(currentLocale) : currentLanguage;

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  }, []);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  const returnFocusToTrigger = useCallback((control: Exclude<ExpandedControl, null>) => {
    window.requestAnimationFrame(() => {
      (control === 'theme' ? themeTriggerRef : languageTriggerRef).current?.focus();
    });
  }, []);

  const collapseEditor = useCallback((control: Exclude<ExpandedControl, null>) => {
    clearCollapseTimer();
    setExpandedControl(null);
    returnFocusToTrigger(control);
  }, [clearCollapseTimer, returnFocusToTrigger]);

  const scheduleCollapse = useCallback((control: Exclude<ExpandedControl, null>) => {
    clearCollapseTimer();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setExpandedControl(null);
      returnFocusToTrigger(control);
    }, COLLAPSE_AFTER_SELECTION_MS);
  }, [clearCollapseTimer, returnFocusToTrigger]);

  const openEditor = useCallback((control: Exclude<ExpandedControl, null>, focusSelection: boolean) => {
    clearCollapseTimer();
    setExpandedControl(control);
    if (!focusSelection) return;
    window.requestAnimationFrame(() => {
      const target = control === 'theme' ? themeControlRef.current : languageControlRef.current;
      target?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
    });
  }, [clearCollapseTimer]);

  const handleThemeChange = useCallback((nextTheme: string) => {
    void setTheme(nextTheme as ThemeSelectionId)
      .catch((error: unknown) => {
        log.error('Failed to change theme from Hub', { themeId: nextTheme, error });
      })
      .finally(() => scheduleCollapse('theme'));
  }, [scheduleCollapse, setTheme]);

  const handleLanguageChange = useCallback((nextLocale: string) => {
    void selectLanguage(nextLocale as LocaleId)
      .catch((error: unknown) => {
        log.error('Failed to change language from Hub', { locale: nextLocale, error });
      })
      .finally(() => scheduleCollapse('language'));
  }, [scheduleCollapse, selectLanguage]);

  return (
    <div
      className={`sparo-workspace-hub__utility-rail${expandedControl ? ' is-expanded' : ''}`}
      role="group"
      aria-label={t('nav.menuPanel.hub.controls.group')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expandedControl) return;
        event.preventDefault();
        event.stopPropagation();
        collapseEditor(expandedControl);
      }}
    >
      {expandedControl === null ? (
        <div className="sparo-workspace-hub__utility-home">
          <Button
            ref={themeTriggerRef}
            variant="ghost"
            size="small"
            className="sparo-workspace-hub__quick-theme"
            aria-label={t('nav.menuPanel.hub.controls.currentTheme', { value: currentThemeLabel })}
            aria-controls="workspace-hub-theme-controls"
            aria-expanded="false"
            title={t('nav.menuPanel.hub.controls.currentTheme', { value: currentThemeLabel })}
            onClick={(event) => openEditor('theme', event.detail === 0)}
          >
            <span className="sparo-workspace-hub__quick-theme-icon" aria-hidden="true">
              <Sun size={16} strokeWidth={2} />
            </span>
            <CurrentThemePreview
              accent={theme?.colors.accent[500]}
              foreground={theme?.colors.text.muted}
              surfacePrimary={theme?.colors.background.secondary}
              border={theme?.colors.border.base}
            />
          </Button>
          <Button
            ref={languageTriggerRef}
            variant="ghost"
            size="small"
            className="sparo-workspace-hub__utility-status"
            aria-label={t('nav.menuPanel.hub.controls.currentLanguage', { value: currentLanguageLabel })}
            aria-controls="workspace-hub-language-controls"
            aria-expanded="false"
            title={t('nav.menuPanel.hub.controls.currentLanguage', { value: currentLanguageLabel })}
            onClick={(event) => openEditor('language', event.detail === 0)}
          >
            <Languages size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="small"
            className="sparo-workspace-hub__utility-status"
            aria-label={t('nav.menuPanel.hub.controls.about')}
            title={t('nav.menuPanel.hub.controls.about')}
            onClick={onOpenAbout}
          >
            <Info size={14} aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <div className={`sparo-workspace-hub__utility-editor is-${expandedControl}`}>
          <Button
            variant="ghost"
            size="small"
            className="sparo-workspace-hub__utility-editor-label"
            aria-label={t(expandedControl === 'theme'
              ? 'nav.menuPanel.hub.controls.exitTheme'
              : 'nav.menuPanel.hub.controls.exitLanguage')}
            aria-expanded="true"
            onClick={() => collapseEditor(expandedControl)}
          >
            <ChevronLeft size={13} aria-hidden="true" />
            <span>{t(`nav.menuPanel.hub.controls.${expandedControl}`)}</span>
          </Button>
          <div
            id={`workspace-hub-${expandedControl}-controls`}
            className={`sparo-workspace-hub__utility-choice is-${expandedControl}`}
            style={choiceStyle(
              expandedControl === 'theme' ? themeIndex : languageIndex,
              expandedControl === 'theme' ? themeOptions.length : languageOptions.length,
            )}
          >
            <span className="sparo-workspace-hub__utility-indicator" aria-hidden="true" />
            {expandedControl === 'theme' ? (
              <SegmentedControl
                ref={themeControlRef}
                className="sparo-workspace-hub__utility-segmented is-theme"
                size="small"
                stretch
                value={activeThemeChoice}
                options={themeOptions}
                disabled={themeLoading}
                ariaLabel={t('nav.menuPanel.hub.controls.theme')}
                aria-busy={themeLoading || undefined}
                onChange={handleThemeChange}
              />
            ) : (
              <SegmentedControl
                ref={languageControlRef}
                className="sparo-workspace-hub__utility-segmented"
                size="small"
                stretch
                value={currentLanguage}
                options={languageOptions}
                disabled={isChanging}
                ariaLabel={t('nav.menuPanel.hub.controls.language')}
                aria-busy={isChanging || undefined}
                onChange={handleLanguageChange}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
