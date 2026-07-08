import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_SPEECH_SAMPLE_RATE,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID,
  speechAPI,
  type SpeechInputSession,
} from '@/infrastructure/api';
import {
  aiExperienceConfigService,
  DEFAULT_VOICE_INPUT_SETTINGS,
  type VoiceInputSettings,
} from '@/infrastructure/config/services/AIExperienceConfigService';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  createVoiceInputRecorder,
  type VoiceInputRecorder,
} from './voiceInputAudio';

const log = createLogger('ComposerVoiceInput');

type VoiceInputPhase = 'idle' | 'preparing' | 'recording' | 'transcribing';
const STARTUP_AUDIO_BUFFER_LIMIT_SECONDS = 5;
const RECORDING_CHUNK_DURATION_MS = 1000;

export interface ComposerVoiceInputController {
  enabled: boolean;
  disabled: boolean;
  phase: VoiceInputPhase;
  audioLevel: number;
  tooltip: string;
  cancelTooltip: string;
  confirmTooltip: string;
  toggle: () => void;
  cancel: () => void;
  confirm: () => void;
}

export interface UseComposerVoiceInputOptions {
  activateInput: () => void;
  focusInputSoon: () => void;
  insertText: (text: string) => void;
}

function isMediaCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function resolveErrorMessage(error: unknown, permissionDenied: string, fallback: string): string {
  if (error instanceof DOMException && (
    error.name === 'NotAllowedError' ||
    error.name === 'PermissionDeniedError'
  )) {
    return permissionDenied;
  }
  return fallback;
}

function isModelMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('speech model is not installed');
}

function estimatePcm16Base64Seconds(pcm16Base64: string, sampleRate: number): number {
  const padding = pcm16Base64.endsWith('==') ? 2 : pcm16Base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor((pcm16Base64.length * 3) / 4) - padding);
  return bytes / (sampleRate * 2);
}

