/**
 * Processing indicator.
 * After 1s of continuous processing, shows the 3x3 task-list running dots and
 * rotating fun hint text together (animation on the left).
 * reserveSpace keeps layout height even when hidden.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import { processingHintsZh, processingHintsEn } from '../../constants/processingHints';
import './ProcessingIndicator.scss';

interface ProcessingIndicatorProps {
  visible: boolean;
  /** When true, preserve height to avoid layout jumps. */
  reserveSpace?: boolean;
  /** Resets the hint cycle when a new processing turn starts. */
  resetKey?: string;
}

export const ProcessingIndicator: React.FC<ProcessingIndicatorProps> = ({ visible, reserveSpace = false, resetKey }) => {
  const { i18n } = useTranslation();
  const hints = i18n.language.startsWith('zh') ? processingHintsZh : processingHintsEn;

  const [hintIndex, setHintIndex] = useState(0);

  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (hints.length === 0) return;
    setHintIndex(Math.floor(Math.random() * hints.length));
  }, [hints.length, resetKey]);

  useEffect(() => {
    if (!visible || hints.length === 0) {
      return;
    }

    rotateTimerRef.current = setInterval(() => {
      setHintIndex(prev => (prev + 1) % hints.length);
    }, 5000);

    return () => {
      if (rotateTimerRef.current) {
        clearInterval(rotateTimerRef.current);
        rotateTimerRef.current = null;
      }
    };
  }, [visible, hints.length]);

  const shouldRender = visible || reserveSpace;
  if (!shouldRender) return null;

  return (
    <div className="processing-indicator" aria-hidden={!visible}>
      <div
        className="processing-indicator__content"
        style={visible ? undefined : { visibility: 'hidden' as const }}
      >
        {visible && hints.length > 0 && (
          <>
            <DotMatrixLoader size="tiny" className="processing-indicator__running-dots" />
            <span key={hintIndex} className="processing-indicator__hint">
              {hints[hintIndex]}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
