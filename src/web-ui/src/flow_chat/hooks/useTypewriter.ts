/**
 * Typewriter hook for smoothing batched streaming updates.
 *
 * The EventBatcher flushes content every ~100ms, which makes text appear
 * in jarring chunks. This hook interpolates between batched updates to
 * produce a smooth reveal. Callers can use coarser settings for expensive
 * Markdown blocks so the UI stays stable without losing live progress.
 */

import { useState, useEffect, useRef } from 'react';

const DEFAULT_FRAME_INTERVAL = 50;
const DEFAULT_REVEAL_DURATION = 800;
const DEFAULT_MIN_CHARS_PER_TICK = 3;

export interface TypewriterOptions {
  frameInterval?: number;
  revealDuration?: number;
  minCharsPerTick?: number;
}

export function useTypewriter(
  targetText: string,
  animate: boolean,
  options: TypewriterOptions = {},
): string {
  const [displayText, setDisplayText] = useState(animate ? '' : targetText);
  const revealedRef = useRef(animate ? 0 : targetText.length);
  const targetRef = useRef(targetText);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(options.minCharsPerTick ?? DEFAULT_MIN_CHARS_PER_TICK);
  const optionsRef = useRef<TypewriterOptions>(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!animate) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      revealedRef.current = targetText.length;
      targetRef.current = targetText;
      setDisplayText(targetText);
      return;
    }

    targetRef.current = targetText;

    if (targetText.length < revealedRef.current) {
      revealedRef.current = 0;
    }

    const delta = targetText.length - revealedRef.current;
    if (delta > 0) {
      const frameInterval = optionsRef.current.frameInterval ?? DEFAULT_FRAME_INTERVAL;
      const revealDuration = optionsRef.current.revealDuration ?? DEFAULT_REVEAL_DURATION;
      const minCharsPerTick = optionsRef.current.minCharsPerTick ?? DEFAULT_MIN_CHARS_PER_TICK;
      const totalFrames = revealDuration / frameInterval;
      speedRef.current = Math.max(Math.ceil(delta / totalFrames), minCharsPerTick);

      if (!timerRef.current) {
        timerRef.current = setInterval(() => {
          const target = targetRef.current;
          const cur = revealedRef.current;
          if (cur >= target.length) {
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            return;
          }
          const next = Math.min(cur + speedRef.current, target.length);
          revealedRef.current = next;
          setDisplayText(target.slice(0, next));
        }, frameInterval);
      }
    }
  }, [targetText, animate, options.frameInterval, options.minCharsPerTick, options.revealDuration]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return displayText;
}
