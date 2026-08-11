import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Mic, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { ComposerVoiceInputController } from './useComposerVoiceInput';

const VOICE_TIMELINE_SAMPLE_COUNT = 32;
const VOICE_TIMELINE_TICK_MS = 86;
const VOICE_SILENCE_THRESHOLD = 0.035;

function createFlatTimelineSamples(): number[] {
  return Array.from({ length: VOICE_TIMELINE_SAMPLE_COUNT }, () => 0);
}

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

interface ComposerVoiceInputButtonProps {
  controller: ComposerVoiceInputController;
}

export function ComposerVoiceInputButton({ controller }: ComposerVoiceInputButtonProps) {
  const [timelineSamples, setTimelineSamples] = useState(createFlatTimelineSamples);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const currentLevelRef = useRef(0);

  useEffect(() => {
    currentLevelRef.current = controller.audioLevel;
  }, [controller.audioLevel]);

  useEffect(() => {
    if (controller.phase === 'idle' || controller.phase === 'preparing') {
      setTimelineSamples(createFlatTimelineSamples());
      return undefined;
    }
    if (controller.phase === 'transcribing') {
      return undefined;
    }

    setTimelineSamples(createFlatTimelineSamples());
    const timerId = window.setInterval(() => {
      const level = currentLevelRef.current < VOICE_SILENCE_THRESHOLD
        ? 0
        : Math.min(1, currentLevelRef.current);
      setTimelineSamples(previous => [...previous.slice(1), level]);
    }, VOICE_TIMELINE_TICK_MS);

    return () => window.clearInterval(timerId);
  }, [controller.phase]);

  useEffect(() => {
    if (controller.phase === 'idle' || controller.phase === 'preparing') {
      setElapsedSeconds(0);
      return undefined;
    }
    if (controller.phase !== 'recording') {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [controller.phase]);

  if (!controller.enabled) {
    return null;
  }

  const preparing = controller.phase === 'preparing';
  const transcribing = controller.phase === 'transcribing';
  const recording = controller.phase === 'recording';
  const activeVoicePill = preparing || recording || transcribing;

  if (activeVoicePill) {
    const currentSample = !recording || controller.audioLevel < VOICE_SILENCE_THRESHOLD
      ? 0
      : Math.min(1, controller.audioLevel);
    const visibleTimelineSamples = recording
      ? [...timelineSamples.slice(0, -1), currentSample]
      : timelineSamples;
    const controlsDisabled = preparing || transcribing;

    return (
      <span className="sparo-chat-input__voice-cluster sparo-chat-input__voice-cluster--recording">
        <span
          aria-label={controller.tooltip}
          aria-busy={preparing || transcribing}
          className="sparo-chat-input__voice-pill"
          role="group"
        >
          <span className="sparo-chat-input__voice-pill-status" aria-hidden="true">
            {preparing ? (
              <Loader2 size={12} className="sparo-chat-input__voice-spinner" />
            ) : (
              <span className="sparo-chat-input__voice-pill-recording-dot" />
            )}
          </span>

          <span className="sparo-chat-input__voice-pill-time" aria-hidden="true">
            {formatElapsedTime(elapsedSeconds)}
          </span>

          <span
            className={`sparo-chat-input__voice-pill-timeline${recording ? '' : ' sparo-chat-input__voice-pill-timeline--paused'}`}
            aria-hidden="true"
          >
            {visibleTimelineSamples.map((sample, index) => {
              const scale = Math.max(0.12, Math.min(1, 0.12 + sample * 0.88));
              return (
                <span
                  key={index}
                  className="sparo-chat-input__voice-pill-timeline-bar"
                  style={{
                    opacity: sample === 0 ? 0.32 : 0.82,
                    transform: `scaleY(${scale})`,
                  }}
                />
              );
            })}
          </span>

          <span className="sparo-chat-input__voice-pill-divider" aria-hidden="true" />

          <IconButton
            aria-label={controller.cancelTooltip}
            className="sparo-chat-input__voice-pill-action sparo-chat-input__voice-pill-action--cancel"
            variant="ghost"
            size="xs"
            shape="circle"
            disabled={transcribing}
            tooltip={controller.cancelTooltip}
            onClick={(event) => {
              event.stopPropagation();
              controller.cancel();
            }}
          >
            <X size={16} />
          </IconButton>

          <IconButton
            aria-label={controlsDisabled ? controller.tooltip : controller.transcribeTooltip}
            className="sparo-chat-input__voice-pill-action sparo-chat-input__voice-pill-action--transcribe"
            variant="ghost"
            size="xs"
            shape="circle"
            disabled={controlsDisabled}
            tooltip={controlsDisabled ? controller.tooltip : controller.transcribeTooltip}
            onClick={(event) => {
              event.stopPropagation();
              controller.transcribe();
            }}
          >
            {transcribing && controller.completionMode === 'transcribe' ? (
              <Loader2 size={15} className="sparo-chat-input__voice-spinner" />
            ) : (
              <Check size={16} />
            )}
          </IconButton>

          <IconButton
            aria-label={controlsDisabled ? controller.tooltip : controller.sendTooltip}
            className="sparo-chat-input__voice-pill-send"
            variant="brand"
            size="xs"
            shape="circle"
            disabled={controlsDisabled}
            tooltip={controlsDisabled ? controller.tooltip : controller.sendTooltip}
            onClick={(event) => {
              event.stopPropagation();
              controller.transcribeAndSend();
            }}
          >
            {transcribing && controller.completionMode === 'send' ? (
              <Loader2 size={15} className="sparo-chat-input__voice-spinner" />
            ) : (
              <ArrowUp size={15} strokeWidth={2.5} />
            )}
          </IconButton>
        </span>
      </span>
    );
  }

  return (
    <span className="sparo-chat-input__voice-cluster">
      <IconButton
        aria-label={controller.tooltip}
        className="sparo-chat-input__voice-control"
        variant="ghost"
        size="xs"
        shape="circle"
        disabled={controller.disabled}
        tooltip={controller.tooltip}
        onClick={(event) => {
          event.stopPropagation();
          controller.toggle();
        }}
      >
        <Mic size={14} />
      </IconButton>
    </span>
  );
}
