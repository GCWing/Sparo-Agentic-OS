import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Feather, Mail, X } from 'lucide-react';
import { Button, IconButton } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { createLogger } from '@/shared/utils/logger';
import { aiExperienceConfigService } from '@/infrastructure/config/services/AIExperienceConfigService';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { dailyLetterApi } from '@/app/scenes/daily-letter/dailyLetterApi';
import { LetterPaper } from '@/app/scenes/daily-letter/LetterPaper';
import { markDailyLetterAcknowledged, useDailyLetterArrivalStore } from '../store/dailyLetterArrivalStore';
import './DailyLetterArrivalDock.scss';

const log = createLogger('DailyLetterArrivalDock');
const POLL_INTERVAL_MS = 20_000;
const OPENING_TRANSITION_MS = 260;

function pendingReceiptCountOf(letter: { receiptCandidates: { status: string }[] } | null): number {
  if (!letter) return 0;
  return letter.receiptCandidates.filter((candidate) => candidate.status === 'pending').length;
}

const DailyLetterArrivalDock: React.FC = () => {
  const { t, formatDate } = useI18n('scenes/daily-letter');
  const { workspacePath } = useLastUsedWorkspace();

  const phase = useDailyLetterArrivalStore((s) => s.phase);
  const letter = useDailyLetterArrivalStore((s) => s.letter);
  const pendingReceiptCount = useDailyLetterArrivalStore((s) => s.pendingReceiptCount);
  const paperOpen = useDailyLetterArrivalStore((s) => s.paperOpen);
  const tick = useDailyLetterArrivalStore((s) => s.tick);
  const expand = useDailyLetterArrivalStore((s) => s.expand);
  const dismiss = useDailyLetterArrivalStore((s) => s.dismiss);
  const openLetter = useDailyLetterArrivalStore((s) => s.openLetter);
  const closePaper = useDailyLetterArrivalStore((s) => s.closePaper);
  const suspendAutoCollapse = useDailyLetterArrivalStore((s) => s.suspendAutoCollapse);
  const resumeAutoCollapse = useDailyLetterArrivalStore((s) => s.resumeAutoCollapse);

  const [enabled, setEnabled] = useState(true);
  const [opening, setOpening] = useState(false);
  const openingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void aiExperienceConfigService.getSettingsAsync().then((settings) => {
      if (!cancelled) setEnabled(settings.enable_daily_letter);
    });
    return aiExperienceConfigService.addChangeListener((settings) => {
      setEnabled(settings.enable_daily_letter);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    void tick(workspacePath || null);
    const id = window.setInterval(() => {
      void tick(workspacePath || null);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, tick, workspacePath]);

  useEffect(() => () => {
    if (openingTimerRef.current) clearTimeout(openingTimerRef.current);
  }, []);

  const handleOpen = useCallback(() => {
    suspendAutoCollapse();
    setOpening(true);
    openingTimerRef.current = setTimeout(() => {
      setOpening(false);
      openLetter();
    }, OPENING_TRANSITION_MS);
  }, [openLetter, suspendAutoCollapse]);

  const handleSeal = useCallback(async () => {
    if (!letter) return;
    try {
      const updated = await dailyLetterApi.seal({
        recordId: letter.id,
        workspacePath: letter.workspace?.path ?? null,
      });
      useDailyLetterArrivalStore.setState({
        letter: updated,
        pendingReceiptCount: pendingReceiptCountOf(updated),
      });
    } catch (error) {
      log.error('Failed to seal daily letter from arrival dock', { error });
    }
  }, [letter]);

  const canSeal = Boolean(letter && pendingReceiptCount === 0 && letter.status !== 'sealed');

  // The corner card/chip always plays, even while the Daily Letter scene
  // itself is open and focused — the scene no longer pops its own full-text
  // dialog on generation, so this is the one consistent "letter arrived"
  // ceremony for every trigger (auto or manual).
  const dockOffsetClass = phase === 'card'
    ? 'is-card'
    : phase === 'chip'
      ? 'is-chip'
      : '';

  useEffect(() => {
    document.documentElement.setAttribute('data-daily-letter-dock', dockOffsetClass || 'none');
    return () => {
      document.documentElement.removeAttribute('data-daily-letter-dock');
    };
  }, [dockOffsetClass]);

  if (!enabled) return null;

  return (
    <>
      {phase === 'card' && letter && !paperOpen && (
        <div className="dla-dock" aria-label={t('arrival.label')}>
          <div className={`dla-envelope${opening ? ' is-opening' : ''}`} role="status" aria-live="polite">
            <span className="dla-envelope__stamp" aria-hidden="true" />
            <IconButton
              className="dla-envelope__close"
              onClick={dismiss}
              aria-label={t('arrival.later')}
              tooltip={t('arrival.later')}
              size="xs"
              shape="circle"
              variant="ghost"
            >
              <X strokeWidth={2} />
            </IconButton>
            <div
              className="dla-envelope__body"
              onMouseEnter={suspendAutoCollapse}
              onMouseLeave={resumeAutoCollapse}
            >
              <div className="dla-envelope__title-row">
                <span className="dla-envelope__icon-badge" aria-hidden="true">
                  <Mail size={13} />
                </span>
                <span className="dla-envelope__title">{t('arrival.title')}</span>
              </div>
              <p className="dla-envelope__desc">{letter.preview.oneLine || letter.preview.title}</p>
              {pendingReceiptCount > 0 && (
                <span className="dla-envelope__note">{t('paper.pending', { count: pendingReceiptCount })}</span>
              )}
              <Button
                type="button"
                className="dla-envelope__action"
                variant="primary"
                size="small"
                onClick={handleOpen}
              >
                {t('actions.full')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'chip' && letter && !paperOpen && (
        <div className="dla-dock" aria-label={t('arrival.label')}>
          <div className="dla-chip-wrap">
            <IconButton
              className="dla-chip"
              onClick={expand}
              aria-label={t('arrival.chipLabel')}
              tooltip={t('arrival.chipLabel')}
              size="medium"
              shape="circle"
              variant="accent"
            >
              <Feather size={15} aria-hidden="true" />
            </IconButton>
            <IconButton
              className="dla-chip-wrap__close"
              onClick={dismiss}
              aria-label={t('arrival.later')}
              tooltip={t('arrival.later')}
              size="xs"
              shape="circle"
              variant="ghost"
            >
              <X strokeWidth={2} />
            </IconButton>
          </div>
        </div>
      )}

      <LetterPaper
        letter={paperOpen ? letter : null}
        open={paperOpen && Boolean(letter)}
        onOpenChange={(next) => {
          if (!next) closePaper();
        }}
        pendingCount={pendingReceiptCount}
        canSeal={canSeal}
        onSeal={() => void handleSeal()}
        formatDate={formatDate}
        t={t}
        originCorner
        onFirstOpen={markDailyLetterAcknowledged}
      />
    </>
  );
};

export default DailyLetterArrivalDock;
