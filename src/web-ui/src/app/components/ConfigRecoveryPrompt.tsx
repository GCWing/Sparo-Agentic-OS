import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/design-system';
import {
  configStartupStatusStore,
  isConfigReadOnlyRecovery,
  useConfigStartupStatus,
} from '@/infrastructure/config';

export function ConfigRecoveryPrompt() {
  const { t } = useTranslation('settings/config-center');
  const startupStatus = useConfigStartupStatus();
  const recovery = isConfigReadOnlyRecovery(startupStatus.value);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (recovery) {
      setDismissed(false);
    }
  }, [recovery]);

  const rebuildDefaults = async () => {
    setFailed(false);
    try {
      await configStartupStatusStore.rebuildDefaults();
    } catch {
      setFailed(true);
      setDismissed(false);
    }
  };

  return (
    <ConfirmDialog
      open={recovery && !dismissed}
      onOpenChange={(open) => setDismissed(!open)}
      onConfirm={() => void rebuildDefaults()}
      title={t('recovery.promptTitle')}
      message={failed ? t('recovery.failed') : t('recovery.promptMessage')}
      type={failed ? 'error' : 'warning'}
      confirmText={t('recovery.action')}
      cancelText={t('recovery.later')}
      confirmDanger
    />
  );
}
