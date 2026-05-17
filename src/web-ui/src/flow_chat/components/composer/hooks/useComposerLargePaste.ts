import { useCallback, useEffect, useRef } from 'react';
import { CHAT_INPUT_CONFIG } from '../../../constants/chatInputConfig';

type Translate = (
  key: string,
  options?: Record<string, unknown>
) => string;

type PendingLargePasteMap = Record<string, string>;

export function getComposerCharacterCount(text: string): number {
  return Array.from(text).length;
}

export function useComposerLargePaste(value: string, t: Translate) {
  const pendingLargePastesRef = useRef<PendingLargePasteMap>({});
  const largePasteCountersRef = useRef<Record<number, number>>({});

  const clearPendingLargePastes = useCallback(() => {
    pendingLargePastesRef.current = {};
  }, []);

  const createLargePastePlaceholder = useCallback((text: string): string | null => {
    const charCount = getComposerCharacterCount(text);
    if (charCount <= CHAT_INPUT_CONFIG.largePaste.thresholdChars) {
      return null;
    }

    const nextCounters = largePasteCountersRef.current;
    const nextSuffix = (nextCounters[charCount] ?? 0) + 1;
    nextCounters[charCount] = nextSuffix;

    const base = t('input.largePastePlaceholder', {
      count: charCount,
      defaultValue: '[Pasted Content {{count}} chars]',
    });
    const placeholder = nextSuffix === 1 ? base : `${base} #${nextSuffix}`;

    pendingLargePastesRef.current = {
      ...pendingLargePastesRef.current,
      [placeholder]: text,
    };

    return placeholder;
  }, [t]);

  const prunePendingLargePastes = useCallback((text: string) => {
    const entries = Object.entries(pendingLargePastesRef.current);
    if (entries.length === 0) {
      return;
    }

    pendingLargePastesRef.current = Object.fromEntries(
      entries.filter(([placeholder]) => text.includes(placeholder))
    );
  }, []);

  const expandPendingLargePastes = useCallback((text: string) => {
    let expanded = text;
    for (const [placeholder, actual] of Object.entries(pendingLargePastesRef.current)) {
      if (expanded.includes(placeholder)) {
        expanded = expanded.split(placeholder).join(actual);
      }
    }
    return expanded;
  }, []);

  const snapshotPendingLargePastes = useCallback(() => ({ ...pendingLargePastesRef.current }), []);

  const restorePendingLargePastes = useCallback((snapshot: PendingLargePasteMap) => {
    pendingLargePastesRef.current = snapshot;
  }, []);

  useEffect(() => {
    if (value === '') {
      clearPendingLargePastes();
    }
  }, [clearPendingLargePastes, value]);

  return {
    clearPendingLargePastes,
    createLargePastePlaceholder,
    expandPendingLargePastes,
    getCharacterCount: getComposerCharacterCount,
    prunePendingLargePastes,
    restorePendingLargePastes,
    snapshotPendingLargePastes,
  };
}
