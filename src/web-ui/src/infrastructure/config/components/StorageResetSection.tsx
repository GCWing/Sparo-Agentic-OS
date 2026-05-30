import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  Switch,
} from '@/design-system';
import { storageAPI, type ResetMode } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import { ConfigPageSection } from './common';
import './StorageResetSection.scss';

const log = createLogger('StorageResetSection');
const CONFIRMATION_TEXT = 'RESET SPARO OS';

type ResetOptionKey = 'logs' | 'secrets' | 'browser';

interface ResetOptions {
  createBackup: boolean;
  includeLogs: boolean;
  includeSecrets: boolean;
  includeBrowserProfiles: boolean;
}

const RESET_MODES: ResetMode[] = ['soft', 'app_data', 'factory'];

const MODE_DETAIL_KEY: Record<ResetMode, string> = {
  soft: 'soft',
  app_data: 'appData',
  factory: 'factory',
};

const MODE_OPTION_MATRIX: Record<ResetMode, { visible: ResetOptionKey[]; forced: ResetOptionKey[] }> = {
  soft: { visible: [], forced: [] },
  app_data: { visible: ['logs', 'secrets', 'browser'], forced: [] },
  factory: { visible: ['logs', 'secrets', 'browser'], forced: ['secrets', 'browser'] },
};

const DEFAULT_OPTIONS: Record<ResetMode, ResetOptions> = {
  soft: {
    createBackup: false,
    includeLogs: false,
    includeSecrets: false,
    includeBrowserProfiles: false,
  },
  app_data: {
    createBackup: true,
    includeLogs: false,
    includeSecrets: false,
    includeBrowserProfiles: false,
  },
  factory: {
    createBackup: true,
    includeLogs: false,
    includeSecrets: true,
    includeBrowserProfiles: true,
  },
};

