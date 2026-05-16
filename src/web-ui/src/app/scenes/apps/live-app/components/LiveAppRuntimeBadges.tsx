import React from 'react';
import { Badge } from '@/design-system';
import type { LiveAppRuntimeSummary } from '../liveAppRuntimeModel';

interface LiveAppRuntimeBadgesProps {
  summary: LiveAppRuntimeSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
  className?: string;
}

const LiveAppRuntimeBadges: React.FC<LiveAppRuntimeBadgesProps> = ({ summary, t, className }) => {
  const classNames = ['live-app-runtime-badges', className].filter(Boolean).join(' ');
  const runtimeText = !summary.nodeEnabled
    ? t('liveApp.permissions.nodeDisabled')
    : summary.runtimeAvailable
      ? t('liveApp.status.runtimeReady', {
          runtime: summary.runtimeLabel || t('liveApp.permissions.nodeEnabled'),
        })
      : t('liveApp.status.runtimeUnavailable');

  return (
    <div
      className={classNames}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {summary.isOpen ? <Badge variant="info">{t('liveApp.status.open')}</Badge> : null}
      {summary.isRunning ? <Badge variant="success">{t('liveApp.status.running')}</Badge> : null}
      {summary.depsDirty ? <Badge variant="warning">{t('liveApp.status.depsDirty')}</Badge> : null}
      {summary.workerRestartRequired ? (
        <Badge variant="warning">{t('liveApp.status.restartRequired')}</Badge>
      ) : null}
      <Badge variant={summary.runtimeAvailable ? 'neutral' : 'error'}>{runtimeText}</Badge>
    </div>
  );
};

export default LiveAppRuntimeBadges;
