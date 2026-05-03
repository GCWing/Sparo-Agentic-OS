import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { InstallOptions, ThemeId, ThemePreferenceId } from '../types/installer';
import { SYSTEM_THEME_ID } from '../types/installer';
import {
  THEMES,
  THEME_DISPLAY_ORDER,
  findInstallerThemeById,
  type InstallerTheme,
} from '../theme/installerThemesData';
import { IgniteButton } from '../components/brand/IgniteButton';

interface ThemeSetupProps {
  options: InstallOptions;
  setOptions: React.Dispatch<React.SetStateAction<InstallOptions>>;
  onLaunch: () => Promise<void>;
  onClose: () => void;
  onBack: () => void;
}

type PreviewEntry =
  | { kind: 'system'; id: typeof SYSTEM_THEME_ID; labelKey: string }
  | { kind: 'theme'; id: ThemeId; theme: InstallerTheme; labelKey: string };

function ThemePreview({ theme }: { theme: InstallerTheme }) {
  const { colors } = theme;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: colors.background.primary,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Faux titlebar */}
      <div
        style={{
          height: 8,
          background: colors.background.secondary,
          borderBottom: `1px solid ${colors.border.subtle}`,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          paddingLeft: 4,
        }}
      >
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: colors.accent['500'], opacity: 0.9 }} />
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: colors.text.muted, opacity: 0.5 }} />
        <span style={{ width: 3, height: 3, borderRadius: '50%', background: colors.text.muted, opacity: 0.3 }} />
      </div>
      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', padding: 5, gap: 4 }}>
        <div
          style={{
            width: 12,
            background: colors.element.subtle,
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 2,
          }}
        >
          <span style={{ height: 2, background: colors.accent['500'], borderRadius: 1, opacity: 0.9 }} />
          <span style={{ height: 2, background: colors.text.muted, borderRadius: 1, opacity: 0.35 }} />
          <span style={{ height: 2, background: colors.text.muted, borderRadius: 1, opacity: 0.25 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ height: 3, width: '74%', background: colors.text.primary, opacity: 0.85, borderRadius: 1 }} />
          <span style={{ height: 2, width: '58%', background: colors.text.muted, opacity: 0.5, borderRadius: 1 }} />
          <span style={{ height: 2, width: '66%', background: colors.text.muted, opacity: 0.45, borderRadius: 1 }} />
          <span style={{ marginTop: 'auto', height: 3, width: 20, background: colors.accent['500'], borderRadius: 1, opacity: 0.95 }} />
        </div>
      </div>
    </div>
  );
}

