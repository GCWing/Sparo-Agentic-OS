/**
 * Runtime tab — launch defaults, triggers, telemetry.
 * Awaiting backend; renders a focused empty state to keep IA visible.
 */
import React from 'react';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/design-system';

export const RuntimeTab: React.FC = () => {
  const { t } = useTranslation('scenes/apps');
  return (
    <div className="app-detail-pane-empty">
      <EmptyState
        image={<Rocket size={28} strokeWidth={1.4} />}
        title={t('appDetail.runtime.title')}
        description={t('appDetail.runtime.description')}
      />
    </div>
  );
};
