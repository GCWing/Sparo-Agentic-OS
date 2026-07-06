import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Bell,
  CalendarDays,
  CalendarRange,
  Check,
  Feather,
  MailOpen,
  Pencil,
  ScrollText,
  Sparkles,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  IconButton,
} from '@/design-system';
import { Markdown } from '@/shared/markdown';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { createLogger } from '@/shared/utils/logger';
import { dailyLetterApi } from './dailyLetterApi';
import type {
  DailyLetterContinuationCard,
  DailyLetterReceiptCandidate,
  DailyLetterRecord,
  DailyLetterScope,
  DailyLetterTrigger,
} from './dailyLetterTypes';
import './DailyLetterScene.scss';

const log = createLogger('DailyLetterScene');

interface WritingTarget {
  date: string;
  scope: DailyLetterScope;
  trigger: DailyLetterTrigger;
}

interface DailyLetterSceneProps {
  workspacePath?: string;
}

const WRITING_POLL_INTERVAL_MS = 2500;

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

function pendingReceiptCount(letter: DailyLetterRecord): number {
  return letter.receiptCandidates.filter((candidate) => candidate.status === 'pending').length;
}

function generationReasonMessage(reason: string | null | undefined, t: (key: string) => string): string | null {
  if (!reason) return null;
  if (reason.includes('already active')) return null;
  if (reason.includes('No authorized daily context')) return t('messages.generateNoSources');
  if (reason.includes('already exists')) return null;
  return t('messages.generateNoResult');
}

/**
 * The paper overlay renders its own masthead, so a duplicated leading
 * markdown H1 ("# 今日来信 · date") is dropped from the body.
 */
function letterBodyForPaper(markdown: string): string {
  const lines = markdown.split('\n');
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index < lines.length && /^#\s/.test(lines[index].trim())) {
    return lines.slice(index + 1).join('\n').replace(/^\s+/, '');
  }
  return markdown;
}

