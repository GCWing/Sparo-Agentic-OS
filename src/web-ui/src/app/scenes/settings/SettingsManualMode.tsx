import { useTranslation } from 'react-i18next';
import { SceneHeader, SettingsPage } from '@/design-system';
import { getCustomSettingsTab } from './customSettingsRegistry';
import { SettingsProjectionHost } from './SettingsProjectionHost';
import { useSettingsStore } from './settingsStore';

function humanizeId(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export interface SettingsManualModeProps {
  disabled?: boolean;
}

export function SettingsManualMode({ disabled = false }: SettingsManualModeProps) {
  const { t } = useTranslation('settings/config-center');
  const activeTab = useSettingsStore((state) => state.activeTab);
  const isCustomTab = Boolean(getCustomSettingsTab(activeTab));

  if (isCustomTab) {
    return (
      <div className="sparo-settings-manual-mode">
        <SettingsProjectionHost tabId={activeTab} disabled={disabled} />
      </div>
    );
  }

  return (
    <div className="sparo-settings-manual-mode">
      <SettingsPage width="default" className="sparo-settings-manual-mode__page">
        <SceneHeader
          className="sparo-settings-manual-mode__header"
          title={t(`tabs.${activeTab}`, { defaultValue: humanizeId(activeTab) })}
          description={t(`tabDescriptions.${activeTab}`, { defaultValue: '' })}
        />
        <SettingsProjectionHost tabId={activeTab} disabled={disabled} />
      </SettingsPage>
    </div>
  );
}
