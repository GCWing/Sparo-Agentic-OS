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

import React, { useCallback } from 'react';
import {
  ArrowRight,
  Clock,
  MessageSquare,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import { IconButton, Tooltip, confirmDanger } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import { renderLiveAppIcon } from '@/app/scenes/apps/live-app/liveAppIcons';
import { AGENT_KIND_META } from '../taskCenter/agentKinds';
import type { TaskItem, StatusVariant, SessionTaskItem, LiveAppTaskItem } from '../taskCenter/useScopedTasks';
import './TaskCard.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAgenticDotDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// ── Status dot ────────────────────────────────────────────────────────────────

const StatusDot: React.FC<{ variant: StatusVariant }> = ({ variant }) => (
  <span className={`tc-card__dot tc-card__dot--${variant}`} aria-hidden />
);

// ── Row view (compact list mode) ──────────────────────────────────────────────

interface TaskRowProps {
  item: TaskItem;
  isHighlighted: boolean;
  showWorkspace: boolean;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
  onStop?: (item: TaskItem) => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  item,
  isHighlighted,
  showWorkspace,
  formatRelativeTime,
  onOpen,
  onDelete,
  onStop,
}) => {
  const { t } = useI18n('common');
  const meta = AGENT_KIND_META[item.kind];
  const Icon = meta.Icon;
  const isRunning = item.status === 'running';

  return (
    <div
      className={[
        'tds-row',
        'tc-row',
        isHighlighted && 'is-highlighted',
        isRunning && 'is-running',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(item)}
    >
      <span className={`tds-row__dot tds-row__dot--${item.status}`} />
      <span className="tds-row__icon-wrap">
        <Icon size={13} className={`tds-row__icon tc-kind-icon--${meta.colorKey}`} />
      </span>
      <span className="tds-row__body">
        <span className="tds-row__title">{item.title}</span>
        <span className="tds-row__meta">
          <span className={`tds-row__badge tds-row__badge--${item.kind === 'code' ? 'code' : item.kind === 'cowork' ? 'cowork' : item.kind === 'liveApp' ? 'live-app' : ''}`}>
            {t(`taskDetailScene.agent.${item.kind}.label`)}
          </span>
          {showWorkspace && item.source === 'session' && (item as SessionTaskItem).workspaceName && (
            <span className="tds-row__badge tds-row__badge--ws">
              {(item as SessionTaskItem).workspaceName}
            </span>
          )}
          <span className="tds-row__meta-dot">·</span>
          <span className="tds-row__meta-item">
            <Clock size={9} />
            {formatRelativeTime(item.updatedAt)}
          </span>
        </span>
      </span>

      {isRunning && onStop && (
        <IconButton
          size="xs"
          variant="ghost"
          className="tds-row__delete-btn"
          tooltip={t('taskDetailScene.card.stop')}
          aria-label={t('taskDetailScene.card.stop')}
          onClick={(e) => { e.stopPropagation(); onStop(item); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </IconButton>
      )}

      {!isRunning && onDelete && item.kind !== 'liveApp' && (
        <IconButton
          size="xs"
          variant="ghost"
          className="tds-row__delete-btn"
          tooltip={t('taskDetailScene.card.delete')}
          aria-label={t('taskDetailScene.card.delete')}
          onClick={(e) => { e.stopPropagation(); onDelete(item); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Trash2 size={12} />
        </IconButton>
      )}

      <ArrowRight size={12} className="tds-row__arrow" />
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
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      // Delete key triggers delete when item is idle
      if (e.key === 'Delete' && item.status === 'idle' && onDelete) { e.preventDefault(); onDelete(); }
    }}
    aria-current={isHighlighted ? 'true' : undefined}
  >
    <div className="tc-card__status-bar" aria-hidden />
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
}

export const SessionCard: React.FC<SessionCardProps> = ({
  item,
  isHighlighted,
  showWorkspace,
  formatRelativeTime,
  onOpen,
  onStop,
  onDelete,
}) => {
  const { t } = useI18n('common');
  const meta = AGENT_KIND_META[item.kind];
  const Icon = meta.Icon;
  const session = item.payload;
  const isRunning = item.status === 'running';

  const turnCount = session.dialogTurns?.length ?? 0;

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

      <div className="tc-card__divider" />

      <div className="tc-card__meta">
        <span className={`tc-card__badge tc-kind-badge--${meta.colorKey}`}>
          {t(`taskDetailScene.agent.${item.kind}.label`)}
        </span>
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

      <div className="tc-card__divider" />

      <div className="tc-card__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="tc-card__primary-btn"
          onClick={() => onOpen(item)}
        >
          {t('taskDetailScene.card.continue')}
          <ArrowRight size={11} />
        </button>
        <div className="tc-card__action-group">
          {isRunning && onStop && (
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('taskDetailScene.card.stop')}
              aria-label={t('taskDetailScene.card.stop')}
              onClick={() => onStop(item)}
            >
              <Square size={11} />
            </IconButton>
          )}
          {!isRunning && onDelete && (
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('taskDetailScene.card.delete')}
              aria-label={t('taskDetailScene.card.delete')}
              onClick={() => onDelete(item)}
            >
              <Trash2 size={11} />
            </IconButton>
          )}
        </div>
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
  const { t } = useI18n('common');
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
        <span className="tc-card__dot tc-card__dot--running" />
      </div>

      <div className="tc-card__divider" />

      <div className="tc-card__meta">
        <span className="tc-card__badge tc-kind-badge--amber">
          {t('taskDetailScene.agent.liveApp.label')}
        </span>
        <span className="tc-card__meta-dot">·</span>
        <span className="tc-card__meta-item">
          <Clock size={9} />
          {formatRelativeTime(item.updatedAt)}
        </span>
      </div>

      <div className="tc-card__divider" />

      <div className="tc-card__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="tc-card__primary-btn"
          onClick={() => onOpen(item)}
        >
          {t('taskDetailScene.card.open')}
          <ArrowRight size={11} />
        </button>
        <div className="tc-card__action-group">
          <IconButton
            size="xs"
            variant="ghost"
            tooltip={t('taskDetailScene.card.stop')}
            aria-label={t('taskDetailScene.card.stop')}
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
  const { t } = useI18n('common');
  const meta = AGENT_KIND_META.dispatcher;
  const Icon = meta.Icon;
  const session = item.payload;
  const dateTitle = `${formatAgenticDotDate(session.createdAt)} → ${formatAgenticDotDate(session.updatedAt ?? session.lastActiveAt)}`;

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    const ok = await confirmDanger(
      t('taskDetailScene.deleteAgenticSessionTitle'),
      t('taskDetailScene.deleteAgenticSessionMessage', { label: dateTitle }),
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

      <div className="tc-card__divider" />

      <div className="tc-card__meta">
        <span className="tc-card__badge tc-kind-badge--sky">
          {t('taskDetailScene.agent.dispatcher.label')}
        </span>
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

      <div className="tc-card__divider" />

      <div className="tc-card__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="tc-card__primary-btn"
          onClick={() => onOpen(item)}
        >
          {t('taskDetailScene.card.resume')}
          <ArrowRight size={11} />
        </button>
        {onDelete && (
          <div className="tc-card__action-group">
            <IconButton
              size="xs"
              variant="ghost"
              tooltip={t('taskDetailScene.card.delete')}
              aria-label={t('taskDetailScene.card.delete')}
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
    />
  );
};

export default TaskCard;