const DailyLetterScene: React.FC<DailyLetterSceneProps> = ({ workspacePath }) => {
  const { t, formatDate } = useI18n('scenes/daily-letter');
  const [letters, setLetters] = useState<DailyLetterRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [writingStartedAtMs, setWritingStartedAtMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<DailyLetterReceiptCandidate | null>(null);
  const [editValue, setEditValue] = useState('');
  const writingTargetRef = useRef<WritingTarget | null>(null);
  const watchSinceMsRef = useRef<number>(0);

  const loadLetters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests = [
        dailyLetterApi.list({ scope: 'agentic_os', limit: 180 }),
      ];
      if (workspacePath) {
        requests.push(dailyLetterApi.list({ scope: 'workspace', workspacePath, limit: 180 }));
      }
      const results = await Promise.all(requests);
      const merged = new Map<string, DailyLetterRecord>();
      results.flat().forEach((letter) => merged.set(letter.id, letter));
      const nextLetters = Array.from(merged.values()).sort((left, right) => (
        right.date.localeCompare(left.date) || right.updatedAtMs - left.updatedAtMs
      ));
      setLetters(nextLetters);
      setSelectedId((current) => current && nextLetters.some((letter) => letter.id === current)
        ? current
        : nextLetters[0]?.id ?? null);
    } catch (loadError) {
      log.error('Failed to load daily letters', { error: loadError });
      setError(t('messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, workspacePath]);

  useEffect(() => {
    void loadLetters();
  }, [loadLetters]);

  // Detect a generation that is already running in the background
  // (auto trigger or Work Center run) when the scene opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await dailyLetterApi.state();
        if (cancelled) return;
        if (state.lastAttemptStatus === 'running') {
          watchSinceMsRef.current = state.lastAttemptStartedAtMs ?? Date.now();
          setWriting(true);
          setWritingStartedAtMs(state.lastAttemptStartedAtMs ?? Date.now());
        }
      } catch (stateError) {
        log.warn('Failed to read daily letter state', { error: stateError });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateLetter = useCallback((updated: DailyLetterRecord) => {
    setLetters((current) => {
      const rest = current.filter((letter) => letter.id !== updated.id);
      return [updated, ...rest].sort((left, right) => (
        right.date.localeCompare(left.date) || right.updatedAtMs - left.updatedAtMs
      ));
    });
  }, []);

  const revealLetter = useCallback((record: DailyLetterRecord) => {
    updateLetter(record);
    setSelectedId(record.id);
    setPaperOpen(true);
  }, [updateLetter]);

  // While a letter is being written, poll the runtime state so both manual
  // and background runs resolve into the same "letter arrived" moment.
  useEffect(() => {
    if (!writing) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const state = await dailyLetterApi.state();
        if (cancelled) return;
        if (state.lastAttemptStatus === 'running') {
          if (state.lastAttemptStartedAtMs) {
            setWritingStartedAtMs(state.lastAttemptStartedAtMs);
          }
          return;
        }
        // Ignore stale snapshots from an earlier attempt: our run may not
        // have registered in the runtime state yet.
        const finishedAt = state.lastAttemptFinishedAtMs ?? 0;
        if (finishedAt < watchSinceMsRef.current - 5000) {
          return;
        }
        setWriting(false);
        const target = writingTargetRef.current;
        writingTargetRef.current = null;
        if (state.lastAttemptStatus === 'error') {
          setError(t('messages.generateFailed'));
        } else if (state.lastAttemptStatus === 'skipped_no_sources') {
          setError(t('messages.generateNoSources'));
        }
        await loadLetters();
        if (state.lastAttemptStatus === 'ok' && target?.trigger === 'manual') {
          try {
            const record = await dailyLetterApi.get({
              date: target.date,
              scope: target.scope,
              workspacePath: target.scope === 'workspace' ? workspacePath : null,
            });
            if (!cancelled && record) {
              revealLetter(record);
            }
          } catch (getError) {
            log.warn('Failed to fetch freshly written letter', { error: getError });
          }
        }
      } catch (stateError) {
        log.warn('Failed to poll daily letter state', { error: stateError });
      }
    };
    const id = window.setInterval(() => void tick(), WRITING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [loadLetters, revealLetter, t, workspacePath, writing]);

  const filteredLetters = useMemo(() => letters.filter((letter) => {
    if (dateFrom && letter.date < dateFrom) return false;
    if (dateTo && letter.date > dateTo) return false;
    return true;
  }), [dateFrom, dateTo, letters]);

  const selectedLetter = useMemo(() => {
    if (selectedId && filteredLetters.some((letter) => letter.id === selectedId)) {
      return filteredLetters.find((letter) => letter.id === selectedId) ?? null;
    }
    return filteredLetters[0] ?? null;
  }, [filteredLetters, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    if (!filteredLetters.some((letter) => letter.id === selectedId)) {
      setSelectedId(filteredLetters[0]?.id ?? null);
    }
  }, [filteredLetters, selectedId]);

  const todayLetter = useMemo(() => {
    const today = todayKey();
    const candidates = letters.filter((letter) => letter.date === today);
    return candidates.find((letter) => letter.scope === 'workspace') ?? candidates[0] ?? null;
  }, [letters]);

  const pendingCount = selectedLetter ? pendingReceiptCount(selectedLetter) : 0;
  const canSeal = Boolean(selectedLetter && pendingCount === 0 && selectedLetter.status !== 'sealed');
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const clearDateFilter = useCallback(() => {
    setDateFrom('');
    setDateTo('');
  }, []);

  const dateRangeLabel = useMemo(() => {
    if (dateFrom && dateTo) return `${dateFrom} – ${dateTo}`;
    if (dateFrom) return `${dateFrom} –`;
    return `– ${dateTo}`;
  }, [dateFrom, dateTo]);

  const scopeLabel = useCallback((letter: DailyLetterRecord) => (
    letter.workspace?.name ?? t(`scope.${letter.scope === 'agentic_os' ? 'agenticOs' : 'workspace'}`)
  ), [t]);

  const generateToday = useCallback(async () => {
    const targetScope: DailyLetterScope = workspacePath ? 'workspace' : 'agentic_os';
    const date = todayKey();
    writingTargetRef.current = { date, scope: targetScope, trigger: 'manual' };
    watchSinceMsRef.current = Date.now();
    setWriting(true);
    setWritingStartedAtMs(Date.now());
    setError(null);
    try {
      const summary = await dailyLetterApi.generate({
        date,
        scope: targetScope,
        workspacePath: targetScope === 'workspace' ? workspacePath : null,
      });
      if (summary.record) {
        setWriting(false);
        writingTargetRef.current = null;
        revealLetter(summary.record);
        return;
      }
      if (summary.reason?.includes('already active')) {
        // Another run is writing right now; the polling effect follows it.
        return;
      }
      setWriting(false);
      writingTargetRef.current = null;
      const reasonMessage = generationReasonMessage(summary.reason, t);
      if (reasonMessage) {
        setError(reasonMessage);
      }
      await loadLetters();
    } catch (generateError) {
      log.error('Failed to generate daily letter', { error: generateError });
      setWriting(false);
      writingTargetRef.current = null;
      setError(t('messages.generateFailed'));
    }
  }, [loadLetters, revealLetter, t, workspacePath]);

  const applyReceipt = useCallback(async (
    candidate: DailyLetterReceiptCandidate,
    action: 'accept' | 'dismiss'
  ) => {
    if (!selectedLetter) return;
    try {
      const updated = await dailyLetterApi.applyReceipts({
        recordId: selectedLetter.id,
        workspacePath: selectedLetter.workspace?.path ?? null,
        decisions: [{ candidateId: candidate.id, action }],
      });
      updateLetter(updated);
    } catch (receiptError) {
      log.error('Failed to apply daily letter receipt', { error: receiptError });
      setError(t('messages.receiptFailed'));
    }
  }, [selectedLetter, t, updateLetter]);

  const openEditReceipt = useCallback((candidate: DailyLetterReceiptCandidate) => {
    setEditingCandidate(candidate);
    setEditValue(candidate.finalText ?? candidate.text);
  }, []);

  const submitEditReceipt = useCallback(async () => {
    if (!selectedLetter || !editingCandidate) return;
    try {
      const updated = await dailyLetterApi.applyReceipts({
        recordId: selectedLetter.id,
        workspacePath: selectedLetter.workspace?.path ?? null,
        decisions: [{
          candidateId: editingCandidate.id,
          action: 'edit',
          finalText: editValue,
        }],
      });
      updateLetter(updated);
      setEditingCandidate(null);
      setEditValue('');
    } catch (receiptError) {
      log.error('Failed to edit daily letter receipt', { error: receiptError });
      setError(t('messages.receiptFailed'));
    }
  }, [editValue, editingCandidate, selectedLetter, t, updateLetter]);

  const sealLetter = useCallback(async () => {
    if (!selectedLetter) return;
    try {
      const updated = await dailyLetterApi.seal({
        recordId: selectedLetter.id,
        workspacePath: selectedLetter.workspace?.path ?? null,
      });
      updateLetter(updated);
    } catch (sealError) {
      log.error('Failed to seal daily letter', { error: sealError });
      setError(t('messages.sealFailed'));
    }
  }, [selectedLetter, t, updateLetter]);

  const updateContinuation = useCallback(async (
    card: DailyLetterContinuationCard,
    remindTomorrow: boolean
  ) => {
    if (!selectedLetter) return;
    try {
      const updated = await dailyLetterApi.updateContinuation({
        recordId: selectedLetter.id,
        workspacePath: selectedLetter.workspace?.path ?? null,
        continuationId: card.id,
        remindTomorrow,
      });
      updateLetter(updated);
    } catch (continuationError) {
      log.error('Failed to update daily letter continuation', { error: continuationError });
      setError(t('messages.continuationFailed'));
    }
  }, [selectedLetter, t, updateLetter]);

  const weekdayLabel = useCallback((date: string) => {
    try {
      return formatDate(parseDateKey(date), { weekday: 'short' });
    } catch {
      return '';
    }
  }, [formatDate]);

  return (
    <div className="dl" data-testid="daily-letter-scene">
      <div className="dl-layout">
        <aside className="dl-rail" aria-label={t('rail.label')}>
          <div className="dl-rail__header">
            <div className="dl-rail__header-top">
              <span className="dl-rail__seed" aria-hidden="true" />
              <div className="dl-rail__header-title">
                <p>{t('rail.eyebrow')}</p>
                <h1>{t('title')}</h1>
              </div>
            </div>
          </div>

          <div className="dl-rail__main">
            <button
              type="button"
              className={`dl-rail__today ${selectedLetter?.id === todayLetter?.id ? 'is-active' : ''}`}
              onClick={() => setSelectedId(todayLetter?.id ?? null)}
              disabled={!todayLetter && !writing}
            >
              <CalendarDays size={15} aria-hidden="true" />
              <span>{t('rail.today')}</span>
              {writing ? (
                <small className="dl-rail__today-writing">{t('writing.chip')}</small>
              ) : (
                <small>{todayLetter ? todayLetter.preview.oneLine : t('rail.todayEmpty')}</small>
              )}
            </button>

            <section className="dl-rail__section">
              <div className="dl-rail__section-title">
                <span className="dl-rail__section-name">{t('rail.allLetters')}</span>
                <span className="dl-rail__section-count">
                  {t('rail.total', { count: filteredLetters.length })}
                </span>
                <button
                  type="button"
                  className={`dl-rail__filter-toggle${hasDateFilter ? ' is-filtered' : ''}${dateFilterOpen ? ' is-open' : ''}`}
                  aria-label={t('date.label')}
                  aria-expanded={dateFilterOpen}
                  onClick={() => setDateFilterOpen((open) => !open)}
                >
                  <CalendarRange size={13} aria-hidden="true" />
                </button>
              </div>
              {dateFilterOpen ? (
                <div className="dl-rail__date-range" aria-label={t('date.label')}>
                  <input
                    type="date"
                    className={dateFrom ? 'is-set' : ''}
                    value={dateFrom}
                    max={dateTo || undefined}
                    aria-label={t('date.from')}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                  <span className="dl-rail__date-range-sep" aria-hidden="true">→</span>
                  <input
                    type="date"
                    className={dateTo ? 'is-set' : ''}
                    value={dateTo}
                    min={dateFrom || undefined}
                    aria-label={t('date.to')}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                  <button
                    type="button"
                    className="dl-rail__date-range-clear"
                    aria-label={t('date.clear')}
                    disabled={!hasDateFilter}
                    onClick={() => {
                      clearDateFilter();
                      setDateFilterOpen(false);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ) : hasDateFilter && (
                <div className="dl-rail__date-chip">
                  <button
                    type="button"
                    className="dl-rail__date-chip-range"
                    aria-label={t('date.label')}
                    onClick={() => setDateFilterOpen(true)}
                  >
                    <CalendarRange size={11} aria-hidden="true" />
                    <span>{dateRangeLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="dl-rail__date-chip-clear"
                    aria-label={t('date.clear')}
                    onClick={clearDateFilter}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="dl-rail__list">
                {filteredLetters.map((letter) => (
                  <button
                    key={letter.id}
                    type="button"
                    className={`dl-rail__letter ${letter.id === selectedLetter?.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(letter.id)}
                  >
                    <span className={`dl-rail__dot dl-rail__dot--${letter.status}`} aria-hidden="true" />
                    <span className="dl-rail__letter-main">
                      <strong>
                        {letter.date}
                        <em>{weekdayLabel(letter.date)}</em>
                      </strong>
                      <small>{scopeLabel(letter)} · {letter.preview.oneLine}</small>
                    </span>
                  </button>
                ))}
                {!filteredLetters.length && (
                  <p className="dl-rail__empty">
                    {loading ? t('states.loading') : letters.length ? t('rail.filteredEmpty') : t('rail.empty')}
                  </p>
                )}
              </div>
            </section>
          </div>
        </aside>

        <header className="dl-header">
          <div className="dl-header__title">
            <p>{selectedLetter ? selectedLetter.date : t('states.noDate')}</p>
            <div className="dl-header__title-row">
              <h2>{selectedLetter?.preview.title ?? t('empty.title')}</h2>
              {writing && (
                <span className="dl-chip dl-chip--writing" role="status">
                  <span className="dl-chip__pulse" aria-hidden="true" />
                  {t('writing.chip')}
                </span>
              )}
            </div>
          </div>
          <div className="dl-header__actions">
            <IconButton
              className="dl-header__icon-action"
              variant="ghost"
              size="small"
              shape="square"
              aria-label={t('actions.generate')}
              tooltip={t('actions.generate')}
              isLoading={writing}
              onClick={() => void generateToday()}
            >
              <Feather size={16} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="dl-header__icon-action"
              variant="primary"
              size="small"
              shape="square"
              aria-label={t('actions.full')}
              tooltip={t('actions.full')}
              disabled={!selectedLetter}
              onClick={() => setPaperOpen(true)}
            >
              <ScrollText size={16} aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        <main className="dl-board">
          {error && <div className="dl-error" role="status">{error}</div>}

          {writing && (
            <WritingDesk startedAtMs={writingStartedAtMs} t={t} />
          )}

          {!selectedLetter ? (
            !writing && (
              <EmptyLetter loading={loading} onGenerate={() => void generateToday()} generating={writing} />
            )
          ) : (
            <div className="dl-board__content dl-board__content--reading">
              <LetterContent
                letter={selectedLetter}
                onAccept={(candidate) => void applyReceipt(candidate, 'accept')}
                onDismiss={(candidate) => void applyReceipt(candidate, 'dismiss')}
                onEdit={openEditReceipt}
                onContinuation={(card, remind) => void updateContinuation(card, remind)}
                t={t}
              />
            </div>
          )}
        </main>
      </div>

      <LetterPaper
        letter={paperOpen ? selectedLetter : null}
        open={paperOpen && Boolean(selectedLetter)}
        onOpenChange={setPaperOpen}
        pendingCount={pendingCount}
        canSeal={canSeal}
        onSeal={() => void sealLetter()}
        onContinuation={(card, remind) => void updateContinuation(card, remind)}
        formatDate={formatDate}
        t={t}
      />

      <Dialog
        open={Boolean(editingCandidate)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCandidate(null);
            setEditValue('');
          }
        }}
        title={t('receipt.editTitle')}
        size="medium"
        closeLabel={t('actions.close')}
      >
        <DialogBody>
          <textarea
            className="dl-edit-receipt"
            value={editValue}
            aria-label={t('receipt.editPrompt')}
            onChange={(event) => setEditValue(event.target.value)}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="small" onClick={() => setEditingCandidate(null)}>
            {t('actions.close')}
          </Button>
          <Button variant="primary" size="small" onClick={() => void submitEditReceipt()}>
            <Check size={14} aria-hidden="true" />
            {t('receipt.accept')}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

type TFn = (key: string, options?: Record<string, unknown>) => string;
type FormatDateFn = (date: Date | number, options?: Intl.DateTimeFormatOptions) => string;

const WritingDesk: React.FC<{ startedAtMs: number | null; t: TFn }> = ({ startedAtMs, t }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedSeconds = startedAtMs ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : null;
  const elapsedLabel = elapsedSeconds === null
    ? null
    : elapsedSeconds < 60
      ? t('writing.elapsed', { seconds: elapsedSeconds })
      : t('writing.elapsedMinutes', {
        minutes: Math.floor(elapsedSeconds / 60),
        seconds: elapsedSeconds % 60,
      });

  return (
    <section className="dl-writing" role="status" aria-live="polite" data-testid="daily-letter-writing">
      <div className="dl-writing__head">
        <span className="dl-writing__nib" aria-hidden="true">
          <Feather size={15} />
        </span>
        <div>
          <h3>{t('writing.title')}</h3>
          <p>{t('writing.body')}</p>
        </div>
      </div>
      <div className="dl-writing__lines" aria-hidden="true">
        <span className="dl-writing__line" />
        <span className="dl-writing__line" />
        <span className="dl-writing__line" />
        <span className="dl-writing__line dl-writing__line--short" />
      </div>
      <div className="dl-writing__foot">
        <small>{t('writing.hint')}</small>
        {elapsedLabel && <small className="dl-writing__elapsed">{elapsedLabel}</small>}
      </div>
    </section>
  );
};

interface PaperScrollState {
  collapsed: boolean;
  progress: number;
  atEnd: boolean;
}

const LetterPaper: React.FC<{
  letter: DailyLetterRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCount: number;
  canSeal: boolean;
  onSeal: () => void;
  onContinuation: (card: DailyLetterContinuationCard, remindTomorrow: boolean) => void;
  formatDate: FormatDateFn;
  t: TFn;
}> = ({ letter, open, onOpenChange, pendingCount, canSeal, onSeal, onContinuation, formatDate, t }) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState<PaperScrollState>({ collapsed: false, progress: 0, atEnd: false });

  const readScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const top = el.scrollTop;
    setScroll({
      // Collapse the masthead into the compact letterhead bar once the
      // large title has mostly left the viewport.
      collapsed: top > 132,
      progress: max > 0 ? Math.min(1, top / max) : 1,
      atEnd: max - top < 24,
    });
  }, []);

  // Start every letter from the top and refresh the tray/topbar state
  // once the content has been laid out.
  useEffect(() => {
    if (!open) return;
    const el = viewportRef.current;
    if (el) el.scrollTop = 0;
    const frame = window.requestAnimationFrame(readScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [letter?.id, open, readScroll]);

  if (!letter) return null;

  const scopeLabel = letter.scope === 'agentic_os' ? t('scope.agenticOs') : t('scope.workspace');
  const postmarkDate = `${letter.date.slice(5, 7)} · ${letter.date.slice(8, 10)}`;
  let dateLine = letter.date;
  try {
    dateLine = formatDate(parseDateKey(letter.date), { dateStyle: 'full' });
  } catch {
    // keep the raw date key
  }
  const writtenAt = formatDate(new Date(letter.createdAtMs), { timeStyle: 'short' });
  const firstContinuation = letter.continuationCards[0] ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xlarge"
      ariaLabel={t('paper.label')}
      closeLabel={t('actions.close')}
      overlayClassName="dl-paper-overlay"
      className="dl-paper-dialog"
      contentClassName="dl-paper-scroll"
    >
      <div
        className={`dl-paper-shell${scroll.collapsed ? ' is-collapsed' : ''}${scroll.atEnd ? ' is-at-end' : ''}`}
      >
        <header className="dl-paper-topbar" aria-hidden={!scroll.collapsed}>
          <span className="dl-paper-topbar__seed" aria-hidden="true" />
          <span className="dl-paper-topbar__eyebrow">{t('paper.eyebrow')}</span>
          <span className="dl-paper-topbar__date">{dateLine}</span>
          <span
            className="dl-paper-topbar__progress"
            style={{ transform: `scaleX(${scroll.progress})` }}
            aria-hidden="true"
          />
        </header>
        <div className="dl-paper-viewport" ref={viewportRef} onScroll={readScroll}>
          <article className="dl-paper" data-status={letter.status} data-testid="daily-letter-paper">
            <div className="dl-paper__postmark" aria-hidden="true">
              <span>{scopeLabel}</span>
              <strong>{postmarkDate}</strong>
            </div>

            <header className="dl-paper__masthead">
              <p className="dl-paper__eyebrow">{t('paper.eyebrow')}</p>
              <h2>{dateLine}</h2>
              <p className="dl-paper__meta">
                {letter.workspace ? `${letter.workspace.name} · ` : ''}
                {t('paper.writtenAt', { time: writtenAt })}
              </p>
              <span className="dl-paper__rule" aria-hidden="true" />
            </header>

            <div className="dl-paper__content">
              <Markdown content={letterBodyForPaper(letter.bodyMarkdown)} />
            </div>

            <footer className="dl-paper__sign">
              {letter.status === 'sealed' && (
                <span className="dl-paper__seal" aria-hidden="true">{t('status.sealed')}</span>
              )}
              <span className="dl-paper__sign-name">{t('paper.signature')}</span>
              <span className="dl-paper__sign-date">{letter.date}</span>
            </footer>

            <div className="dl-paper__actions">
              <div className="dl-paper__actions-note">
                {pendingCount > 0 && (
                  <span className="dl-paper__pending">{t('paper.pending', { count: pendingCount })}</span>
                )}
              </div>
              <div className="dl-paper__actions-buttons">
                <Button
                  variant="ghost"
                  size="small"
                  disabled={!pendingCount}
                  onClick={() => onOpenChange(false)}
                >
                  <Check size={14} aria-hidden="true" />
                  {t('actions.receipt')}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={!firstContinuation}
                  onClick={() => {
                    if (firstContinuation) onContinuation(firstContinuation, !firstContinuation.remindTomorrow);
                  }}
                >
                  <Bell size={14} aria-hidden="true" />
                  {t('actions.continueTomorrow')}
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  disabled={!canSeal}
                  onClick={onSeal}
                >
                  <Archive size={14} aria-hidden="true" />
                  {t('actions.seal')}
                </Button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </Dialog>
  );
};

const LetterContent: React.FC<{
  letter: DailyLetterRecord;
  onAccept: (candidate: DailyLetterReceiptCandidate) => void;
  onDismiss: (candidate: DailyLetterReceiptCandidate) => void;
  onEdit: (candidate: DailyLetterReceiptCandidate) => void;
  onContinuation: (card: DailyLetterContinuationCard, remindTomorrow: boolean) => void;
  t: TFn;
}> = ({ letter, onAccept, onDismiss, onEdit, onContinuation, t }) => (
  <div className="dl-letter-content">
    <article className="dl-letter">
      <div className="dl-letter__body">
        <Markdown content={letter.bodyMarkdown} />
      </div>
    </article>

    <section className="dl-section" aria-label={t('receipt.label')}>
      <SectionHeading icon={<Check size={15} />} title={t('receipt.title')} count={letter.receiptCandidates.length} />
      {letter.receiptCandidates.length ? (
        <div className="dl-card-list">
          {letter.receiptCandidates.map((candidate) => (
            <ReceiptCard
              key={candidate.id}
              candidate={candidate}
              onAccept={() => onAccept(candidate)}
              onDismiss={() => onDismiss(candidate)}
              onEdit={() => onEdit(candidate)}
              t={t}
            />
          ))}
        </div>
      ) : (
        <p className="dl-section__empty">{t('receipt.empty')}</p>
      )}
    </section>

    <section className="dl-section" aria-label={t('next.label')}>
      <SectionHeading icon={<CalendarDays size={15} />} title={t('next.title')} count={letter.continuationCards.length} />
      {letter.continuationCards.length ? (
        <div className="dl-card-list">
          {letter.continuationCards.map((card) => (
            <div key={card.id} className="dl-note-card">
              <p>{card.text}</p>
              {card.reason && <small>{card.reason}</small>}
              <Button
                className="dl-note-card__action"
                variant={card.remindTomorrow ? 'secondary' : 'ghost'}
                size="small"
                onClick={() => onContinuation(card, !card.remindTomorrow)}
              >
                <Bell size={13} aria-hidden="true" />
                {card.remindTomorrow ? t('next.reminding') : t('next.remind')}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="dl-section__empty">{t('next.empty')}</p>
      )}
    </section>

    {letter.appOpportunity && (
      <section className="dl-section" aria-label={t('app.label')}>
        <SectionHeading icon={<Sparkles size={15} />} title={t('app.title')} count={1} />
        <div className="dl-note-card dl-note-card--idea">
          <strong>{letter.appOpportunity.title}</strong>
          <p>{letter.appOpportunity.summary}</p>
        </div>
      </section>
    )}
  </div>
);

const EmptyLetter: React.FC<{
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
}> = ({ loading, generating, onGenerate }) => {
  const { t } = useI18n('scenes/daily-letter');
  return (
    <div className="dl-empty">
      <MailOpen size={26} aria-hidden="true" />
      <h3>{loading ? t('states.loading') : t('empty.title')}</h3>
      <p>{loading ? t('empty.loadingBody') : t('empty.body')}</p>
      {!loading && (
        <Button variant="primary" size="small" isLoading={generating} loadingLabel={t('states.generating')} onClick={onGenerate}>
          <Feather size={14} aria-hidden="true" />
          {t('actions.generate')}
        </Button>
      )}
    </div>
  );
};

const SectionHeading: React.FC<{ icon: React.ReactNode; title: string; count: number }> = ({
  icon,
  title,
  count,
}) => (
  <div className="dl-section__heading">
    <span aria-hidden="true">{icon}</span>
    <h3>{title}</h3>
    <small>{count}</small>
  </div>
);

const ReceiptCard: React.FC<{
  candidate: DailyLetterReceiptCandidate;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit: () => void;
  t: TFn;
}> = ({ candidate, onAccept, onDismiss, onEdit, t }) => {
  const pending = candidate.status === 'pending';
  return (
    <div className={`dl-receipt ${pending ? '' : 'is-settled'}`}>
      <p>{candidate.finalText ?? candidate.text}</p>
      {candidate.reason && <small>{candidate.reason}</small>}
      <div className="dl-receipt__footer">
        <Badge variant={pending ? 'warning' : 'success'}>{t(`receipt.status.${candidate.status}`)}</Badge>
        {pending && (
          <div className="dl-receipt__actions">
            <Button className="dl-receipt__action" variant="ghost" size="small" onClick={onDismiss}>
              <X size={13} aria-hidden="true" />
              {t('receipt.dismiss')}
            </Button>
            <Button className="dl-receipt__action" variant="secondary" size="small" onClick={onEdit}>
              <Pencil size={13} aria-hidden="true" />
              {t('receipt.edit')}
            </Button>
            <Button className="dl-receipt__action" variant="primary" size="small" onClick={onAccept}>
              <Check size={13} aria-hidden="true" />
              {t('receipt.accept')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyLetterScene;
