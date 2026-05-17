/**
 * ScopeRail — left navigation rail for the Task Center.
 *
 * Shows:
 *   1. Panel header + search
 *   2. Running + global (system) task scopes in one list
 *   3. WORKSPACES section (opened + recent list)
 *   4. "+ Open workspace" menu at the bottom
 */

import React, { useCallback, useId, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Folder,
  FolderPlus,
  LayoutDashboard,
  Plus,
  X,
} from 'lucide-react';
import { Button, Search, IconButton, Tooltip } from '@/design-system';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n';
import type { WorkspaceInfo } from '@/shared/types';
import { createLogger } from '@/shared/utils/logger';
import type { TaskCenterScope } from '@/app/stores/sessionCapsuleStore';
import type { AgentKind } from '../taskCenter/agentKinds';
import './ScopeRail.scss';

const log = createLogger('ScopeRail');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceFullPath(workspace: WorkspaceInfo): string {
  return workspace.rootPath?.trim() ?? '';
}

// ── Open workspace menu (portal popover) ─────────────────────────────────────

interface OpenWorkspaceMenuProps {
  onOpenLocal: () => void;
}

const OpenWorkspaceMenu: React.FC<OpenWorkspaceMenuProps> = ({ onOpenLocal }) => {
  const { t } = useI18n('scenes/task-detail');
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
        tooltip={t('openWorkspaceMenu')}
        aria-label={t('openWorkspaceMenu')}
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
              <Button
                variant="ghost"
                size="small"
                className="sr-open-ws-popover__entry"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenLocal();
                }}
              >
                <FolderOpen size={14} className="sr-open-ws-popover__icon" aria-hidden />
                <span>{t('openWorkspaceLocal')}</span>
              </Button>
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
  const { t } = useI18n('scenes/task-detail');
  const chips: Array<{ key: AgentKind; label: string }> = [
    { key: 'liveApp', label: t('agent.liveApp.label') },
    { key: 'deepResearch', label: t('agent.deepResearch.label') },
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
        <span className="sr-system-item__title">{t('scope.system.title')}</span>
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
  const { t } = useI18n('scenes/task-detail');
  const fullPath = getWorkspaceFullPath(workspace);
  const primaryName = workspace.name?.trim() || fullPath || workspace.id;
  const showPath = isOpened && Boolean(fullPath && fullPath !== primaryName);
  const closedPathHint =
    !isOpened && fullPath && fullPath !== primaryName ? fullPath : undefined;
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
      title={closedPathHint}
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
          tooltip={t('closeWorkspace')}
          onClick={(e) => onClose(e, workspace.id)}
          aria-label={t('closeWorkspace')}
        >
          <X size={11} />
        </IconButton>
      )}
    </div>
  );

  if (isOpened) return row;

  return (
    <Tooltip content={t('workspaceNotOpenedTooltip')} placement="right">
      {row}
    </Tooltip>
  );
};

// ── Main ScopeRail ─────────────────────────────────────────────────────────────

