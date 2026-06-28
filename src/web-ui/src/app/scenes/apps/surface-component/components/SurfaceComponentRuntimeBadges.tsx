import React from 'react';
import { Badge } from '@/design-system';
import type { SurfaceComponentRuntimeSummary } from '../surfaceComponentRuntimeModel';

interface SurfaceComponentRuntimeBadgesProps {
  summary: SurfaceComponentRuntimeSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
  className?: string;
}

const SurfaceComponentRuntimeBadges: React.FC<SurfaceComponentRuntimeBadgesProps> = ({ summary, t, className }) => {
  const classNames = ['surface-component-runtime-badges', className].filter(Boolean).join(' ');
  const runtimeText = !summary.nodeEnabled
    ? t('surfaceComponent.permissions.nodeDisabled')
    : summary.runtimeAvailable
      ? t('surfaceComponent.status.runtimeReady', {
          runtime: summary.runtimeLabel || t('surfaceComponent.permissions.nodeEnabled'),
        })
      : t('surfaceComponent.status.runtimeUnavailable');

  return (
    <div
      className={classNames}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {summary.isOpen ? <Badge variant="info">{t('surfaceComponent.status.open')}</Badge> : null}
      {summary.isRunning ? <Badge variant="success">{t('surfaceComponent.status.running')}</Badge> : null}
      {summary.depsDirty ? <Badge variant="warning">{t('surfaceComponent.status.depsDirty')}</Badge> : null}
      {summary.workerRestartRequired ? (
        <Badge variant="warning">{t('surfaceComponent.status.restartRequired')}</Badge>
      ) : null}
      <Badge variant={summary.runtimeAvailable ? 'neutral' : 'error'}>{runtimeText}</Badge>
    </div>
  );
};

export default SurfaceComponentRuntimeBadges;
