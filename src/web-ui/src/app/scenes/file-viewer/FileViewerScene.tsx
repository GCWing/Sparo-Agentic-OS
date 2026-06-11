import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Bot,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  ExternalLink,
  File as FileIcon,
  FileText,
  Folder,
  FolderInput,
  FolderUp,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  MessageSquarePlus,
  Music,
  Pencil,
  Search,
  SidebarClose,
  SidebarOpen,
  Star,
  Video,
} from 'lucide-react';
import { Button, EmptyState, IconButton, Input, SegmentedControl } from '@/design-system';
import FilesPanel from '../../components/panels/FilesPanel';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { CanvasStoreModeContext } from '../../components/panels/content-canvas/stores';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import { descriptorFromAgentType } from '@/flow_chat/domain/sessionDescriptor';
import {
  fileWorkbenchAPI,
  filesContextAPI,
  pinnedAPI,
  systemFsAPI,
  workspaceAPI,
  type DriveInfo,
  type FileOperationAuditRecord,
  type FileOperationPlan,
  type FileWorkbenchEntry,
  type FileWorkbenchScope,
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
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { addFileMentionToChat } from '@/shared/utils/chatContext';
import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import { openPathAsWorkspace } from '@/shared/utils/openPathAsWorkspace';
import {
  applyFileSelection,
  buildFileContextPack,
  canOpenInSparo,
  consumePendingFileWorkbenchPlanReview,
  decideFileOpenAction,
  FILE_WORKBENCH_REVIEW_PLAN_EVENT,
  filterAndSortEntries,
  getFileCategory,
  getLangFamily,
  getRecencyAttr,
  getSelectionRecommendations,
  imageMimeTypeFromPath,
  isFileWorkbenchPlanReviewEvent,
  keepVisibleSelection,
  recentFileProvider,
  selectAllFiles,
  systemFileProvider,
  toFilesContext,
  type BrowserSortBy,
  type FileCategory,
  type FileEntry,
  type FileScope,
  type SortOrder,
} from '@/tools/file-workbench';
import './FileViewerScene.scss';

const log = createLogger('SparoFilesScene');

type PaneMode = 'workspace' | 'browser' | 'home';
type ViewMode = 'list' | 'grid';

interface DragSelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface DragSelectionStart {
  x: number;
  y: number;
  additive: boolean;
  baseSelectedPaths: Set<string>;
}

const VIEW_MODE_STORAGE_KEY = 'sparo.files.viewMode';
const COL_WIDTHS_STORAGE_KEY = 'sparo.files.colWidths';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sparo.files.sidebarCollapsed';
const PROJECT_FILES_WIDTH_STORAGE_KEY = 'sparo.files.projectFilesWidth';
const RECENT_PATHS_STORAGE_KEY = 'sparo.files.recentPaths';
const DEFAULT_PROJECT_FILES_WIDTH = 300;
const MIN_PROJECT_FILES_WIDTH = 220;
const MAX_PROJECT_FILES_WIDTH = 560;
const MIN_CONTENT_CANVAS_WIDTH = 320;
const MAX_INLINE_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_LOADS = 4;
const MAX_THUMBNAIL_CACHE_ENTRIES = 48;
const MAX_TEXT_PREVIEW_SIZE = 512 * 1024;
const TEXT_PREVIEW_CHARS = 380;
const MAX_TEXT_PREVIEW_LOADS = 4;
const MAX_TEXT_PREVIEW_CACHE_ENTRIES = 64;
const MAX_RECENT_PATHS = 12;
const DRAG_SELECTION_THRESHOLD = 4;

function getCategoryIcon(category: FileCategory): React.ReactElement {
  switch (category) {
    case 'folder':   return React.createElement(Folder,    { size: 11 });
    case 'image':    return React.createElement(ImageIcon, { size: 11 });
    case 'video':    return React.createElement(Video,     { size: 11 });
    case 'audio':    return React.createElement(Music,     { size: 11 });
    case 'archive':  return React.createElement(Archive,   { size: 11 });
    case 'document': return React.createElement(FileText,  { size: 11 });
    case 'text':     return React.createElement(FileText,  { size: 11 });
    default:         return React.createElement(FileIcon,  { size: 11 });
  }
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function getNormalizedSelectionRect(box: DragSelectionBox): DOMRect {
  const left = Math.min(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const width = Math.abs(box.currentX - box.startX);
  const height = Math.abs(box.currentY - box.startY);
  return new DOMRect(left, top, width, height);
}

interface FileViewerSceneProps {
  workspacePath?: string;
}

const FILER_AGENT_TYPE = 'Filer';

// Starter prompts for the single general-purpose Filer agent. These are not separate
// apps - each one launches Filer with a different intent. The current location and
// selection travel to the agent via the stashed FilesContext, so prompts stay generic.
const FILER_SUGGESTIONS = ['organize', 'duplicates', 'space', 'summarize'] as const;

type FilerSuggestionId = (typeof FILER_SUGGESTIONS)[number];

function toWorkbenchApiScope(scope: FileScope): FileWorkbenchScope {
  switch (scope.kind) {
    case 'workspace':
      return { kind: 'workspace', root: scope.root, workspaceId: scope.workspaceId };
    case 'pinned':
      return { kind: 'pinned', pinId: scope.pinId, path: scope.path };
    case 'recent':
      return { kind: 'recent', id: scope.id };
    default:
      return { kind: 'system', root: scope.root };
  }
}

function toWorkbenchApiEntry(entry: FileEntry): FileWorkbenchEntry {
  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    scope: toWorkbenchApiScope(entry.scope),
    size: entry.size,
    modifiedAt: entry.modified,
    category: entry.category,
    hidden: entry.hidden,
    readonly: entry.readonly,
  };
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

function loadRecentPaths(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_PATHS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveRecentPaths(paths: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RECENT_PATHS_STORAGE_KEY, JSON.stringify(paths.slice(0, MAX_RECENT_PATHS)));
}

function thumbnailCacheKey(entry: FsEntry): string {
  return `${entry.path}|${entry.size}|${entry.modified || ''}`;
}

interface ThumbnailTask {
  entry: FsEntry;
  key: string;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

const thumbnailCache = new Map<string, string>();
const failedThumbnailKeys = new Set<string>();
const pendingThumbnails = new Map<string, Promise<string>>();
const thumbnailQueue: ThumbnailTask[] = [];
let activeThumbnailLoads = 0;

function trimThumbnailCache(): void {
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (!oldestKey) return;
    thumbnailCache.delete(oldestKey);
  }
}

function runThumbnailQueue(): void {
  while (activeThumbnailLoads < MAX_THUMBNAIL_LOADS && thumbnailQueue.length > 0) {
    const task = thumbnailQueue.shift();
    if (!task) return;

    activeThumbnailLoads += 1;
    workspaceAPI.readFileContent(task.entry.path)
      .then((content) => {
        const imageUrl = `data:${imageMimeTypeFromPath(task.entry.path)};base64,${toBase64Content(content)}`;
        thumbnailCache.set(task.key, imageUrl);
        failedThumbnailKeys.delete(task.key);
        trimThumbnailCache();
        task.resolve(imageUrl);
      })
      .catch((error) => {
        failedThumbnailKeys.add(task.key);
        task.reject(error);
      })
      .finally(() => {
        activeThumbnailLoads -= 1;
        runThumbnailQueue();
      });
  }
}

function loadQueuedThumbnail(entry: FsEntry): Promise<string> {
  const key = thumbnailCacheKey(entry);
  const cached = thumbnailCache.get(key);
  if (cached) {
    thumbnailCache.delete(key);
    thumbnailCache.set(key, cached);
    return Promise.resolve(cached);
  }

  if (failedThumbnailKeys.has(key)) {
    return Promise.reject(new Error('Thumbnail previously failed'));
  }

  const pending = pendingThumbnails.get(key);
  if (pending) return pending;

  const promise = new Promise<string>((resolve, reject) => {
    thumbnailQueue.push({ entry, key, resolve, reject });
    runThumbnailQueue();
  }).finally(() => {
    pendingThumbnails.delete(key);
  });

  pendingThumbnails.set(key, promise);
  return promise;
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

// ---- Text preview cache ----
const textPreviewCache = new Map<string, string>();
const failedTextPreviewKeys = new Set<string>();
const pendingTextPreviews = new Map<string, Promise<string>>();
const textPreviewQueue: ThumbnailTask[] = [];
let activeTextPreviewLoads = 0;

function textPreviewCacheKey(entry: FsEntry): string {
  return `txt:${entry.path}|${entry.size}|${entry.modified || ''}`;
}

function trimTextPreviewCache(): void {
  while (textPreviewCache.size > MAX_TEXT_PREVIEW_CACHE_ENTRIES) {
    const key = textPreviewCache.keys().next().value;
    if (!key) return;
    textPreviewCache.delete(key);
  }
}

function runTextPreviewQueue(): void {
  while (activeTextPreviewLoads < MAX_TEXT_PREVIEW_LOADS && textPreviewQueue.length > 0) {
    const task = textPreviewQueue.shift();
    if (!task) return;
    activeTextPreviewLoads += 1;
    workspaceAPI.readFileContent(task.entry.path)
      .then((raw) => {
        const text = raw.slice(0, TEXT_PREVIEW_CHARS);
        textPreviewCache.set(task.key, text);
        failedTextPreviewKeys.delete(task.key);
        trimTextPreviewCache();
        task.resolve(text);
      })
      .catch((err) => {
        failedTextPreviewKeys.add(task.key);
        task.reject(err);
      })
      .finally(() => {
        activeTextPreviewLoads -= 1;
        runTextPreviewQueue();
      });
  }
}

function loadTextPreview(entry: FsEntry): Promise<string> {
  const key = textPreviewCacheKey(entry);
  const cached = textPreviewCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  if (failedTextPreviewKeys.has(key)) return Promise.reject(new Error('Text preview previously failed'));
  const pending = pendingTextPreviews.get(key);
  if (pending) return pending;
  const promise = new Promise<string>((resolve, reject) => {
    textPreviewQueue.push({ entry, key, resolve, reject });
    runTextPreviewQueue();
  }).finally(() => {
    pendingTextPreviews.delete(key);
  });
  pendingTextPreviews.set(key, promise);
  return promise;
}

// ---- Folder children cache ----
const folderChildrenCache = new Map<string, FsEntry[]>();
const failedFolderKeys = new Set<string>();

// ---- Sub-components for card previews ----

const TextPreviewContent: React.FC<{ entry: FsEntry }> = React.memo(({ entry }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const shouldLoad = entry.kind !== 'dir' && (!entry.size || entry.size <= MAX_TEXT_PREVIEW_SIZE);

  useEffect(() => {
    setText(null);
    setIsVisible(false);
  }, [entry.path, entry.size, entry.modified]);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const cached = textPreviewCache.get(textPreviewCacheKey(entry));
    if (cached !== undefined) { setText(cached); setIsVisible(true); return undefined; }
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([rec]) => {
      if (rec?.isIntersecting) { setIsVisible(true); observer.disconnect(); }
    }, { root: null, rootMargin: '320px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || !isVisible || text !== null) return undefined;
    let cancelled = false;
    loadTextPreview(entry)
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setText(''); });
    return () => { cancelled = true; };
  }, [entry, isVisible, shouldLoad, text]);

  const langFamily = getLangFamily(entry.name);
  return (
    <div ref={ref} className="sparo-files-scene__card-preview sparo-files-scene__card-preview--text" data-lang={langFamily}>
      {text !== null && text.length > 0 && (
        <div className="sparo-files-scene__card-code">{text}</div>
      )}
    </div>
  );
});
TextPreviewContent.displayName = 'TextPreviewContent';

const FolderMosaicContent: React.FC<{ entry: FsEntry }> = React.memo(({ entry }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setChildren(null);
    setIsVisible(false);
  }, [entry.path]);

  useEffect(() => {
    const cached = folderChildrenCache.get(entry.path);
    if (cached) { setChildren(cached); setIsVisible(true); return undefined; }
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([rec]) => {
      if (rec?.isIntersecting) { setIsVisible(true); observer.disconnect(); }
    }, { root: null, rootMargin: '320px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry.path]);

  useEffect(() => {
    if (!isVisible || children !== null || failedFolderKeys.has(entry.path)) return undefined;
    let cancelled = false;
    systemFsAPI.listDir(entry.path)
      .then((items) => {
        if (cancelled) return;
        const visible = items.filter((i) => !i.hidden).slice(0, 4);
        folderChildrenCache.set(entry.path, visible);
        setChildren(visible);
      })
      .catch(() => {
        if (!cancelled) { failedFolderKeys.add(entry.path); setChildren([]); }
      });
    return () => { cancelled = true; };
  }, [entry.path, isVisible, children]);

  return (
    <div ref={ref} className="sparo-files-scene__card-preview sparo-files-scene__card-preview--folder">
      {children && children.length > 0 ? (
        <ul className="sparo-files-scene__card-mosaic">
          {children.map((child) => (
            <li key={child.path} className="sparo-files-scene__card-mosaic-item" data-kind={child.kind}>
              <span className="sparo-files-scene__card-mosaic-dot" data-kind={child.kind} />
              <span className="sparo-files-scene__card-mosaic-name">{child.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="sparo-files-scene__card-folder-empty" />
      )}
    </div>
  );
});
FolderMosaicContent.displayName = 'FolderMosaicContent';

const CategoryIconContent: React.FC<{ category: FileCategory; entry: FsEntry }> = React.memo(({ category, entry }) => {
  const ext = entry.name.split('.').pop()?.toUpperCase().slice(0, 4) || '';
  return (
    <div className="sparo-files-scene__card-preview sparo-files-scene__card-preview--icon" data-category={category}>
      <span className="sparo-files-scene__card-category-glyph" data-category={category} />
      {ext && <span className="sparo-files-scene__card-ext-badge">{ext}</span>}
    </div>
  );
});
CategoryIconContent.displayName = 'CategoryIconContent';

const ImagePreviewContent: React.FC<{ entry: FsEntry }> = React.memo(({ entry }) => {
  const thumbRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const shouldLoad = !entry.size || entry.size <= MAX_INLINE_THUMBNAIL_BYTES;

  useEffect(() => {
    setIsVisible(false);
    setImageUrl(null);
    setFailed(false);
  }, [entry.path, entry.size, entry.modified]);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const cached = thumbnailCache.get(thumbnailCacheKey(entry));
    if (cached) { setImageUrl(cached); setIsVisible(true); return undefined; }
    const node = thumbRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([rec]) => {
      if (rec?.isIntersecting) { setIsVisible(true); observer.disconnect(); }
    }, { root: null, rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entry, shouldLoad]);

  useEffect(() => {
    let cancelled = false;
    if (!shouldLoad || !isVisible || imageUrl || failed) return () => { cancelled = true; };
    loadQueuedThumbnail(entry)
      .then((url) => { if (!cancelled) setImageUrl(url); })
      .catch((err) => {
        if (cancelled) return;
        log.debug('Failed to load file tile thumbnail', { path: entry.path, error: err });
        setFailed(true);
      });
    return () => { cancelled = true; };
  }, [entry, failed, imageUrl, isVisible, shouldLoad]);

  return (
    <div ref={thumbRef} className="sparo-files-scene__card-preview sparo-files-scene__card-preview--image">
      {imageUrl && !failed && (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      )}
    </div>
  );
});
ImagePreviewContent.displayName = 'ImagePreviewContent';

// ---- Main tile card ----

interface FileTileCardProps {
  entry: FsEntry;
  tRecency: (key: string, opts?: Record<string, string>) => string;
}

const FileTileCard: React.FC<FileTileCardProps> = React.memo(({ entry, tRecency }) => {
  const category = getFileCategory(entry);

  let preview: React.ReactNode;
  if (category === 'image') {
    preview = <ImagePreviewContent entry={entry} />;
  } else if (category === 'text') {
    preview = <TextPreviewContent entry={entry} />;
  } else if (category === 'folder') {
    preview = <FolderMosaicContent entry={entry} />;
  } else {
    preview = <CategoryIconContent category={category} entry={entry} />;
  }

  const recency = getRecencyAttr(entry.modified);
  const recencyTitle = recency === 'today'
    ? tRecency('recency.today', {
        time: entry.modified
          ? new Date(entry.modified).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
          : '',
      })
    : recency === 'week'
      ? tRecency('recency.week', {
          weekday: entry.modified
            ? new Date(entry.modified).toLocaleDateString(undefined, { weekday: 'long' })
            : '',
        })
      : null;

  return (
    <div className="sparo-files-scene__card">
      {preview}
      {recencyTitle && (
        <span
          className="sparo-files-scene__card-recency-dot"
          data-recency={recency}
          title={recencyTitle}
          aria-label={recencyTitle}
        />
      )}
      <div className="sparo-files-scene__card-footer">
        <div className="sparo-files-scene__card-footer-row">
          <span className="sparo-files-scene__card-footer-icon" data-category={category}>
            {getCategoryIcon(category)}
          </span>
          <span className="sparo-files-scene__card-name">{entry.name}</span>
        </div>
        <span className="sparo-files-scene__card-meta">
          {entry.kind === 'dir' ? '' : formatSize(entry.size)}
        </span>
      </div>
    </div>
  );
});

FileTileCard.displayName = 'FileTileCard';

const FileViewerScene: React.FC<FileViewerSceneProps> = ({ workspacePath }) => {
  const { t } = useTranslation('scenes/files');
  const { t: tFlowChat } = useTranslation('flow-chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const browserMainRef = useRef<HTMLDivElement>(null);
  const workspaceSplitRef = useRef<HTMLDivElement>(null);
  const projectFilesPaneRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const dragSelectionStartRef = useRef<DragSelectionStart | null>(null);
  const suppressNextEntryClickRef = useRef(false);
  const [mode, setMode] = useState<PaneMode>(workspacePath ? 'workspace' : 'home');
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [quickFolders, setQuickFolders] = useState<QuickFolder[]>([]);
  const [pinned, setPinned] = useState<PinnedPath[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>(loadRecentPaths);
  const [currentPath, setCurrentPath] = useState(workspacePath || '');
  const [systemEntries, setSystemEntries] = useState<FileEntry[]>([]);
  const [selectedEntries, setSelectedEntries] = useState<FileEntry[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [browserSearchQuery, setBrowserSearchQuery] = useState('');
  const [browserSortBy, setBrowserSortBy] = useState<BrowserSortBy>('name');
  const [browserSortOrder, setBrowserSortOrder] = useState<SortOrder>('asc');
  const [dragSelectionBox, setDragSelectionBox] = useState<DragSelectionBox | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pathDraft, setPathDraft] = useState(workspacePath || '');
  const [editingAddress, setEditingAddress] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return stored === 'grid' ? 'grid' : 'list';
  });

  const [colWidths, setColWidths] = useState<{ name: number; modified: number; size: number }>(() => {
    if (typeof window === 'undefined') return { name: 220, modified: 120, size: 80 };
    try {
      const stored = window.localStorage.getItem(COL_WIDTHS_STORAGE_KEY);
      if (stored) return JSON.parse(stored) as { name: number; modified: number; size: number };
    } catch { /* ignore */ }
    return { name: 220, modified: 120, size: 80 };
  });

  const startColResize = useCallback((col: 'name' | 'modified' | 'size', startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startWidth = colWidths[col];
    const minWidth = col === 'size' ? 60 : 80;

    const onMove = (e: MouseEvent) => {
      const next = Math.max(minWidth, startWidth + e.clientX - startX);
      setColWidths((prev) => ({ ...prev, [col]: next }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setColWidths((prev) => {
        try { window.localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
        return prev;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  });
  const [projectFilesWidth, setProjectFilesWidth] = useState(loadProjectFilesWidth);
  const [isProjectFilesResizing, setIsProjectFilesResizing] = useState(false);
  const [isProjectFilesResizerHovering, setIsProjectFilesResizerHovering] = useState(false);
  const [loadingPath, setLoadingPath] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationPlan, setOperationPlan] = useState<FileOperationPlan | null>(null);
  const [operationPlanSource, setOperationPlanSource] = useState<'selection' | 'external' | null>(null);
  const [operationPlanLoading, setOperationPlanLoading] = useState(false);
  const [operationPlanError, setOperationPlanError] = useState<string | null>(null);
  const [operationPlanExecuting, setOperationPlanExecuting] = useState(false);
  const [operationPlanAudit, setOperationPlanAudit] = useState<FileOperationAuditRecord | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const entryHover = useMovingHoverHighlight<HTMLUListElement>();
  const contextMenuHover = useMovingHoverHighlight<HTMLDivElement>();
  const effectiveWorkspacePath = workspacePath || activeWorkspace?.rootPath;

  const activeFileScope = useMemo<FileScope>(() => (
    currentPath.startsWith('recent:')
        ? { kind: 'recent', id: currentPath }
      : mode === 'workspace'
      ? { kind: 'workspace', root: effectiveWorkspacePath || currentPath || '' }
      : { kind: 'system', root: currentPath || undefined, permission: 'auto' }
  ), [currentPath, effectiveWorkspacePath, mode]);

  const selectedContextPack = useMemo(() => buildFileContextPack({
    scope: activeFileScope,
    cwd: currentPath || effectiveWorkspacePath || '',
    workspaceRoot: mode === 'workspace' ? effectiveWorkspacePath : undefined,
    selection: selectedEntries,
    recentlyOpenedPaths: history.slice(-5),
  }), [activeFileScope, currentPath, effectiveWorkspacePath, history, mode, selectedEntries]);

  const selectedContext = useMemo<FilesContext>(
    () => toFilesContext(selectedContextPack),
    [selectedContextPack],
  );

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
      const entries = await systemFileProvider.listDir(nextPath);
      setCurrentPath(nextPath);
      setPathDraft(nextPath);
      setSystemEntries(entries);
      setSelectedEntries([]);
      setSelectionAnchorPath(null);
      setBrowserSearchQuery('');
      setEditingAddress(false);
      setRecentPaths((previous) => {
        const next = [nextPath, ...previous.filter((path) => path !== nextPath)].slice(0, MAX_RECENT_PATHS);
        saveRecentPaths(next);
        return next;
      });
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
    // Ensure workspace state is loaded - initialize() is idempotent, so this is a
    // no-op when the main app has already initialized, but it populates the list
    // when the Files scene mounts in a context that hasn't (e.g. a standalone window).
    void workspaceManager.initialize().then(refreshWorkspaceState);
    refreshWorkspaceState();
    void refreshSystemRoots();
    return remove;
  }, [refreshSystemRoots, refreshWorkspaceState]);

  useEffect(() => {
    if (effectiveWorkspacePath) {
      setMode('workspace');
      setCurrentPath(effectiveWorkspacePath);
      setPathDraft(effectiveWorkspacePath);
      setSelectedEntries([]);
      setSelectionAnchorPath(null);
      setBrowserSearchQuery('');
      return;
    }

    setMode('home');
    setCurrentPath('');
    setPathDraft('');
    setSelectedEntries([]);
    setSelectionAnchorPath(null);
    setBrowserSearchQuery('');
    setSidebarCollapsed(false);
  }, [effectiveWorkspacePath]);

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

  const handleOpenPathAsWorkspace = useCallback(async (path: string) => {
    const workspace = await openPathAsWorkspace(path);
    setMode('workspace');
    setCurrentPath(workspace.rootPath);
    setPathDraft(workspace.rootPath);
    setSelectedEntries([]);
    setEditingAddress(false);
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
      workspacePath: effectiveWorkspacePath || currentPath,
    }, descriptorFromAgentType(agentType));
    await filesContextAPI.stash(sessionId, selectedContext);
    await manager.sendMessage(prompt, sessionId, prompt, agentType, agentType);
  }, [currentPath, effectiveWorkspacePath, selectedContext]);

  const handleAskSparo = useCallback(() => {
    void startFilesSession(
      FILER_AGENT_TYPE,
      `Help me with this location: ${selectedContext.cwd}`
    );
  }, [selectedContext.cwd, startFilesSession]);

  const handleFilesAgent = useCallback((entry?: FileEntry) => {
    const target = entry?.path || selectedEntries.map((item) => item.path).join(', ') || selectedContext.cwd;
    void startFilesSession(
      FILER_AGENT_TYPE,
      `Help me reason about and operate on this file selection: ${target}`
    );
  }, [selectedContext.cwd, selectedEntries, startFilesSession]);

  const handleFilerSuggestion = useCallback((id: FilerSuggestionId) => {
    void startFilesSession(FILER_AGENT_TYPE, t(`suggestions.${id}.prompt`));
  }, [startFilesSession, t]);

  const handleRevealEntry = useCallback(async (entry: FileEntry) => {
    await systemFsAPI.revealInOs(entry.path);
  }, []);

  const isCurrentPinned = useMemo(
    () => currentPath && !currentPath.startsWith('recent:')
      ? pinned.some((p) => p.path === currentPath)
      : false,
    [currentPath, pinned],
  );

  const handleTogglePin = useCallback(async () => {
    if (!currentPath || currentPath.startsWith('recent:')) return;
    if (isCurrentPinned) {
      const entry = pinned.find((p) => p.path === currentPath);
      if (entry) await pinnedAPI.remove(entry.id);
    } else {
      await pinnedAPI.add(currentPath, basename(currentPath));
    }
    const next = await pinnedAPI.list();
    setPinned(next.paths);
  }, [currentPath, isCurrentPinned, pinned]);

  const handleOpenRecentPaths = useCallback(async () => {
    setMode('browser');
    setLoadingPath(true);
    setError(null);
    try {
      const entries = await recentFileProvider.list(recentPaths);
      setCurrentPath('recent:paths');
      setPathDraft(t('activity.recent'));
      setSystemEntries(entries);
      setSelectedEntries([]);
      setSelectionAnchorPath(null);
      setBrowserSearchQuery('');
      setEditingAddress(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPath(false);
    }
  }, [recentPaths, t]);

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
  const primarySelectedEntry = selectedEntries[0] ?? null;
  const selectedTotalSize = selectedContextPack.summary.totalSize;
  const selectedCategoryCounts = selectedContextPack.summary.categories;
  const selectedRecommendations = useMemo(
    () => getSelectionRecommendations(selectedEntries),
    [selectedEntries],
  );
  const hasPlanRecommendation = useMemo(
    () => selectedRecommendations.some((recommendation) => recommendation.requiresPlan),
    [selectedRecommendations],
  );

  const currentDrive = useMemo(() => {
    if (!currentPath || drives.length === 0) return null;
    const lowerPath = currentPath.toLowerCase();
    return [...drives]
      .filter((drive) => lowerPath.startsWith(drive.mount.toLowerCase()))
      .sort((a, b) => b.mount.length - a.mount.length)[0] ?? null;
  }, [currentPath, drives]);

  const sortedEntries = useMemo(
    () => filterAndSortEntries(systemEntries, browserSearchQuery, browserSortBy, browserSortOrder),
    [browserSearchQuery, browserSortBy, browserSortOrder, systemEntries],
  );

  useEffect(() => {
    setSelectedEntries((previous) => keepVisibleSelection(previous, sortedEntries));
  }, [sortedEntries]);

  const dragSelectionStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!dragSelectionBox || !browserMainRef.current) return undefined;
    const hostRect = browserMainRef.current.getBoundingClientRect();
    const selectionRect = getNormalizedSelectionRect(dragSelectionBox);
    return {
      left: selectionRect.left - hostRect.left,
      top: selectionRect.top - hostRect.top,
      width: selectionRect.width,
      height: selectionRect.height,
    };
  }, [dragSelectionBox]);

  const applyDragSelection = useCallback((box: DragSelectionBox, start: DragSelectionStart) => {
    const host = browserMainRef.current;
    if (!host) return;

    const selectionRect = getNormalizedSelectionRect(box);
    const selectedPaths = new Set<string>();
    host.querySelectorAll<HTMLElement>('[data-files-entry-path]').forEach((element) => {
      const path = element.dataset.filesEntryPath;
      if (path && rectsIntersect(selectionRect, element.getBoundingClientRect())) {
        selectedPaths.add(path);
      }
    });

    const nextSelectedEntries = sortedEntries.filter((entry) => (
      selectedPaths.has(entry.path) || (start.additive && start.baseSelectedPaths.has(entry.path))
    ));

    if (operationPlanSource === 'external') {
      setOperationPlanSource(null);
    }
    setSelectedEntries(nextSelectedEntries);
    setSelectionAnchorPath(nextSelectedEntries[0]?.path ?? null);
  }, [operationPlanSource, sortedEntries]);

  const reviewExternalOperationPlan = useCallback((plan: FileOperationPlan) => {
    setOperationPlan(plan);
    setOperationPlanSource('external');
    setOperationPlanLoading(false);
    setOperationPlanError(null);
    setOperationPlanAudit(null);
    setOperationPlanExecuting(false);

    const planPath = plan.cwd?.trim();
    if (
      planPath &&
      !planPath.startsWith('recent:') &&
      plan.scope.kind !== 'workspace'
    ) {
      void openSystemPath(planPath, false);
    }
  }, [openSystemPath]);

  useEffect(() => {
    const pending = consumePendingFileWorkbenchPlanReview();
    if (pending) {
      reviewExternalOperationPlan(pending.plan);
    }

    const handlePlanReview = (event: Event) => {
      if (!isFileWorkbenchPlanReviewEvent(event)) {
        return;
      }
      reviewExternalOperationPlan(event.detail.plan);
    };

    window.addEventListener(FILE_WORKBENCH_REVIEW_PLAN_EVENT, handlePlanReview);
    return () => {
      window.removeEventListener(FILE_WORKBENCH_REVIEW_PLAN_EVENT, handlePlanReview);
    };
  }, [reviewExternalOperationPlan]);

  useEffect(() => {
    let cancelled = false;

    if (operationPlanSource === 'external') {
      return undefined;
    }

    setOperationPlan(null);
    setOperationPlanSource(null);
    setOperationPlanError(null);
    setOperationPlanAudit(null);

    if (!hasPlanRecommendation || selectedEntries.length === 0 || !selectedContextPack.cwd) {
      setOperationPlanLoading(false);
      return undefined;
    }

    setOperationPlanLoading(true);
    fileWorkbenchAPI.planOperations({
      scope: toWorkbenchApiScope(activeFileScope),
      cwd: selectedContextPack.cwd,
      selection: selectedEntries.map(toWorkbenchApiEntry),
      intent: {
        title: t('workbench.planDraftTitle'),
        operationType: 'delete-to-trash',
        reason: t('workbench.planDraftReason'),
      },
    })
      .then((plan) => {
        if (!cancelled) {
          setOperationPlan(plan);
        }
      })
      .catch((err) => {
        if (!cancelled) setOperationPlanError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setOperationPlanLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFileScope, hasPlanRecommendation, operationPlanSource, selectedContextPack.cwd, selectedEntries, t]);

  const operationPlanExecutable = useMemo(() => {
    if (!operationPlan) return false;
    if (operationPlan.summary.highRiskCount > 0) return false;
    return operationPlan.items.some((item) => {
      if (!item.included) return false;
      if (item.operationType === 'move' || item.operationType === 'rename' || item.operationType === 'copy') {
        return Boolean(item.sourcePath && item.targetPath);
      }
      if (item.operationType === 'mkdir') {
        return Boolean(item.targetPath || item.sourcePath);
      }
      if (item.operationType === 'delete-to-trash' || item.operationType === 'delete-permanent') {
        return Boolean(item.sourcePath);
      }
      if (item.operationType === 'archive' || item.operationType === 'extract') {
        return Boolean(item.sourcePath);
      }
      return false;
    });
  }, [operationPlan]);

  const handleExecuteOperationPlan = useCallback(async () => {
    if (!operationPlan || !operationPlanExecutable) return;
    setOperationPlanExecuting(true);
    setOperationPlanError(null);
    setOperationPlanAudit(null);
    try {
      const audit = await fileWorkbenchAPI.executePlan({
        plan: operationPlan,
        confirmationToken: `confirm:${operationPlan.id}`,
      });
      setOperationPlanAudit(audit);
      const refreshPaths = Array.from(
        new Set(audit.results.flatMap((result) => result.refreshPaths)),
      );
      if (refreshPaths.includes(currentPath)) {
        await openSystemPath(currentPath, false);
      }
    } catch (err) {
      setOperationPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setOperationPlanExecuting(false);
    }
  }, [currentPath, openSystemPath, operationPlan, operationPlanExecutable]);

  useEffect(() => {
    let cancelled = false;
    setPreviewText(null);
    setPreviewLoading(false);

    if (!primarySelectedEntry || getFileCategory(primarySelectedEntry) !== 'text') {
      return undefined;
    }

    setPreviewLoading(true);
    loadTextPreview(primarySelectedEntry)
      .then((text) => {
        if (!cancelled) setPreviewText(text);
      })
      .catch(() => {
        if (!cancelled) setPreviewText('');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [primarySelectedEntry]);

  const handleEntrySelect = useCallback((
    entry: FileEntry,
    event: React.MouseEvent,
  ) => {
    if (suppressNextEntryClickRef.current) {
      suppressNextEntryClickRef.current = false;
      return;
    }
    const next = applyFileSelection(sortedEntries, {
      selectedEntries,
      anchorPath: selectionAnchorPath,
    }, entry, {
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
    if (operationPlanSource === 'external') {
      setOperationPlanSource(null);
    }
    setSelectedEntries(next.selectedEntries);
    setSelectionAnchorPath(next.anchorPath);
  }, [operationPlanSource, selectedEntries, selectionAnchorPath, sortedEntries]);

  const handleBrowserMainPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const targetElement = event.target instanceof Element ? event.target : null;
    if (
      event.button !== 0 ||
      loadingPath ||
      sortedEntries.length === 0 ||
      targetElement?.closest(
        'button, input, textarea, select, a, [contenteditable="true"], .sparo-files-scene__browser-toolbar, .sparo-files-scene__entry-head, .sparo-files-scene__col-resize',
      )
    ) {
      return;
    }

    const start: DragSelectionStart = {
      x: event.clientX,
      y: event.clientY,
      additive: event.ctrlKey || event.metaKey,
      baseSelectedPaths: new Set(selectedEntries.map((entry) => entry.path)),
    };
    dragSelectionStartRef.current = start;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const activeStart = dragSelectionStartRef.current;
      if (!activeStart) return;

      const movedFarEnough =
        Math.abs(moveEvent.clientX - activeStart.x) >= DRAG_SELECTION_THRESHOLD ||
        Math.abs(moveEvent.clientY - activeStart.y) >= DRAG_SELECTION_THRESHOLD;

      if (!movedFarEnough && !dragSelectionBox) return;

      moveEvent.preventDefault();
      suppressNextEntryClickRef.current = true;
      const nextBox = {
        startX: activeStart.x,
        startY: activeStart.y,
        currentX: moveEvent.clientX,
        currentY: moveEvent.clientY,
      };
      setDragSelectionBox(nextBox);
      applyDragSelection(nextBox, activeStart);
    };

    const handlePointerUp = () => {
      dragSelectionStartRef.current = null;
      setDragSelectionBox(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [applyDragSelection, dragSelectionBox, loadingPath, selectedEntries, sortedEntries]);

  const handleSelectAllEntries = useCallback(() => {
    const next = selectAllFiles(sortedEntries);
    if (operationPlanSource === 'external') {
      setOperationPlanSource(null);
    }
    setSelectedEntries(next.selectedEntries);
    setSelectionAnchorPath(next.anchorPath);
  }, [operationPlanSource, sortedEntries]);

  const handleOpenInSparo = useCallback((entry: FileEntry) => {
    if (!canOpenInSparo(entry)) return;
    openFileInBestTarget({
      filePath: entry.path,
      fileName: entry.name,
      workspacePath: effectiveWorkspacePath,
    }, { source: 'project-nav' });
  }, [effectiveWorkspacePath]);

  const handleOpenExternally = useCallback((entry: FileEntry) => {
    if (entry.kind === 'dir') {
      void openSystemPath(entry.path);
      return;
    }
    void systemFsAPI.openWithDefault(entry.path);
  }, [openSystemPath]);

  const handlePrimaryEntryOpen = useCallback((entry: FileEntry) => {
    const decision = decideFileOpenAction(entry);
    if (decision.primary === 'openFolder') void openSystemPath(entry.path);
    if (decision.primary === 'openInSparo') handleOpenInSparo(entry);
    if (decision.primary === 'openExternal') void systemFsAPI.openWithDefault(entry.path);
  }, [handleOpenInSparo, openSystemPath]);

  const handleAddEntryToChat = useCallback((entry: FileEntry) => {
    addFileMentionToChat({
      path: entry.path,
      name: entry.name,
      isDirectory: entry.kind === 'dir',
    }, effectiveWorkspacePath);
  }, [effectiveWorkspacePath]);

  const handleAddSelectionToChat = useCallback(() => {
    selectedEntries.forEach((entry) => handleAddEntryToChat(entry));
  }, [handleAddEntryToChat, selectedEntries]);

  const handleCopyPath = useCallback(async (entry: FileEntry) => {
    await navigator.clipboard.writeText(entry.path);
  }, []);

  const handleSortChange = useCallback((nextSortBy: BrowserSortBy) => {
    setBrowserSortBy((previous) => {
      if (previous === nextSortBy) {
        setBrowserSortOrder((order) => order === 'asc' ? 'desc' : 'asc');
        return previous;
      }
      setBrowserSortOrder(nextSortBy === 'name' || nextSortBy === 'type' ? 'asc' : 'desc');
      return nextSortBy;
    });
  }, []);

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

  const renderWorkbench = () => {
    const hasSelection = selectedEntries.length > 0;
    const selectedLabel = selectedEntries.length === 1 && primarySelectedEntry
      ? primarySelectedEntry.name
      : t('workbench.selectionCount', { count: selectedEntries.length });
    const primaryCategory = primarySelectedEntry ? getFileCategory(primarySelectedEntry) : null;
    const renderOperationPlanSection = () => (operationPlanLoading || operationPlan || operationPlanError) ? (
      <section className="sparo-files-scene__workbench-section">
        <header className="sparo-files-scene__workbench-section-title">
          {t('workbench.plan')}
        </header>
        <div className="sparo-files-scene__plan-card" data-testid="files-operation-plan">
          <div className="sparo-files-scene__plan-card-header">
            <strong>{operationPlan?.title ?? t('workbench.planDraftTitle')}</strong>
            <span>
              {operationPlanLoading
                ? t('workbench.planLoading')
                : operationPlanError
                  ? t('workbench.planUnavailable')
                  : t('workbench.planItems', { count: operationPlan?.summary.total ?? 0 })}
            </span>
          </div>
          <p>{operationPlanError || t('workbench.planDraftDescription')}</p>
          {operationPlan && (
            <div className="sparo-files-scene__plan-meta">
              <span>{t('workbench.planHighRisk', { count: operationPlan.summary.highRiskCount })}</span>
              <span>{t('workbench.planConflicts', { count: operationPlan.summary.conflictCount })}</span>
            </div>
          )}
          {operationPlan && (
            <Button
              size="small"
              variant="secondary"
              disabled={!operationPlanExecutable || operationPlanExecuting}
              onClick={() => void handleExecuteOperationPlan()}
            >
              {operationPlanExecuting
                ? t('workbench.planExecuting')
                : operationPlanExecutable
                  ? t('workbench.confirmExecute')
                  : t('workbench.planNeedsTarget')}
            </Button>
          )}
          {operationPlanAudit && (
            <div
              className="sparo-files-scene__plan-audit"
              data-success={operationPlanAudit.success}
            >
              {operationPlanAudit.success
                ? t('workbench.planExecuted')
                : t('workbench.planPartiallyFailed')}
              <span>{t('workbench.planResultItems', { count: operationPlanAudit.results.length })}</span>
            </div>
          )}
        </div>
      </section>
    ) : null;

    return (
      <aside className="sparo-files-scene__workbench" data-testid="files-workbench-pane">
        <header className="sparo-files-scene__workbench-header">
          <span className="sparo-files-scene__workbench-eyebrow">{t('workbench.title')}</span>
          <strong>{hasSelection ? selectedLabel : t('workbench.emptyTitle')}</strong>
        </header>

        {!hasSelection ? (
          <>
            <div className="sparo-files-scene__workbench-empty">
              <Eye size={18} />
              <p>{t('workbench.emptyDescription')}</p>
            </div>
            {renderOperationPlanSection()}
          </>
        ) : (
          <>
            <section className="sparo-files-scene__workbench-section">
              <div className="sparo-files-scene__summary-grid">
                <span>
                  <small>{t('workbench.items')}</small>
                  <strong>{selectedEntries.length}</strong>
                </span>
                <span>
                  <small>{t('workbench.totalSize')}</small>
                  <strong>{formatSize(selectedTotalSize)}</strong>
                </span>
              </div>
              {selectedCategoryCounts.length > 0 && (
                <div className="sparo-files-scene__category-row">
                  {selectedCategoryCounts.slice(0, 4).map(({ category, count }) => (
                    <span key={category} className="sparo-files-scene__category-chip">
                      {getCategoryIcon(category)}
                      {t(`categories.${category}`)} {count}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {primarySelectedEntry && (
              <section className="sparo-files-scene__workbench-section">
                <header className="sparo-files-scene__workbench-section-title">
                  {t('workbench.preview')}
                </header>
                <div className="sparo-files-scene__preview-card" data-category={primaryCategory || 'other'}>
                  {primaryCategory === 'image' ? (
                    <ImagePreviewContent entry={primarySelectedEntry} />
                  ) : primaryCategory === 'text' ? (
                    <div className="sparo-files-scene__preview-text">
                      {previewLoading ? (
                        <span className="sparo-files-scene__preview-muted">{t('workbench.previewLoading')}</span>
                      ) : previewText ? (
                        <pre>{previewText}</pre>
                      ) : (
                        <span className="sparo-files-scene__preview-muted">{t('workbench.previewUnavailable')}</span>
                      )}
                    </div>
                  ) : primaryCategory === 'folder' ? (
                    <FolderMosaicContent entry={primarySelectedEntry} />
                  ) : (
                    <div className="sparo-files-scene__preview-icon">
                      {primaryCategory && getCategoryIcon(primaryCategory)}
                      <span>{primaryCategory ? t(`categories.${primaryCategory}`) : t('categories.other')}</span>
                    </div>
                  )}
                </div>
                <dl className="sparo-files-scene__metadata-list">
                  <div>
                    <dt>{t('columns.name')}</dt>
                    <dd title={primarySelectedEntry.name}>{primarySelectedEntry.name}</dd>
                  </div>
                  <div>
                    <dt>{t('columns.modified')}</dt>
                    <dd>{formatModified(primarySelectedEntry.modified) || t('workbench.unknown')}</dd>
                  </div>
                  <div>
                    <dt>{t('columns.size')}</dt>
                    <dd>{primarySelectedEntry.kind === 'dir' ? t('browser.folder') : formatSize(primarySelectedEntry.size)}</dd>
                  </div>
                </dl>
              </section>
            )}

            <section className="sparo-files-scene__workbench-section">
              <header className="sparo-files-scene__workbench-section-title">
                {t('workbench.actions')}
              </header>
              {selectedRecommendations.length > 0 && (
                <div className="sparo-files-scene__recommendation-row">
                  {selectedRecommendations.slice(0, 5).map((recommendation) => (
                    <span
                      key={recommendation.id}
                      className="sparo-files-scene__recommendation-chip"
                      data-priority={recommendation.priority}
                    >
                      {t(`recommendations.${recommendation.id}`)}
                      {recommendation.requiresPlan && (
                        <small>{t('workbench.requiresPlan')}</small>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <div className="sparo-files-scene__action-grid">
                {primarySelectedEntry && canOpenInSparo(primarySelectedEntry) && (
                  <Button size="small" variant="secondary" onClick={() => handleOpenInSparo(primarySelectedEntry)}>
                    {t('actions.openInSparo')}
                  </Button>
                )}
                {primarySelectedEntry && (
                  <Button size="small" variant="ghost" onClick={() => handleOpenExternally(primarySelectedEntry)}>
                    {primarySelectedEntry.kind === 'dir' ? t('context.open') : t('actions.openExternally')}
                  </Button>
                )}
                <Button size="small" variant="ghost" onClick={handleAddSelectionToChat}>
                  {t('actions.addToChat')}
                </Button>
                <Button size="small" variant="ghost" onClick={() => void handleFilesAgent(primarySelectedEntry ?? undefined)}>
                  {t('context.ask')}
                </Button>
                {primarySelectedEntry?.kind === 'dir' && (
                  <Button size="small" variant="ghost" onClick={() => void handleOpenPathAsWorkspace(primarySelectedEntry.path)}>
                    {t('context.openAsWorkspace')}
                  </Button>
                )}
                {primarySelectedEntry && (
                  <Button size="small" variant="ghost" onClick={() => void handleRevealEntry(primarySelectedEntry)}>
                    {t('context.reveal')}
                  </Button>
                )}
              </div>
            </section>

            {renderOperationPlanSection()}
          </>
        )}
      </aside>
    );
  };

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
            data-testid="files-address-input"
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
          data-testid="files-address-button"
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
      <IconButton
        aria-label={t('actions.openAsWorkspace')}
        tooltip={t('actions.openAsWorkspace')}
        size="small"
        variant="ghost"
        disabled={!currentPath || currentPath.startsWith('recent:')}
        onClick={() => void handleOpenPathAsWorkspace(currentPath)}
      >
        <FolderInput size={13} />
      </IconButton>
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
              <SidebarClose size={14} />
            </IconButton>
          </header>

          <div className="sparo-files-scene__sidebar-scroll">
            {sidebarWorkspaces.length > 0 && renderSection('workspaces', t('activity.workspaces'),
              sidebarWorkspaces.slice(0, 8).map((workspace) => {
                const isActive = mode === 'workspace' && activeWorkspace?.id === workspace.id;
                return (
                  <button
                    key={workspace.id}
                    className={[
                      'sparo-files-scene__row',
                      'sparo-files-scene__row--workspace',
                      isActive && 'is-active',
                    ].filter(Boolean).join(' ')}
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
                  data-testid="files-quick-folder"
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
                  data-testid="files-drive"
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

            {recentPaths.length > 0 && renderSection('recent', t('activity.recent'),
              <button
                className="sparo-files-scene__row sparo-files-scene__row--compact"
                onClick={() => void handleOpenRecentPaths()}
                data-testid="files-recent-paths"
              >
                <Clock3 size={13} />
                <span className="sparo-files-scene__row-text">
                  <strong>{t('activity.recent')}</strong>
                  <small>{recentPaths[0]}</small>
                </span>
              </button>,
              recentPaths.length,
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
                <SidebarOpen size={14} />
              </IconButton>
            )}
            <div className="sparo-files-scene__nav">
              <IconButton
                aria-label={t('actions.back')}
                tooltip={t('actions.back')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || currentPath.startsWith('recent:') || historyIndex <= 0}
                onClick={handleBack}
              >
                <ArrowLeft size={14} />
              </IconButton>
              <IconButton
                aria-label={t('actions.forward')}
                tooltip={t('actions.forward')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || currentPath.startsWith('recent:') || historyIndex >= history.length - 1}
                onClick={handleForward}
              >
                <ArrowRight size={14} />
              </IconButton>
              <IconButton
                aria-label={t('actions.up')}
                tooltip={t('actions.up')}
                size="small"
                variant="ghost"
                disabled={mode !== 'browser' || currentPath.startsWith('recent:') || !currentPath}
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
                aria-label={t('actions.pin')}
                tooltip={t('actions.pin')}
                size="small"
                variant="ghost"
                disabled={!currentPath || currentPath.startsWith('recent:')}
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
                    data-area="file-explorer"
                    data-workspace-root={effectiveWorkspacePath}
                    data-file-list="true"
                    style={{ width: projectFilesWidth }}
                  >
                    <FilesPanel workspacePath={effectiveWorkspacePath} hideHeader hideExplorerToolbar />
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
                  <ContentCanvas workspacePath={effectiveWorkspacePath} mode="project" />
                </div>
              </div>
            ) : mode === 'home' ? (
              <div className="sparo-files-scene__home">
                <div className="sparo-files-scene__home-hero">
                  <div className="sparo-files-scene__hero-halo" aria-hidden />
                  <EmptyState
                    className="sparo-files-scene__home-empty"
                    image={<span aria-hidden />}
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
              <div
                className="sparo-files-scene__browser"
                data-testid="files-browser"
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                    event.preventDefault();
                    handleSelectAllEntries();
                  }
                }}
                tabIndex={0}
              >
                <div className="sparo-files-scene__browser-layout">
                  <div
                    ref={browserMainRef}
                    className="sparo-files-scene__browser-main"
                    onPointerDown={handleBrowserMainPointerDown}
                  >
                    <div className="sparo-files-scene__browser-toolbar">
                      <Input
                        variant="filled"
                        size="small"
                        value={browserSearchQuery}
                        prefix={<Search size={13} />}
                        onChange={(event) => setBrowserSearchQuery(event.target.value)}
                        placeholder={t('browser.searchPlaceholder')}
                        data-testid="files-browser-search"
                      />
                      <SegmentedControl
                        size="small"
                        ariaLabel={t('browser.sortBy')}
                        value={browserSortBy}
                        onChange={(value) => handleSortChange(value as BrowserSortBy)}
                        options={[
                          { value: 'name', label: t('columns.name') },
                          { value: 'modified', label: t('columns.modified') },
                          { value: 'size', label: t('columns.size') },
                          { value: 'type', label: t('columns.type') },
                        ]}
                      />
                      <IconButton
                        aria-label={t('browser.toggleSortOrder')}
                        tooltip={t('browser.toggleSortOrder')}
                        size="small"
                        variant="ghost"
                        onClick={() => setBrowserSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                      >
                        <ArrowUpDown size={13} />
                      </IconButton>
                    </div>

                    {error && <div className="sparo-files-scene__error">{error}</div>}
                    {loadingPath ? (
                      <div className="sparo-files-scene__empty">{t('browser.loading')}</div>
                    ) : sortedEntries.length === 0 ? (
                      <div className="sparo-files-scene__empty">
                        {browserSearchQuery.trim() ? t('browser.noResults') : t('browser.noPath')}
                      </div>
                    ) : viewMode === 'grid' ? (
                      <ul className="sparo-files-scene__entry-grid" role="listbox">
                        {sortedEntries.map((entry) => {
                          const isSelected = selectedEntries.some((item) => item.path === entry.path);
                          const recency = getRecencyAttr(entry.modified);
                          const category = getFileCategory(entry);
                          return (
                            <li
                              key={entry.path}
                              className={isSelected ? 'sparo-files-scene__tile is-selected' : 'sparo-files-scene__tile'}
                              role="option"
                              aria-selected={isSelected}
                              title={entry.name}
                              data-recency={recency}
                              data-category={category}
                              data-files-entry-path={entry.path}
                              data-testid="files-browser-entry"
                              onClick={(event) => handleEntrySelect(entry, event)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                if (!selectedEntries.some((item) => item.path === entry.path)) {
                                  setSelectedEntries([entry]);
                                  setSelectionAnchorPath(entry.path);
                                }
                                setContextMenu({ x: event.clientX, y: event.clientY, entry });
                              }}
                              onDoubleClick={() => handlePrimaryEntryOpen(entry)}
                            >
                              <FileTileCard entry={entry} tRecency={t} />
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div
                        className="sparo-files-scene__entry-table"
                        style={{
                          '--col-name': `${colWidths.name}px`,
                          '--col-modified': `${colWidths.modified}px`,
                          '--col-size': `${colWidths.size}px`,
                        } as React.CSSProperties}
                      >
                        <div className="sparo-files-scene__entry-head" role="row">
                          <button className="sparo-files-scene__entry-head-cell" onClick={() => handleSortChange('name')}>
                            {t('columns.name')}
                            <span className="sparo-files-scene__col-resize" onMouseDown={(e) => {
                              e.stopPropagation();
                              startColResize('name', e);
                            }} />
                          </button>
                          <button className="sparo-files-scene__entry-head-cell" onClick={() => handleSortChange('modified')}>
                            {t('columns.modified')}
                            <span className="sparo-files-scene__col-resize" onMouseDown={(e) => {
                              e.stopPropagation();
                              startColResize('modified', e);
                            }} />
                          </button>
                          <button className="sparo-files-scene__entry-head-cell" onClick={() => handleSortChange('size')}>
                            {t('columns.size')}
                          </button>
                        </div>
                        <ul
                          ref={entryHover.surfaceRef}
                          className="sparo-files-scene__entry-list sparo-files-scene__entry-list--motion"
                          role="listbox"
                          {...entryHover.getSurfaceHandlers('.sparo-files-scene__entry')}
                        >
                          <li
                            className="sparo-files-scene__entry-hover-highlight"
                            style={{
                              transform: `translate3d(${entryHover.highlight.left}px, ${entryHover.highlight.top}px, 0) scale(${entryHover.highlight.stretchX}, ${entryHover.highlight.stretchY})`,
                              width: `${entryHover.highlight.width}px`,
                              height: `${entryHover.highlight.height}px`,
                              opacity: entryHover.highlight.visible ? 1 : 0,
                            }}
                            aria-hidden
                          />
                          {sortedEntries.map((entry) => {
                            const isSelected = selectedEntries.some((item) => item.path === entry.path);
                            return (
                              <li
                                key={entry.path}
                                className={isSelected ? 'sparo-files-scene__entry is-selected' : 'sparo-files-scene__entry'}
                                role="option"
                                aria-selected={isSelected}
                                data-files-entry-path={entry.path}
                                data-testid="files-browser-entry"
                                onClick={(event) => handleEntrySelect(entry, event)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  if (!selectedEntries.some((item) => item.path === entry.path)) {
                                    setSelectedEntries([entry]);
                                    setSelectionAnchorPath(entry.path);
                                  }
                                  setContextMenu({ x: event.clientX, y: event.clientY, entry });
                                }}
                                onDoubleClick={() => handlePrimaryEntryOpen(entry)}
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
                                  {entry.kind === 'dir' ? '-' : formatSize(entry.size)}
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
                    {dragSelectionStyle && (
                      <div
                        className="sparo-files-scene__drag-selection"
                        style={dragSelectionStyle}
                        aria-hidden
                      />
                    )}
                  </div>
                  {renderWorkbench()}
                </div>
              </div>
            )}
          </div>
        </main>

        {contextMenu && (
          <div
            ref={contextMenuHover.surfaceRef}
            className="sparo-files-scene__context-menu sparo-files-scene__context-menu--motion"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            {...contextMenuHover.getSurfaceHandlers('button[role="menuitem"]')}
          >
            <div
              className="sparo-files-scene__context-menu-hover-highlight"
              style={{
                transform: `translate3d(${contextMenuHover.highlight.left}px, ${contextMenuHover.highlight.top}px, 0) scale(${contextMenuHover.highlight.stretchX}, ${contextMenuHover.highlight.stretchY})`,
                width: `${contextMenuHover.highlight.width}px`,
                height: `${contextMenuHover.highlight.height}px`,
                opacity: contextMenuHover.highlight.visible ? 1 : 0,
              }}
              aria-hidden
            />
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              handlePrimaryEntryOpen(contextMenu.entry);
            }}>
              <ExternalLink size={13} />
              {t('context.open')}
            </button>
            {canOpenInSparo(contextMenu.entry) && (
              <button role="menuitem" onClick={() => {
                setContextMenu(null);
                handleOpenInSparo(contextMenu.entry);
              }}>
                <FileText size={13} />
                {t('actions.openInSparo')}
              </button>
            )}
            {contextMenu.entry.kind !== 'dir' && (
              <button role="menuitem" onClick={() => {
                setContextMenu(null);
                void systemFsAPI.openWithDefault(contextMenu.entry.path);
              }}>
                <ExternalLink size={13} />
                {t('actions.openExternally')}
              </button>
            )}
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              void handleFilesAgent(contextMenu.entry);
            }}>
              <Bot size={13} />
              {t('context.ask')}
            </button>
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              handleAddEntryToChat(contextMenu.entry);
            }}>
              <MessageSquarePlus size={13} />
              {t('actions.addToChat')}
            </button>
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              void handleCopyPath(contextMenu.entry);
            }}>
              <Copy size={13} />
              {t('actions.copyPath')}
            </button>
            <button role="menuitem" onClick={() => {
              setContextMenu(null);
              void handleRevealEntry(contextMenu.entry);
            }}>
              <Folder size={13} />
              {t('context.reveal')}
            </button>
            {contextMenu.entry.kind === 'dir' && (
              <button role="menuitem" onClick={() => {
                setContextMenu(null);
                void handleOpenPathAsWorkspace(contextMenu.entry.path);
              }}>
                <FolderInput size={13} />
                {t('context.openAsWorkspace')}
              </button>
            )}
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
