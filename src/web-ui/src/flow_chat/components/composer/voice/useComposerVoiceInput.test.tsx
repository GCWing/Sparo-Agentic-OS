/**
 * @vitest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useComposerVoiceInput,
  type ComposerVoiceInputController,
} from './useComposerVoiceInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  finishText: 'Transcribed request',
  recorderStop: vi.fn(async () => undefined),
  finishInputSession: vi.fn(async () => ({ text: 'Transcribed request' })),
  cancelInputSession: vi.fn(async () => undefined),
  notificationInfo: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  DEFAULT_SPEECH_SAMPLE_RATE: 16000,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID: 'sensevoice-test-model',
  speechAPI: {
    listModels: vi.fn(async () => ({
      models: [{ modelId: 'sensevoice-test-model', state: 'installed' }],
    })),
    onModelStatusChanged: vi.fn(() => () => undefined),
    startInputSession: vi.fn(async () => ({ sessionId: 'voice-session-1' })),
    appendAudioChunk: vi.fn(async () => undefined),
    finishInputSession: mocks.finishInputSession,
    cancelInputSession: mocks.cancelInputSession,
  },
}));

vi.mock('@/infrastructure/config/hooks', () => {
  const voiceInput = {
    enabled: true,
    default_language: 'auto',
    max_recording_seconds: 60,
  };
  return {
    useAIExperienceSettings: () => ({
      settings: { voice_input: voiceInput },
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@/app/navigation/workspaceNavigation', () => ({
  openWorkspaceScene: vi.fn(),
}));

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ setActiveTab: vi.fn() }),
  },
}));

vi.mock('@/shared/notification-system', () => ({
  notificationService: {
    info: mocks.notificationInfo,
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./voiceInputAudio', () => ({
  createVoiceInputRecorder: vi.fn(async () => ({
    stop: mocks.recorderStop,
  })),
}));

interface ProbeProps {
  activateInput: () => void;
  focusInputSoon: () => void;
  insertText: (text: string) => boolean;
  submitText: () => Promise<void>;
  onController: (controller: ComposerVoiceInputController) => void;
}

function Probe({ onController, ...options }: ProbeProps) {
  const controller = useComposerVoiceInput(options);
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

describe('useComposerVoiceInput completion modes', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ComposerVoiceInputController | undefined;
  let activateInput: ReturnType<typeof vi.fn>;
  let focusInputSoon: ReturnType<typeof vi.fn>;
  let insertText: ReturnType<typeof vi.fn<(text: string) => boolean>>;
  let submitText: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(async () => {
    mocks.finishText = 'Transcribed request';
    mocks.finishInputSession.mockImplementation(async () => ({ text: mocks.finishText }));
    mocks.recorderStop.mockClear();
    mocks.finishInputSession.mockClear();
    mocks.cancelInputSession.mockClear();
    mocks.notificationInfo.mockClear();
    activateInput = vi.fn();
    focusInputSoon = vi.fn();
    insertText = vi.fn(() => true);
    submitText = vi.fn(async () => undefined);
    controller = undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <Probe
          activateInput={activateInput}
          focusInputSoon={focusInputSoon}
          insertText={insertText}
          submitText={submitText}
          onController={(next) => { controller = next; }}
        />,
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function startRecording() {
    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller?.phase).toBe('recording');
  }

  it('inserts the transcript without sending in transcribe-only mode', async () => {
    await startRecording();

    await act(async () => {
      controller?.transcribe();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(insertText).toHaveBeenCalledWith('Transcribed request');
    expect(focusInputSoon).toHaveBeenCalledOnce();
    expect(submitText).not.toHaveBeenCalled();
  });

  it('submits the freshly inserted transcript in transcribe-and-send mode', async () => {
    await startRecording();

    await act(async () => {
      controller?.transcribeAndSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activateInput).toHaveBeenCalledOnce();
    expect(insertText).toHaveBeenCalledWith('Transcribed request');
    expect(submitText).toHaveBeenCalledOnce();
    expect(focusInputSoon).not.toHaveBeenCalled();
  });

  it('never submits the existing draft when transcription is empty', async () => {
    mocks.finishText = '   ';
    await startRecording();

    await act(async () => {
      controller?.transcribeAndSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(insertText).not.toHaveBeenCalled();
    expect(submitText).not.toHaveBeenCalled();
    expect(mocks.notificationInfo).toHaveBeenCalledOnce();
  });
});
