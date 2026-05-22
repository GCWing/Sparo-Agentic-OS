import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Pin,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import { Button, EmptyState, IconButton, Input, SegmentedControl } from '@/design-system';
import FilesPanel from '../../components/panels/FilesPanel';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { CanvasStoreModeContext } from '../../components/panels/content-canvas/stores';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import { agentAppAPI, type AgentAppInfo } from '@/infrastructure/api/service-api/AgentAppAPI';
import {
  filesContextAPI,
  pinnedAPI,
  systemFsAPI,
  type DriveInfo,
  type FilesContext,
  type FsEntry,
  type PinnedPath,
  type QuickFolder,
} from '@/infrastructure/api';
import {
  workspaceManager,
  type WorkspaceEvent,
} from '@/infrastructure/services/business/workspaceManager';
import type { WorkspaceInfo } from '@/shared/types';
import { createLogger } from '@/shared/utils/logger';
import './FileViewerScene.scss';

const log = createLogger('SparoFilesScene');

type PaneMode = 'workspace' | 'browser' | 'home';
type ViewMode = 'list' | 'grid';

const VIEW_MODE_STORAGE_KEY = 'sparo.files.viewMode';

interface FileViewerSceneProps {
  workspacePath?: string;
}

const OFFICIAL_FILES_APPS = [
  {
    id: 'files.downloads-tidy',
    name: 'Downloads Tidy',
    description: 'Group downloads by type and age, with a preview-first cleanup plan.',
    prompt: 'Help me tidy the current downloads or selected folder. Start with a preview plan before moving files.',
  },
  {
    id: 'files.batch-renamer',
    name: 'Batch Renamer',
    description: 'Rename selected files with a consistent pattern and reversible plan.',
    prompt: 'Help me batch rename the selected files. Propose the mapping before making changes.',
  },
];

interface FilesAppLauncher {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agentType: string;
}

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return path.includes(':') ? path.slice(0, 3) : '/';
  return normalized.slice(0, idx);
}

function fileKindFromEntry(entry: FsEntry): 'file' | 'dir' {
  return entry.kind === 'dir' ? 'dir' : 'file';
}

function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatModified(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Crumb {
  label: string;
  path: string;
}

function buildBreadcrumbs(currentPath: string): Crumb[] {
  if (!currentPath) return [];
  const isWindows = /^[A-Za-z]:/.test(currentPath);
  const parts = currentPath.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return [];
  return parts.map((label, index) => {
    if (isWindows) {
      const joined = parts.slice(0, index + 1).join('\\');
      return { label, path: index === 0 ? `${joined}\\` : joined };
    }
    return { label, path: '/' + parts.slice(0, index + 1).join('/') };
  });
}

function workspaceInitial(name: string): string {
  const cleaned = (name || '?').trim();
  if (!cleaned) return '?';
  const match = cleaned.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : cleaned[0]).toUpperCase();
}

