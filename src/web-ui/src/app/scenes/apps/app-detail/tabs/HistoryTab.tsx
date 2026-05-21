/**
 * History tab — recent sessions and runs for this App.
 * Awaiting session-listing API; renders a focused empty state.
 */
import React from 'react';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/design-system';

export const HistoryTab: React.FC = () => {
  const { t } = useTranslation('scenes/apps');
  return (
    <div className="app-detail-pane-empty">
      <EmptyState
        image={<History size={28} strokeWidth={1.4} />}
        title={t('appDetail.history.title')}
        description={t('appDetail.history.description')}
      />
    </div>
  );
};