export interface ScopeRailProps {
  scope: TaskCenterScope;
  onScopeChange: (scope: TaskCenterScope) => void;
  onQuickCreateTask: () => void;
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
  onQuickCreateTask,
  workspaceTaskCounts,
  workspaceRunningCounts,
  systemRunningCount,
  recentRunRunningCount,
}) => {
  const { t } = useI18n('scenes/task-detail');
  const {
    openedWorkspacesList,
    recentWorkspaces,
    openWorkspace,
    closeWorkspaceById,
  } = useWorkspaceContext();

  const [railSearch, setRailSearch] = useState('');
  const [closedWorkspacesExpanded, setClosedWorkspacesExpanded] = useState(false);
  const closedWorkspaceListId = useId();

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

  const filteredOpenedWorkspaces = React.useMemo(() => {
    return filteredWorkspaces.filter((ws) => openedIds.has(ws.id));
  }, [filteredWorkspaces, openedIds]);

  const filteredClosedWorkspaces = React.useMemo(() => {
    return filteredWorkspaces.filter((ws) => !openedIds.has(ws.id));
  }, [filteredWorkspaces, openedIds]);

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
      rail.querySelectorAll<HTMLElement>('button:not(:disabled), [role="button"][tabindex="0"]')
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
    <nav className="sr-rail" aria-label={t('pageTitle')} onKeyDown={handleRailKeyDown}>
      {/* Header */}
      <div className="sr-header">
        <div className="sr-header__row">
          <h1 className="sr-header__title">{t('pageTitle')}</h1>
        </div>
        <div className="sr-header__search-row">
          <Search
            className="sr-header__search"
            size="small"
            value={railSearch}
            onChange={setRailSearch}
            placeholder={t('scope.searchPlaceholder')}
            clearable
          />
          <IconButton
            size="xs"
            variant="primary"
            className="sr-header__create-action"
            tooltip={t('scope.quickCreateTask')}
            aria-label={t('scope.quickCreateTask')}
            onClick={onQuickCreateTask}
          >
            <Plus size={13} />
          </IconButton>
        </div>
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
                <span className="sr-system-item__title">{t('scope.running.title')}</span>
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
            <span className="sr-section__label">{t('scope.workspaces.label')}</span>
            <span className="sr-section__count">{filteredWorkspaces.length}</span>
            <OpenWorkspaceMenu onOpenLocal={handleOpenLocal} />
          </div>
          <div className="sr-section__list">
            {filteredWorkspaces.length === 0 ? (
              <div className="sr-empty">
                <FolderOpen size={20} />
                <span>{t('emptyWorkspaces')}</span>
              </div>
            ) : (
              <>
                {filteredOpenedWorkspaces.map((ws) => (
                  <ScopeWorkspaceItem
                    key={ws.id}
                    workspace={ws}
                    isSelected={scope.kind === 'workspace' && scope.id === ws.id}
                    isOpened
                    taskCount={workspaceTaskCounts.get(ws.id) ?? 0}
                    runningCount={workspaceRunningCounts.get(ws.id) ?? 0}
                    onSelect={(id) => onScopeChange({ kind: 'workspace', id })}
                    onClose={handleCloseWorkspace}
                  />
                ))}
                {filteredClosedWorkspaces.length > 0 && (
                  <div
                    className={[
                      'sr-ws-closed-block',
                      filteredOpenedWorkspaces.length > 0 && 'sr-ws-closed-block--spaced',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Button
                      variant="ghost"
                      size="small"
                      className="sr-ws-closed-block__toggle"
                      aria-expanded={closedWorkspacesExpanded}
                      aria-controls={closedWorkspaceListId}
                      title={
                        closedWorkspacesExpanded
                          ? t('scope.workspaces.closedSectionCollapse')
                          : t('scope.workspaces.closedSectionExpand')
                      }
                      onClick={() => setClosedWorkspacesExpanded((v) => !v)}
                    >
                      <span className="sr-ws-closed-block__chevron" aria-hidden>
                        {closedWorkspacesExpanded ? (
                          <ChevronDown size={14} strokeWidth={2.25} />
                        ) : (
                          <ChevronRight size={14} strokeWidth={2.25} />
                        )}
                      </span>
                      <span className="sr-ws-closed-block__label">
                        {t('scope.workspaces.closedSection')}
                      </span>
                      <span className="sr-ws-closed-block__count">{filteredClosedWorkspaces.length}</span>
                    </Button>
                    <div
                      id={closedWorkspaceListId}
                      className="sr-ws-closed-block__list"
                      hidden={!closedWorkspacesExpanded}
                    >
                      {closedWorkspacesExpanded
                        ? filteredClosedWorkspaces.map((ws) => (
                            <ScopeWorkspaceItem
                              key={ws.id}
                              workspace={ws}
                              isSelected={scope.kind === 'workspace' && scope.id === ws.id}
                              isOpened={false}
                              taskCount={workspaceTaskCounts.get(ws.id) ?? 0}
                              runningCount={workspaceRunningCounts.get(ws.id) ?? 0}
                              onSelect={(id) => onScopeChange({ kind: 'workspace', id })}
                              onClose={handleCloseWorkspace}
                            />
                          ))
                        : null}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default ScopeRail;