function SystemPreview({ light, dark }: { light: InstallerTheme; dark: InstallerTheme }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}>
        <ThemePreview theme={light} />
      </div>
      <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
        <ThemePreview theme={dark} />
      </div>
      {/* diagonal divider */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(15,23,42,0.22)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function ThemeSetup({ options, setOptions, onLaunch, onClose, onBack }: ThemeSetupProps) {
  const { t } = useTranslation();
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const lightPreview = findInstallerThemeById('light');
  const darkPreview = findInstallerThemeById('dark');

  const previewEntries = useMemo<PreviewEntry[]>(() => {
    const ordered = [...THEMES].sort(
      (a, b) => THEME_DISPLAY_ORDER.indexOf(a.id) - THEME_DISPLAY_ORDER.indexOf(b.id),
    );
    return [
      { kind: 'system', id: SYSTEM_THEME_ID, labelKey: 'themeSetup.followSystem' },
      ...ordered.map<PreviewEntry>((theme) => ({
        kind: 'theme',
        id: theme.id,
        theme,
        labelKey: `themeSetup.themeNames.${theme.id}`,
      })),
    ];
  }, []);

  const selectedId: ThemePreferenceId = options.themePreference;

  const selectTheme = (id: ThemePreferenceId) => {
    setOptions((prev) => ({ ...prev, themePreference: id }));
  };

  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    setFinishError(null);
    try {
      try {
        await invoke('set_theme_preference', { themePreference: options.themePreference });
      } catch (err) {
        console.warn('Failed to persist theme preference:', err);
      }
      if (options.launchAfterInstall) {
        await onLaunch();
      }
      onClose();
    } catch (err: unknown) {
      setFinishError(typeof err === 'string' ? err : (err as Error)?.message || 'Failed to launch');
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '22px 40px 12px',
          animation: 'fadeIn 0.5s ease-out',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* Eyebrow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#B7372F', flexShrink: 0 }} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--slate)',
              }}
            >
              {t('themeSetup.eyebrow', 'Ready to Ignite')}
            </span>
          </div>

          {/* Hero */}
          <div
            style={{
              fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--ink)',
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              marginBottom: 6,
              maxWidth: 520,
            }}
          >
            {t('themeSetup.heroTitle', '点亮，开始')}
          </div>

          <div
            style={{
              fontSize: 12,
              color: 'var(--slate)',
              lineHeight: 1.45,
              marginBottom: 16,
              maxWidth: 460,
            }}
          >
            {t('themeSetup.subtitle', 'Sparo OS 已就绪')}
          </div>

          {/* Theme previews */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: 8,
              marginBottom: 14,
            }}
          >
            {previewEntries.map((entry) => {
              const active = selectedId === entry.id;
              const label = t(entry.labelKey, {
                defaultValue: entry.kind === 'theme' ? entry.theme.name : 'System',
              });
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => selectTheme(entry.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 6,
                    padding: 4,
                    background: active ? 'var(--color-accent-50)' : 'transparent',
                    border: active ? '1px solid var(--print)' : '1px solid var(--border-base)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.2s ease, border-color 0.2s ease',
                    textAlign: 'left',
                    outline: 'none',
                    boxShadow: active ? '0 0 0 2px rgba(183,55,47,0.2)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.borderColor = 'var(--border-medium)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.borderColor = 'var(--border-base)';
                  }}
                >
                  <div
                    style={{
                      height: 52,
                      borderRadius: 4,
                      overflow: 'hidden',
                      border: '1px solid var(--border-base)',
                    }}
                  >
                    {entry.kind === 'system' ? (
                      <SystemPreview light={lightPreview} dark={darkPreview} />
                    ) : (
                      <ThemePreview theme={entry.theme} />
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 4px 2px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: active ? 600 : 400,
                        color: active ? 'var(--ink)' : 'var(--graphite)',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {label}
                    </span>
                    {active && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#B7372F',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Launch checkbox */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 2px',
              cursor: 'pointer',
              color: 'var(--graphite)',
              fontSize: 13,
            }}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={options.launchAfterInstall}
              onClick={() => setOptions((prev) => ({ ...prev, launchAfterInstall: !prev.launchAfterInstall }))}
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                border: `1.5px solid ${options.launchAfterInstall ? 'var(--ignite-bg)' : 'var(--border-medium)'}`,
                background: options.launchAfterInstall ? 'var(--ignite-bg)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {options.launchAfterInstall && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ignite-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
            <span onClick={() => setOptions((prev) => ({ ...prev, launchAfterInstall: !prev.launchAfterInstall }))}>
              {t('options.launchAfterInstall')}
            </span>
          </label>

          {finishError && (
            <div style={{ marginTop: 14, color: 'var(--print)', fontSize: 13 }}>
              {finishError}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="page-footer page-footer--split" style={{ padding: '12px 40px 14px' }}>
        <button
          type="button"
          onClick={onBack}
          disabled={isFinishing}
          className="btn btn-ghost"
          style={{ fontSize: 13, padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('options.back', '返回')}
        </button>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ fontSize: 13, padding: '8px 14px' }}
          >
            {t('themeSetup.closeLater', '稍后启动')}
          </button>
          <IgniteButton
            loading={isFinishing}
            disabled={isFinishing}
            onClick={() => { void handleFinish(); }}
            style={{ minWidth: 150, fontSize: 14, padding: '8px 18px' }}
          >
            {t('themeSetup.launch', '启动 Sparo OS')}
          </IgniteButton>
        </div>
      </div>
    </div>
  );
}
