import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen, HardDrive, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Select,
  Switch,
  confirmDanger,
  type BadgeVariant,
  type SelectOption,
} from '@/design-system';
import {
  DEFAULT_MAX_RECORDING_SECONDS,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID,
  speechAPI,
  systemFsAPI,
  type SpeechModelInstallState,
  type SpeechModelStatus,
} from '@/infrastructure/api';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import { useAIExperienceSettings } from '../hooks';
import {
  aiExperienceConfigService,
  type AIExperienceSettings,
} from '../services/AIExperienceConfigService';
import type { VoiceInputSettings } from '../types';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageLoading,
  ConfigPageMessage,
  ConfigPageRow,
  ConfigPageSection,
} from './common';
import './VoiceInputConfig.scss';

const log = createLogger('VoiceInputConfig');

const LANGUAGE_OPTIONS: SelectOption[] = [
  { label: 'Auto', value: 'auto' },
  { label: '中文', value: 'zh' },
  { label: '粤语', value: 'yue' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
];

const normalizeSelectValue = (value: string | number | (string | number)[]): string =>
  String(Array.isArray(value) ? (value[0] ?? '') : value);

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function clampRecordingSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_RECORDING_SECONDS;
  }
  return Math.min(300, Math.max(5, Math.round(value)));
}

