import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { ModeSwitch } from '@/design-system';
import { useSettingsStore, type SettingsMode } from './settingsStore';

export function SettingsModeSwitch() {
  const { t } = useTranslation('settings/ai-mode');
  const mode = useSettingsStore((state) => state.mode);
  const setMode = useSettingsStore((state) => state.setMode);

  return (
    <ModeSwitch
      appearance="slider"
      className="sparo-settings-mode-switch"
      ariaLabel={t('modeLabel')}
      value={mode}
      onChange={(value) => setMode(value as SettingsMode)}
      options={[
        {
          value: 'manual',
          label: t('manualMode'),
          icon: <SlidersHorizontal size={14} aria-hidden />,
        },
        {
          value: 'ai',
          label: t('aiMode'),
          icon: <Sparkles size={14} aria-hidden />,
        },
      ]}
    />
  );
}
