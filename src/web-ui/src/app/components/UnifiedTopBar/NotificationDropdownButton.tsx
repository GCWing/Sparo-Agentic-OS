/**
 * NotificationDropdownButton — top-bar notification entry point.
 *
 * A compact bell icon button that opens a Portal-positioned dropdown panel
 * anchored below the button, right-aligned. The panel shows active tasks
 * and notification history with search/filter controls.
 *
 * States:
 *   idle      – bell icon; click → open panel
 *   unread    – bell-dot icon + red badge count
 *   progress  – spinner + progress text (mirrors NotificationButton progress indicator)
 */

import React, {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellDot,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Eraser,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import { Search, Select, Tooltip } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  useUnreadCount,
  useNotificationHistory,
  useCenterOpen,
  useAllProgressNotifications,
  useAllLoadingNotifications,
  useLatestTaskNotification,
} from '@/shared/notification-system/hooks/useNotificationState';
import { notificationService } from '@/shared/notification-system/services/NotificationService';
import type { NotificationFilter, NotificationRecord, Notification } from '@/shared/notification-system/types';
import './NotificationDropdownButton.scss';

// ── Component ───────────────────────────────────────────────────────────────

const NotificationDropdownButton: React.FC = () => {
  const { t, formatDate } = useI18n(['common', 'components']);

  // ── Open/close state ─────────────────────────────────────────────────────

  const isCenterOpen = useCenterOpen();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Keep dropdown open state in sync with notification service center state
  // so that external toggleCenter() calls (e.g. keyboard shortcuts) work too
  useEffect(() => {
    setOpen(isCenterOpen);
  }, [isCenterOpen]);

  // ── Notification data ────────────────────────────────────────────────────

  const unreadCount = useUnreadCount();
  const activeNotification = useLatestTaskNotification();
  const history = useNotificationHistory();
  const allProgressNotifications = useAllProgressNotifications();
  const allLoadingNotifications = useAllLoadingNotifications();

  const activeTaskNotifications = useMemo(
    () => [...allProgressNotifications, ...allLoadingNotifications],
    [allProgressNotifications, allLoadingNotifications],
  );

  // ── Filter / search ──────────────────────────────────────────────────────

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filterOptions = useMemo(
    () => [
      { value: 'all' as const, label: t('components:notificationCenter.filters.all', { count: history.length }) },
      { value: 'success' as const, label: t('common:status.success') },
      { value: 'error' as const, label: t('common:status.error') },
      { value: 'warning' as const, label: t('common:status.warning') },
      { value: 'info' as const, label: t('common:status.info') },
    ],
    [history.length, t],
  );

  const handleFilterChange = useCallback((value: string | number | (string | number)[]) => {
    if (Array.isArray(value)) return;
    setFilter(value as NotificationFilter);
  }, []);

  const filteredHistory = useMemo(() => {
    let filtered = history.filter((n) => {
      if (n.variant === 'progress' || n.variant === 'loading') {
        return n.status === 'completed' || n.status === 'failed' || n.status === 'cancelled';
      }
      return true;
    });
    if (filter !== 'all') {
      filtered = filtered.filter((n) => n.type === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) => n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [history, filter, searchQuery]);

  const groupedHistory = useMemo(() => {
    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const yesterday = today - 86400000;
    const groups = {
      today: [] as NotificationRecord[],
      yesterday: [] as NotificationRecord[],
      earlier: [] as NotificationRecord[],
    };
    filteredHistory.forEach((n) => {
      const d = new Date(n.timestamp).setHours(0, 0, 0, 0);
      if (d === today) groups.today.push(n);
      else if (d === yesterday) groups.yesterday.push(n);
      else groups.earlier.push(n);
    });
    return groups;
  }, [filteredHistory]);

  // ── Panel positioning ────────────────────────────────────────────────────

  const close = useCallback(() => {
    notificationService.toggleCenter(false);
  }, []);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPanelPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    updatePos();
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePos);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, updatePos, close]);

  const handleToggle = useCallback(() => {
    notificationService.toggleCenter();
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleMarkAllRead = useCallback(() => {
    notificationService.markAllAsRead();
  }, []);

  const handleClearAll = useCallback(() => {
    notificationService.clearHistory();
  }, []);

  const handleDeleteNotification = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    notificationService.deleteFromHistory(id);
  }, []);

  const handleNotificationClick = useCallback((notification: NotificationRecord) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(notification.id)) next.delete(notification.id);
      else next.add(notification.id);
      return next;
    });
    if (!notification.read) {
      notificationService.markAsRead(notification.id);
    }
    notification.metadata?.onClick?.();
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const formatTime = useCallback(
    (timestamp: number) => {
      const now = Date.now();
      const today = new Date(now).setHours(0, 0, 0, 0);
      const yesterday = today - 86400000;
      const d = new Date(timestamp).setHours(0, 0, 0, 0);
      if (d < yesterday) {
        return formatDate(timestamp, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      }
      return formatDate(timestamp, { hour: '2-digit', minute: '2-digit' });
    },
    [formatDate],
  );

  const getIcon = (type: string, status?: string) => {
    if (status === 'completed') return '✓';
    if (status === 'failed') return '✕';
    if (status === 'cancelled') return '⊘';
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      default: return 'ℹ';
    }
  };

  // ── Button tooltip ───────────────────────────────────────────────────────

  const buttonTooltip = t('nav.notifications');

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderActiveTaskItem = (notification: Notification) => {
    const isProgress = notification.variant === 'progress';
    const isLoading = notification.variant === 'loading';

    const progressInfo = (() => {
      if (isLoading) return null;
      if (isProgress) {
        const mode = notification.progressMode || (notification.textOnly ? 'text-only' : 'percentage');
        if (mode === 'text-only') return null;
        if (mode === 'fraction' && notification.current !== undefined && notification.total !== undefined) {
          return `${notification.current}/${notification.total}`;
        }
        if (mode === 'percentage' && notification.progress !== undefined) {
          return `${Math.round(notification.progress)}%`;
        }
      }
      return null;
    })();

    return (
      <div key={notification.id} className="notif-panel__active-item">
        <div className="notif-panel__active-icon">
          <Loader2 size={15} className="notif-panel__spinner" />
        </div>
        <div className="notif-panel__active-content">
          <div className="notif-panel__active-row">
            <div className="notif-panel__active-title">{notification.title}</div>
            {progressInfo && (
              <div className="notif-panel__active-progress-text">{progressInfo}</div>
            )}
          </div>
          <div className="notif-panel__active-message">
            {isProgress && notification.progressText
              ? notification.progressText
              : (notification.messageNode ?? notification.message)}
          </div>
          {isProgress && (() => {
            const mode = notification.progressMode || (notification.textOnly ? 'text-only' : 'percentage');
            if (mode === 'text-only') return null;
            return (
              <div className="notif-panel__progress-bar">
                <div
                  className="notif-panel__progress-fill"
                  style={{ width: `${notification.progress || 0}%` }}
                />
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  const renderNotificationItem = (notification: NotificationRecord) => {
    const isProgress = notification.variant === 'progress';
    const isLoading = notification.variant === 'loading';
    const iconCls =
      (isProgress || isLoading) && notification.status
        ? `notif-panel__item-icon--${notification.status}`
        : `notif-panel__item-icon--${notification.type}`;
    const isExpanded = expandedIds.has(notification.id);

    return (
      <div
        key={notification.id}
        className={[
          'notif-panel__item',
          !notification.read ? 'is-unread' : '',
          isProgress ? 'is-progress' : '',
          isLoading ? 'is-loading' : '',
          isExpanded ? 'is-expanded' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => handleNotificationClick(notification)}
        data-notification-id={notification.id}
        data-context-type="notification"
      >
        <div className={`notif-panel__item-icon ${iconCls}`}>
          {getIcon(notification.type, notification.status)}
        </div>
        <div className="notif-panel__item-content">
          <div className="notif-panel__item-header">
            <div className="notif-panel__item-title">{notification.title}</div>
            {isProgress && (() => {
              const mode = notification.progressMode || (notification.textOnly ? 'text-only' : 'percentage');
              if (mode === 'text-only') return null;
              if (mode === 'fraction' && notification.current !== undefined && notification.total !== undefined) {
                return <div className="notif-panel__item-pct">{notification.current}/{notification.total}</div>;
              }
              if (mode === 'percentage' && notification.progress !== undefined) {
                return <div className="notif-panel__item-pct">{Math.round(notification.progress)}%</div>;
              }
              return null;
            })()}
          </div>
          <div className="notif-panel__item-message">
            {isProgress && notification.progressText
              ? notification.progressText
              : (notification.messageNode ?? notification.message)}
          </div>
          {isProgress && (() => {
            const mode = notification.progressMode || (notification.textOnly ? 'text-only' : 'percentage');
            if (mode === 'text-only') return null;
            return (
              <div className="notif-panel__progress-bar">
                <div
                  className={`notif-panel__progress-fill ${notification.status ? `is-${notification.status}` : ''}`}
                  style={{ width: `${notification.progress || 0}%` }}
                />
              </div>
            );
          })()}
          <div className="notif-panel__item-time">{formatTime(notification.timestamp)}</div>
        </div>
        {!notification.read && <div className="notif-panel__item-badge" />}
        <div className="notif-panel__item-actions">
          <button
            className="notif-panel__item-expand"
            onClick={(e) => {
              e.stopPropagation();
              handleNotificationClick(notification);
            }}
            title={isExpanded ? t('common:actions.collapse') : t('common:actions.expand')}
          >
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            className="notif-panel__item-delete"
            onClick={(e) => handleDeleteNotification(e, notification.id)}
            title={t('common:actions.delete')}
          >
            <XCircle size={14} />
          </button>
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <Tooltip content={buttonTooltip} placement="bottom" followCursor disabled={open}>
        <button
          ref={anchorRef}
          type="button"
          className={[
            'notif-btn',
            open ? 'is-open' : '',
            activeNotification ? 'notif-btn--has-progress' : '',
            activeNotification?.variant === 'loading' ? 'notif-btn--loading' : '',
          ].filter(Boolean).join(' ')}
          aria-label={buttonTooltip}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={handleToggle}
        >
          {activeNotification ? (
            <div className="notif-btn__progress">
              {activeNotification.variant === 'loading' ? (
                <div className="notif-btn__loading-icon">
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5"
                    className="notif-btn__spinner"
                  >
                    <path d="M12 2 A 10 10 0 0 1 22 12" strokeLinecap="round" />
                  </svg>
                </div>
              ) : (
                <div className="notif-btn__progress-icon">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" opacity="0.2" />
                    <path
                      d="M12 2 A 10 10 0 0 1 22 12"
                      strokeLinecap="round"
                      style={{
                        strokeDasharray: `${(activeNotification.progress || 0) * 0.628} 62.8`,
                        transform: 'rotate(-90deg)',
                        transformOrigin: 'center',
                      }}
                    />
                  </svg>
                </div>
              )}
              <span className="notif-btn__progress-text">
                {activeNotification.variant === 'loading'
                  ? activeNotification.message
                  : (() => {
                      const mode = activeNotification.progressMode ||
                        (activeNotification.textOnly ? 'text-only' : 'percentage');
                      if (
                        mode === 'fraction' &&
                        activeNotification.current !== undefined &&
                        activeNotification.total !== undefined
                      ) {
                        return `${activeNotification.current}/${activeNotification.total}`;
                      }
                      return `${Math.round(activeNotification.progress || 0)}%`;
                    })()}
              </span>
            </div>
          ) : unreadCount > 0 ? (
            <BellDot size={14} className="notif-btn__icon--unread" aria-hidden="true" />
          ) : (
            <Bell size={14} aria-hidden="true" />
          )}

          {unreadCount > 0 && !activeNotification && (
            <span className="notif-btn__badge" aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </Tooltip>

      {open &&
        panelPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="notif-panel__backdrop"
              aria-hidden="true"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={close}
            />

            {/* Panel */}
            <div
              className="notif-panel"
              role="dialog"
              aria-label={t('nav.notifications')}
              style={{ top: panelPos.top, right: panelPos.right }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="notif-panel__header">
                <Bell size={13} aria-hidden="true" className="notif-panel__header-icon" />
                <span className="notif-panel__header-title">
                  {t('components:notificationCenter.title')}
                </span>
                <div className="notif-panel__header-actions">
                  <button
                    className="notif-panel__header-btn"
                    onClick={handleMarkAllRead}
                    title={t('components:notificationCenter.actions.markAllRead')}
                  >
                    <CheckCheck size={14} />
                  </button>
                  <button
                    className="notif-panel__header-btn"
                    onClick={handleClearAll}
                    title={t('components:notificationCenter.actions.clearAll')}
                  >
                    <Eraser size={14} />
                  </button>
                  <button
                    className="notif-panel__header-btn"
                    onClick={close}
                    title={t('common:actions.close')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Toolbar */}
              <div className="notif-panel__toolbar">
                <Search
                  className="notif-panel__search"
                  placeholder={t('components:notificationCenter.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(val) => setSearchQuery(val)}
                  clearable
                  size="medium"
                />
                <Select
                  className="notif-panel__filter"
                  size="small"
                  value={filter}
                  options={filterOptions}
                  onChange={handleFilterChange}
                  placeholder={t('components:notificationCenter.filters.placeholder')}
                />
              </div>

              {/* Content */}
              <div className="notif-panel__content">
                {activeTaskNotifications.length > 0 && (
                  <div className="notif-panel__active-section">
                    <div className="notif-panel__section-label">
                      {t('components:notificationCenter.activeTasks.title', {
                        count: activeTaskNotifications.length,
                      })}
                    </div>
                    <div className="notif-panel__active-list">
                      {activeTaskNotifications.map(renderActiveTaskItem)}
                    </div>
                  </div>
                )}

                {filteredHistory.length === 0 && activeTaskNotifications.length === 0 ? (
                  <div className="notif-panel__empty">
                    <div className="notif-panel__empty-icon" />
                    <div className="notif-panel__empty-text">
                      {searchQuery
                        ? t('components:notificationCenter.empty.noMatches')
                        : t('components:notificationCenter.empty.noNotifications')}
                    </div>
                  </div>
                ) : (
                  <>
                    {groupedHistory.today.length > 0 && (
                      <div className="notif-panel__group">
                        <div className="notif-panel__group-label">{t('common:time.today')}</div>
                        {groupedHistory.today.map(renderNotificationItem)}
                      </div>
                    )}
                    {groupedHistory.yesterday.length > 0 && (
                      <div className="notif-panel__group">
                        <div className="notif-panel__group-label">{t('common:time.yesterday')}</div>
                        {groupedHistory.yesterday.map(renderNotificationItem)}
                      </div>
                    )}
                    {groupedHistory.earlier.length > 0 && (
                      <div className="notif-panel__group">
                        <div className="notif-panel__group-label">
                          {t('components:notificationCenter.groups.earlier')}
                        </div>
                        {groupedHistory.earlier.map(renderNotificationItem)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
};

export default NotificationDropdownButton;
