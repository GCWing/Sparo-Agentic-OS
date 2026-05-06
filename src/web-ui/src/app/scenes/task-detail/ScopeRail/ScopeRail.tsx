/**
 * ScopeRail — left navigation rail for the Task Center.
 *
 * Shows:
 *   1. Panel header + search
 *   2. Running + global (system) task scopes in one list
 *   3. WORKSPACES section (opened + recent list)
 *   4. "+ Open workspace" menu at the bottom
 */

import React, { useCallback, useContext, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock,
  FolderOpen,
  Folder,
  FolderPlus,
  LayoutDashboard,
  Server,
  X,
} from 'lucide-react';
import { Search, IconButton, Tooltip } from '@/component-library';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { isRemoteWorkspace, type WorkspaceInfo } from '@/shared/types';
import { useI18n } from '@/infrastructure/i18n';
import { SSHContext } from '@/features/ssh-remote/SSHRemoteContext';
import { createLogger } from '@/shared/utils/logger';
import type { TaskCenterScope } from '@/app/stores/sessionCapsuleStore';
import type { AgentKind } from '../taskCenter/agentKinds';
import './ScopeRail.scss';

const log = createLogger('ScopeRail');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceFullPath(workspace: WorkspaceInfo): string {
  const path = workspace.rootPath?.trim() ?? '';
  if (!path) return '';
  if (isRemoteWorkspace(workspace)) {
    const host = workspace.sshHost?.trim();
    if (host && host.toLowerCase() !== 'localhost') return `${host}:${path}`;
  }
  return path;
}

// ── Open workspace menu (portal popover) ─────────────────────────────────────

interface OpenWorkspaceMenuProps {
  onOpenLocal: () => void;
  onOpenRemote: () => void;
  remoteAvailable: boolean;
}

