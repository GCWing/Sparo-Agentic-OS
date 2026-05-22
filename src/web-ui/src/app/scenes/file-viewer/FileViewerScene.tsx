import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronRight,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderUp,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import { Button, EmptyState, IconButton, Input, SegmentedControl } from '@/design-system';
import FilesPanel from '../../components/panels/FilesPanel';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { CanvasStoreModeContext } from '../../components/panels/content-canvas/stores';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import {
  filesContextAPI,
  pinnedAPI,
  systemFsAPI,
  workspaceAPI,
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
import { isImageFile } from '@/infrastructure/language-detection';
import type { WorkspaceInfo } from '@/shared/types';
import { createLogger } from '@/shared/utils/logger';
import './FileViewerScene.scss';

const log = createLogger('SparoFilesScene');

type PaneMode = 'workspace' | 'browser' | 'home';
type ViewMode = 'list' | 'grid';

const VIEW_MODE_STORAGE_KEY = 'sparo.files.viewMode';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sparo.files.sidebarCollapsed';
const PROJECT_FILES_WIDTH_STORAGE_KEY = 'sparo.files.projectFilesWidth';
const DEFAULT_PROJECT_FILES_WIDTH = 300;
const MIN_PROJECT_FILES_WIDTH = 220;
const MAX_PROJECT_FILES_WIDTH = 560;
const MIN_CONTENT_CANVAS_WIDTH = 320;
const MAX_INLINE_THUMBNAIL_BYTES = 8 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

interface FileViewerSceneProps {
  workspacePath?: string;
}

const FILER_AGENT_TYPE = 'Filer';

// Starter prompts for the single general-purpose Filer agent. These are not separate
// apps — each one launches Filer with a different intent. The current location and
// selection travel to the agent via the stashed FilesContext, so prompts stay generic.
const FILER_SUGGESTIONS = ['organize', 'duplicates', 'space', 'summarize'] as const;

type FilerSuggestionId = (typeof FILER_SUGGESTIONS)[number];

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

function imageMimeTypeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return IMAGE_MIME_TYPES[ext] || 'image/*';
}

function isProbablyBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function toBase64Content(content: string): string {
  if (isProbablyBase64(content)) {
    return content;
  }

  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDriveName(drive: DriveInfo): string {
  return (drive.label || drive.mount).trim() || drive.mount;
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

function loadProjectFilesWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_PROJECT_FILES_WIDTH;
  const stored = window.localStorage.getItem(PROJECT_FILES_WIDTH_STORAGE_KEY);
  const parsed = stored ? Number.parseInt(stored, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_PROJECT_FILES_WIDTH;
  return Math.min(MAX_PROJECT_FILES_WIDTH, Math.max(MIN_PROJECT_FILES_WIDTH, parsed));
}

function persistProjectFilesWidth(width: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROJECT_FILES_WIDTH_STORAGE_KEY, String(width));
}

interface FileTileThumbnailProps {
  entry: FsEntry;
}

const FileTileThumbnail: React.FC<FileTileThumbnailProps> = ({ entry }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const shouldPreviewImage = entry.kind !== 'dir'
    && isImageFile(entry.name)
    && (!entry.size || entry.size <= MAX_INLINE_THUMBNAIL_BYTES);

  useEffect(() => {
    let cancelled = false;

    if (!shouldPreviewImage) {
      setImageUrl(null);
      setFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setImageUrl(null);
    setFailed(false);

    workspaceAPI.readFileContent(entry.path)
      .then((content) => {
        if (cancelled) return;
        setImageUrl(`data:${imageMimeTypeFromPath(entry.path)};base64,${toBase64Content(content)}`);
      })
      .catch((error) => {
        if (cancelled) return;
        log.debug('Failed to load file tile thumbnail', { path: entry.path, error });
        setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [entry.kind, entry.name, entry.path, entry.size, shouldPreviewImage]);

  if (shouldPreviewImage && imageUrl && !failed) {
    return (
      <span className="sparo-files-scene__tile-thumb is-image" data-kind="file">
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className="sparo-files-scene__tile-thumb" data-kind={entry.kind}>
      {entry.kind === 'dir' ? <Folder size={40} strokeWidth={1.4} /> : <FileIcon size={36} strokeWidth={1.4} />}
    </span>
  );
};

const FileViewerScene: React.FC<FileViewerSceneProps> = ({ workspacePath }) => {
  const { t } = useTranslation('scenes/files');
  const { t: tFlowChat } = useTranslation('flow-chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceSplitRef = useRef<HTMLDivElement>(null);
  const projectFilesPaneRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<PaneMode>(workspacePath ? 'workspace' : 'home');
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [quickFolders, setQuickFolders] = useState<QuickFolder[]>([]);
  const [pinned, setPinned] = useState<PinnedPath[]>([]);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  });
  const [projectFilesWidth, setProjectFilesWidth] = useState(loadProjectFilesWidth);
  const [isProjectFilesResizing, setIsProjectFilesResizing] = useState(false);
  const [isProjectFilesResizerHovering, setIsProjectFilesResizerHovering] = useState(false);
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
    const [nextDrives, nextQuickFolders, pinnedState] = await Promise.all([
      systemFsAPI.listDrives().catch((err) => {
        log.warn('Failed to list drives', { err });
        return [];
      }),
      systemFsAPI.listQuickFolders().catch(() => []),
      pinnedAPI.list().catch(() => ({ paths: [], grantedRoots: [] })),
    ]);
    setDrives(nextDrives);
    setQuickFolders(nextQuickFolders);
    setPinned(pinnedState.paths);
  }, []);

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
    const remove = workspaceManager.addEventListener((_event: WorkspaceEvent) => {
      refreshWorkspaceState();
    });
    // Ensure workspace state is loaded — initialize() is idempotent, so this is a
    // no-op when the main app has already initialized, but it populates the list
    // when the Files scene mounts in a context that hasn't (e.g. a standalone window).
    void workspaceManager.initialize().then(refreshWorkspaceState);
    refreshWorkspaceState();
    void refreshSystemRoots();
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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const calculateValidProjectFilesWidth = useCallback((width: number): number => {
    const splitWidth = workspaceSplitRef.current?.offsetWidth ?? 0;
    if (splitWidth <= 0) {
      return Math.min(MAX_PROJECT_FILES_WIDTH, Math.max(MIN_PROJECT_FILES_WIDTH, width));
    }
    const maxAllowed = Math.max(
      MIN_PROJECT_FILES_WIDTH,
      splitWidth - MIN_CONTENT_CANVAS_WIDTH - 1,
    );
    const cap = Math.min(MAX_PROJECT_FILES_WIDTH, maxAllowed);
    return Math.min(cap, Math.max(MIN_PROJECT_FILES_WIDTH, width));
  }, []);

  const saveProjectFilesWidth = useCallback((width: number) => {
    const valid = calculateValidProjectFilesWidth(width);
    setProjectFilesWidth(valid);
    persistProjectFilesWidth(valid);
  }, [calculateValidProjectFilesWidth]);

  useEffect(() => {
    const validateProjectFilesWidth = () => {
      setProjectFilesWidth((previous) => {
        const valid = calculateValidProjectFilesWidth(previous);
        if (valid !== previous) {
          persistProjectFilesWidth(valid);
        }
        return valid;
      });
    };

    const rafId = window.requestAnimationFrame(validateProjectFilesWidth);
    window.addEventListener('resize', validateProjectFilesWidth);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', validateProjectFilesWidth);
    };
  }, [calculateValidProjectFilesWidth]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

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

  const handleProjectFilesResizerMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (!workspaceSplitRef.current) return;

    const startX = event.clientX;
    const startWidth = projectFilesWidth;
    let lastValidWidth = startWidth;

    setIsProjectFilesResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = window.requestAnimationFrame(() => {
        lastValidWidth = calculateValidProjectFilesWidth(startWidth + (moveEvent.clientX - startX));
        if (projectFilesPaneRef.current) {
          projectFilesPaneRef.current.style.width = `${lastValidWidth}px`;
        } else {
          setProjectFilesWidth(lastValidWidth);
        }
        animationFrameRef.current = null;
      });
    };

    const onUp = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      saveProjectFilesWidth(lastValidWidth);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsProjectFilesResizing(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [calculateValidProjectFilesWidth, projectFilesWidth, saveProjectFilesWidth]);

  const handleProjectFilesResizerDoubleClick = useCallback(() => {
    saveProjectFilesWidth(DEFAULT_PROJECT_FILES_WIDTH);
  }, [saveProjectFilesWidth]);

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
      FILER_AGENT_TYPE,
      `Help me with this location: ${selectedContext.cwd}`
    );
  }, [selectedContext.cwd, startFilesSession]);

  const handleFilesAgent = useCallback((entry?: FsEntry) => {
    const target = entry?.path || selectedEntries.map((item) => item.path).join(', ') || selectedContext.cwd;
    void startFilesSession(
      FILER_AGENT_TYPE,
      `Help me reason about and operate on this file selection: ${target}`
    );
  }, [selectedContext.cwd, selectedEntries, startFilesSession]);

  const handleFilerSuggestion = useCallback((id: FilerSuggestionId) => {
    void startFilesSession(FILER_AGENT_TYPE, t(`suggestions.${id}.prompt`));
  }, [startFilesSession, t]);

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

  const currentDrive = useMemo(() => {
    if (!currentPath || drives.length === 0) return null;
    const lowerPath = currentPath.toLowerCase();
    return [...drives]
      .filter((drive) => lowerPath.startsWith(drive.mount.toLowerCase()))
      .sort((a, b) => b.mount.length - a.mount.length)[0] ?? null;
  }, [currentPath, drives]);

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
      <div
        ref={containerRef}
        className={[
          'sparo-files-scene',
          sidebarCollapsed && 'is-sidebar-collapsed',
          isProjectFilesResizing && 'is-project-files-resizing',
        ].filter(Boolean).join(' ')}
      >
        <aside className="sparo-files-scene__sidebar" aria-label={t('activity.aria')}>
          <header className="sparo-files-scene__sidebar-header">
            <span className="sparo-files-scene__brand-text">{t('brand')}</span>
            <IconButton
              aria-label={t('actions.collapseSidebar')}
              tooltip={t('actions.collapseSidebar')}
              size="small"
              variant="ghost"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose size={14} />
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
                    <strong>{formatDriveName(drive)}</strong>
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
          </div>
        </aside>

        <main className="sparo-files-scene__main">
          <div className="sparo-files-scene__topbar">
            {sidebarCollapsed && (
              <IconButton
                aria-label={t('actions.expandSidebar')}
                tooltip={t('actions.expandSidebar')}
                size="small"
                variant="ghost"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={14} />
              </IconButton>
            )}
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
                <FolderUp size={14} />
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
                variant="ghost"
                disabled={!currentPath}
                onClick={() => void handleTogglePin()}
              >
                <Star
                  size={13}
                  className={isCurrentPinned ? 'sparo-files-scene__pin-icon is-active' : 'sparo-files-scene__pin-icon'}
                  fill={isCurrentPinned ? 'currentColor' : 'none'}
                />
              </IconButton>
              <Button size="small" onClick={handleAskSparo} disabled={mode === 'home' || !selectedContext.cwd}>
                {t('actions.ask')}
              </Button>
            </div>
          </div>

          <div className="sparo-files-scene__surface">
            {mode === 'workspace' ? (
              <div className="sparo-files-scene__workspace-pane">
                <div ref={workspaceSplitRef} className="sparo-files-scene__split">
                  <div
                    ref={projectFilesPaneRef}
                    className="sparo-files-scene__project-files"
                    style={{ width: projectFilesWidth }}
                  >
                    <FilesPanel workspacePath={workspacePath} hideHeader />
                  </div>
                  <div
                    className={[
                      'sparo-pane-resizer',
                      isProjectFilesResizing && 'sparo-pane-resizer--dragging',
                      isProjectFilesResizerHovering && 'sparo-pane-resizer--hovering',
                    ].filter(Boolean).join(' ')}
                    onMouseDown={handleProjectFilesResizerMouseDown}
                    onDoubleClick={handleProjectFilesResizerDoubleClick}
                    onMouseEnter={() => setIsProjectFilesResizerHovering(true)}
                    onMouseLeave={() => setIsProjectFilesResizerHovering(false)}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={tFlowChat('layout.resizer.leftAriaLabel')}
                    aria-valuenow={projectFilesWidth}
                    aria-valuemin={MIN_PROJECT_FILES_WIDTH}
                    aria-valuemax={MAX_PROJECT_FILES_WIDTH}
                    title={tFlowChat('layout.resizer.leftAriaLabel')}
                  >
                    <div className="sparo-pane-resizer__line" />
                    <div className="sparo-pane-resizer__handle">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sparo-pane-resizer__icon" aria-hidden>
                        <circle cx="6" cy="4" r="1" fill="currentColor" />
                        <circle cx="6" cy="8" r="1" fill="currentColor" />
                        <circle cx="6" cy="12" r="1" fill="currentColor" />
                        <circle cx="10" cy="4" r="1" fill="currentColor" />
                        <circle cx="10" cy="8" r="1" fill="currentColor" />
                        <circle cx="10" cy="12" r="1" fill="currentColor" />
                      </svg>
                    </div>
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
                <div className="sparo-files-scene__suggestions">
                  <header className="sparo-files-scene__suggestions-title">
                    {t('suggestions.title')}
                  </header>
                  <div className="sparo-files-scene__app-grid">
                    {FILER_SUGGESTIONS.map((id) => (
                      <button
                        key={id}
                        className="sparo-files-scene__app-card"
                        onClick={() => handleFilerSuggestion(id)}
                      >
                        <span className="sparo-files-scene__app-card-icon" aria-hidden>
                          <Bot size={16} />
                        </span>
                        <span className="sparo-files-scene__app-card-body">
                          <strong>{t(`suggestions.${id}.label`)}</strong>
                          <small>{t(`suggestions.${id}.hint`)}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
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
                          <FileTileThumbnail entry={entry} />
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
                  {currentDrive && currentDrive.totalBytes > 0 && (
                    <span className="sparo-files-scene__status-disk">
                      {t('status.disk', {
                        free: formatSize(currentDrive.freeBytes),
                        total: formatSize(currentDrive.totalBytes),
                      })}
                    </span>
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
              if (contextMenu.entry.kind === 'dir') {
                void openSystemPath(contextMenu.entry.path);
              } else {
                void systemFsAPI.openWithDefault(contextMenu.entry.path);
              }
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
              <Star size={13} />
              {t('context.pin')}
            </button>
          </div>
        )}
      </div>
    </CanvasStoreModeContext.Provider>
  );
};

export default FileViewerScene;
