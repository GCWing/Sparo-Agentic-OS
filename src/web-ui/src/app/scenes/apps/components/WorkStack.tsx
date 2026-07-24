import React from 'react';
import { ChevronLeft, ChevronRight, Layers, Play, Plus, Square } from 'lucide-react';
import { IconButton, StatusDot, type StatusTone } from '@/design-system';
import type { WorkRecord, WorkStatus } from '@/app/agentic-os/work/domain/workTypes';
import { AppIcon, type AppIconSource } from '@/app/components/AppIcon';
import './WorkStack.scss';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function statusTone(status: WorkStatus): StatusTone {
  if (status === 'running') return 'success';
  if (status === 'waiting_user' || status === 'blocked') return 'warning';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'completed') return 'info';
  return 'neutral';
}

function needsAttention(status: WorkStatus): boolean {
  return status === 'waiting_user' || status === 'blocked';
}

function relativeTimeLabel(timestamp: number): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diffMinutes = Math.round((timestamp - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

// ── WorkStack: the icon face — purely identity + status (halo, attention
// badge) like the Discover card's icon. It only becomes a click target when
// there is a specific "latest work" worth resuming in one tap; otherwise it
// stays as calm and inert as every other app icon on the page.

export interface WorkStackProps {
  app: AppIconSource;
  running: boolean;
  relatedWorks: WorkRecord[];
  clickable: boolean;
  size?: number;
  onContinue?: (work: WorkRecord) => void;
  t: Translate;
  className?: string;
}

export const WorkStack: React.FC<WorkStackProps> = ({
  app,
  running,
  relatedWorks,
  clickable,
  size = 40,
  onContinue,
  t,
  className,
}) => {
  const isAnyRunning = running || relatedWorks.some((work) => work.status === 'running');
  const attentionCount = relatedWorks.filter((work) => needsAttention(work.status)).length;
  const latest = relatedWorks.length > 0 ? relatedWorks[0] : null;
  const iconNode = <AppIcon app={app} size={size} />;

  return (
    <div
      className={['work-stack', 'work-stack--logo', isAnyRunning && 'is-running', className].filter(Boolean).join(' ')}
      data-testid="work-stack"
    >
      {isAnyRunning ? <span className="work-stack__halo" aria-hidden /> : null}
      {clickable && latest && onContinue ? (
        <button
          type="button"
          className="work-stack__face"
          style={{ width: size, height: size }}
          onClick={(event) => { event.stopPropagation(); onContinue(latest); }}
          aria-label={t('productSystem.workStack.continueLabel', { title: latest.title })}
          title={t('productSystem.workStack.continueLabel', { title: latest.title })}
        >
          {iconNode}
        </button>
      ) : (
        <span className="work-stack__face work-stack__face--static" style={{ width: size, height: size }}>
          {iconNode}
        </span>
      )}
      {attentionCount > 0 ? (
        <span
          className="work-stack__badge"
          role="img"
          aria-label={t('productSystem.workStack.attentionBadge', { count: attentionCount })}
        >
          {attentionCount > 9 ? '9+' : attentionCount}
        </span>
      ) : null}
    </div>
  );
};

export default WorkStack;

// ── WorkCardFrame ────────────────────────────────────────────────────────────
// The whole card reads as a stack: 1–2 ghost cards, matching the real card's
// shape and radius, peek out from behind at full scale. The peek retracts
// once the card expands (see CardExpandPanel below).

export interface WorkCardFrameProps {
  depth: number;
  expanded: boolean;
  children: React.ReactNode;
  className?: string;
}

export const WorkCardFrame: React.FC<WorkCardFrameProps> = ({ depth, expanded, children, className }) => (
  <div
    className={['work-card-frame', expanded && 'is-expanded', className].filter(Boolean).join(' ')}
    data-stack-depth={depth}
  >
    {depth >= 2 ? <span className="work-card-frame__ghost work-card-frame__ghost--2" aria-hidden /> : null}
    {depth >= 1 ? <span className="work-card-frame__ghost work-card-frame__ghost--1" aria-hidden /> : null}
    {children}
  </div>
);

// ── CardExpandPanel ──────────────────────────────────────────────────────────
// Every card keeps exactly the same content it always had — front (icon,
// title, primary action, description, stack link) and back (its own
// compact header plus the work list) are unchanged. Only the transition
// changes: instead of turning over in 3D, the front folds straight up and
// out while the back unfolds straight down in its place, using the CSS
// grid `0fr -> 1fr` technique so the card grows to fit the list instead of
// staying pinned to one fixed-size box.

export interface CardExpandPanelProps {
  expanded: boolean;
  onCollapse: () => void;
  front: React.ReactNode;
  back: React.ReactNode;
}

export const CardExpandPanel: React.FC<CardExpandPanelProps> = ({ expanded, onCollapse, front, back }) => (
  <div className="card-expand">
    <div className={['card-expand__pane', !expanded && 'is-open'].filter(Boolean).join(' ')} aria-hidden={expanded}>
      <div className="card-expand__pane-inner">{front}</div>
    </div>
    <div
      className={['card-expand__pane', expanded && 'is-open'].filter(Boolean).join(' ')}
      aria-hidden={!expanded}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCollapse();
        }
      }}
    >
      <div className="card-expand__pane-inner">{back}</div>
    </div>
  </div>
);