const FileViewerScene: React.FC<FileViewerSceneProps> = ({ workspacePath }) => {
  const { t } = useTranslation('scenes/files');
  const containerRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PaneMode>(workspacePath ? 'workspace' : 'home');
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [quickFolders, setQuickFolders] = useState<QuickFolder[]>([]);
  const [pinned, setPinned] = useState<PinnedPath[]>([]);
  const [agentApps, setAgentApps] = useState<AgentAppInfo[]>([]);
  const [currentPath, setCurrentPath] = useState(workspacePath || '');
  const [systemEntries, setSystemEntries] = useState<FsEntry[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<FsEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pathDraft, setPathDraft] = useState(workspacePath || '');
  const [editingAddress, setEditingAddress] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'grid' ? 'grid' : 'list';
  });
  const [loadingPath, setLoadingPath] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FsEntry;
  } | null>(null);

  const selectedContext = useMemo<FilesContext>(() => ({
    scope: mode === 'workspace' ? 'workspace' : 'system',
    cwd: currentPath || workspacePath || '',
    workspaceRoot: mode === 'workspace' ? workspacePath : undefined,
    selection: selectedEntries.map((entry) => ({
      path: entry.path,
      kind: fileKindFromEntry(entry),
      size: entry.size,
    })),
    recentlyOpenedPaths: history.slice(-5),
  }), [currentPath, history, mode, selectedEntries, workspacePath]);

  const refreshWorkspaceState = useCallback(() => {
    const state = workspaceManager.getState();
    setWorkspaces(Array.from(state.openedWorkspaces.values()));
    setRecentWorkspaces(state.recentWorkspaces);
    setActiveWorkspace(state.lastUsedWorkspace);
  }, []);

  const refreshSystemRoots = useCallback(async () => {
    const [nextDrives, nextQuickFolders, pinnedState, apps] = await Promise.all([
      systemFsAPI.listDrives().catch((err) => {
        log.warn('Failed to list drives', { err });
        return [];
      }),
      systemFsAPI.listQuickFolders().catch(() => []),
      pinnedAPI.list().catch(() => ({ paths: [], grantedRoots: [] })),
      agentAppAPI.listAgentApps(workspacePath).catch(() => []),
    ]);
    setDrives(nextDrives);
    setQuickFolders(nextQuickFolders);
    setPinned(pinnedState.paths);
    setAgentApps(apps.filter((app) => app.category === 'files'));
  }, [workspacePath]);

  const openSystemPath = useCallback(async (path: string, pushHistory = true) => {
    const nextPath = path.trim();
    if (!nextPath) return;
    setMode('browser');
    setLoadingPath(true);
    setError(null);
    try {
      const entries = await systemFsAPI.listDir(nextPath);
      setCurrentPath(nextPath);
      setPathDraft(nextPath);
      setSystemEntries(entries);
      setSelectedEntries([]);
      setEditingAddress(false);
      if (pushHistory) {
        setHistory((previous) => {
          const clipped = historyIndex >= 0 ? previous.slice(0, historyIndex + 1) : previous;
          const next = [...clipped, nextPath];
          setHistoryIndex(next.length - 1);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPath(false);
    }
  }, [historyIndex]);

  useEffect(() => {
    refreshWorkspaceState();
    void refreshSystemRoots();
    const remove = workspaceManager.addEventListener((_event: WorkspaceEvent) => {
      refreshWorkspaceState();
    });
    return remove;
  }, [refreshSystemRoots, refreshWorkspaceState]);

  useEffect(() => {
    if (workspacePath && !currentPath) {
      setCurrentPath(workspacePath);
      setPathDraft(workspacePath);
    }
  }, [currentPath, workspacePath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (editingAddress) {
      const id = window.requestAnimationFrame(() => {
        addressInputRef.current?.focus();
        addressInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [editingAddress]);

  const handleSwitchWorkspace = useCallback(async (workspace: WorkspaceInfo) => {
    await workspaceManager.switchWorkspace(workspace);
    setMode('workspace');
    setCurrentPath(workspace.rootPath);
    setPathDraft(workspace.rootPath);
  }, []);

  const handleBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    void openSystemPath(history[nextIndex], false);
  }, [history, historyIndex, openSystemPath]);

  const handleForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    void openSystemPath(history[nextIndex], false);
  }, [history, historyIndex, openSystemPath]);

  const handleUp = useCallback(() => {
    if (!currentPath) return;
    void openSystemPath(dirname(currentPath));
  }, [currentPath, openSystemPath]);

  const handleRefreshPath = useCallback(() => {
    if (mode === 'browser' && currentPath) {
      void openSystemPath(currentPath, false);
    } else {
      void refreshSystemRoots();
    }
  }, [currentPath, mode, openSystemPath, refreshSystemRoots]);

  const handleAddressKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPathDraft(currentPath);
      setEditingAddress(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const value = pathDraft.trim();
    if (!value) return;
    const baseDir = dirname(value);
    const partial = basename(value).toLowerCase();
    const match = systemEntries.find((entry) => (
      entry.path.startsWith(baseDir) && entry.name.toLowerCase().startsWith(partial)
    ));
    if (!match) return;
    event.preventDefault();
    setPathDraft(match.path);
  }, [currentPath, pathDraft, systemEntries]);

  const startFilesSession = useCallback(async (agentType: string, prompt: string) => {
    const manager = FlowChatManager.getInstance();
    const sessionId = await manager.createChatSession({
      workspacePath: workspacePath || activeWorkspace?.rootPath || currentPath,
    }, agentType);
    await filesContextAPI.stash(sessionId, selectedContext);
    await manager.sendMessage(prompt, sessionId, prompt, agentType, agentType);
  }, [activeWorkspace?.rootPath, currentPath, selectedContext, workspacePath]);

  const handleAskSparo = useCallback(() => {
    void startFilesSession(
      'agentic',
      `Use the current Files context to help with this location: ${selectedContext.cwd}`
    );
  }, [selectedContext.cwd, startFilesSession]);

  const handleFilesAgent = useCallback((entry?: FsEntry) => {
    const target = entry?.path || selectedEntries.map((item) => item.path).join(', ') || selectedContext.cwd;
    void startFilesSession(
      'Files',
      `Help me reason about and operate on this file selection: ${target}`
    );
  }, [selectedContext.cwd, selectedEntries, startFilesSession]);

  const handleRevealEntry = useCallback(async (entry: FsEntry) => {
    await systemFsAPI.revealInOs(entry.path);
  }, []);

  const isCurrentPinned = useMemo(
    () => currentPath ? pinned.some((p) => p.path === currentPath) : false,
    [currentPath, pinned],
  );

  const handleTogglePin = useCallback(async () => {
    if (!currentPath) return;
    if (isCurrentPinned) {
      const entry = pinned.find((p) => p.path === currentPath);
      if (entry) await pinnedAPI.remove(entry.id);
    } else {
      await pinnedAPI.add(currentPath, basename(currentPath));
    }
    const next = await pinnedAPI.list();
    setPinned(next.paths);
  }, [currentPath, isCurrentPinned, pinned]);

  const filesApps: FilesAppLauncher[] = agentApps.length > 0
    ? agentApps.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      prompt: app.examples[0]?.prompt || `Run ${app.name} for the current Files context.`,
      agentType: app.id,
    }))
    : OFFICIAL_FILES_APPS.map((app) => ({
      ...app,
      agentType: 'Files',
    }));

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [contextMenu]);

  const sidebarWorkspaces = recentWorkspaces.length > 0 ? recentWorkspaces : workspaces;
  const breadcrumbs = useMemo(() => buildBreadcrumbs(currentPath), [currentPath]);

  const sortedEntries = useMemo(() => (
    [...systemEntries]
      .filter((entry) => !entry.hidden)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
  ), [systemEntries]);

  const renderSection = (
    key: string,
    title: string,
    children: React.ReactNode,
    count?: number,
  ) => (
    <section key={key} className="sparo-files-scene__section">
      <header className="sparo-files-scene__section-title">
        <span>{title}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="sparo-files-scene__section-count">{count}</span>
        )}
      </header>
      <div className="sparo-files-scene__section-body">{children}</div>
    </section>
  );

  const renderAddressBar = () => (
    <div className="sparo-files-scene__address">
      {editingAddress ? (
        <form
          className="sparo-files-scene__address-form"
          onSubmit={(event) => {
            event.preventDefault();
            void openSystemPath(pathDraft);
          }}
        >
          <Input
            ref={addressInputRef}
            variant="filled"
            size="small"
            value={pathDraft}
            prefix={<Folder size={13} />}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={handleAddressKeyDown}
            onBlur={() => setEditingAddress(false)}
            placeholder={t('address.placeholder')}
            spellCheck={false}
          />
        </form>
      ) : (
        <button
          type="button"
          className="sparo-files-scene__breadcrumbs"
          onClick={() => {
            setPathDraft(currentPath);
            setEditingAddress(true);
          }}
          aria-label={t('address.placeholder')}
        >
          <Folder size={13} className="sparo-files-scene__breadcrumb-leading" />
          {breadcrumbs.length === 0 ? (
            <span className="sparo-files-scene__breadcrumb-placeholder">
              {t('address.placeholder')}
            </span>
          ) : (
            breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.path}>
                  <span
                    className={
                      isLast
                        ? 'sparo-files-scene__breadcrumb sparo-files-scene__breadcrumb--current'
                        : 'sparo-files-scene__breadcrumb'
                    }
                    onClick={(event) => {
                      if (isLast) return;
                      event.stopPropagation();
                      void openSystemPath(crumb.path);
                    }}
                  >
                    {crumb.label}
                  </span>
                  {!isLast && (
                    <ChevronRight size={11} className="sparo-files-scene__breadcrumb-sep" />
                  )}
                </React.Fragment>
              );
            })
          )}
          <Pencil size={11} className="sparo-files-scene__breadcrumb-edit" />
        </button>
      )}
    </div>
  );

  return (
    <CanvasStoreModeContext.Provider value="project">
      <div ref={containerRef} className="sparo-files-scene">
        <aside className="sparo-files-scene__sidebar" aria-label={t('activity.aria')}>
          <header className="sparo-files-scene__sidebar-header">
            <div className="sparo-files-scene__brand">
              <span className="sparo-files-scene__brand-mark">
                <Sparkles size={13} />
              </span>
              <span className="sparo-files-scene__brand-text">{t('brand')}</span>
            </div>
            <IconButton
              aria-label={t('actions.refresh')}
              tooltip={t('actions.refresh')}
              size="small"
              variant="ghost"
              onClick={() => void refreshSystemRoots()}
            >
              <RefreshCw size={13} />
            </IconButton>
          </header>

          <div className="sparo-files-scene__sidebar-scroll">
            {sidebarWorkspaces.length > 0 && renderSection('workspaces', t('activity.workspaces'),
              sidebarWorkspaces.slice(0, 8).map((workspace) => {
                const isActive = mode === 'workspace' && activeWorkspace?.id === workspace.id;
                return (
                  <button
                    key={workspace.id}
                    className={isActive ? 'sparo-files-scene__row is-active' : 'sparo-files-scene__row'}
                    onClick={() => void handleSwitchWorkspace(workspace)}
                    title={workspace.rootPath}
                  >
                    <span className="sparo-files-scene__avatar" aria-hidden>
                      {workspaceInitial(workspace.name)}
                    </span>
                    <span className="sparo-files-scene__row-text">
                      <strong>{workspace.name}</strong>
                      <small>{workspace.rootPath}</small>
                    </span>
                  </button>
                );
              }),
            )}

            {quickFolders.length > 0 && renderSection('quick', t('system.quickFolders'),
              quickFolders.map((folder) => (
                <button
                  key={folder.id}
                  className="sparo-files-scene__row sparo-files-scene__row--compact"
                  onClick={() => void openSystemPath(folder.path)}
                  title={folder.path}
                >
                  <Folder size={13} />
                  <span className="sparo-files-scene__row-text">
                    <strong>{folder.name}</strong>
                  </span>
                </button>
              )),
            )}

            {drives.length > 0 && renderSection('drives', t('system.drives'),
              drives.map((drive) => (
                <button
                  key={drive.id}
                  className="sparo-files-scene__row sparo-files-scene__row--compact"
                  onClick={() => void openSystemPath(drive.mount)}
                  title={drive.mount}
                >
                  <HardDrive size={13} />
                  <span className="sparo-files-scene__row-text">
                    <strong>{drive.label || drive.mount}</strong>
                    <small>{drive.mount}</small>
                  </span>
                </button>
              )),
            )}

            {pinned.length > 0 && renderSection('pinned', t('activity.pinned'),
              pinned.map((item) => (
                <button
                  key={item.id}
                  className="sparo-files-scene__row sparo-files-scene__row--compact"
                  onClick={() => void openSystemPath(item.kind === 'dir' ? item.path : dirname(item.path))}
                  title={item.path}
                >
                  <Star size={13} />
                  <span className="sparo-files-scene__row-text">
                    <strong>{item.label || basename(item.path)}</strong>
                    <small>{item.path}</small>
                  </span>
                </button>
              )),
              pinned.length,
            )}

            {filesApps.length > 0 && renderSection('apps', t('home.filesApps'),
              filesApps.map((app) => (
                <button
                  key={app.id}
                  className="sparo-files-scene__row sparo-files-scene__row--app"
                  onClick={() => void startFilesSession(app.agentType, app.prompt)}
                  title={app.description}
                >
                  <span className="sparo-files-scene__app-tile" aria-hidden>
                    <Bot size={13} />
                  </span>
                  <span className="sparo-files-scene__row-text">
                    <strong>{app.name}</strong>
                    <small>{app.description}</small>
                  </span>
                </button>
              )),
            )}
          </div>
        </aside>

        <main className="sparo-files-scene__main">
          <div className="sparo-files-scene__topbar">
            <div className="sparo-files-scene__nav">
              <IconButton
                aria-label={t('actions.back')}
                tooltip={t('actions.back')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || historyIndex <= 0}
                onClick={handleBack}
              >
                <ArrowLeft size={14} />
              </IconButton>
              <IconButton
                aria-label={t('actions.forward')}
                tooltip={t('actions.forward')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || historyIndex >= history.length - 1}
                onClick={handleForward}
              >
                <ArrowRight size={14} />
              </IconButton>
              <IconButton
                aria-label={t('actions.up')}
                tooltip={t('actions.up')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || !currentPath}
                onClick={handleUp}
              >
                <ArrowUp size={14} />
              </IconButton>
            </div>

            {renderAddressBar()}

            <div className="sparo-files-scene__topbar-actions">
              {mode === 'browser' && (
                <SegmentedControl
                  size="small"
                  ariaLabel={t('view.aria')}
                  value={viewMode}
                  onChange={(next) => setViewMode(next as ViewMode)}
                  options={[
                    { value: 'list', icon: <ListIcon size={13} />, label: '' },
                    { value: 'grid', icon: <LayoutGrid size={13} />, label: '' },
                  ]}
                />
              )}
              <IconButton
                aria-label={t('actions.refresh')}
                tooltip={t('actions.refresh')}
                size="small"
                variant="ghost"
                onClick={handleRefreshPath}
              >
                <RefreshCw size={13} />
              </IconButton>
              <IconButton
                aria-label={t('actions.pin')}
                tooltip={t('actions.pin')}
                size="small"
                variant={isCurrentPinned ? 'accent' : 'ghost'}
                disabled={!currentPath}
                onClick={() => void handleTogglePin()}
              >
                <Pin size={13} />
              </IconButton>
              <Button size="small" onClick={handleAskSparo}>
                <Bot size={13} />
                {t('actions.ask')}
              </Button>
            </div>
          </div>

          <div className="sparo-files-scene__surface">
            {mode === 'workspace' ? (
              <div className="sparo-files-scene__workspace-pane">
                <div className="sparo-files-scene__split">
                  <div className="sparo-files-scene__project-files">
                    <FilesPanel workspacePath={workspacePath} hideHeader />
                  </div>
                  <ContentCanvas workspacePath={workspacePath} mode="project" />
                </div>
              </div>
            ) : mode === 'home' ? (
              <div className="sparo-files-scene__home">
                <div className="sparo-files-scene__home-hero">
                  <div className="sparo-files-scene__hero-halo" aria-hidden />
                  <EmptyState
                    image={
                      <span className="sparo-files-scene__hero-mark">
                        <Sparkles size={26} strokeWidth={1.5} />
                      </span>
                    }
                    imageSize="small"
                    title={t('home.welcomeTitle')}
                    description={t('home.welcomeDescription')}
                  />
                </div>
                {filesApps.length > 0 && (
                  <div className="sparo-files-scene__app-grid">
                    {filesApps.map((app) => (
                      <button
                        key={app.id}
                        className="sparo-files-scene__app-card"
                        onClick={() => void startFilesSession(app.agentType, app.prompt)}
                      >
                        <span className="sparo-files-scene__app-card-icon" aria-hidden>
                          <Bot size={16} />
                        </span>
                        <span className="sparo-files-scene__app-card-body">
                          <strong>{app.name}</strong>
                          <small>{app.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="sparo-files-scene__browser">
                {error && <div className="sparo-files-scene__error">{error}</div>}
                {loadingPath ? (
                  <div className="sparo-files-scene__empty">{t('browser.loading')}</div>
                ) : sortedEntries.length === 0 ? (
                  <div className="sparo-files-scene__empty">{t('browser.noPath')}</div>
                ) : viewMode === 'grid' ? (
                  <ul className="sparo-files-scene__entry-grid" role="listbox">
                    {sortedEntries.map((entry) => {
                      const isSelected = selectedEntries.some((item) => item.path === entry.path);
                      return (
                        <li
                          key={entry.path}
                          className={isSelected ? 'sparo-files-scene__tile is-selected' : 'sparo-files-scene__tile'}
                          role="option"
                          aria-selected={isSelected}
                          title={entry.name}
                          onClick={() => setSelectedEntries([entry])}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setSelectedEntries([entry]);
                            setContextMenu({ x: event.clientX, y: event.clientY, entry });
                          }}
                          onDoubleClick={() => entry.kind === 'dir'
                            ? void openSystemPath(entry.path)
                            : void systemFsAPI.openWithDefault(entry.path)}
                        >
                          <span className="sparo-files-scene__tile-thumb" data-kind={entry.kind}>
                            {entry.kind === 'dir' ? <Folder size={40} strokeWidth={1.4} /> : <FileIcon size={36} strokeWidth={1.4} />}
                          </span>
                          <span className="sparo-files-scene__tile-name">{entry.name}</span>
                          <span className="sparo-files-scene__tile-meta">
                            {entry.kind === 'dir' ? t('browser.folder') : formatSize(entry.size)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="sparo-files-scene__entry-table">
                    <div className="sparo-files-scene__entry-head" role="row">
                      <span>{t('columns.name')}</span>
                      <span>{t('columns.modified')}</span>
                      <span>{t('columns.size')}</span>
                    </div>
                    <ul className="sparo-files-scene__entry-list" role="listbox">
                      {sortedEntries.map((entry) => {
                        const isSelected = selectedEntries.some((item) => item.path === entry.path);
                        return (
                          <li
                            key={entry.path}
                            className={isSelected ? 'sparo-files-scene__entry is-selected' : 'sparo-files-scene__entry'}
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => setSelectedEntries([entry])}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setSelectedEntries([entry]);
                              setContextMenu({ x: event.clientX, y: event.clientY, entry });
                            }}
                            onDoubleClick={() => entry.kind === 'dir'
                              ? void openSystemPath(entry.path)
                              : void systemFsAPI.openWithDefault(entry.path)}
                          >
                            <span className="sparo-files-scene__entry-name-cell">
                              <span className="sparo-files-scene__entry-icon" data-kind={entry.kind}>
                                {entry.kind === 'dir' ? <Folder size={14} /> : <FileIcon size={14} />}
                              </span>
                              <span className="sparo-files-scene__entry-name">{entry.name}</span>
                            </span>
                            <span className="sparo-files-scene__entry-meta">
                              {formatModified(entry.modified)}
                            </span>
                            <span className="sparo-files-scene__entry-meta sparo-files-scene__entry-meta--size">
                              {entry.kind === 'dir' ? '—' : formatSize(entry.size)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="sparo-files-scene__status">
                  <span>{t('status.items', { count: sortedEntries.length })}</span>
                  {selectedEntries.length > 0 && (
                    <span>{t('status.selected', { count: selectedEntries.length })}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        {contextMenu && (
          <div
            className="sparo-files-scene__context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
          >
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              contextMenu.entry.kind === 'dir'
                ? void openSystemPath(contextMenu.entry.path)
                : void systemFsAPI.openWithDefault(contextMenu.entry.path);
            }}>
              <ExternalLink size={13} />
              {t('context.open')}
            </button>
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              void handleFilesAgent(contextMenu.entry);
            }}>
              <Bot size={13} />
              {t('context.ask')}
            </button>
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              void handleRevealEntry(contextMenu.entry);
            }}>
              <Folder size={13} />
              {t('context.reveal')}
            </button>
            <button role="menuitem" onClick={async () => {
              await pinnedAPI.add(contextMenu.entry.path, contextMenu.entry.name);
              const next = await pinnedAPI.list();
              setPinned(next.paths);
              setContextMenu(null);
            }}>
              <Pin size={13} />
              {t('context.pin')}
            </button>
          </div>
        )}
      </div>
    </CanvasStoreModeContext.Provider>
  );
};

export default FileViewerScene;
