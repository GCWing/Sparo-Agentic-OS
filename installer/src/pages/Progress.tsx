import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InstallProgress } from '../types/installer';

interface ProgressProps {
  progress: InstallProgress;
  error: string | null;
  canConfirmProgress: boolean;
  onConfirmProgress: () => void;
  onFinishAndLaunch: () => Promise<void>;
  onRetry: () => Promise<void>;
  onBackToOptions: () => void;
}

const STEP_LABEL_KEYS: Record<string, string> = {
  prepare:      'progress.prepare',
  extract:      'progress.extract',
  registry:     'progress.registry',
  shortcuts:    'progress.shortcuts',
  context_menu: 'progress.contextMenu',
  path:         'progress.path',
  config:       'progress.config',
  complete:     'progress.finishing',
};

export function ProgressPage({
  progress,
  error,
  canConfirmProgress,
  onConfirmProgress,
  onFinishAndLaunch,
  onRetry,
  onBackToOptions,
}: ProgressProps) {
  const { t } = useTranslation();
  const [launchBusy, setLaunchBusy] = useState(false);
  const isCompleted = canConfirmProgress || progress.percent >= 100;

  // Delay visual "ignited" state until after the bar's fill transition finishes (~400ms)
  // so the bar is visually full before the hero text switches.
  const [visualCompleted, setVisualCompleted] = useState(false);
  useEffect(() => {
    if (isCompleted && !visualCompleted) {
      const t1 = setTimeout(() => setVisualCompleted(true), 420);
      return () => clearTimeout(t1);
    }
  }, [isCompleted, visualCompleted]);

  // No auto-advance; user continues manually via footer button.

  const stepLabelKey = STEP_LABEL_KEYS[progress.step] ?? 'progress.starting';
  const stepLabel = t(stepLabelKey, { defaultValue: progress.step || t('progress.starting') });

  if (error) {
    return (
      <div className="page-shell">
        <div className="page-scroll">
          <div
            className="page-container page-container--center"
            style={{ alignItems: 'center', textAlign: 'center', gap: 0 }}
          >
            <div style={{
              fontFamily: "'Inter','Geist','Noto Sans SC',sans-serif",
              fontSize: 36,
              fontWeight: 700,
              color: 'var(--ink)',
              letterSpacing: '-0.035em',
              lineHeight: 1.15,
              marginBottom: 16,
              animation: 'fadeUp 0.5s ease-out',
            }}>
              {t('progress.failed')}
            </div>
            <div style={{
              fontSize: 13,
              color: 'var(--print)',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
              maxWidth: 440,
              lineHeight: 1.6,
            }}>
              {error}
            </div>
          </div>
        </div>
        <div className="page-footer page-footer--split">
          <button className="btn btn-ghost" onClick={onBackToOptions}>
            {t('options.title')}
          </button>
          <button className="btn btn--ignite" onClick={() => { void onRetry(); }}>
            {t('options.install')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-scroll">
        <div
          className="page-container page-container--center progress-page-shell"
          style={{ alignItems: 'center', textAlign: 'center', gap: 0 }}
        >
          <div className="progress-page__inner">
          {/* Hero: visualCompleted drives text switch (after bar fills visually) */}
          <div className="progress-page__hero">
            <span
              className={'progress-page__hero-text progress-page__hero-text--connecting' + (visualCompleted ? '' : ' progress-page__hero-text--visible')}
            >
              {t('progress.connectingSystem', '正在为你接通系统')}
            </span>
            <span
              className={'progress-page__hero-text progress-page__hero-text--ignited' + (visualCompleted ? ' progress-page__hero-text--visible' : '')}
              aria-hidden={!visualCompleted}
            >
              {t('progress.ignited', '火种已点燃')}
            </span>
          </div>

          {/* Step + percent only; no separate "complete" caption when ignited */}
          <div className="progress-page__caption" aria-live="polite">
            {!visualCompleted ? (
              <span className="progress-page__caption-live">{`${stepLabel} · ${Math.min(100, progress.percent)}%`}</span>
            ) : (
              <span className="progress-page__caption-placeholder" aria-hidden />
            )}
          </div>

          <div className="progress-page__lower">
            <div className="install-progress-bar-wrap">
              <div
                className="progress-bar-container install-progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.max(0, Math.round(progress.percent)))}
                aria-label={stepLabel}
              >
                <div
                  className={'progress-bar-fill install-progress-bar__fill' + (isCompleted ? ' install-progress-bar__fill--complete' : '')}
                  style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                />
              </div>
            </div>

            <div className="progress-page__cta-wrap" aria-live="polite">
              <div
                className={
                  'progress-page__cta-inner' + (visualCompleted ? ' progress-page__cta-inner--visible' : '')
                }
              >
                <div className="progress-page__cta-actions">
                  <button
                    type="button"
                    className="btn btn-ghost progress-page__cta-secondary"
                    disabled={launchBusy}
                    onClick={() => {
                      setLaunchBusy(true);
                      void onFinishAndLaunch().finally(() => setLaunchBusy(false));
                    }}
                  >
                    {t('progress.finishAndLaunch')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ignite progress-page__cta-primary"
                    disabled={launchBusy}
                    onClick={onConfirmProgress}
                  >
                    {t('progress.continueConfigure')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

    </div>
  );
}
