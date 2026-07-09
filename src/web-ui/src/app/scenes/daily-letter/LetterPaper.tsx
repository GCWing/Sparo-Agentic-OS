import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Check } from 'lucide-react';
import { Button, Dialog, type DialogProps } from '@/design-system';
import { Markdown } from '@/shared/markdown';
import { parseDateKey } from './dailyLetterDateUtils';
import type { DailyLetterRecord } from './dailyLetterTypes';
import './LetterPaper.scss';

type TFn = (key: string, options?: Record<string, unknown>) => string;
type FormatDateFn = (date: Date | number, options?: Intl.DateTimeFormatOptions) => string;

interface PaperScrollState {
  collapsed: boolean;
  progress: number;
  atEnd: boolean;
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

export interface LetterPaperProps {
  letter: DailyLetterRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCount: number;
  canSeal: boolean;
  onSeal: () => void;
  formatDate: FormatDateFn;
  t: TFn;
  /**
   * When the paper is opened from a corner-anchored surface (e.g. the
   * bottom-left arrival card), the unfold animation grows from that
   * corner instead of the viewport center — a cheap way to keep the
   * "this letter came from where I just clicked" continuity without a
   * real shared-element transition.
   */
  originCorner?: boolean;
  /**
   * Called once, the first time this record is shown open. Lets callers
   * (the arrival dock, the scene) mark the letter as read in one place
   * regardless of who triggered the open.
   */
  onFirstOpen?: (letter: DailyLetterRecord) => void;
  dialogProps?: Partial<DialogProps>;
}

export function LetterPaper({
  letter,
  open,
  onOpenChange,
  pendingCount,
  canSeal,
  onSeal,
  formatDate,
  t,
  originCorner = false,
  onFirstOpen,
  dialogProps,
}: LetterPaperProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState<PaperScrollState>({ collapsed: false, progress: 0, atEnd: false });
  const announcedIdRef = useRef<string | null>(null);

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

  // A letter counts as "read" the moment its paper is actually shown,
  // no matter whether the scene or the global arrival card opened it.
  useEffect(() => {
    if (!open || !letter) return;
    if (announcedIdRef.current === letter.id) return;
    announcedIdRef.current = letter.id;
    onFirstOpen?.(letter);
  }, [letter, onFirstOpen, open]);

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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xlarge"
      ariaLabel={t('paper.label')}
      closeLabel={t('actions.close')}
      overlayClassName="dl-paper-overlay"
      className={`dl-paper-dialog${originCorner ? ' dl-paper-dialog--from-corner' : ''}`}
      contentClassName="dl-paper-scroll"
      {...dialogProps}
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
}

export default LetterPaper;