function formatMb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  if (value >= 1024) {
    return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} MB`;
}

interface StorageResetSectionProps {
  resetting: boolean;
  onResettingChange: (resetting: boolean) => void;
  onResetSuccess: (message: string) => void;
  onResetError: (message: string) => void;
}

export const StorageResetSection: React.FC<StorageResetSectionProps> = ({
  resetting,
  onResettingChange,
  onResetSuccess,
  onResetError,
}) => {
  const { t } = useTranslation('settings/data-storage');
  const [optionsByMode, setOptionsByMode] = useState<Record<ResetMode, ResetOptions>>(DEFAULT_OPTIONS);
  const [configDialogMode, setConfigDialogMode] = useState<ResetMode | null>(null);
  const [draftOptions, setDraftOptions] = useState<ResetOptions>(DEFAULT_OPTIONS.app_data);
  const [confirmResetMode, setConfirmResetMode] = useState<ResetMode | null>(null);

  const activeOptionMatrix = configDialogMode ? MODE_OPTION_MATRIX[configDialogMode] : null;

  const openConfigDialog = useCallback((mode: ResetMode) => {
    const matrix = MODE_OPTION_MATRIX[mode];
    setDraftOptions({
      ...optionsByMode[mode],
      includeSecrets: matrix.forced.includes('secrets') || optionsByMode[mode].includeSecrets,
      includeBrowserProfiles: matrix.forced.includes('browser') || optionsByMode[mode].includeBrowserProfiles,
    });
    setConfigDialogMode(mode);
  }, [optionsByMode]);

  const closeConfigDialog = useCallback(() => {
    if (resetting) return;
    setConfigDialogMode(null);
  }, [resetting]);

  const proceedToConfirm = useCallback(() => {
    if (!configDialogMode) return;
    setOptionsByMode(prev => ({ ...prev, [configDialogMode]: draftOptions }));
    setConfirmResetMode(configDialogMode);
    setConfigDialogMode(null);
  }, [configDialogMode, draftOptions]);

  const handleReset = useCallback(async () => {
    if (!confirmResetMode) return;

    const options = optionsByMode[confirmResetMode];
    const matrix = MODE_OPTION_MATRIX[confirmResetMode];
    const forcedSecrets = matrix.forced.includes('secrets');
    const forcedBrowser = matrix.forced.includes('browser');
    const showLogs = matrix.visible.includes('logs');
    const showSecrets = matrix.visible.includes('secrets');
    const showBrowser = matrix.visible.includes('browser');

    onResettingChange(true);
    try {
      const resetResult = await storageAPI.resetApplicationData({
        mode: confirmResetMode,
        confirmation: CONFIRMATION_TEXT,
        createBackup: options.createBackup,
        includeLogs: showLogs ? options.includeLogs : false,
        includeSecrets: forcedSecrets || (showSecrets && options.includeSecrets),
        includeBrowserProfiles: forcedBrowser || (showBrowser && options.includeBrowserProfiles),
        includeProjectLocalSparoDirs: [],
      });
      onResetSuccess(t('messages.resetComplete', {
        resetId: resetResult.resetId,
        size: formatMb(resetResult.bytesFreed / 1_048_576),
      }));
    } catch (resetError) {
      log.error('Failed to reset application data', { error: resetError });
      onResetError(t('messages.resetFailed'));
    } finally {
      onResettingChange(false);
      setConfirmResetMode(null);
    }
  }, [confirmResetMode, onResetError, onResetSuccess, onResettingChange, optionsByMode, t]);

  const dialogOptions = useMemo(() => {
    if (!activeOptionMatrix || !configDialogMode) return [];

    const rows: Array<{
      key: keyof ResetOptions;
      label: string;
      description: string;
      disabled?: boolean;
      visible: boolean;
    }> = [
      {
        key: 'createBackup',
        label: t('reset.options.backup.label'),
        description: t('reset.options.backup.description'),
        visible: configDialogMode !== 'soft',
      },
      {
        key: 'includeLogs',
        label: t('reset.options.logs.label'),
        description: t('reset.options.logs.description'),
        visible: activeOptionMatrix.visible.includes('logs'),
      },
      {
        key: 'includeSecrets',
        label: t('reset.options.secrets.label'),
        description: activeOptionMatrix.forced.includes('secrets')
          ? t('reset.options.forced')
          : t('reset.options.secrets.description'),
        disabled: activeOptionMatrix.forced.includes('secrets'),
        visible: activeOptionMatrix.visible.includes('secrets'),
      },
      {
        key: 'includeBrowserProfiles',
        label: t('reset.options.browser.label'),
        description: activeOptionMatrix.forced.includes('browser')
          ? t('reset.options.forced')
          : t('reset.options.browser.description'),
        disabled: activeOptionMatrix.forced.includes('browser'),
        visible: activeOptionMatrix.visible.includes('browser'),
      },
    ];

    return rows.filter(row => row.visible);
  }, [activeOptionMatrix, configDialogMode, t]);

  return (
    <>
      <ConfigPageSection title={t('sections.reset')}>
        {RESET_MODES.map(mode => (
          <button
            key={mode}
            type="button"
            className="sparo-config-page-row sparo-config-page-row--center sparo-data-storage-reset__action-row"
            disabled={resetting}
            onClick={() => openConfigDialog(mode)}
          >
            <span className="sparo-config-page-row__meta">
              <span className="sparo-config-page-row__label">
                {t(`reset.mode.${MODE_DETAIL_KEY[mode]}`)}
              </span>
              <span className="sparo-config-page-row__description">
                {t(`reset.summary.${MODE_DETAIL_KEY[mode]}`)}
              </span>
            </span>
            <span className="sparo-config-page-row__control sparo-data-storage-reset__action-indicator">
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </button>
        ))}
      </ConfigPageSection>

      <Dialog
        open={configDialogMode !== null}
        onOpenChange={(open) => {
          if (!open) closeConfigDialog();
        }}
        title={configDialogMode ? t(`reset.mode.${MODE_DETAIL_KEY[configDialogMode]}`) : undefined}
        size="medium"
        contentInset
        closeOnOverlayClick={!resetting}
        closeOnEscape={!resetting}
      >
        <DialogBody className="sparo-data-storage-reset-dialog__body">
          {configDialogMode ? (
            <>
              <p className="sparo-data-storage-reset-dialog__intro">
                {t(`reset.details.${MODE_DETAIL_KEY[configDialogMode]}`)}
              </p>
              {dialogOptions.length > 0 ? (
                <div className="sparo-data-storage-reset-dialog__options">
                  {dialogOptions.map(option => (
                    <div className="sparo-data-storage-reset-dialog__option" key={option.key}>
                      <div className="sparo-data-storage-reset-dialog__option-copy">
                        <span className="sparo-data-storage-reset-dialog__option-label">
                          {option.label}
                        </span>
                        <span className="sparo-data-storage-reset-dialog__option-description">
                          {option.description}
                        </span>
                      </div>
                      <div className="sparo-data-storage-reset-dialog__option-control">
                        <Switch
                          checked={draftOptions[option.key]}
                          disabled={option.disabled}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setDraftOptions(prev => ({ ...prev, [option.key]: checked }));
                          }}
                          size="small"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={closeConfigDialog}
            disabled={resetting}
          >
            {t('reset.dialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="small"
            onClick={proceedToConfirm}
            disabled={resetting || !configDialogMode}
          >
            {t('reset.dialog.confirm')}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={confirmResetMode !== null}
        onOpenChange={(open) => {
          if (!open && !resetting) setConfirmResetMode(null);
        }}
        onConfirm={() => void handleReset()}
        title={confirmResetMode ? t(`reset.confirm.${MODE_DETAIL_KEY[confirmResetMode]}.title`) : ''}
        message={confirmResetMode ? t(`reset.confirm.${MODE_DETAIL_KEY[confirmResetMode]}.message`) : ''}
        type="error"
        confirmDanger
        confirmText={t('resetDialog.confirm')}
        cancelText={t('resetDialog.cancel')}
      />
    </>
  );
};

export default StorageResetSection;
