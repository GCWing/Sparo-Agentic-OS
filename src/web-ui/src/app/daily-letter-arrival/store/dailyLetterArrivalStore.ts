import { create } from 'zustand';
import { createLogger } from '@/shared/utils/logger';
import { dailyLetterApi } from '@/app/scenes/daily-letter/dailyLetterApi';
import type { DailyLetterRecord } from '@/app/scenes/daily-letter/dailyLetterTypes';

const log = createLogger('DailyLetterArrivalStore');

const STORAGE_KEY = 'sparo.dailyLetterArrival.v1';
const CHIP_COLLAPSE_MS = 15_000;

export type DailyLetterArrivalPhase = 'hidden' | 'card';

interface PersistedArrivalState {
  /** Highest `lastAttemptFinishedAtMs` already processed by the poller, of any outcome. */
  seenFinishedAtMs: number;
  /**
   * Identity of the most recent record the dock has surfaced (arrived), for
   * the footer unread dot. Keyed on `${recordId}:${updatedAtMs}` rather than
   * just the record id — a manual re-generation reuses the same record id
   * for the same date/scope, but produces a new `updatedAtMs`. Keying on the
   * pair means re-generating an already-read letter is treated as a fresh
   * arrival instead of being silently swallowed as "already acknowledged".
   */
  lastArrivedKey: string | null;
  /** 'unseen' right after arrival, 'dismissed' once folded away unread, 'read' once opened. */
  lastArrivedState: 'unseen' | 'dismissed' | 'read';
}

function arrivalKeyOf(record: DailyLetterRecord): string {
  return `${record.id}:${record.updatedAtMs}`;
}

function loadPersisted(): PersistedArrivalState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('no-value');
    const parsed = JSON.parse(raw) as Partial<PersistedArrivalState> & { lastArrivedRecordId?: string | null };
    return {
      seenFinishedAtMs: parsed.seenFinishedAtMs ?? 0,
      // `lastArrivedRecordId` is the pre-migration field name; drop it rather
      // than mapping it in, so a letter re-generated across the migration
      // is treated as unseen instead of possibly matching by id alone.
      lastArrivedKey: parsed.lastArrivedKey ?? null,
      lastArrivedState: parsed.lastArrivedState ?? 'read',
    };
  } catch {
    return { seenFinishedAtMs: 0, lastArrivedKey: null, lastArrivedState: 'read' };
  }
}

function savePersisted(state: PersistedArrivalState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best effort only — a lost arrival marker just means the letter may
    // resurface once more, which is harmless.
  }
}

interface DailyLetterArrivalStoreState {
  phase: DailyLetterArrivalPhase;
  letter: DailyLetterRecord | null;
  pendingReceiptCount: number;
  hasUnread: boolean;
  paperOpen: boolean;

  /** Internal: guards concurrent polling ticks. */
  _polling: boolean;
  _chipTimer: ReturnType<typeof setTimeout> | null;

  tick: (workspacePath: string | null) => Promise<void>;
  collapseCard: () => void;
  dismiss: () => void;
  openLetter: () => void;
  openRecord: (letter: DailyLetterRecord) => void;
  closePaper: () => void;
  suspendAutoCollapse: () => void;
  resumeAutoCollapse: () => void;
}

function pendingReceiptCountOf(letter: DailyLetterRecord | null): number {
  if (!letter) return 0;
  return letter.receiptCandidates.filter((candidate) => candidate.status === 'pending').length;
}

async function findRecordForDate(
  date: string,
  workspacePath: string | null,
): Promise<DailyLetterRecord | null> {
  try {
    const requests = [dailyLetterApi.list({ scope: 'agentic_os', limit: 8 })];
    if (workspacePath) {
      requests.push(dailyLetterApi.list({ scope: 'workspace', workspacePath, limit: 8 }));
    }
    const results = await Promise.all(requests);
    const candidates = results.flat().filter((record) => record.date === date);
    if (!candidates.length) return null;
    return candidates.find((record) => record.scope === 'workspace') ?? candidates[0];
  } catch (error) {
    log.warn('Failed to resolve arrived daily letter record', { date, error });
    return null;
  }
}

let persisted = loadPersisted();