const OpenWorkspaceMenu: React.FC<OpenWorkspaceMenuProps> = ({
  onOpenLocal,
  onOpenRemote,
  remoteAvailable,
}) => {
  const { t } = useI18n('common');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 216;
    const pad = 8;
    setPos({
      top: rect.bottom + 4,
      left: Math.max(pad, Math.min(rect.left, window.innerWidth - menuWidth - pad)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onViewport = () => updatePos();
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="sr-open-ws-menu" ref={anchorRef}>
      <IconButton
        size="xs"
        variant="ghost"
        tooltip={t('taskDetailScene.openWorkspaceMenu')}
        aria-label={t('taskDetailScene.openWorkspaceMenu')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <FolderPlus size={12} />
      </IconButton>
      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              className="sr-open-ws-popover"
              style={{ top: pos.top, left: pos.left }}
              role="menu"
            >
              <button
                type="button"
                className="sr-open-ws-popover__item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenLocal();
                }}
              >
                <FolderOpen size={14} className="sr-open-ws-popover__icon" aria-hidden />
                <span>{t('taskDetailScene.openWorkspaceLocal')}</span>
              </button>
              <button
                type="button"
                className="sr-open-ws-popover__item"
                role="menuitem"
                disabled={!remoteAvailable}
                title={remoteAvailable ? undefined : t('taskDetailScene.openWorkspaceRemoteUnavailable')}
                onClick={() => {
                  if (!remoteAvailable) return;
                  setOpen(false);
                  onOpenRemote();
                }}
              >
                <Server size={14} className="sr-open-ws-popover__icon" aria-hidden />
                <span>{t('taskDetailScene.openWorkspaceRemoteSsh')}</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

// ── System scope item ─────────────────────────────────────────────────────────

interface ScopeSystemItemProps {
  isSelected: boolean;
  runningCount: number;
  onSelect: () => void;
}

const ScopeSystemItem: React.FC<ScopeSystemItemProps> = ({
  isSelected,
  runningCount,
  onSelect,
}) => {
  const { t } = useI18n('common');
  const chips: Array<{ key: AgentKind; label: string }> = [
    { key: 'liveApp', label: t('taskDetailScene.agent.liveApp.label') },
    { key: 'deepResearch', label: t('taskDetailScene.agent.deepResearch.label') },
  ];

  return (
    <div
      className={['sr-system-item', 'sr-scope-global', isSelected && 'is-selected'].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      aria-current={isSelected ? 'true' : undefined}
    >
      <span className="sr-system-item__icon-wrap" aria-hidden>
        <LayoutDashboard size={13} strokeWidth={2.25} />
      </span>
      <span className="sr-system-item__body">
        <span className="sr-system-item__title">{t('taskDetailScene.scope.system.title')}</span>
        <span className="sr-system-item__chips">
          {chips.map((c, i) => (
            <React.Fragment key={c.key}>
              {i > 0 && <span className="sr-system-item__chip-dot" aria-hidden>·</span>}
              <span className="sr-system-item__chip">{c.label}</span>
            </React.Fragment>
          ))}
        </span>
      </span>
      {runningCount > 0 && (
        <span className="sr-system-item__running" aria-label={`${runningCount} running`}>
          {runningCount}
        </span>
      )}
    </div>
  );
};

// ── Workspace scope item ──────────────────────────────────────────────────────

interface ScopeWorkspaceItemProps {
  workspace: WorkspaceInfo;
  isSelected: boolean;
  isOpened: boolean;
  taskCount: number;
  runningCount: number;
  onSelect: (id: string) => void;
  onClose: (e: React.MouseEvent, id: string) => void;
}

const ScopeWorkspaceItem: React.FC<ScopeWorkspaceItemProps> = ({
  workspace,
  isSelected,
  isOpened,
  taskCount,
  runningCount,
  onSelect,
  onClose,
}) => {
  const { t } = useI18n('common');
  const fullPath = getWorkspaceFullPath(workspace);
  const primaryName = workspace.name?.trim() || fullPath || workspace.id;
  const showPath = Boolean(fullPath && fullPath !== primaryName);
  const emoji = workspace.identity?.emoji?.trim();

  const row = (
    <div
      className={[
        'sr-ws-item',
        isSelected && 'is-selected',
        !isOpened && 'is-recent',
        runningCount > 0 && 'has-running',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(workspace.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(workspace.id)}
      aria-current={isSelected ? 'true' : undefined}
    >
      <span className="sr-ws-item__icon-wrap" aria-hidden>
        {emoji ? (
          <span className="sr-ws-item__emoji">{emoji}</span>
        ) : isOpened ? (
          <FolderOpen size={13} className="sr-ws-item__icon" />
        ) : (
          <Folder size={13} className="sr-ws-item__icon sr-ws-item__icon--closed" />
        )}
      </span>
      <span className="sr-ws-item__body">
        <span className="sr-ws-item__title">{primaryName}</span>
        {showPath && (
          <span className="sr-ws-item__path" title={fullPath}>
            {fullPath}
          </span>
        )}
        <span className="sr-ws-item__meta">
          {!isOpened && (
            <span className="sr-ws-item__badge sr-ws-item__badge--recent">
              {t('taskDetailScene.badgeRecent')}
            </span>
          )}
        </span>
      </span>
      <span className="sr-ws-item__tail">
        {taskCount > 0 && (
          <span className={['sr-ws-item__count', runningCount > 0 && 'has-running'].filter(Boolean).join(' ')}>
            {runningCount > 0 ? (
              <span className="sr-ws-item__count-dot" />
            ) : null}
            {taskCount}
          </span>
        )}
      </span>
      {isOpened && (
        <IconButton
          size="xs"
          variant="ghost"
          className="sr-ws-item__close"
          tooltip={t('taskDetailScene.closeWorkspace')}
          onClick={(e) => onClose(e, workspace.id)}
          aria-label={t('taskDetailScene.closeWorkspace')}
        >
          <X size={11} />
        </IconButton>
      )}
    </div>
  );

  if (isOpened) return row;

  return (
    <Tooltip content={t('taskDetailScene.workspaceNotOpenedTooltip')} placement="right">
      {row}
    </Tooltip>
  );
};

// ── Main ScopeRail ─────────────────────────────────────────────────────────────

export interface ScopeRailProps {
  scope: TaskCenterScope;
  onScopeChange: (scope: TaskCenterScope) => void;
  /** taskCount per workspaceId for badge display. */
  workspaceTaskCounts: Map<string, number>;
  workspaceRunningCounts: Map<string, number>;
  systemRunningCount: number;
  /** Recent-run scope: count of tasks currently running (sessions + Live Apps), for the rail badge. */
  recentRunRunningCount: number;
}

const RECENT_WORKSPACE_LIMIT = 7;

const ScopeRail: React.FC<ScopeRailProps> = ({
  scope,
  onScopeChange,
  workspaceTaskCounts,
  workspaceRunningCounts,
  systemRunningCount,
  recentRunRunningCount,
}) => {
  const { t } = useI18n('common');
  const sshContext = useContext(SSHContext);
  const sshAvailable =
    typeof window !== 'undefined' &&
    '__TAURI__' in window &&
    Boolean(sshContext?.setShowConnectionDialog);

  const {
    openedWorkspacesList,
    recentWorkspaces,
    openWorkspace,
    closeWorkspaceById,
  } = useWorkspaceContext();

  const [railSearch, setRailSearch] = useState('');

  // Merged list: opened + recent (up to limit), stable order
  const workspaceOrderRef = useRef<Map<string, number>>(new Map());
  const allWorkspaces = React.useMemo(() => {
    const scope_map = new Map<string, WorkspaceInfo>();
    openedWorkspacesList.forEach((ws) => scope_map.set(ws.id, ws));
    recentWorkspaces.slice(0, RECENT_WORKSPACE_LIMIT).forEach((ws) => {
      if (!scope_map.has(ws.id)) scope_map.set(ws.id, ws);
    });
    const vals = Array.from(scope_map.values());
    const order = workspaceOrderRef.current;
    vals.forEach((ws) => {
      if (!order.has(ws.id)) order.set(ws.id, order.size);
    });
    return vals.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [openedWorkspacesList, recentWorkspaces]);

  const openedIds = React.useMemo(
    () => new Set(openedWorkspacesList.map((ws) => ws.id)),
    [openedWorkspacesList]
  );

  const filteredWorkspaces = React.useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    if (!q) return allWorkspaces;
    return allWorkspaces.filter(
      (ws) =>
        ws.name?.toLowerCase().includes(q) ||
        (ws.rootPath ?? '').toLowerCase().includes(q)
    );
  }, [allWorkspaces, railSearch]);

  const handleOpenLocal = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        await openWorkspace(selected);
      }
    } catch (e) {
      log.error('Failed to open workspace', e);
    }
  }, [openWorkspace]);

  const handleCloseWorkspace = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      try {
        await closeWorkspaceById(id);
        if (scope.kind === 'workspace' && scope.id === id) {
          onScopeChange({ kind: 'system' });
        }
      } catch (e) {
        log.error('Failed to close workspace', e);
      }
    },
    [closeWorkspaceById, scope, onScopeChange]
  );

  // Arrow-key navigation within the rail (j = down, k = up, ArrowDown/Up)
  const handleRailKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'j' && e.key !== 'k') return;
    const target = e.target as HTMLElement;
    const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (isEditable) return;

    const rail = e.currentTarget;
    const items = Array.from(
      rail.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]')
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const isDown = e.key === 'ArrowDown' || e.key === 'j';
    const next = isDown
      ? items[Math.min(idx + 1, items.length - 1)]
      : items[Math.max(idx - 1, 0)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }, []);

  return (
    <nav className="sr-rail" aria-label={t('taskDetailScene.pageTitle')} onKeyDown={handleRailKeyDown}>
      {/* Header */}
      <div className="sr-header">
        <div className="sr-header__row">
          <h1 className="sr-header__title">{t('taskDetailScene.pageTitle')}</h1>
        </div>
        <Search
          className="sr-header__search"
          size="small"
          value={railSearch}
          onChange={setRailSearch}
          placeholder={t('taskDetailScene.scope.searchPlaceholder')}
          clearable
        />
      </div>

      <div className="sr-main">
        <div className="sr-section">
          <div className="sr-section__list">
            <div
              className={['sr-system-item', 'sr-scope-global', scope.kind === 'running' && 'is-selected'].filter(Boolean).join(' ')}
              role="button"
              tabIndex={0}
              onClick={() => onScopeChange({ kind: 'running' })}
              onKeyDown={(e) => e.key === 'Enter' && onScopeChange({ kind: 'running' })}
              aria-current={scope.kind === 'running' ? 'true' : undefined}
            >
              <span className="sr-system-item__icon-wrap" aria-hidden>
                <Clock size={13} strokeWidth={2.25} />
              </span>
              <span className="sr-system-item__body">
                <span className="sr-system-item__title">{t('taskDetailScene.scope.running.title')}</span>
              </span>
              {recentRunRunningCount > 0 && (
                <span className="sr-system-item__rail-count">{recentRunRunningCount}</span>
              )}
            </div>
            <ScopeSystemItem
              isSelected={scope.kind === 'system'}
              runningCount={systemRunningCount}
              onSelect={() => onScopeChange({ kind: 'system' })}
            />
          </div>
        </div>

        {/* Workspaces section */}
        <div className="sr-section sr-section--workspaces">
          <div className="sr-section__head">
            <span className="sr-section__label">{t('taskDetailScene.scope.workspaces.label')}</span>
            <span className="sr-section__count">{filteredWorkspaces.length}</span>
            <OpenWorkspaceMenu
              onOpenLocal={handleOpenLocal}
              onOpenRemote={() => sshContext?.setShowConnectionDialog(true)}
              remoteAvailable={sshAvailable}
            />
          </div>
          <div className="sr-section__list">
            {filteredWorkspaces.length === 0 ? (
              <div className="sr-empty">
                <FolderOpen size={20} />
                <span>{t('taskDetailScene.emptyWorkspaces')}</span>
              </div>
            ) : (
              filteredWorkspaces.map((ws) => (
                <ScopeWorkspaceItem
                  key={ws.id}
                  workspace={ws}
                  isSelected={scope.kind === 'workspace' && scope.id === ws.id}
                  isOpened={openedIds.has(ws.id)}
                  taskCount={workspaceTaskCounts.get(ws.id) ?? 0}
                  runningCount={workspaceRunningCounts.get(ws.id) ?? 0}
                  onSelect={(id) => onScopeChange({ kind: 'workspace', id })}
                  onClose={handleCloseWorkspace}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default ScopeRail;