function statusBadgeVariant(state: SpeechModelInstallState): BadgeVariant {
  switch (state) {
    case 'installed':
      return 'success';
    case 'downloading':
    case 'verifying':
      return 'info';
    case 'corrupt':
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

const VoiceInputConfig: React.FC = () => {
  const { t } = useTranslation('settings/voice-input');
  const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useAIExperienceSettings();
  const [models, setModels] = useState<SpeechModelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const cancelDownloadRequestedRef = useRef(false);

  const voiceInput = settings?.voice_input;
  const model = useMemo(
    () => models.find(item => item.modelId === LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID) ?? models[0],
    [models],
  );
  const isDownloading = model?.state === 'downloading';
  const progressPercent = Math.min(100, Math.max(0, model?.progress?.percent ?? 0));

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const modelResponse = await speechAPI.listModels();
      setModels(modelResponse.models);
    } catch (error) {
      log.error('Failed to load voice input settings', { error });
      notificationService.error(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
    const unsubscribeProgress = speechAPI.onModelProgress(event => {
      setModels(previous => previous.map(item =>
        item.modelId === event.status.modelId ? event.status : item
      ));
    });
    const unsubscribeStatus = speechAPI.onModelStatusChanged(status => {
      setModels(previous => previous.map(item =>
        item.modelId === status.modelId ? status : item
      ));
    });

    return () => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, [loadData]);

  const updateVoiceInput = useCallback(async (patch: Partial<VoiceInputSettings>) => {
    if (!settings) {
      notificationService.error(t('messages.loadFailed'));
      return;
    }
    const nextSettings: AIExperienceSettings = {
      ...settings,
      voice_input: {
        ...settings.voice_input,
        ...patch,
      },
    };
    try {
      await aiExperienceConfigService.saveSettings(nextSettings);
      notificationService.success(t('messages.saveSuccess'));
    } catch (error) {
      log.error('Failed to save voice input settings', { error });
      notificationService.error(t('messages.saveFailed'));
    }
  }, [settings, t]);

  const updateModelStatus = useCallback((status: SpeechModelStatus) => {
    setModels(previous => previous.map(item =>
      item.modelId === status.modelId ? status : item
    ));
  }, []);

  const handleDownload = useCallback(() => {
    if (!model || model.state === 'downloading') return;
    cancelDownloadRequestedRef.current = false;
    updateModelStatus({
      ...model,
      state: 'downloading',
      installedBytes: 0,
      progress: {
        modelId: model.modelId,
        downloadedBytes: 0,
        totalBytes: model.expectedBytes,
        percent: 0,
      },
      error: null,
    });

    void speechAPI.downloadModel(model.modelId).then(status => {
      updateModelStatus(status);
      notificationService.success(t('messages.downloadSuccess'));
    }).catch(error => {
      if (cancelDownloadRequestedRef.current) {
        return;
      }
      log.error('Failed to download speech model', { modelId: model.modelId, error });
      notificationService.error(t('messages.downloadFailed'));
      void loadData();
    }).finally(() => {
      cancelDownloadRequestedRef.current = false;
    });
  }, [loadData, model, t, updateModelStatus]);

  const handleCancelDownload = useCallback(async () => {
    if (!model) return;
    cancelDownloadRequestedRef.current = true;
    setBusyAction('cancel');
    try {
      const status = await speechAPI.cancelModelDownload(model.modelId);
      updateModelStatus(status);
      notificationService.info(t('messages.downloadCancelled'));
    } catch (error) {
      log.error('Failed to cancel speech model download', { modelId: model.modelId, error });
      notificationService.error(t('messages.cancelFailed'));
    } finally {
      setBusyAction(null);
    }
  }, [model, t, updateModelStatus]);

  const handleVerify = useCallback(async () => {
    if (!model) return;
    setBusyAction('verify');
    try {
      const status = await speechAPI.verifyModel(model.modelId);
      updateModelStatus(status);
      notificationService.success(t('messages.verifySuccess'));
    } catch (error) {
      log.error('Failed to verify speech model', { modelId: model.modelId, error });
      notificationService.error(t('messages.verifyFailed'));
    } finally {
      setBusyAction(null);
    }
  }, [model, t, updateModelStatus]);

  const handleOpenFolder = useCallback(async () => {
    if (!model?.installedPath) return;
    try {
      await systemFsAPI.revealInOs(model.installedPath);
    } catch (error) {
      log.error('Failed to reveal speech model path', { modelId: model.modelId, error });
      notificationService.error(t('messages.openFolderFailed'));
    }
  }, [model, t]);

  const handleDelete = useCallback(async () => {
    if (!model) return;
    const confirmed = await confirmDanger(
      t('model.deleteConfirmTitle'),
      t('model.deleteConfirmMessage', { name: model.displayName }),
      {
        confirmText: t('model.delete'),
        cancelText: t('model.keep'),
      },
    );
    if (!confirmed) return;

    setBusyAction('delete');
    try {
      const status = await speechAPI.deleteModel(model.modelId);
      updateModelStatus(status);
      notificationService.success(t('messages.deleteSuccess'));
    } catch (error) {
      log.error('Failed to delete speech model', { modelId: model.modelId, error });
      notificationService.error(t('messages.deleteFailed'));
    } finally {
      setBusyAction(null);
    }
  }, [model, t, updateModelStatus]);

  if (loading || settingsLoading) {
    return (
      <ConfigPageLayout className="voice-input-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent>
          <ConfigPageLoading text={t('loading')} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  if (settingsError || !settings || !voiceInput) {
    return (
      <ConfigPageLayout className="voice-input-config">
        <ConfigPageHeader title={t('title')} description={t('subtitle')} />
        <ConfigPageContent>
          <ConfigPageMessage message={{ type: 'error', text: t('messages.loadFailed') }} />
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }

  return (
    <ConfigPageLayout className="voice-input-config">
      <ConfigPageHeader title={t('title')} description={t('subtitle')} />

      <ConfigPageContent className="voice-input-config__content">
        <ConfigPageSection title={t('sections.composer')}>
          <ConfigPageRow
            label={t('composer.enabled.label')}
            description={t('composer.enabled.description')}
            align="center"
          >
            <Switch
              checked={voiceInput.enabled}
              onChange={(event) => updateVoiceInput({ enabled: event.target.checked })}
              size="small"
            />
          </ConfigPageRow>

          <ConfigPageRow
            label={t('composer.language.label')}
            description={t('composer.language.description')}
            align="center"
          >
            <Select
              value={voiceInput.default_language}
              onChange={(value) => updateVoiceInput({ default_language: normalizeSelectValue(value) })}
              options={LANGUAGE_OPTIONS}
              size="small"
              className="voice-input-config__select"
            />
          </ConfigPageRow>

          <ConfigPageRow
            label={t('composer.maxRecording.label')}
            description={t('composer.maxRecording.description')}
            align="center"
          >
            <input
              className="voice-input-config__number-input"
              type="number"
              min={5}
              max={300}
              step={5}
              value={voiceInput.max_recording_seconds}
              onChange={(event) => {
                updateVoiceInput({
                  max_recording_seconds: clampRecordingSeconds(Number(event.target.value)),
                });
              }}
              aria-label={t('composer.maxRecording.label')}
            />
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('sections.model')}
          titleSuffix={model ? (
            <Badge variant={statusBadgeVariant(model.state)}>
              {t(`states.${model.state}`)}
            </Badge>
          ) : null}
          extra={(
            <Button
              variant="ghost"
              size="small"
              onClick={() => void loadData()}
              disabled={busyAction !== null || isDownloading}
            >
              <RefreshCw size={14} />
              {t('model.refresh')}
            </Button>
          )}
        >
          {model ? (
            <div className="voice-input-config__model-card">
              <div className="voice-input-config__model-main">
                <div className="voice-input-config__model-icon" aria-hidden="true">
                  <HardDrive size={18} />
                </div>
                <div className="voice-input-config__model-copy">
                  <div className="voice-input-config__model-name">{model.displayName}</div>
                  <div className="voice-input-config__model-meta">
                    <span>{t('model.version', { version: model.version })}</span>
                    <span>{t('model.size', { size: formatBytes(model.expectedBytes || model.installedBytes) })}</span>
                  </div>
                  {model.installedPath ? (
                    <div className="voice-input-config__model-path">{model.installedPath}</div>
                  ) : null}
                  {model.error ? (
                    <div className="voice-input-config__model-error">{model.error}</div>
                  ) : null}
                </div>
              </div>

              {isDownloading ? (
                <div className="voice-input-config__progress">
                  <div className="voice-input-config__progress-track" aria-hidden="true">
                    <div
                      className="voice-input-config__progress-value"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="voice-input-config__progress-text">
                    {t('model.progress', {
                      percent: Math.round(progressPercent),
                      downloaded: formatBytes(model.progress?.downloadedBytes ?? model.installedBytes),
                      total: formatBytes(model.progress?.totalBytes ?? model.expectedBytes),
                    })}
                  </span>
                </div>
              ) : null}

              <div className="voice-input-config__model-actions">
                {isDownloading ? (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => void handleCancelDownload()}
                    isLoading={busyAction === 'cancel'}
                    disabled={busyAction !== null && busyAction !== 'cancel'}
                    loadingLabel={t('model.cancelling')}
                  >
                    {t('model.cancel')}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() => void handleDownload()}
                    isLoading={busyAction === 'download'}
                    disabled={busyAction !== null || model.state === 'installed'}
                    loadingLabel={t('model.downloading')}
                  >
                    <Download size={14} />
                    {model.state === 'installed' ? t('model.downloaded') : t('model.download')}
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => void handleOpenFolder()}
                  disabled={busyAction !== null || !model.installedPath}
                >
                  <FolderOpen size={14} />
                  {t('model.openFolder')}
                </Button>

                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => void handleVerify()}
                  isLoading={busyAction === 'verify'}
                  disabled={busyAction !== null || model.state !== 'installed'}
                  loadingLabel={t('model.verifying')}
                >
                  <ShieldCheck size={14} />
                  {t('model.verify')}
                </Button>

                <Button
                  variant="danger"
                  size="small"
                  onClick={() => void handleDelete()}
                  isLoading={busyAction === 'delete'}
                  disabled={busyAction !== null || model.state !== 'installed'}
                  loadingLabel={t('model.deleting')}
                >
                  <Trash2 size={14} />
                  {t('model.delete')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="voice-input-config__empty">{t('model.empty')}</div>
          )}
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default VoiceInputConfig;