export function useComposerVoiceInput({
  activateInput,
  focusInputSoon,
  insertText,
}: UseComposerVoiceInputOptions): ComposerVoiceInputController {
  const { t } = useTranslation('flow-chat');
  const [settings, setSettings] = useState<VoiceInputSettings>(
    aiExperienceConfigService.getSettings().voice_input ?? DEFAULT_VOICE_INPUT_SETTINGS,
  );
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const sessionRef = useRef<SpeechInputSession | null>(null);
  const sessionPromiseRef = useRef<Promise<SpeechInputSession> | null>(null);
  const recorderRef = useRef<VoiceInputRecorder | null>(null);
  const pendingAppendRef = useRef<Promise<void>>(Promise.resolve());
  const appendErrorRef = useRef<unknown>(null);
  const latestAudioLevelRef = useRef(0);
  const audioLevelFrameRef = useRef<number | null>(null);
  const activeRecordingIdRef = useRef(0);
  const bufferedChunksRef = useRef<Array<{ pcm16Base64: string; seconds: number }>>([]);
  const bufferedSecondsRef = useRef(0);
  const cancelRecordingRef = useRef<(() => Promise<void>) | null>(null);

  const openVoiceInputSettings = useCallback(() => {
    useSettingsStore.getState().setActiveTab('voiceInput');
    openWorkspaceScene('settings');
  }, []);

  const refreshCapability = useCallback(async () => {
    try {
      const [loadedSettings, modelResponse] = await Promise.all([
        aiExperienceConfigService.getSettingsAsync(),
        speechAPI.listModels(),
      ]);
      setSettings(loadedSettings.voice_input ?? DEFAULT_VOICE_INPUT_SETTINGS);
      setModelInstalled(
        modelResponse.models.some(model =>
          model.modelId === LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID &&
          model.state === 'installed'
        ),
      );
    } catch (error) {
      log.warn('Failed to refresh voice input capability', { error });
      setModelInstalled(null);
    }
  }, []);

  useEffect(() => {
    void refreshCapability();
    const removeSettingsListener = aiExperienceConfigService.addChangeListener(nextSettings => {
      setSettings(nextSettings.voice_input ?? DEFAULT_VOICE_INPUT_SETTINGS);
    });
    const removeModelListener = speechAPI.onModelStatusChanged(status => {
      if (status.modelId === LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID) {
        setModelInstalled(status.state === 'installed');
      }
    });

    return () => {
      removeSettingsListener();
      removeModelListener();
    };
  }, [refreshCapability]);

  useEffect(() => () => {
    activeRecordingIdRef.current += 1;
    const session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    if (audioLevelFrameRef.current !== null) {
      window.cancelAnimationFrame(audioLevelFrameRef.current);
      audioLevelFrameRef.current = null;
    }
    if (recorder) {
      void recorder.stop().catch(error => {
        log.warn('Failed to stop voice recorder during cleanup', { error });
      });
    }
    if (session) {
      void speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel voice input session during cleanup', { error });
      });
    }
    if (sessionPromise) {
      sessionPromise.then(lateSession => {
        if (lateSession.sessionId === session?.sessionId) {
          return;
        }
        return speechAPI.cancelInputSession(lateSession.sessionId).catch(error => {
          log.warn('Failed to cancel late voice input session during cleanup', {
            sessionId: lateSession.sessionId,
            error,
          });
        });
      }).catch(error => {
        log.warn('Voice input session creation failed during cleanup', { error });
      });
    }
  }, []);

  const updateAudioLevel = useCallback((level: number) => {
    latestAudioLevelRef.current = Math.max(0, Math.min(1, level));
    if (audioLevelFrameRef.current !== null) {
      return;
    }

    audioLevelFrameRef.current = window.requestAnimationFrame(() => {
      audioLevelFrameRef.current = null;
      setAudioLevel(previous =>
        Math.max(0, Math.min(1, previous * 0.35 + latestAudioLevelRef.current * 0.65))
      );
    });
  }, []);

  const appendChunkToSession = useCallback(async (
    session: SpeechInputSession,
    pcm16Base64: string,
  ) => {
    if (sessionRef.current?.sessionId !== session.sessionId) {
      return;
    }
    try {
      await speechAPI.appendAudioChunk(session.sessionId, pcm16Base64);
    } catch (error) {
      appendErrorRef.current = error;
      log.warn('Failed to append voice input chunk', { sessionId: session.sessionId, error });
    }
  }, []);

  const flushBufferedChunks = useCallback((session: SpeechInputSession) => {
    const bufferedChunks = bufferedChunksRef.current;
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;

    for (const chunk of bufferedChunks) {
      pendingAppendRef.current = pendingAppendRef.current
        .catch(() => undefined)
        .then(() => appendChunkToSession(session, chunk.pcm16Base64));
    }
  }, [appendChunkToSession]);

  const attachSession = useCallback((session: SpeechInputSession, recordingId: number) => {
    if (activeRecordingIdRef.current !== recordingId) {
      void speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel stale voice input session', { sessionId: session.sessionId, error });
      });
      return;
    }

    sessionRef.current = session;
    appendErrorRef.current = null;
    flushBufferedChunks(session);
  }, [flushBufferedChunks]);

  const enqueueChunk = useCallback((pcm16Base64: string) => {
    const session = sessionRef.current;
    if (!session) {
      const seconds = estimatePcm16Base64Seconds(pcm16Base64, DEFAULT_SPEECH_SAMPLE_RATE);
      if (bufferedSecondsRef.current + seconds > STARTUP_AUDIO_BUFFER_LIMIT_SECONDS) {
        appendErrorRef.current = new Error('Voice input session took too long to start');
        log.warn('Voice input startup buffer limit exceeded', {
          limitSeconds: STARTUP_AUDIO_BUFFER_LIMIT_SECONDS,
          bufferedSeconds: bufferedSecondsRef.current,
        });
        void cancelRecordingRef.current?.();
        return;
      }
      bufferedChunksRef.current.push({ pcm16Base64, seconds });
      bufferedSecondsRef.current += seconds;
      return;
    }

    pendingAppendRef.current = pendingAppendRef.current
      .catch(() => undefined)
      .then(() => appendChunkToSession(session, pcm16Base64));
  }, [appendChunkToSession]);

  const cancelRecording = useCallback(async () => {
    activeRecordingIdRef.current += 1;
    const session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    appendErrorRef.current = null;
    pendingAppendRef.current = Promise.resolve();
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    setPhase('idle');

    if (recorder) {
      await recorder.stop().catch(error => {
        log.warn('Failed to stop voice recorder during cancellation', { error });
      });
    }
    if (session) {
      await speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel voice input session', { sessionId: session.sessionId, error });
      });
    }
    if (sessionPromise) {
      sessionPromise.then(lateSession => {
        if (lateSession.sessionId === session?.sessionId) {
          return;
        }
        return speechAPI.cancelInputSession(lateSession.sessionId).catch(error => {
          log.warn('Failed to cancel late voice input session', {
            sessionId: lateSession.sessionId,
            error,
          });
        });
      }).catch(error => {
        log.warn('Voice input session creation failed after cancellation', { error });
      });
    }
  }, []);

  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
    return () => {
      if (cancelRecordingRef.current === cancelRecording) {
        cancelRecordingRef.current = null;
      }
    };
  }, [cancelRecording]);

  const stopAndTranscribe = useCallback(async () => {
    let session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    if (!recorder || (!session && !sessionPromise)) {
      setPhase('idle');
      return;
    }

    setPhase('transcribing');
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    try {
      recorderRef.current = null;
      await recorder.stop();
      if (!session && sessionPromise) {
        session = await sessionPromise;
        attachSession(session, activeRecordingIdRef.current);
      }
      if (!sessionRef.current || !session) {
        throw new Error('Voice input session was not ready');
      }
      await pendingAppendRef.current;
      if (appendErrorRef.current) {
        throw appendErrorRef.current;
      }

      const result = await speechAPI.finishInputSession(session.sessionId);
      const text = result.text.trim();
      if (text) {
        activateInput();
        focusInputSoon();
        insertText(text);
      } else {
        notificationService.info(t('input.voiceInput.empty'));
      }
    } catch (error) {
      log.error('Voice input transcription failed', { sessionId: session?.sessionId, error });
      notificationService.error(resolveErrorMessage(
        error,
        t('input.voiceInput.permissionDenied'),
        t('input.voiceInput.failed'),
      ));
      if (session) {
        const sessionId = session.sessionId;
        await speechAPI.cancelInputSession(session.sessionId).catch(cancelError => {
          log.warn('Failed to cancel voice input session after error', {
            sessionId,
            error: cancelError,
          });
        });
      }
    } finally {
      activeRecordingIdRef.current += 1;
      sessionRef.current = null;
      sessionPromiseRef.current = null;
      appendErrorRef.current = null;
      pendingAppendRef.current = Promise.resolve();
      bufferedChunksRef.current = [];
      bufferedSecondsRef.current = 0;
      setPhase('idle');
    }
  }, [activateInput, attachSession, focusInputSoon, insertText, t]);

  const startRecording = useCallback(async () => {
    if (!settings.enabled) {
      notificationService.info(t('input.voiceInput.disabled'));
      return;
    }
    if (!isMediaCaptureSupported()) {
      notificationService.error(t('input.voiceInput.unsupported'));
      return;
    }

    setPhase('preparing');
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    const recordingId = activeRecordingIdRef.current + 1;
    activeRecordingIdRef.current = recordingId;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    appendErrorRef.current = null;
    pendingAppendRef.current = Promise.resolve();
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    let sessionPromise: Promise<SpeechInputSession> | null = null;

    try {
      const voiceSettings = settings;
      if (modelInstalled === false) {
        notificationService.warning(t('input.voiceInput.modelMissing'));
        openVoiceInputSettings();
        setPhase('idle');
        return;
      }

      sessionPromise = speechAPI.startInputSession({
        modelId: LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID,
        language: voiceSettings.default_language,
        sampleRate: DEFAULT_SPEECH_SAMPLE_RATE,
        maxRecordingSeconds: voiceSettings.max_recording_seconds,
      });
      sessionPromiseRef.current = sessionPromise;
      sessionPromise
        .then(session => {
          attachSession(session, recordingId);
        })
        .catch(async error => {
          if (activeRecordingIdRef.current !== recordingId) {
            return;
          }
          log.error('Failed to create voice input session', { error });
          activeRecordingIdRef.current += 1;
          const recorder = recorderRef.current;
          recorderRef.current = null;
          sessionRef.current = null;
          sessionPromiseRef.current = null;
          bufferedChunksRef.current = [];
          bufferedSecondsRef.current = 0;
          latestAudioLevelRef.current = 0;
          setAudioLevel(0);
          setPhase('idle');
          if (recorder) {
            await recorder.stop().catch(stopError => {
              log.warn('Failed to stop recorder after session creation failure', { error: stopError });
            });
          }
          if (isModelMissingError(error)) {
            setModelInstalled(false);
            notificationService.warning(t('input.voiceInput.modelMissing'));
            openVoiceInputSettings();
            return;
          }
          notificationService.error(t('input.voiceInput.failed'));
        });

      const recorder = await createVoiceInputRecorder({
        targetSampleRate: DEFAULT_SPEECH_SAMPLE_RATE,
        chunkDurationMs: RECORDING_CHUNK_DURATION_MS,
        onChunk: enqueueChunk,
        onLevel: updateAudioLevel,
      });
      if (activeRecordingIdRef.current !== recordingId) {
        await recorder.stop().catch(error => {
          log.warn('Failed to stop stale voice recorder', { error });
        });
        return;
      }
      recorderRef.current = recorder;
      setPhase('recording');
    } catch (error) {
      log.error('Failed to start voice input', { error });
      activeRecordingIdRef.current += 1;
      const session = sessionRef.current as SpeechInputSession | null;
      sessionRef.current = null;
      sessionPromiseRef.current = null;
      bufferedChunksRef.current = [];
      bufferedSecondsRef.current = 0;
      if (session) {
        const sessionId = session.sessionId;
        await speechAPI.cancelInputSession(sessionId).catch(cancelError => {
          log.warn('Failed to cancel voice input session after start failure', {
            sessionId,
            error: cancelError,
          });
        });
      }
      const pendingSessionPromise: Promise<SpeechInputSession> | null = sessionPromise;
      if (pendingSessionPromise) {
        pendingSessionPromise
          .then((lateSession: SpeechInputSession) => speechAPI.cancelInputSession(lateSession.sessionId))
          .catch(sessionError => {
            log.warn('Voice input session creation failed after recorder start failure', {
              error: sessionError,
            });
          });
      }
      if (isModelMissingError(error)) {
        setModelInstalled(false);
        notificationService.warning(t('input.voiceInput.modelMissing'));
        openVoiceInputSettings();
        setPhase('idle');
        return;
      }
      notificationService.error(resolveErrorMessage(
        error,
        t('input.voiceInput.permissionDenied'),
        t('input.voiceInput.failed'),
      ));
      latestAudioLevelRef.current = 0;
      setAudioLevel(0);
      setPhase('idle');
    }
  }, [attachSession, enqueueChunk, modelInstalled, openVoiceInputSettings, settings, t, updateAudioLevel]);

  const toggle = useCallback(() => {
    if (phase === 'recording') {
      void stopAndTranscribe();
      return;
    }
    if (phase !== 'idle') {
      return;
    }
    void startRecording();
  }, [phase, startRecording, stopAndTranscribe]);

  const cancel = useCallback(() => {
    void cancelRecording();
  }, [cancelRecording]);

  const confirm = useCallback(() => {
    void stopAndTranscribe();
  }, [stopAndTranscribe]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void cancelRecording();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelRecording, phase]);

  const disabled = phase === 'recording'
    ? false
    : !settings.enabled || !isMediaCaptureSupported() || phase === 'preparing' || phase === 'transcribing';
  const tooltip = useMemo(() => {
    if (!settings.enabled) return t('input.voiceInput.disabled');
    if (!isMediaCaptureSupported()) return t('input.voiceInput.unsupported');
    if (modelInstalled === false) return t('input.voiceInput.modelMissing');
    if (phase === 'preparing') return t('input.voiceInput.preparing');
    if (phase === 'recording') return t('input.voiceInput.stop');
    if (phase === 'transcribing') return t('input.voiceInput.transcribing');
    return t('input.voiceInput.start');
  }, [modelInstalled, phase, settings.enabled, t]);

  return {
    enabled: settings.enabled,
    disabled,
    phase,
    audioLevel,
    tooltip,
    cancelTooltip: t('input.cancelShortcut'),
    confirmTooltip: t('input.voiceInput.stop'),
    toggle,
    cancel,
    confirm,
  };
}
