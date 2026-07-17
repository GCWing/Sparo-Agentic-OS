import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@/design-system';
import {
  configStartupStatusStore,
  isConfigReadOnlyRecovery,
  useConfigStartupStatus,
} from '@/infrastructure/config';
import SettingsNav from './SettingsNav';
import { SettingsAIMode } from './SettingsAIMode';
import { SettingsManualMode } from './SettingsManualMode';
import { SettingsModeSwitch } from './SettingsModeSwitch';
import { SettingsConfirmationHost } from './SettingsConfirmationHost';
import { useSettingsStore } from './settingsStore';
import './SettingsScene.scss';

export default function SettingsScene() {
  const { t } = useTranslation('settings/config-center');
  const mode = useSettingsStore((state) => state.mode);
  const startupStatus = useConfigStartupStatus();
  const readOnlyRecovery = isConfigReadOnlyRecovery(startupStatus.value);
  const [rebuilding, setRebuilding] = useState(false);

  const rebuildDefaults = async () => {
    setRebuilding(true);
    try {
      await configStartupStatusStore.rebuildDefaults();
    } catch {
      // The store records the failure and recovery mode remains active.
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <SettingsConfirmationHost>
      <div className={`sparo-settings-scene sparo-settings-scene--${mode}`}>
        {readOnlyRecovery ? (
          <div className="sparo-settings-scene__recovery">
            <div className="sparo-settings-scene__recovery-alert">
              <Alert
                type="warning"
                title={t('recovery.title')}
                message={t('recovery.message')}
                description={t('recovery.description')}
              />
              <Button
                variant="danger"
                size="small"
                isLoading={rebuilding}
                loadingLabel={t('recovery.rebuilding')}
                onClick={() => void rebuildDefaults()}
              >
                {t('recovery.action')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="sparo-settings-scene__body">
          <aside className="sparo-settings-scene__nav">
            <div className="sparo-settings-scene__mode-switch">
              <SettingsModeSwitch />
            </div>
            <div className="sparo-settings-scene__nav-stack">
              <div
                ref={(element) => {
                  element?.toggleAttribute('inert', mode !== 'manual');
                }}
                className={[
                  'sparo-settings-scene__nav-panel',
                  'sparo-settings-scene__nav-panel--manual',
                  mode === 'manual' && 'is-active',
                ].filter(Boolean).join(' ')}
                aria-hidden={mode !== 'manual'}
              >
                <SettingsNav />
              </div>
            </div>
          </aside>
          <main className="sparo-settings-scene__content">
            <div className="sparo-settings-scene__content-stack">
              <section
                ref={(element) => {
                  element?.toggleAttribute('inert', mode !== 'manual');
                }}
                className={[
                  'sparo-settings-scene__content-panel',
                  'sparo-settings-scene__content-panel--manual',
                  mode === 'manual' && 'is-active',
                ].filter(Boolean).join(' ')}
                aria-hidden={mode !== 'manual'}
              >
                <SettingsManualMode disabled={readOnlyRecovery} />
              </section>
              <section
                ref={(element) => {
                  element?.toggleAttribute('inert', mode !== 'ai');
                }}
                className={[
                  'sparo-settings-scene__content-panel',
                  'sparo-settings-scene__content-panel--ai',
                  mode === 'ai' && 'is-active',
                ].filter(Boolean).join(' ')}
                aria-hidden={mode !== 'ai'}
              >
                <SettingsAIMode active={mode === 'ai'} disabled={readOnlyRecovery} />
              </section>
            </div>
          </main>
        </div>
      </div>
    </SettingsConfirmationHost>
  );
}
