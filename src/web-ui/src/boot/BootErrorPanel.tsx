import React from 'react';

interface BootErrorPanelProps {
  stage: string;
  error: string;
}

/**
 * Rendered when the backend reports `BootStage::Degraded`. Plain inline
 * styles so the panel works even when the design-system bundle failed to
 * load.
 */
const BootErrorPanel: React.FC<BootErrorPanelProps> = ({ stage, error }) => {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary, #14161a)',
        color: 'var(--color-text-primary, #eef0f3)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        zIndex: 10_000,
      }}
    >
      <div style={{ maxWidth: 560, padding: 32 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 12 }}>
          Sparo OS startup failed
        </h1>
        <p style={{ opacity: 0.7, marginBottom: 12 }}>
          The application could not finish initializing.
        </p>
        <p style={{ marginBottom: 8 }}>
          <strong>Stage:</strong> {stage}
        </p>
        <pre
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: 12,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
          }}
        >
          {error}
        </pre>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            type="button"
            onClick={handleReload}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
};

export default BootErrorPanel;
