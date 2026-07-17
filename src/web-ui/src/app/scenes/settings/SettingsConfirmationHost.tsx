import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/design-system';
import {
  configManager,
  type ConfigConfirmationRequiredError,
} from '@/infrastructure/config';
import {
  SettingsConfirmationContext,
  type ConfirmationRequester,
} from './settingsConfirmationContext';

interface PendingConfirmation {
  error: ConfigConfirmationRequiredError;
  resolve: (confirmed: boolean) => void;
}

function humanizeId(value: string): string {
  return value
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SettingsConfirmationHost({ children }: { children: ReactNode }) {
  const { t } = useTranslation('settings/ai-mode');
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const pendingRef = useRef<PendingConfirmation | null>(null);

  const requestConfirmation = useCallback<ConfirmationRequester>((error) => (
    new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next = { error, resolve };
      pendingRef.current = next;
      setPending(next);
    })
  ), []);

  useEffect(() => {
    const clearHandler = configManager.setConfirmationHandler(requestConfirmation);
    return () => {
      clearHandler();
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, [requestConfirmation]);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  const preview = useMemo(() => pending?.error.plan.changes
    .map((change) => humanizeId(change.settingId))
    .join('\n'), [pending]);

  return (
    <SettingsConfirmationContext.Provider value={requestConfirmation}>
      {children}
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) {
            settle(false);
          }
        }}
        title={t('confirmation.title')}
        message={t('confirmation.description')}
        preview={preview}
        confirmText={t('confirmation.confirm')}
        cancelText={t('confirmation.reject')}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </SettingsConfirmationContext.Provider>
  );
}