export const useDailyLetterArrivalStore = create<DailyLetterArrivalStoreState>((set, get) => ({
  phase: 'hidden',
  letter: null,
  pendingReceiptCount: 0,
  hasUnread: persisted.lastArrivedState !== 'read' && Boolean(persisted.lastArrivedKey),
  paperOpen: false,
  _polling: false,
  _chipTimer: null,

  tick: async (workspacePath) => {
    if (get()._polling) return;
    set({ _polling: true });
    try {
      const state = await dailyLetterApi.state();

      // Writing in progress is intentionally silent here — the corner is
      // reserved for the moment the letter actually arrives, not the
      // composing process. (The Daily Letter scene still shows its own
      // "writing" chip when it happens to be open.)
      if (state.lastAttemptStatus === 'running') {
        return;
      }

      const finishedAt = state.lastAttemptFinishedAtMs ?? null;
      if (!finishedAt || finishedAt <= persisted.seenFinishedAtMs) {
        return;
      }

      persisted = { ...persisted, seenFinishedAtMs: finishedAt };
      savePersisted(persisted);

      if (state.lastAttemptStatus !== 'ok' || !state.lastCompletedDate) {
        return;
      }

      const record = await findRecordForDate(state.lastCompletedDate, workspacePath);
      if (!record) return;

      surfaceArrivedLetter(record);
    } catch (error) {
      log.warn('Failed to poll daily letter arrival state', { error });
    } finally {
      set({ _polling: false });
    }
  },

  collapseCard: () => {
    if (get().letter && get().phase === 'card') {
      set({ phase: 'hidden', letter: null });
    }
  },

  dismiss: () => {
    const { letter } = get();
    get().suspendAutoCollapse();
    if (letter && persisted.lastArrivedKey === arrivalKeyOf(letter)) {
      persisted = { ...persisted, lastArrivedState: 'dismissed' };
      savePersisted(persisted);
    }
    // Terminal for this arrival: drop the letter reference too, so no
    // leftover hover/collapse timer or stale callback can act on it and
    // bring the card back after it has been put away.
    set({ phase: 'hidden', letter: null });
  },

  openLetter: () => {
    get().suspendAutoCollapse();
    // Hide the card/chip the instant the letter is opened, synchronously
    // in the same action — not indirectly via `onFirstOpen` once the paper
    // has mounted. That side-channel still marks the letter "read" in
    // storage, but the *visual* close must not depend on it or on any
    // in-flight hover/collapse timer from the card being torn down.
    set({ paperOpen: true, phase: 'hidden' });
  },

  openRecord: (letter) => {
    get().suspendAutoCollapse();
    set({
      paperOpen: true,
      phase: 'hidden',
      letter,
      pendingReceiptCount: pendingReceiptCountOf(letter),
    });
  },

  closePaper: () => {
    // Closing the paper is terminal for this arrival: clear the letter
    // reference so nothing can resurface the same card/chip afterward.
    set({ paperOpen: false, phase: 'hidden', letter: null });
  },

  suspendAutoCollapse: () => {
    const timer = get()._chipTimer;
    if (timer) {
      clearTimeout(timer);
      set({ _chipTimer: null });
    }
  },

  resumeAutoCollapse: () => {
    get().suspendAutoCollapse();
    const timer = setTimeout(() => {
      get().collapseCard();
    }, CHIP_COLLAPSE_MS);
    set({ _chipTimer: timer });
  },
}));

/**
 * Surfaces a completed letter as the corner arrival card/chip, unless this
 * exact version (by `arrivalKeyOf`) has already been surfaced this session.
 * Shared by the poller (`tick`) and by direct callers that already know a
 * letter just finished writing (`announceDailyLetterArrival`), so both
 * paths — which can race each other for the same manual run — agree on the
 * same "have I already shown this one" bookkeeping.
 *
 * The check is unconditional on `lastArrivedKey` alone (not also gated on
 * `lastArrivedState`): once a given version has been surfaced once, it must
 * never be surfaced again in this session, whether it is still showing,
 * already read, or already dismissed/collapsed. Re-checking the state too
 * would let a delayed, redundant caller pop an already-settled card back
 * open. A later re-generation of the same day's letter produces a new
 * `updatedAtMs` and therefore a new arrival key, so it is still treated as a
 * genuinely fresh arrival.
 */
function surfaceArrivedLetter(record: DailyLetterRecord): void {
  const arrivalKey = arrivalKeyOf(record);
  if (persisted.lastArrivedKey === arrivalKey) {
    return;
  }

  persisted = { ...persisted, lastArrivedKey: arrivalKey, lastArrivedState: 'unseen' };
  savePersisted(persisted);

  useDailyLetterArrivalStore.setState({
    phase: 'card',
    letter: record,
    pendingReceiptCount: pendingReceiptCountOf(record),
    hasUnread: true,
  });
  useDailyLetterArrivalStore.getState().resumeAutoCollapse();
}

/**
 * Marks a letter as read, regardless of who opened it (the global arrival
 * card, the arrival chip, or the Daily Letter scene browsing its own rail).
 * Centralizing this in one place means every entry point shares the same
 * "have I seen this one" bookkeeping.
 *
 * This only touches persisted state when the opened letter is the one
 * currently tracked as "the latest arrival" — opening some unrelated older
 * letter from the scene's history list must not clobber that pointer.
 */
export function markDailyLetterAcknowledged(letter: DailyLetterRecord): void {
  const arrivalKey = arrivalKeyOf(letter);
  if (persisted.lastArrivedKey !== arrivalKey) return;

  persisted = { ...persisted, lastArrivedState: 'read' };
  savePersisted(persisted);

  const store = useDailyLetterArrivalStore.getState();
  if (store.letter?.id === letter.id) {
    store.suspendAutoCollapse();
    useDailyLetterArrivalStore.setState({ phase: 'hidden', hasUnread: false });
  } else {
    useDailyLetterArrivalStore.setState({ hasUnread: false });
  }
}

/**
 * Announces a letter that just finished writing — called directly by the
 * Daily Letter scene right after a manual "urge the letter" completes (or
 * after its background-run poll detects a completion), instead of waiting
 * for the arrival poller's next ~20s tick. The corner card/chip ceremony
 * always plays, even while the scene itself is open and focused: the scene
 * no longer pops the full-text paper on its own, so this is the only place
 * that announces a fresh letter.
 *
 * Safe to call redundantly — it shares the same "already acknowledged"
 * bookkeeping as the poller via `surfaceArrivedLetter`, so if the poller (or
 * another surface) already claimed this exact version, this is a no-op.
 */
export function announceDailyLetterArrival(record: DailyLetterRecord): void {
  surfaceArrivedLetter(record);
}
