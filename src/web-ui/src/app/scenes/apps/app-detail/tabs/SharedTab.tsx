/**
 * Shared tab — App-level resources every Agent can inherit.
 *
 * Backed by future schema-driven Shared config. For now the left rail enumerates
 * the planned sections and the main pane shows a focused coming-soon panel
 * per section so the contract is visible and the IA is locked in.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  EmptyState,
  NavigationList,
  NavigationListItem,
} from '@/design-system';
import { useAppDetailStore } from '../appDetailStore';
import { SHARED_SECTION_KEYS } from '../types';

export const SharedTab: React.FC = () => {
  const { t } = useTranslation('scenes/apps');
  const section = useAppDetailStore((s) => s.sharedSection);
  const setSection = useAppDetailStore((s) => s.setSharedSection);

  return (
    <div className="app-detail-shared">
      <div className="app-detail-shared__main">
        <EmptyState
          image={<Lock size={28} strokeWidth={1.4} />}
          title={t(`appDetail.shared.sections.${section}.title`)}
          description={t(`appDetail.shared.sections.${section}.description`)}
        />
      </div>
      <aside className="app-detail-shared__rail" aria-label={t('appDetail.shared.railLabel')}>
        <div className="app-detail-shared__rail-heading">{t('appDetail.shared.heading')}</div>
        <NavigationList variant="plain">
          {SHARED_SECTION_KEYS.map((key) => (
            <NavigationListItem
              key={key}
              active={section === key}
              onClick={() => setSection(key)}
            >
              {t(`appDetail.shared.sections.${key}.title`)}
            </NavigationListItem>
          ))}
        </NavigationList>
      </aside>
    </div>
  );
};
