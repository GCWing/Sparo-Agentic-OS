import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  DateRangeDialog,
  Dialog,
  DialogBody,
  DialogFooter,
  IconButton,
  type DateRangeValue,
} from '@/design-system';
import { Markdown } from '@/shared/markdown';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { createLogger } from '@/shared/utils/logger';
import { dailyLetterApi } from './dailyLetterApi';
import {
  defaultDateFilterRange,
  formatDateKey,
  parseDateKey,
  startOfLocalToday,
  todayKey,
} from './dailyLetterDateUtils';
import { LetterPaper } from './LetterPaper';
import {
  announceDailyLetterArrival,
  markDailyLetterAcknowledged,
} from '@/app/daily-letter-arrival/store/dailyLetterArrivalStore';
import type {
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

type TFn = (key: string, options?: Record<string, unknown>) => string;

function pendingReceiptCount(letter: DailyLetterRecord): number {
  return letter.receiptCandidates.filter((candidate) => candidate.status === 'pending').length;
}

function generationReasonMessage(reason: string | null | undefined, t: (key: string) => string): string | null {
  if (!reason) return null;
  if (reason.includes('already active')) return null;
  if (reason.includes('disabled in settings')) return t('messages.generateDisabled');
  if (reason.includes('No authorized daily context')) return t('messages.generateNoSources');
  if (reason.includes('already exists')) return null;
  return t('messages.generateNoResult');
}

const DailyLetterScene: React.FC<DailyLetterSceneProps> = ({ workspacePath }) => {
  const { t, formatDate, currentLanguage } = useI18n('scenes/daily-letter');
  const [letters, setLetters] = useState<DailyLetterRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [writingStartedAtMs, setWritingStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
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
          const startedAtMs = state.lastAttemptStartedAtMs ?? Date.now();
          watchSinceMsRef.current = startedAtMs;
          setWriting(true);
          setWritingStartedAtMs(startedAtMs);
          setNowMs(Date.now());
        }
      } catch (stateError) {
        log.warn('Failed to read daily letter state', { error: stateError });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!writing) return undefined;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [writing]);

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
    // Select it into the reading pane, but don't force the full-text dialog
    // open — the corner arrival card/chip is the one consistent "letter
    // arrived" ceremony now, for every trigger and regardless of whether
    // this scene happens to be focused. Announcing it directly (rather than
    // waiting for the poller's next ~20s tick) makes the card appear right
    // away instead of after a noticeable delay.
    announceDailyLetterArrival(record);
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
        // Claim the target before doing anything async below — if
        // `generateToday`'s own direct `await` also resolves around the
        // same time, whichever of the two paths reads this ref first wins,
        // and the other will see it already cleared and skip revealing.
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
    if (dateFrom && dateTo) return `${dateFrom} - ${dateTo}`;
    if (dateFrom) return `${dateFrom} -`;
    return `- ${dateTo}`;
  }, [dateFrom, dateTo]);

  const dateFilterInitialRange = useMemo<DateRangeValue | null>(() => {
    if (!dateFrom && !dateTo) return null;
    const fallbackEnd = startOfLocalToday();
    const startDate = dateFrom ? parseDateKey(dateFrom) : dateTo ? parseDateKey(dateTo) : fallbackEnd;
    const endDate = dateTo ? parseDateKey(dateTo) : fallbackEnd;
    return startDate.getTime() <= endDate.getTime()
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }, [dateFrom, dateTo]);

  const dateFilterDefaultRange = useMemo(() => defaultDateFilterRange(), []);
  const dateFilterMaxDate = useMemo(() => startOfLocalToday(), []);

  const applyDateRange = useCallback((range: DateRangeValue) => {
    setDateFrom(formatDateKey(range.startDate));
    setDateTo(formatDateKey(range.endDate));
    setDateFilterOpen(false);
  }, []);

  const scopeLabel = useCallback((letter: DailyLetterRecord) => (
    letter.workspace?.name ?? t(`scope.${letter.scope === 'agentic_os' ? 'agenticOs' : 'workspace'}`)
  ), [t]);

  const generateToday = useCallback(async () => {
    const targetScope: DailyLetterScope = workspacePath ? 'workspace' : 'agentic_os';
    const date = todayKey();
    const startedAtMs = Date.now();
    // A distinct object identity per call, not just a value — the writing-poll
    // effect below independently watches the same run via its own state()
    // polling and can race this direct `await` to detect completion first.
    // Comparing identity (not just nullness) lets whichever path notices
    // completion first "claim" the reveal, so the other reliably no-ops
    // instead of double-revealing/double-announcing the same letter.
    const myTarget: WritingTarget = { date, scope: targetScope, trigger: 'manual' };
    writingTargetRef.current = myTarget;
    watchSinceMsRef.current = startedAtMs;
    setWriting(true);
    setWritingStartedAtMs(startedAtMs);
    setNowMs(startedAtMs);
    setError(null);
    try {
      const summary = await dailyLetterApi.generate({
        date,
        scope: targetScope,
        workspacePath: targetScope === 'workspace' ? workspacePath : null,
        force: true,
      });
      if (summary.record) {
        setWriting(false);
        if (writingTargetRef.current === myTarget) {
          writingTargetRef.current = null;
          revealLetter(summary.record);
        }
        return;
      }
      if (summary.reason?.includes('already active')) {
        // Another run is writing right now; the polling effect follows it.
        return;
      }
      setWriting(false);
      if (writingTargetRef.current === myTarget) {
        writingTargetRef.current = null;
      }
      const reasonMessage = generationReasonMessage(summary.reason, t);
      if (reasonMessage) {
        setError(reasonMessage);
      }
      await loadLetters();
    } catch (generateError) {
      log.error('Failed to generate daily letter', { error: generateError });
      setWriting(false);
      if (writingTargetRef.current === myTarget) {
        writingTargetRef.current = null;
      }
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

  const weekdayLabel = useCallback((date: string) => {
    try {
      return formatDate(parseDateKey(date), { weekday: 'short' });
    } catch {
      return '';
    }
  }, [formatDate]);

  const writingElapsedLabel = useMemo(() => {
    if (!writing || !writingStartedAtMs) return null;
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - writingStartedAtMs) / 1000));
    return elapsedSeconds < 60
      ? t('writing.elapsed', { seconds: elapsedSeconds })
      : t('writing.elapsedMinutes', {
        minutes: Math.floor(elapsedSeconds / 60),
        seconds: elapsedSeconds % 60,
      });
  }, [nowMs, t, writing, writingStartedAtMs]);

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
                <small className="dl-rail__today-writing">
                  <span className="dl-rail__today-writing-label">{t('writing.chip')}</span>
                  {writingElapsedLabel ? (
                    <span className="dl-rail__today-elapsed">{writingElapsedLabel}</span>
                  ) : null}
                </small>
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
                <IconButton
                  className={`dl-rail__filter-toggle${hasDateFilter ? ' is-filtered' : ''}${dateFilterOpen ? ' is-open' : ''}`}
                  variant="ghost"
                  size="xs"
                  aria-label={t('date.label')}
                  aria-expanded={dateFilterOpen}
                  tooltip={t('date.label')}
                  onClick={() => setDateFilterOpen(true)}
                >
                  <CalendarRange size={13} aria-hidden="true" />
                </IconButton>
              </div>
              {hasDateFilter && (
                <div className="dl-rail__date-chip">
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    className="dl-rail__date-chip-range"
                    aria-label={t('date.label')}
                    onClick={() => setDateFilterOpen(true)}
                  >
                    <CalendarRange size={11} aria-hidden="true" />
                    <span>{dateRangeLabel}</span>
                  </Button>
                  <IconButton
                    className="dl-rail__date-chip-clear"
                    aria-label={t('date.clear')}
                    tooltip={t('date.clear')}
                    variant="ghost"
                    size="xs"
                    onClick={clearDateFilter}
                  >
                    <X size={11} aria-hidden="true" />
                  </IconButton>
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
            <Button
              variant="ghost"
              size="small"
              isLoading={writing}
              loadingLabel={t('states.generating')}
              onClick={() => void generateToday()}
            >
              <Feather size={16} aria-hidden="true" />
              {t('actions.generate')}
            </Button>
            <IconButton
              className="dl-header__icon-action"
              variant="primary"
              size="small"
              shape="circle"
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
        formatDate={formatDate}
        t={t}
        onFirstOpen={markDailyLetterAcknowledged}
      />

      <DateRangeDialog
        open={dateFilterOpen}
        onOpenChange={setDateFilterOpen}
        onApply={applyDateRange}
        title={t('date.title')}
        initialRange={dateFilterInitialRange}
        defaultRange={dateFilterDefaultRange}
        maxDate={dateFilterMaxDate}
        locale={currentLanguage}
        labels={{
          hint: t('date.hint'),
          summary: (start, end) => t('date.summary', { start, end }),
          pickEndHint: (start) => t('date.pickEndHint', { start }),
          pickEndError: t('date.pickEndError'),
          previousMonth: t('date.previousMonth'),
          nextMonth: t('date.nextMonth'),
          cancel: t('date.cancel'),
          apply: t('date.apply'),
        }}
        closeLabel={t('actions.close')}
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

function LetterContent({
  letter,
  onAccept,
  onDismiss,
  onEdit,
  t,
}: {
  letter: DailyLetterRecord;
  onAccept: (candidate: DailyLetterReceiptCandidate) => void;
  onDismiss: (candidate: DailyLetterReceiptCandidate) => void;
  onEdit: (candidate: DailyLetterReceiptCandidate) => void;
  t: TFn;
}) {
  return (
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
}

function EmptyLetter({
  loading,
  generating,
  onGenerate,
}: {
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
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
}

function SectionHeading({
  icon,
  title,
  count,
}: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="dl-section__heading">
      <span aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <small>{count}</small>
    </div>
  );
}

function ReceiptCard({
  candidate,
  onAccept,
  onDismiss,
  onEdit,
  t,
}: {
  candidate: DailyLetterReceiptCandidate;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit: () => void;
  t: TFn;
}) {
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
}

export default DailyLetterScene;
