import { useTranslation } from 'react-i18next';

interface UninstallPageProps {
  installPath: string;
  isUninstalling: boolean;
  uninstallCompleted: boolean;
  uninstallError: string | null;
  uninstallProgress: number;
  onUninstall: () => Promise<void>;
  onClose: () => void;
}

export function UninstallPage({
  installPath,
  isUninstalling,
  uninstallCompleted,
  uninstallError,
  uninstallProgress,
  onUninstall,
  onClose,
}: UninstallPageProps) {
  const { t } = useTranslation();

  const showProgress = isUninstalling || (uninstallCompleted && uninstallProgress > 0);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 1,
        padding: '48px 32px',
      }}
    >
      {/* Status heading */}
      <div style={{
        fontSize: 26,
        fontWeight: 700,
        color: 'var(--ink)',
        textAlign: 'center',
        letterSpacing: '-0.02em',
        marginBottom: 12,
        animation: 'fadeUp 0.5s ease-out',
      }}>
        {uninstallCompleted
          ? t('uninstall.orbitRetracted', '轨道已收回')
          : isUninstalling
          ? t('uninstall.retracting', '轨道收回中…')
          : t('uninstall.title')}
      </div>

      {/* Subtitle */}
      <div style={{
        fontSize: 14,
        color: 'var(--slate)',
        textAlign: 'center',
        maxWidth: 380,
        lineHeight: 1.6,
        marginBottom: 8,
      }}>
        {uninstallCompleted
          ? t('uninstall.farewell', '期待你下一次点燃。')
          : t('uninstall.subtitle')}
      </div>

      {/* Install path */}
      {!uninstallCompleted && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 16,
          marginBottom: 20,
          padding: '8px 14px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--element-bg-subtle)',
          maxWidth: 400,
        }}>
          <span style={{ fontSize: 11, color: 'var(--slate)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t('uninstall.installPath')}:
          </span>
          <span style={{
            fontSize: 11,
            color: 'var(--graphite)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {installPath || t('uninstall.pathUnknown')}
          </span>
        </div>
      )}

      {/* Progress track */}
      {showProgress && (
        <div style={{ width: '100%', maxWidth: 320, marginBottom: 20 }}>
          <div style={{
            height: 2,
            background: 'var(--element-bg-medium)',
            borderRadius: 1,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${uninstallProgress}%`,
              background: uninstallCompleted ? 'var(--color-success)' : 'var(--print)',
              borderRadius: 1,
              transition: 'width 0.4s ease, background 0.6s ease',
            }} />
          </div>
          <div style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--slate)',
            fontFamily: 'var(--font-mono)',
            textAlign: 'right',
          }}>
            {uninstallProgress}%
          </div>
        </div>
      )}

      {/* Error */}
      {uninstallError && (
        <div style={{
          fontSize: 13,
          color: 'var(--print)',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          marginBottom: 16,
          maxWidth: 380,
          textAlign: 'center',
        }}>
          {uninstallError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onClose}>
          {t(uninstallCompleted ? 'uninstall.close' : 'uninstall.cancel')}
        </button>
        {!uninstallCompleted && (
          <button
            className="btn btn--ignite"
            disabled={isUninstalling}
            onClick={() => { void onUninstall(); }}
          >
            {isUninstalling ? t('uninstall.uninstalling') : t('uninstall.confirm')}
          </button>
        )}
      </div>
    </div>
  );
}
