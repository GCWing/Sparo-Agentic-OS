/**
 * TaskCard — visual task card with status bar, meta info, and actions.
 *
 * Three render variants:
 *   - SessionCardVariant (code / cowork / design / other)
 *   - LiveAppCardVariant
 *   - DispatcherCardVariant
 *
 * Shared shell handles: status bar, hover elevation, selected ring.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ArrowRight,
  Clock,
  MessageSquare,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Badge, Button, IconButton, Input, StatusDot as DsStatusDot, Tooltip, confirmDanger } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { renderLiveAppIcon } from '@/app/scenes/apps/live-app/liveAppIconHelpers';
import { AGENT_KIND_META } from '../taskCenter/agentKinds';
import type { TaskItem, StatusVariant, SessionTaskItem, LiveAppTaskItem } from '../taskCenter/useScopedTasks';
import './TaskCard.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAgenticDotDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// ── Design-system adapters ───────────────────────────────────────────────────

type BadgeTone = React.ComponentProps<typeof Badge>['variant'];
type DotTone = React.ComponentProps<typeof DsStatusDot>['tone'];

const STATUS_DOT_TONE: Record<StatusVariant, DotTone> = {
  running: 'accent',
  active: 'success',
  error: 'error',
  idle: 'neutral',
};

const KIND_BADGE_TONE: Record<string, BadgeTone> = {
  accent: 'accent',
  emerald: 'success',
  violet: 'purple',
  amber: 'warning',
  sky: 'info',
  muted: 'neutral',
};

const StatusDot: React.FC<{ variant: StatusVariant }> = ({ variant }) => (
  <DsStatusDot
    className="tc-card__dot"
    tone={STATUS_DOT_TONE[variant]}
    size="small"
    pulse={variant === 'running'}
  />
);

function getKindBadgeTone(colorKey: string): BadgeTone {
  return KIND_BADGE_TONE[colorKey] ?? 'neutral';
}

// ── Row view (compact list mode) ──────────────────────────────────────────────

interface TaskRowProps {
  item: TaskItem;
  isHighlighted: boolean;
  showWorkspace: boolean;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
  onStop?: (item: TaskItem) => void;
  onQuickSend?: (item: SessionTaskItem, message: string) => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  item,
  isHighlighted,
  showWorkspace,
  formatRelativeTime,
  onOpen,
  onDelete,
  onStop,
  onQuickSend,
}) => {
  const { t } = useI18n('scenes/task-detail');
  const meta = AGENT_KIND_META[item.kind];
  const Icon = meta.Icon;
  const isRunning = item.status === 'running';
  const canQuickSend = item.source === 'session' && !!onQuickSend;

  const [showInput, setShowInput] = useState(false);
  const [quickMsg, setQuickMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const msg = quickMsg.trim();
    if (!msg || !canQuickSend) return;
    onQuickSend!(item as SessionTaskItem, msg);
    setQuickMsg('');
    setShowInput(false);
  }, [quickMsg, canQuickSend, onQuickSend, item]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setQuickMsg('');
    setShowInput(false);
  }, []);

  const openInput = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowInput(true);
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const rowBody = (
    <span className="tds-row__body">
      <span className="tds-row__title">{item.title}</span>
      <span className="tds-row__meta">
        <Badge variant={getKindBadgeTone(meta.colorKey)} className="tds-row__badge">
          {t(`agent.${item.kind}.label`)}
        </Badge>
        {showWorkspace && item.source === 'session' && (item as SessionTaskItem).workspaceName && (
          <Badge variant="neutral" className="tds-row__badge tc-row__workspace-badge">
            {(item as SessionTaskItem).workspaceName}
          </Badge>
        )}
        <span className="tds-row__meta-dot">·</span>
        <span className="tds-row__meta-item">
          <Clock size={9} />
          {formatRelativeTime(item.updatedAt)}
        </span>
      </span>
    </span>
  );

  const browseActions = (
    <>
      {canQuickSend && (
        <IconButton
          size="xs"
          variant="ghost"
          className="tds-row__quick-send-action"
          tooltip={t('card.quickSend')}
          aria-label={t('card.quickSend')}
          onClick={openInput}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Send size={12} />
        </IconButton>
      )}
      {isRunning && onStop && (
        <IconButton
          size="xs"
          variant="ghost"
          className="tds-row__destructive-action"
          tooltip={t('card.stop')}
          aria-label={t('card.stop')}
          onClick={(e) => {
            e.stopPropagation();
            onStop(item);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </IconButton>
      )}
      {!isRunning && onDelete && item.kind !== 'liveApp' && (
        <IconButton
          size="xs"
          variant="ghost"
          className="tds-row__destructive-action"
          tooltip={t('card.delete')}
          aria-label={t('card.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Trash2 size={12} />
        </IconButton>
      )}
      <ArrowRight size={12} className="tds-row__arrow" />
    </>
  );

  const quickForm = (
    <form className="tc-row__quick-form" onSubmit={handleSubmit}>
      <Input
        ref={inputRef}
        className="tc-row__quick-input-wrap"
        value={quickMsg}
        onChange={(e) => setQuickMsg(e.target.value)}
        placeholder={t('card.quickSendPlaceholder')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setShowInput(false);
            setQuickMsg('');
          }
        }}
        size="small"
        variant="filled"
      />
      <span className="tc-row__quick-actions">
        <IconButton
          size="xs"
          variant="ghost"
          type="submit"
          tooltip={t('card.quickSend')}
          aria-label={t('card.quickSend')}
          disabled={!quickMsg.trim()}
        >
          <Send size={12} />
        </IconButton>
        <IconButton
          size="xs"
          variant="ghost"
          tooltip={t('card.quickSendCancel')}
          aria-label={t('card.quickSendCancel')}
          onClick={handleCancel}
        >
          <X size={12} />
        </IconButton>
      </span>
    </form>
  );

  return (
    <div
      className={[
        'tds-row',
        'tc-row',
        isHighlighted && 'is-highlighted',
        isRunning && 'is-running',
        showInput && 'tc-row--composing',
      ]
        .filter(Boolean)
        .join(' ')}
      role={showInput ? 'group' : 'button'}
      tabIndex={showInput ? undefined : 0}
      aria-label={showInput ? t('card.quickSend') : undefined}
      onClick={showInput ? undefined : () => onOpen(item)}
      onKeyDown={
        showInput
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(item);
              }
            }
      }
    >
      <DsStatusDot
        className="tds-row__dot"
        tone={STATUS_DOT_TONE[item.status]}
        size="small"
        pulse={item.status === 'running'}
      />
      <span className="tds-row__icon-wrap">
        <Icon size={13} className={`tds-row__icon tc-kind-icon--${meta.colorKey}`} aria-hidden />
      </span>
      {!canQuickSend ? (
        <>
          {rowBody}
          <span className="tc-row__browse-actions tc-row__browse-actions--contents">{browseActions}</span>
        </>
      ) : (
        <div className="tc-row__main">
          <div className="tc-row__dock" aria-live="polite">
            <div
              className={`tc-row__layer tc-row__layer--browse ${showInput ? 'tc-row__layer--out' : 'tc-row__layer--in'}`}
              {...(showInput ? { inert: true } : {})}
            >
              <div className="tc-row__browse-row">{rowBody}</div>
              <span className="tc-row__browse-actions">{browseActions}</span>
            </div>
            <div
              className={`tc-row__layer tc-row__layer--compose ${showInput ? 'tc-row__layer--in' : 'tc-row__layer--out'}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              {...(!showInput ? { inert: true } : {})}
            >
              {quickForm}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Card shell ────────────────────────────────────────────────────────────────

interface CardShellProps {
  item: TaskItem;
  isHighlighted: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const CardShell: React.FC<CardShellProps & { onDelete?: () => void }> = ({
  item, isHighlighted, onClick, onDelete, children
}) => (
  <div
    className={[
      'tc-card',
      `tc-card--${item.status}`,
      `tc-card--${item.kind}`,
      isHighlighted && 'is-highlighted',
    ].filter(Boolean).join(' ')}
    aria-current={isHighlighted ? 'true' : undefined}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      if (e.key === 'Delete' && item.status === 'idle' && onDelete) { e.preventDefault(); onDelete(); }
    }}
  >
    {children}
  </div>
);

// ── Session card ──────────────────────────────────────────────────────────────

interface SessionCardProps {
  item: SessionTaskItem;
  isHighlighted: boolean;
  showWorkspace: boolean;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onStop?: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
  onQuickSend?: (item: SessionTaskItem, message: string) => void;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  item,
  isHighlighted,
  showWorkspace,
  formatRelativeTime,
  onOpen,
  onStop,
  onDelete,
  onQuickSend,
}) => {
  const { t } = useI18n('scenes/task-detail');
  const meta = AGENT_KIND_META[item.kind];
  const Icon = meta.Icon;
  const session = item.payload;
  const isRunning = item.status === 'running';

  const turnCount = session.dialogTurns?.length ?? 0;

  const [showQuickInput, setShowQuickInput] = useState(false);
  const [quickMsg, setQuickMsg] = useState('');
  const quickInputRef = useRef<HTMLInputElement>(null);

  const handleOpenQuickInput = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowQuickInput(true);
    window.setTimeout(() => quickInputRef.current?.focus(), 80);
  }, []);

  const handleQuickCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowQuickInput(false);
    setQuickMsg('');
  }, []);

  const handleQuickSubmit = useCallback(() => {
    const msg = quickMsg.trim();
    if (!msg || !onQuickSend) return;
    onQuickSend(item, msg);
    setQuickMsg('');
    setShowQuickInput(false);
  }, [quickMsg, onQuickSend, item]);

  const handleQuickKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickSubmit();
    }
    if (e.key === 'Escape') {
      setShowQuickInput(false);
      setQuickMsg('');
    }
  }, [handleQuickSubmit]);

  return (
    <CardShell
      item={item}
      isHighlighted={isHighlighted}
      onClick={() => onOpen(item)}
      onDelete={onDelete ? () => onDelete(item) : undefined}
    >
      <div className="tc-card__top">
        <StatusDot variant={item.status} />
        <span className={`tc-card__kind-icon tc-kind-icon--${meta.colorKey}`}>
          <Icon size={12} />
        </span>
        <span className="tc-card__title">
          <Tooltip content={item.title} placement="top">
            <span>{item.title}</span>
          </Tooltip>
        </span>
      </div>

      <div className="tc-card__meta">
        <Badge variant={getKindBadgeTone(meta.colorKey)} className="tc-card__badge">
          {t(`agent.${item.kind}.label`)}
        </Badge>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <MessageSquare size={9} />
          {turnCount}
        </span>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <Clock size={9} />
          {formatRelativeTime(item.updatedAt)}
        </span>
        {showWorkspace && item.workspaceName && (
          <>
            <span className="tc-card__meta-dot">·</span>
            <span className="tc-card__meta-item tc-card__meta-item--ws">
              {item.workspaceName}
            </span>
          </>
        )}
      </div>

      <div
        className={[
          'tc-card__actions',
          showQuickInput && onQuickSend && 'tc-card__actions--composing',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {!onQuickSend ? (
          <>
            <Button variant="ghost" size="small" className="tc-card__primary-action" onClick={() => onOpen(item)}>
              {t('card.continue')}
              <ArrowRight size={11} />
            </Button>
            <div className="tc-card__action-group">
              {isRunning && onStop && (
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip={t('card.stop')}
                  aria-label={t('card.stop')}
                  onClick={() => onStop(item)}
                >
                  <Square size={11} />
                </IconButton>
              )}
              {!isRunning && onDelete && (
                <IconButton
                  size="xs"
                  variant="ghost"
                  tooltip={t('card.delete')}
                  aria-label={t('card.delete')}
                  onClick={() => onDelete(item)}
                >
                  <Trash2 size={11} />
                </IconButton>
              )}
            </div>
          </>
        ) : (
          <div className="tc-card__actions-dock" aria-live="polite">
            <div
              className={`tc-card__actions-layer tc-card__actions-layer--browse ${showQuickInput ? 'tc-card__actions-layer--out' : 'tc-card__actions-layer--in'}`}
              {...(showQuickInput ? { inert: true } : {})}
            >
              <div className="tc-card__actions-row">
                <Button variant="ghost" size="small" className="tc-card__primary-action" onClick={() => onOpen(item)}>
                  {t('card.continue')}
                  <ArrowRight size={11} />
                </Button>
                <div className="tc-card__action-group">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    tooltip={t('card.quickSend')}
                    aria-label={t('card.quickSend')}
                    onClick={handleOpenQuickInput}
                  >
                    <Send size={11} />
                  </IconButton>
                  {isRunning && onStop && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      tooltip={t('card.stop')}
                      aria-label={t('card.stop')}
                      onClick={() => onStop(item)}
                    >
                      <Square size={11} />
                    </IconButton>
                  )}
                  {!isRunning && onDelete && (
                    <IconButton
                      size="xs"
                      variant="ghost"
                      tooltip={t('card.delete')}
                      aria-label={t('card.delete')}
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 size={11} />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
            <div
              className={`tc-card__actions-layer tc-card__actions-layer--compose ${showQuickInput ? 'tc-card__actions-layer--in' : 'tc-card__actions-layer--out'}`}
              {...(!showQuickInput ? { inert: true } : {})}
            >
              <div className="tc-card__actions-row">
                <Input
                  ref={quickInputRef}
                  className="tc-card__inline-input"
                  value={quickMsg}
                  onChange={(e) => setQuickMsg(e.target.value)}
                  onKeyDown={handleQuickKeyDown}
                  placeholder={t('card.quickSendPlaceholder')}
                  size="small"
                  variant="filled"
                />
                <div className="tc-card__action-group">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    tooltip={t('card.quickSend')}
                    aria-label={t('card.quickSend')}
                    disabled={!quickMsg.trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleQuickSubmit();
                    }}
                  >
                    <Send size={11} />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    tooltip={t('card.quickSendCancel')}
                    aria-label={t('card.quickSendCancel')}
                    onClick={handleQuickCancel}
                  >
                    <X size={11} />
                  </IconButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </CardShell>
  );
};

// ── Live App card ─────────────────────────────────────────────────────────────

interface LiveAppCardProps {
  item: LiveAppTaskItem;
  isHighlighted: boolean;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onStop: (item: TaskItem) => void;
}

export const LiveAppCard: React.FC<LiveAppCardProps> = ({
  item,
  isHighlighted,
  formatRelativeTime,
  onOpen,
  onStop,
}) => {
  const { t } = useI18n('scenes/task-detail');
  const app = item.payload;

  return (
    <CardShell item={item} isHighlighted={isHighlighted} onClick={() => onOpen(item)}>
      <div className="tc-card__top">
        <span className="tc-card__live-app-icon">
          {renderLiveAppIcon(app.icon, 14)}
        </span>
        <span className="tc-card__title">
          <Tooltip content={item.title} placement="top">
            <span>{item.title}</span>
          </Tooltip>
        </span>
        <StatusDot variant="running" />
      </div>

      <div className="tc-card__meta">
        <Badge variant="warning" className="tc-card__badge">
          {t('agent.liveApp.label')}
        </Badge>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <Clock size={9} />
          {formatRelativeTime(item.updatedAt)}
        </span>
      </div>

      <div className="tc-card__actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="small"
          className="tc-card__primary-action"
          onClick={() => onOpen(item)}
        >
          {t('card.open')}
          <ArrowRight size={11} />
        </Button>
        <div className="tc-card__action-group">
          <IconButton
            size="xs"
            variant="ghost"
            tooltip={t('card.stop')}
            aria-label={t('card.stop')}
            onClick={() => onStop(item)}
          >
            <Square size={11} />
          </IconButton>
        </div>
      </div>
    </CardShell>
  );
};

// ── Dispatcher card ───────────────────────────────────────────────────────────

interface DispatcherCardProps {
  item: SessionTaskItem;
  isHighlighted: boolean;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
}

export const DispatcherCard: React.FC<DispatcherCardProps> = ({
  item,
  isHighlighted,
  formatRelativeTime,
  onOpen,
  onDelete,
}) => {
  const { t } = useI18n('scenes/task-detail');
  const meta = AGENT_KIND_META.dispatcher;
  const Icon = meta.Icon;
  const session = item.payload;
  const dateTitle = `${formatAgenticDotDate(session.createdAt)} → ${formatAgenticDotDate(session.updatedAt ?? session.lastActiveAt)}`;

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    const ok = await confirmDanger(
      t('deleteAgenticSessionTitle'),
      t('deleteAgenticSessionMessage', { label: dateTitle }),
      {
        confirmText: t('nav.sessions.delete'),
        cancelText: t('actions.cancel'),
      }
    );
    if (ok) onDelete(item);
  }, [onDelete, item, t, dateTitle]);

  return (
    <CardShell
      item={item}
      isHighlighted={isHighlighted}
      onClick={() => onOpen(item)}
      onDelete={onDelete ? handleDelete : undefined}
    >
      <div className="tc-card__top">
        <StatusDot variant={item.status} />
        <span className={`tc-card__kind-icon tc-kind-icon--${meta.colorKey}`}>
          <Icon size={12} />
        </span>
        <span className="tc-card__title">
          <Tooltip content={dateTitle} placement="top">
            <span>{dateTitle}</span>
          </Tooltip>
        </span>
      </div>

      <div className="tc-card__meta">
        <Badge variant="info" className="tc-card__badge">
          {t('agent.dispatcher.label')}
        </Badge>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <Wrench size={9} />
          {session.dialogTurns?.length ?? 0}
        </span>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <Clock size={9} />
          {formatRelativeTime(item.updatedAt)}
        </span>
      </div>

      <div className="tc-card__actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="small"
          className="tc-card__primary-action"
          onClick={() => onOpen(item)}
        >
          {t('card.resume')}
          <ArrowRight size={11} />
        </Button>
        {onDelete && (
          <div className="tc-card__action-group">
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('card.delete')}
              aria-label={t('card.delete')}
              onClick={handleDelete}
            >
              <Trash2 size={11} />
            </IconButton>
          </div>
        )}
      </div>
    </CardShell>
  );
};

// ── Unified dispatcher ────────────────────────────────────────────────────────

interface TaskCardProps {
  item: TaskItem;
  isHighlighted: boolean;
  showWorkspace: boolean;
  viewMode: 'cards' | 'rows';
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onStop?: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
  onQuickSend?: (item: SessionTaskItem, message: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  item,
  isHighlighted,
  showWorkspace,
  viewMode,
  formatRelativeTime,
  onOpen,
  onStop,
  onDelete,
  onQuickSend,
}) => {
  if (viewMode === 'rows') {
    return (
      <TaskRow
        item={item}
        isHighlighted={isHighlighted}
        showWorkspace={showWorkspace}
        formatRelativeTime={formatRelativeTime}
        onOpen={onOpen}
        onStop={onStop}
        onDelete={onDelete}
        onQuickSend={onQuickSend}
      />
    );
  }

  if (item.source === 'liveApp') {
    return (
      <LiveAppCard
        item={item as LiveAppTaskItem}
        isHighlighted={isHighlighted}
        formatRelativeTime={formatRelativeTime}
        onOpen={onOpen}
        onStop={onStop ?? (() => {})}
      />
    );
  }

  const sessionItem = item as SessionTaskItem;
  if (item.kind === 'dispatcher') {
    return (
      <DispatcherCard
        item={sessionItem}
        isHighlighted={isHighlighted}
        formatRelativeTime={formatRelativeTime}
        onOpen={onOpen}
        onDelete={onDelete}
      />
    );
  }

  return (
    <SessionCard
      item={sessionItem}
      isHighlighted={isHighlighted}
      showWorkspace={showWorkspace}
      formatRelativeTime={formatRelativeTime}
      onOpen={onOpen}
      onStop={onStop}
      onDelete={onDelete}
      onQuickSend={onQuickSend}
    />
  );
};

export default TaskCard;
