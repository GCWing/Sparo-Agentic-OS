import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { IgniteButton } from '../components/brand';
import { InstallErrorPanel } from '../components/InstallErrorPanel';
import type { InstallOptions, DiskSpaceInfo, InstallPathValidation } from '../types/installer';

interface OptionsProps {
  options: InstallOptions;
  setOptions: React.Dispatch<React.SetStateAction<InstallOptions>>;
  diskSpace: DiskSpaceInfo | null;
  error: string | null;
  refreshDiskSpace: (path: string) => Promise<void>;
  onBack: () => void;
  onInstall: () => Promise<void>;
  isInstalling: boolean;
  clearInstallError: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const FIELD_LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--slate)',
  marginBottom: 6,
};

export function Options({
  options,
  setOptions,
  diskSpace,
  error,
  refreshDiskSpace,
  onBack,
  onInstall,
  isInstalling,
  clearInstallError,
}: OptionsProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (options.installPath) refreshDiskSpace(options.installPath);
  }, [options.installPath, refreshDiskSpace]);

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      defaultPath: options.installPath,
      title: t('options.pathLabel'),
    });
    if (selected && typeof selected === 'string') {
      try {
        const validated = await invoke<InstallPathValidation>('validate_install_path', {
          path: selected,
        });
        setOptions((prev) => ({ ...prev, installPath: validated.installPath }));
      } catch {
        setOptions((prev) => ({ ...prev, installPath: selected }));
      }
      clearInstallError();
    }
  };

  const toggle = (key: keyof InstallOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  };

  const insufficientSpace = diskSpace !== null && !diskSpace.sufficient;
  const pathError = error ?? (insufficientSpace ? t('options.insufficientSpace') : undefined);
  const canInstall = !!options.installPath && !insufficientSpace && !isInstalling;

  const integrations: { key: keyof InstallOptions; labelKey: string }[] = [
    { key: 'desktopShortcut', labelKey: 'options.desktopShortcut' },
    { key: 'startMenu', labelKey: 'options.startMenu' },
    { key: 'contextMenu', labelKey: 'options.contextMenu' },
    { key: 'addToPath', labelKey: 'options.addToPath' },
  ];

  const availableLabel = diskSpace
    ? (diskSpace.available < Number.MAX_SAFE_INTEGER ? formatBytes(diskSpace.available) : '—')
    : null;
  const requiredLabel = diskSpace ? formatBytes(diskSpace.required) : null;

  return (
    <div className="page-shell">
      <div className="page-scroll">
        <div className="page-container options-page" style={{ paddingBottom: 6 }}>
          {/* Hero */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 10,
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--slate)',
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--print)' }} />
            {t('options.title')}
          </div>
          <div
            style={{
              fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--ink)',
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
              marginBottom: 24,
              maxWidth: 480,
            }}
          >
            {t('options.subtitle')}
          </div>

          {/* Install path */}
          <div style={{ marginBottom: 22 }}>
            <div style={FIELD_LABEL_STYLE}>{t('options.pathLabel')}</div>
            <div className="input-group">
              <input
                className={`input${pathError ? ' input--error' : ''}`}
                type="text"
                value={options.installPath}
                disabled={isInstalling}
                onChange={(e) => {
                  setOptions((prev) => ({ ...prev, installPath: e.target.value }));
                  clearInstallError();
                }}
                placeholder={t('options.pathPlaceholder')}
              />
              <button
                className="btn"
                type="button"
                disabled={isInstalling}
                onClick={handleBrowse}
                style={{ padding: '7px 11px', flexShrink: 0, fontSize: 12 }}
              >
                {t('options.browse')}
              </button>
            </div>
            {pathError ? (
              <InstallErrorPanel message={pathError} />
            ) : diskSpace ? (
              <div
                style={{
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--slate)',
                  letterSpacing: '0.02em',
                }}
              >
                {t('options.available')} {availableLabel} · {t('options.required')} {requiredLabel}
              </div>
            ) : null}
          </div>

          {/* Integrations — quiet list, no numbers, hover-only accents */}
          <div>
            <div style={FIELD_LABEL_STYLE}>{t('options.optionsLabel', 'Integrations')}</div>
            {integrations.map(({ key, labelKey }) => {
              const active = Boolean(options[key]);
              return (
                <label
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 2px',
                    cursor: isInstalling ? 'default' : 'pointer',
                    transition: 'color 0.15s ease',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: active ? 'var(--ink)' : 'var(--graphite)',
                      lineHeight: 1.35,
                    }}
                  >
                    {t(labelKey)}
                  </span>
                  <button
                    type="button"
                    className={`toggle-switch${active ? ' on' : ''}`}
                    onClick={() => { if (!isInstalling) toggle(key); }}
                    disabled={isInstalling}
                    aria-pressed={active}
                    aria-label={t(labelKey)}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="page-footer page-footer--split">
        <button className="btn btn-ghost" type="button" disabled={isInstalling} onClick={onBack}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('options.changeLanguage')}
        </button>
        <IgniteButton
          loading={isInstalling}
          disabled={!canInstall}
          onClick={() => { void onInstall(); }}
        >
          {isInstalling ? t('options.installing') : t('options.install')}
        </IgniteButton>
      </div>
    </div>
  );
}