// ── CardPrimaryAction: one small circular button, same recipe as the
// Discover card's install button — a single unmistakable action instead of a
// row of controls. Launch/stop for single-instance apps, "new work" for
// multi-instance apps (continuing an existing one is the icon's job above).

export interface CardPrimaryActionProps {
  supportsMultipleWorks: boolean;
  running: boolean;
  launching: boolean;
  stopping: boolean;
  onLaunch: () => void;
  onStop: () => void;
  t: Translate;
  className?: string;
}

export const CardPrimaryAction: React.FC<CardPrimaryActionProps> = ({
  supportsMultipleWorks,
  running,
  launching,
  stopping,
  onLaunch,
  onStop,
  t,
  className,
}) => {
  const isStop = !supportsMultipleWorks && running;
  const busy = isStop ? stopping : launching;
  const label = supportsMultipleWorks
    ? t('productSystem.actions.newWork')
    : (running ? t('productSystem.actions.stop') : t('productSystem.actions.launch'));
  const ActionIcon = isStop ? Square : (supportsMultipleWorks ? Plus : Play);

  return (
    <IconButton
      variant="ghost"
      size="small"
      shape="circle"
      className={[
        'card-primary-action',
        !isStop && 'card-primary-action--emphasis',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={label}
      tooltip={label}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={(event) => { event.stopPropagation(); if (isStop) onStop(); else onLaunch(); }}
    >
      <ActionIcon size={14} aria-hidden />
    </IconButton>
  );
};

// ── CardStackLink: a fixed footer row pinned to the bottom of the card via
// `margin-top: auto` — every card's stack affordance lands in the exact same
// place, no matter how much (or little) description text precedes it. The
// stack-of-layers icon echoes the ghost cards peeking out behind the card
// itself, so the affordance and the visual metaphor point at the same idea.

export interface CardStackLinkProps {
  count: number;
  onClick: () => void;
  t: Translate;
}

export const CardStackLink: React.FC<CardStackLinkProps> = ({ count, onClick, t }) => (
  <button
    type="button"
    className="card-stack-link"
    onClick={(event) => { event.stopPropagation(); onClick(); }}
  >
    <Layers size={12} className="card-stack-link__icon" aria-hidden />
    <span className="card-stack-link__count">{t('productSystem.workStack.moreCount', { count })}</span>
    <ChevronRight size={12} className="card-stack-link__chevron" aria-hidden />
  </button>
);

// ── WorkCardBack: the card's back face — its own compact header (collapse,
// icon, title, start a new one) plus every related Work as a row. This is
// where the old floating popover's job now lives, without leaving the card
// footprint locked to a fixed box.

export interface WorkCardBackProps {
  appLabel: string;
  app: AppIconSource;
  relatedWorks: WorkRecord[];
  onBack: () => void;
  onSelect: (work: WorkRecord) => void;
  onCreateNew: () => void;
  t: Translate;
}

export const WorkCardBack: React.FC<WorkCardBackProps> = ({
  appLabel,
  app,
  relatedWorks,
  onBack,
  onSelect,
  onCreateNew,
  t,
}) => (
  <div
    className="work-card-back"
    role="group"
    aria-label={t('productSystem.workStack.relatedLabel', { name: appLabel })}
  >
    <div className="work-card-back__header">
      <button
        type="button"
        className="work-card-back__return"
        onClick={(event) => { event.stopPropagation(); onBack(); }}
        aria-label={t('productSystem.workStack.collapse')}
        title={t('productSystem.workStack.collapse')}
      >
        <ChevronLeft size={13} aria-hidden />
      </button>
      <span className="work-card-back__icon" aria-hidden><AppIcon app={app} size={16} /></span>
      <strong className="work-card-back__title">{appLabel}</strong>
      <button
        type="button"
        className="work-card-back__new"
        onClick={(event) => { event.stopPropagation(); onCreateNew(); }}
        aria-label={t('productSystem.actions.newWork')}
        title={t('productSystem.actions.newWork')}
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
    <div className="work-card-back__list">
      {relatedWorks.map((work, index) => (
        <button
          key={work.id}
          type="button"
          className="work-card-back__row"
          style={{ '--wcb-index': index } as React.CSSProperties}
          onClick={(event) => { event.stopPropagation(); onSelect(work); }}
        >
          <StatusDot tone={statusTone(work.status)} size="small" pulse={work.status === 'running'} />
          <span className="work-card-back__row-body">
            <strong>{work.title}</strong>
            <small>{work.objective}</small>
          </span>
          <span className="work-card-back__row-time">{relativeTimeLabel(work.updatedAt)}</span>
        </button>
      ))}
    </div>
  </div>
);
