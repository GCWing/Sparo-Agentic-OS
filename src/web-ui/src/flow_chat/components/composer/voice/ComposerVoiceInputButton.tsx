import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { ComposerVoiceInputController } from './useComposerVoiceInput';

const VOICE_TIMELINE_SAMPLE_COUNT = 22;
const VOICE_TIMELINE_TICK_MS = 86;
const VOICE_SILENCE_THRESHOLD = 0.035;
const FLAT_LINE_SCALE = 0.045;

function createFlatTimelineSamples(): number[] {
  return Array.from({ length: VOICE_TIMELINE_SAMPLE_COUNT }, () => 0);
}

interface ComposerVoiceInputButtonProps {
  controller: ComposerVoiceInputController;
}

export function ComposerVoiceInputButton({ controller }: ComposerVoiceInputButtonProps) {
  const [timelineSamples, setTimelineSamples] = useState(createFlatTimelineSamples);
  const currentLevelRef = useRef(0);

  useEffect(() => {
    currentLevelRef.current = controller.audioLevel;
  }, [controller.audioLevel]);

  useEffect(() => {
    if (controller.phase !== 'recording') {
      setTimelineSamples(createFlatTimelineSamples());
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

  if (!controller.enabled) {
    return null;
  }

  const busy = controller.phase === 'preparing' || controller.phase === 'transcribing';
  const recording = controller.phase === 'recording';

  if (recording) {
    const currentSample = controller.audioLevel < VOICE_SILENCE_THRESHOLD
      ? 0
      : Math.min(1, controller.audioLevel);
    const visibleTimelineSamples = [
      ...timelineSamples.slice(0, -1),
      currentSample,
    ];

    return (
      <span className="sparo-chat-input__voice-cluster sparo-chat-input__voice-cluster--recording">
        <span
          aria-label={controller.tooltip}
          className="sparo-chat-input__voice-pill"
          role="group"
        >
          <span className="sparo-chat-input__voice-pill-timeline" aria-hidden="true">
            {visibleTimelineSamples.map((sample, index) => {
              const scale = sample === 0
                ? FLAT_LINE_SCALE
                : Math.max(0.08, Math.min(1, 0.08 + sample * 0.92));
              return (
                <span
                  key={index}
                  className="sparo-chat-input__voice-pill-timeline-bar"
                  style={{ transform: `scaleY(${scale})` }}
                />
              );
            })}
          </span>

          <IconButton
            aria-label={controller.cancelTooltip}
            className="sparo-chat-input__voice-pill-action"
            variant="ghost"
            size="xs"
            shape="circle"
            tooltip={controller.cancelTooltip}
            onClick={(event) => {
              event.stopPropagation();
              controller.cancel();
            }}
          >
            <X size={16} />
          </IconButton>

          <IconButton
            aria-label={controller.confirmTooltip}
            className="sparo-chat-input__voice-pill-action sparo-chat-input__voice-pill-action--confirm"
            variant="ghost"
            size="xs"
            shape="circle"
            tooltip={controller.confirmTooltip}
            onClick={(event) => {
              event.stopPropagation();
              controller.confirm();
            }}
          >
            <Check size={16} />
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
        {busy ? (
          <Loader2 size={14} className="sparo-chat-input__voice-spinner" />
        ) : (
          <Mic size={14} />
        )}
      </IconButton>
    </span>
  );
}
