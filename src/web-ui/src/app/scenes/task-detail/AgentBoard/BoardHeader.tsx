/**
 * BoardHeader — top toolbar for the Agent Board.
 *
 * Contains: scope breadcrumb · running badge · search · grouping pills ·
 *           Cards/Rows view toggle · overflow menu (⋯)
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  LayoutGrid,
  List,
  MoreHorizontal,
  Radio,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { Search, FilterPill, FilterPillGroup, IconButton, Tooltip, confirmDanger } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import type { TaskCenterScope, TaskCenterGrouping, TaskCenterView } from '@/app/stores/sessionCapsuleStore';
import './BoardHeader.scss';

interface BoardHeaderProps {
  scope: TaskCenterScope;
  scopeName: string;
  scopePath?: string;
  runningCount: number;
  totalCount: number;
  searchQuery: string;
  grouping: TaskCenterGrouping;
  view: TaskCenterView;
  onSearchChange: (q: string) => void;
  onGroupingChange: (g: TaskCenterGrouping) => void;
  onViewChange: (v: TaskCenterView) => void;
  onRefresh?: () => void;
  onStopAll?: () => void;
  onClearFinished?: () => void;
}

// ── Overflow menu ─────────────────────────────────────────────────────────────

interface OverflowMenuProps {
  runningCount: number;
  onRefresh?: () => void;
  onStopAll?: () => void;
  onClearFinished?: () => void;
}

const OverflowMenu: React.FC<OverflowMenuProps> = ({
  runningCount,
  onRefresh,
  onStopAll,
  onClearFinished,
}) => {
  const { t } = useI18n('common');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('resize', updatePos);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, updatePos]);

  return (
    <div ref={anchorRef} className="bh-overflow-wrap">
      <IconButton
        size="xs"
        variant="ghost"
        tooltip={t('taskDetailScene.board.moreActions')}
        aria-label={t('taskDetailScene.board.moreActions')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </IconButton>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="bh-overflow-menu"
              style={{ top: pos.top, right: pos.right }}
              role="menu"
            >
              {onRefresh && (
                <button
                  type="button"
                  className="bh-overflow-menu__item"
                  role="menuitem"
                  onClick={() => { setOpen(false); onRefresh(); }}
                >
                  <RefreshCw size={13} />
                  <span>{t('taskDetailScene.board.actions.refresh')}</span>
                </button>
              )}
              {onStopAll && runningCount > 0 && (
                <button
                  type="button"
                  className="bh-overflow-menu__item bh-overflow-menu__item--danger"
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    const ok = await confirmDanger(
                      t('taskDetailScene.board.actions.stopAllTitle'),
                      t('taskDetailScene.board.actions.stopAllMessage', { count: runningCount }),
                      { confirmText: t('taskDetailScene.board.actions.stopAll'), cancelText: t('actions.cancel') }
                    );
                    if (ok) onStopAll();
                  }}
                >
                  <Square size={13} />
                  <span>{t('taskDetailScene.board.actions.stopAll')}</span>
                </button>
              )}
              {onClearFinished && (
                <button
                  type="button"
                  className="bh-overflow-menu__item bh-overflow-menu__item--danger"
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    const ok = await confirmDanger(
                      t('taskDetailScene.board.actions.clearFinishedTitle'),
                      t('taskDetailScene.board.actions.clearFinishedMessage'),
                      { confirmText: t('taskDetailScene.board.actions.clearFinished'), cancelText: t('actions.cancel') }
                    );
                    if (ok) onClearFinished();
                  }}
                >
                  <Trash2 size={13} />
                  <span>{t('taskDetailScene.board.actions.clearFinished')}</span>
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

// ── BoardHeader ───────────────────────────────────────────────────────────────

const BoardHeader: React.FC<BoardHeaderProps> = ({
  scope,
  scopeName,
  scopePath,
  runningCount,
  totalCount,
  searchQuery,
  grouping,
  view,
  onSearchChange,
  onGroupingChange,
  onViewChange,
  onRefresh,
  onStopAll,
  onClearFinished,
}) => {
  const { t } = useI18n('common');

  const groupingOptions: Array<{ id: TaskCenterGrouping; label: string }> = [
    { id: 'agent', label: t('taskDetailScene.board.grouping.agent') },
    { id: 'status', label: t('taskDetailScene.board.grouping.status') },
    { id: 'time', label: t('taskDetailScene.board.grouping.time') },
  ];

  return (
    <div className="bh-header">
      {/* Left: breadcrumb + running badge */}
      <div className="bh-header__left">
        <div className="bh-breadcrumb">
          {scope.kind === 'workspace' && (
            <>
              <span className="bh-breadcrumb__segment bh-breadcrumb__segment--muted">
                {t('taskDetailScene.board.breadcrumb.workspace')}
              </span>
              <ChevronRight size={11} className="bh-breadcrumb__sep" aria-hidden />
            </>
          )}
          <Tooltip content={scopePath ?? scopeName} placement="bottom" disabled={!scopePath}>
            <span className="bh-breadcrumb__segment">{scopeName}</span>
          </Tooltip>
        </div>

        {runningCount > 0 && (
          <span className="bh-running-badge">
            <Radio size={9} />
            {t('taskDetailScene.runningCount', { count: runningCount })}
          </span>
        )}

        <span className="bh-total-badge">{totalCount}</span>
      </div>

      {/* Right: search + grouping + view toggle + more */}
      <div className="bh-header__right">
        <Search
          className="bh-search"
          size="small"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={t('taskDetailScene.searchSessionsPlaceholder')}
          clearable
        />

        <FilterPillGroup>
          {groupingOptions.map((opt) => (
            <FilterPill
              key={opt.id}
              label={opt.label}
              active={grouping === opt.id}
              onClick={() => onGroupingChange(opt.id)}
            />
          ))}
        </FilterPillGroup>

        <div className="bh-view-toggle" role="group" aria-label={t('taskDetailScene.board.viewToggleLabel')}>
          <button
            type="button"
            className={['bh-view-btn', view === 'cards' && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => onViewChange('cards')}
            title={t('taskDetailScene.board.view.cards')}
            aria-label={t('taskDetailScene.board.view.cards')}
            aria-pressed={view === 'cards'}
          >
            <LayoutGrid size={13} />
          </button>
          <button
            type="button"
            className={['bh-view-btn', view === 'rows' && 'is-active'].filter(Boolean).join(' ')}
            onClick={() => onViewChange('rows')}
            title={t('taskDetailScene.board.view.rows')}
            aria-label={t('taskDetailScene.board.view.rows')}
            aria-pressed={view === 'rows'}
          >
            <List size={13} />
          </button>
        </div>

        <OverflowMenu
          runningCount={runningCount}
          onRefresh={onRefresh}
          onStopAll={onStopAll}
          onClearFinished={onClearFinished}
        />
      </div>
    </div>
  );
};

export default BoardHeader;
